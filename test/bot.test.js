// Bot stress test: the bot (Black) must ALWAYS produce a move when the
// game is not over and it is Black's turn. Any null/throw/slow result
// is a "bot thinks forever" repro. Run: node test/bot.test.js
const fs = require('fs');
const path = require('path');

function loadEngine() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const engine = scripts.find(([, src]) => src.includes('module.exports'));
  if (!engine) throw new Error('engine script not found');
  const [, src] = engine;
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}

const E = loadEngine();
let failures = 0;
let games = 0, plies = 0, botMoves = 0, draws = 0, wins = 0;
let maxBotMs = 0, maxLegalMs = 0;
const fail = (msg) => { failures++; console.log('FAIL: ' + msg); };

function playBotGame(mode, seed, difficulty) {
  const st = E.newGame(mode, seed);
  if (st.over) return; // 0-king instant loss etc — no bot turn expected
  let guard = 0;
  while (!st.over && guard++ < 600) {
    // White (stand-in player): random legal move
    let t0 = Date.now();
    const wm = E.legalMoves(st);
    let dt = Date.now() - t0; if (dt > maxLegalMs) maxLegalMs = dt;
    if (st.turn !== 'w') { fail(`turn desync (expected w) mode=${mode} seed=${seed}`); return; }
    if (wm.length === 0) { fail(`White has no legal moves but game not over mode=${mode} seed=${seed}`); return; }
    const pick = wm[Math.floor(Math.random() * wm.length)];
    const r1 = E.doMove(st, pick);
    if (!r1) { fail(`doMove rejected a legal White move mode=${mode} seed=${seed}`); return; }
    plies++;
    if (st.over) break;
    // Black (bot): must move
    if (st.turn !== 'b') { fail(`turn desync (expected b) mode=${mode} seed=${seed}`); return; }
    t0 = Date.now();
    let bm;
    try { bm = E.botMove(st, difficulty); }
    catch (e) { fail(`botMove threw (${e.message}) mode=${mode} seed=${seed} difficulty=${difficulty}`); return; }
    dt = Date.now() - t0; if (dt > maxBotMs) maxBotMs = dt;
    if (dt > 2000) fail(`botMove slow: ${dt}ms mode=${mode} seed=${seed}`);
    if (!bm) { fail(`botMove returned null but game NOT over mode=${mode} seed=${seed} difficulty=${difficulty} turn=${st.turn} over=${st.over} history=${st.history.length}`); return; }
    botMoves++;
    const r2 = E.doMove(st, bm);
    if (!r2) { fail(`doMove rejected the bot's own move mode=${mode} seed=${seed} from=${bm.from} to=${bm.to}`); return; }
    plies++;
  }
  games++;
  if (st.over) { if (st.winner) wins++; else draws++; }
  else fail(`game did not terminate within 600 plies mode=${mode} seed=${seed}`);
}

// Full bot games across seeds / modes / difficulties
for (const mode of ['pieces', 'everything']) {
  for (let seed = 1; seed <= 150; seed++) {
    playBotGame(mode, seed, 'medium');
    playBotGame(mode, seed + 10000, 'easy');
  }
}

// Exhaustive: after EVERY legal first White move, the bot must have a reply
for (const mode of ['pieces', 'everything']) {
  for (let seed = 1; seed <= 25; seed++) {
    const st0 = E.newGame(mode, seed);
    if (st0.over) continue;
    const firsts = E.legalMoves(st0);
    for (const f of firsts) {
      const st = E.newGame(mode, seed);
      E.doMove(st, f);
      if (st.over) continue;
      if (st.turn !== 'b') { fail(`after first move turn is ${st.turn}`); continue; }
      let bm;
      try { bm = E.botMove(st, 'medium'); } catch (e) { fail(`botMove threw after first move: ${e.message}`); continue; }
      if (!bm) fail(`botMove null after first move ${f.from}->${f.to} mode=${mode} seed=${seed} history=${st.history.length} over=${st.over}`);
      else botMoves++;
    }
  }
}

console.log(`\nbot games: ${games}, plies: ${plies}, bot moves made: ${botMoves}, wins: ${wins}, draws: ${draws}`);
console.log(`max legalMoves: ${maxLegalMs}ms, max botMove: ${maxBotMs}ms`);
console.log(failures === 0 ? 'BOT TEST: ALL OK' : `BOT TEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
