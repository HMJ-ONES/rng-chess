// RNG Chess engine tests — extracts the pure engine <script> from index.html
// and runs it in Node. No DOM needed.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// engine block is the one exporting via module.exports
const engineSrc = blocks.find(s => s.includes('module.exports'));
if (!engineSrc) { console.error('FAIL: engine script block not found'); process.exit(1); }

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
const E = sandbox.module.exports;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
function allSeeds(n, fn) { for (let s = 1; s <= n; s++) fn(s); }

console.log('Mode 1 — Random Pieces:');
allSeeds(200, s => {
  const { board } = E.genSetup('pieces', s);
  const w = E.countPieces(board, 'w'), b = E.countPieces(board, 'b');
  if (w !== 16 || b !== 16) throw new Error('seed ' + s + ': counts ' + w + '/' + b);
  for (let i = 0; i < 64; i++) {
    const r = (i / 8) | 0;
    const occupied = !!board[i];
    const shouldBe = (r === 6 || r === 7) || (r === 0 || r === 1);
    if (occupied !== shouldBe) throw new Error('seed ' + s + ': square ' + i + ' occupancy wrong');
    if (occupied) {
      const want = r >= 6 ? 'w' : 'b';
      if (board[i].c !== want) throw new Error('seed ' + s + ': wrong colour at ' + i);
    }
  }
});
check('200 seeds: exactly 16 pieces/side, only on ranks 1-2 / 7-8, correct colours', true);
{
  // distribution: piece types actually vary, kings vary incl. 0 and multiples
  const kingCounts = new Set(); let sawZero = false, sawMulti = false, sawQueen = false;
  allSeeds(500, s => {
    const { board } = E.genSetup('pieces', s);
    const k = E.countKings(board, 'w'); kingCounts.add(k);
    if (k === 0) sawZero = true; if (k > 1) sawMulti = true;
    if (E.pieceCounts(board, 'w').Q > 0) sawQueen = true;
  });
  check('king counts vary across seeds (saw ' + [...kingCounts].sort().join(',') + ')', kingCounts.size >= 3);
  check('some setups have 0 white kings', sawZero);
  check('some setups have 2+ white kings', sawMulti);
  check('queens appear', sawQueen);
  // determinism: same seed -> identical board
  const a = JSON.stringify(E.genSetup('pieces', 42).board);
  const b = JSON.stringify(E.genSetup('pieces', 42).board);
  check('same seed reproduces identical board', a === b);
}

console.log('Mode 2 — RANDOM EVERYTHING:');
{
  let sawEmpty = false, sawFullish = false, sawZeroKingsBoth = false, minTotal = 99, maxTotal = -1;
  allSeeds(500, s => {
    const { board } = E.genSetup('everything', s);
    const t = E.countPieces(board, 'w') + E.countPieces(board, 'b');
    minTotal = Math.min(minTotal, t); maxTotal = Math.max(maxTotal, t);
    if (t === 0) sawEmpty = true; if (t > 50) sawFullish = true;
    if (E.countKings(board, 'w') === 0 && E.countKings(board, 'b') === 0) sawZeroKingsBoth = true;
    // no pawn stranded on last rank
    for (let i = 0; i < 64; i++) {
      const p = board[i]; if (!p || p.t !== 'P') continue;
      const r = (i / 8) | 0;
      if ((p.c === 'w' && r === 0) || (p.c === 'b' && r === 7)) throw new Error('pawn on last rank, seed ' + s);
    }
    // no overlapping pieces (array model guarantees it, but count squares)
    if (board.filter(Boolean).length !== t) throw new Error('overlap, seed ' + s);
  });
  check('total pieces vary (min ' + minTotal + ', max ' + maxTotal + ')', minTotal < 10 && maxTotal > 50);
  check('some boards nearly empty / very full', sawEmpty || maxTotal > 50);
  check('some boards have zero kings on both sides', sawZeroKingsBoth);
}

