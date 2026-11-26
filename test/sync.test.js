// RNG Chess sync test — two copies of the real page script in separate VM
// contexts, joined by a fake in-memory PeerJS transport with a drop switch.
// Proves: setup arrives (or is re-requested), every move updates BOTH
// boards, and a dropped message heals itself via ack/resend + heartbeat.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const engineSrc = blocks.find(s => s.includes('module.exports'));
const uiSrc = blocks.find(s => s.includes('attachConn'));

// NOTE: this fake DOM does NOT model innerHTML destroying child elements,
// so a UI null-deref that only happens in a real browser (e.g. the v1.1
// `$('statusSub')` crash — statusBox's innerHTML wiped out #statusSub, so
// every render() threw and the bot's timeout was never scheduled) cannot be
// caught here. UI crashes need a real-browser check; engine rules are fully
// covered by test/engine.test.js instead.
function makeEl() {
  return {
    style: {}, dataset: {}, children: [], _l: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    innerHTML: '', textContent: '', value: '', className: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { this._l[ev] = fn; },
    click() { if (this._l.click) this._l.click(); },
  };
}
function makeCtx() {
  const els = {};
  const sandbox = {
    console,
    location: { search: '', origin: 'https://rng-chess.pages.dev', pathname: '/', href: 'https://rng-chess.pages.dev/' },
    navigator: {},
    window: {},
    document: {
      getElementById(id) { return (els[id] = els[id] || makeEl()); },
      createElement() { return makeEl(); },
      addEventListener() {},
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, crypto,
    module: { exports: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  vm.runInContext(uiSrc, sandbox);
  return sandbox;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

async function runScenario(name, dropFn, movesToMake, custom = false) {
  console.log('Scenario: ' + name);
  const host = makeCtx(), guest = makeCtx();
  const sent = { host: [], guest: [] };
  let drop = dropFn;
  function deliver(from, obj) {
    const copy = JSON.parse(JSON.stringify(obj));
    (from === 'host' ? sent.host : sent.guest).push(copy);
    if (drop && drop(from, copy)) return; // message lost in transit
    const target = from === 'host' ? guestConn : hostConn;
    setImmediate(() => target.emit('data', JSON.parse(JSON.stringify(copy))));
  }
  function makeConn(who) {
    const handlers = {};
    return {
      open: false,
      on(ev, fn) { handlers[ev] = fn; },
      emit(ev, arg) { if (handlers[ev]) handlers[ev](arg); },
      send(obj) { deliver(who, obj); },
      close() { this.open = false; if (handlers.close) handlers.close(); },
    };
  }
  const hostConn = makeConn('host'), guestConn = makeConn('guest');
  const E = host.module.exports;

  let config;
  if (custom) {
    const field = id => host.document.getElementById(id);
    field('customSetup').checked = true;
    field('axisCenter').value = 'K';
    field('axisDistribution').value = 'uniform';
    for (const type of E.TYPES) {
      field('dist' + type).value = 'poisson';
      field('mean' + type).valueAsNumber = 2;
    }
    field('customSetup').onchange();
    config = host.setupFromMenu();
    check('advanced menu shows the calculated final weight', field('weightK').textContent === '16.67%');
  }
  host.startGame('pieces', 1234, { config, playMode: 'online', myColor: 'w', isHost: true, roomCode: 'TEST', connText: 'test' });
  host.attachConn(hostConn, true);
  guest.attachConn(guestConn, false);
  hostConn.open = true; hostConn.emit('open');
  guestConn.open = true; guestConn.emit('open');
  await sleep(300);
  // Guest must have the board (hello-retry heals a dropped setup).
  const guestGotBoard = sent.guest.some(m => m.t === 'ack') || sent.host.some(m => m.t === 'state');
  check('guest received the board', guestGotBoard);
  if (custom) {
    const game = ctx => ctx.document.getElementById('gameScreen');
    const weights = host.document.getElementById('xabinskiWeights');
    check('the Xabinski screen gates play on both peers before showing weights',
      game(host).inert && game(guest).inert && !weights.innerHTML);
    await sleep(3400);
    check('the comparison shows crossed-out old weights next to the new weights',
      game(host).inert && weights.innerHTML.includes('<del>16.67%</del></td><td>16.67%</td>'));
    await sleep(3500);
    check('play is available after the weight comparison', !game(host).inert && !game(guest).inert);
  }

  // Play movesToMake plies, alternating host/guest, via the real UI entry point.
  for (let ply = 0; ply < movesToMake; ply++) {
    // Current position = the longest-history state either side has sent.
    const states = [...sent.host, ...sent.guest].filter(m => m.t === 'state');
    const last = states.reduce((best, m) => (!best || m.state.history.length > best.state.history.length ? m : best), null);
    if (!last) { check('move ' + ply + ': a state is known', false); break; }
    const st = E.deserializeState(last.state);
    const moves = E.legalMoves(st);
    if (!moves.length) break;
    const mv = moves[0];
    const side = st.turn === 'w' ? host : guest;
    side.finishMove(mv.from, mv.to, mv.promotion);
    await sleep(600);
  }
  await sleep(4500); // let resends + heartbeat reconcile finish
  // Compare board fingerprints from the latest ping/state each side sent.
  const lastPing = who => [...sent[who]].reverse().find(m => m.t === 'ping');
  const hp = lastPing('host'), gp = lastPing('guest');
  check('both sides sent heartbeats', !!hp && !!gp, 'host:' + !!hp + ' guest:' + !!gp);
  if (hp && gp) {
    check('board fingerprints match after ' + movesToMake + ' plies (host n=' + hp.n + ' hash=' + hp.hash + ', guest n=' + gp.n + ' hash=' + gp.hash + ')', hp.n === gp.n && hp.hash === gp.hash);
  }
  if (custom) {
    check('guest receives the custom setup and axis',
      vm.runInContext('JSON.stringify(state.config)', guest) === JSON.stringify(config));
    host.requestRematch();
    await sleep(100);
    const snapshot = ctx => vm.runInContext('JSON.stringify(serializeState(state))', ctx);
    check('custom rematch regenerates the same board on both peers', snapshot(host) === snapshot(guest));
  }
  // Cleanup timers so the process can exit.
  host.backToMenu(); guest.backToMenu();
  await sleep(50);
  return true;
}

(async () => {
  await runScenario('custom setup and rematch: no drops, 4 plies', null, 4, true);
  await runScenario('dropped setup: first host state lost, 2 plies', (from, m) => from === 'host' && m.t === 'state' && !runScenario._setupDropped ? (runScenario._setupDropped = true) : false, 2);
  runScenario._setupDropped = false;
  let droppedMove = false;
  await runScenario('dropped move: one host state lost, 4 plies', (from, m) => {
    if (from === 'host' && m.t === 'state' && m.state.history.length === 1 && !droppedMove) { droppedMove = true; return true; }
    return false;
  }, 4);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
