// Repro for the user's report: "after killing a single king the game
// ended — it must only end when ALL kings are killed."
// Also scans for born-mated starts. Run: node test/repro-king-bug.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const engineSrc = blocks.find(s => s.includes('module.exports'));
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
const E = sandbox.module.exports;

// --- The user's exact scenario ---
// White: K e1, R a1, B c3, P g6. Black: K a8, K h8.
// White Rxa8 captures ONE black king. The remaining black king on h8 is
// then in check (rook on a8 along the rank, bishop on c3 on the diagonal)
// with every escape covered (g8 by the rook, g7 by the bishop, h7 by the pawn).
const board = new Array(64).fill(null);
board[60] = { t: 'K', c: 'w' };           // Ke1
board[56] = { t: 'R', c: 'w' };           // Ra1
board[42] = { t: 'B', c: 'w' };           // Bc3
board[22] = { t: 'P', c: 'w' };           // Pg6
board[0] = { t: 'K', c: 'b' };            // Ka8
board[7] = { t: 'K', c: 'b' };            // Kh8
const st = E.newGame('pieces', 1, board);
console.log('start over?', st.over);
const mv = E.doMove(st, { from: 56, to: 0 });
console.log('Rxa8 played?', !!mv);
console.log('black kings left:', E.countKings(st.board, 'b'));
console.log('game over?', st.over, '| winner:', st.winner, '| reason:', st.reason);
if (st.over && E.countKings(st.board, 'b') > 0) {
  console.log('BUG REPRODUCED: game ended while Black still has a king.');
} else {
  console.log('OK: game continues with a king still alive.');
}

// --- How often does this happen in real random games? ---
// Play random games; count games that end by checkmate/stalemate while
// the loser still has >= 1 king.
let total = 0, endedWithKings = 0, kingCaptures = 0;
for (let s = 1; s <= 200; s++) {
  for (const mode of ['pieces', 'everything']) {
    const g = E.newGame(mode, s * 7919 + 3);
    let guard = 0;
    while (!g.over && guard++ < 2000) {
      const m = E.botMove(g, 'easy');
      if (!m) break;
      const before = E.countKings(g.board, g.turn === 'w' ? 'b' : 'w');
      const beforeKings = { w: E.countKings(g.board, 'w'), b: E.countKings(g.board, 'b') };
      E.doMove(g, m);
      const afterKings = { w: E.countKings(g.board, 'w'), b: E.countKings(g.board, 'b') };
      if (afterKings.w < beforeKings.w || afterKings.b < beforeKings.b) kingCaptures++;
    }
    total++;
    if (g.over && g.winner) {
      const loserKings = E.countKings(g.board, g.winner === 'w' ? 'b' : 'w');
      if (loserKings > 0 && /checkmate|stalemate/i.test(g.reason)) endedWithKings++;
    }
  }
}
console.log(`\nrandom games: ${total}, king captures: ${kingCaptures}, games ended by mate/stalemate with loser kings alive: ${endedWithKings}`);

// --- Born-mated scan (is newGame's re-roll sound?) ---
let bornBad = 0;
for (let s = 1; s <= 10000; s++) {
  for (const mode of ['pieces', 'everything']) {
    const g = E.newGame(mode, s);
    const wk = E.countKings(g.board, 'w'), bk = E.countKings(g.board, 'b');
    if (g.over && wk > 0 && bk > 0) bornBad++;
  }
}
console.log('born-over with both sides having kings (20k games):', bornBad);