console.log('Win / loss rules:');
{
  // no-king auto-loss at setup
  let foundWhiteZero = 0, foundBlackZero = 0;
  for (let s = 1; s <= 2000 && (foundWhiteZero < 1 || foundBlackZero < 1); s++) {
    const st = E.newGame('pieces', s);
    if (E.countKings(st.board, 'w') === 0) { check('0 white kings -> black wins immediately (seed ' + s + ')', st.over && st.winner === 'b'); foundWhiteZero++; }
    if (E.countKings(st.board, 'b') === 0) { check('0 black kings -> white wins immediately (seed ' + s + ')', st.over && st.winner === 'w'); foundBlackZero++; }
  }
  // multi-king: capturing ONE king does not end the game
  // Build a custom board: white K a1 + K b1, black K h8, white Q a2. White QxK is illegal? No — Q a2 to h8 is not a queen line.
  // Simpler: white: K e1, K e2, R a1; black: K a8. R a1xa8 captures the only black king -> white wins.
  const board = new Array(64).fill(null);
  board[60] = { t: 'K', c: 'w' }; board[52] = { t: 'K', c: 'w' }; board[56] = { t: 'R', c: 'w' };
  board[0] = { t: 'K', c: 'b' };
  const st = E.newGame('pieces', 1, board);
  check('custom 2-king board is not over at start', !st.over);
  const mv = E.doMove(st, { from: 56, to: 0 });
  check('rook captures last black king', !!mv && st.over && st.winner === 'w');
  // Capturing one of TWO kings leaves game running
  const board2 = new Array(64).fill(null);
  board2[60] = { t: 'K', c: 'w' };
  board2[56] = { t: 'R', c: 'w' };
  board2[0] = { t: 'K', c: 'b' }; board2[1] = { t: 'K', c: 'b' };
  const st2 = E.newGame('pieces', 1, board2);
  const mv2 = E.doMove(st2, { from: 56, to: 0 });
  check('capturing 1 of 2 kings does NOT end game', !!mv2 && !st2.over && E.countKings(st2.board, 'b') === 1);
}

console.log('Move legality:');
{
  // Standard-ish position: white K e1, white P e2, black K e8, black R e7? No — use a pin test:
  // White K e1, white N e2 pinned by black R e8 down the file; N e2->g3 must be illegal.
  const board = new Array(64).fill(null);
  board[60] = { t: 'K', c: 'w' }; board[52] = { t: 'N', c: 'w' };
  board[4] = { t: 'K', c: 'b' }; board[12] = { t: 'R', c: 'b' };
  const st = E.newGame('pieces', 1, board);
  const moves = E.legalMoves(st);
  const knightMoves = moves.filter(m => m.from === 52);
  check('pinned knight has no legal moves', knightMoves.length === 0, 'got ' + knightMoves.length);
  // Knight moves exist when not pinned
  const boardB = new Array(64).fill(null);
  boardB[60] = { t: 'K', c: 'w' }; boardB[52] = { t: 'N', c: 'w' }; boardB[4] = { t: 'K', c: 'b' };
  const stB = E.newGame('pieces', 1, boardB);
  check('unpinned knight has moves', E.legalMoves(stB).filter(m => m.from === 52).length > 0);
  // Pawn double move + en passant square, then capture
  const boardC = new Array(64).fill(null);
  boardC[60] = { t: 'K', c: 'w' }; boardC[52] = { t: 'P', c: 'w' }; boardC[35] = { t: 'P', c: 'b' };
  boardC[4] = { t: 'K', c: 'b' };
  const stC = E.newGame('pieces', 1, boardC);
  const dbl = E.doMove(stC, { from: 52, to: 36 });
  check('pawn double move works', !!dbl && stC.ep === 44);
  const epMoves = E.legalMoves(stC).filter(m => m.ep);
  check('en passant capture is offered', epMoves.length === 1 && epMoves[0].from === 35 && epMoves[0].to === 44);
  // Illegal move rejected
  const bad = E.doMove(stC, { from: 35, to: 34 });
  check('illegal move (pawn sideways) rejected', bad === null);
  // Promotion: white pawn a7 -> a8 promotes
  const boardD = new Array(64).fill(null);
  boardD[60] = { t: 'K', c: 'w' }; boardD[8] = { t: 'P', c: 'w' }; boardD[4] = { t: 'K', c: 'b' };
  const stD = E.newGame('pieces', 1, boardD);
  const pm = E.doMove(stD, { from: 8, to: 0, promotion: 'N' });
  check('promotion to knight works', !!pm && stD.board[0].t === 'N');
}

console.log('Full random games terminate sensibly (bot vs bot):');
{
  let wins = 0, draws = 0, errors = 0;
  for (let s = 1; s <= 30; s++) {
    try {
      const st = E.newGame(s % 2 ? 'pieces' : 'everything', s * 7919);
      let guard = 0;
      while (!st.over && guard < 400) {
        const m = E.botMove(st, 'medium');
        if (!m) break;
        E.doMove(st, m); guard++;
      }
      if (st.over) { if (st.winner) wins++; else draws++; }
      else { errors++; console.log('  (seed ' + s + ' did not finish in 400 plies — likely repetition guard)'); }
    } catch (e) { errors++; console.log('  ERROR seed ' + s + ': ' + e.message); }
  }
  check('30 bot-vs-bot games: 0 engine errors', errors === 0);
  check('bot games end in wins or draws (' + wins + ' wins, ' + draws + ' draws)', wins + draws === 30);
}

console.log('Serialization round-trip:');
{
  const st = E.newGame('everything', 99);
  E.doMove(st, E.botMove(st, 'easy') || { from: 0, to: 0 });
  const s2 = E.deserializeState(E.serializeState(st));
  check('state survives serialize/deserialize', JSON.stringify(s2.board) === JSON.stringify(st.board) && s2.turn === st.turn);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
