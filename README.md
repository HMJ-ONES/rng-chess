# 🎲 RNG Chess

**A free browser chess variant. Every game is a new roll. No two boards alike.**

Play it right now — no sign-up, no download, no cost. PC, mobile, and (probably not) your calculator.

## The game

Normal chess moves. Completely abnormal starting positions.

### Mode 1 — Random Pieces
All 16 pieces per side spawn on the normal starting squares (ranks 1–2 for White, 7–8 for Black) — but **which** piece lands on each square is completely random. Multiple kings, zero kings, five queens… anything goes.

### Mode 2 — RANDOM EVERYTHING
Piece count is random. Piece types are random. Squares are random. No limits. A board can have 0 pieces or 64. If you start with no king, you lose on the spot.

### The rules that make it work
- **Win by killing kings.** If a side has several kings, **all** of them must be captured. Capturing one just thins the herd.
- **King counts follow a discretized Rayleigh distribution** with continuous mean 1. Each side with pieces has a 5% chance of zero kings. One king is the most common result, and higher counts are progressively rarer. An empty side always has zero kings. Boards with kings on both sides and no opening move for White are re-rolled up to the 100-attempt limit.
- **Otherwise, normal chess.** Pawns, knights, bishops, rooks, queens and kings move the usual way. Pawns promote on the last rank (you pick the piece). En passant works. There is **no castling** — with random pieces it would be chaos.
- **Kings are captured like any other piece.** If your king is attacked and you don't save it, it dies — you lose only when your last king falls. There is no checkmate.
- **Only the last king matters:** the game ends only when a side loses its last king. If a side has no moves at all, that's stalemate — a draw. Threefold repetition and the 50-move rule are draws too.
- **White moves first.** The room creator plays White; colours swap on rematch.
- Every setup is generated from a visible **seed**, so a board can be reproduced and verified.

## How to play

| Button | What it does |
|---|---|
| **Create room** | Generates a 4-letter room code. Send it to a friend — they type it in and join. |
| **Join room** | Enter a friend's room code. |
| **Play anyone** | Matchmaking: you either wait in a lobby slot or join a stranger already waiting in one. |
| **Play the bot** | Solo vs a bot (Easy = random, Medium = greedy). |
| **Local 2-player** | Same screen, pass & play. |

A room link also works: open `https://<your-site>/?room=KQ7B` and the code is filled in for you.

## $0 architecture — how multiplayer is free

There is **no game server**. The whole game is one static file (`index.html`):

- **Hosting:** Cloudflare Pages (free tier) serves the static site.
- **Multiplayer:** peer-to-peer WebRTC via [PeerJS](https://peerjs.com/)'s free public broker (`0.peerjs.com`). Room codes are PeerJS peer IDs; moves travel directly between the two browsers. Nothing about your game is stored anywhere.
- **Sync that heals itself:** every move sends the full board state (not just the move), the other side acknowledges it, unacknowledged states are resent automatically, the joiner keeps asking for the board until it arrives, and both sides compare board fingerprints every few seconds — a lost message repairs itself instead of desyncing the game. Proven by `test/sync.test.js`, which runs two copies of the real page script over a fake network that drops messages.
- **Cost:** $0. No database, no backend to keep awake, no accounts.

Because the game is fully client-side, it also works offline for bot and local games (once loaded).

## Run it locally

```bash
# any static server works — the game is a single file
python3 -m http.server 8000
# open http://localhost:8000/
```

Tests (engine only, no browser needed):

```bash
node test/engine.test.js   # 23 checks: setups, multi-king wins, pins, en passant, promotion, bot games
```

## Deploy to Cloudflare Pages ($0)

**Option A — dashboard (easiest, 2 minutes)**
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Pick this repo. Framework preset: **None**. Build command: *(empty)*. Output directory: `/` (the repo root — `index.html` is there).
4. Deploy. You get `https://rng-chess.pages.dev` free.

**Option B — CLI**
```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name rng-chess
```

**Custom domain (optional):** Pages → Custom domains → add yours. Still free.

## Optional: server-authoritative rooms (Cloudflare Worker + Durable Object)

The PeerJS path above is the default and needs nothing else. If you later want rooms that survive a player refreshing, or server-side matchmaking, `worker/` contains a minimal Durable Object relay (one object per room, WebSocket broadcast + stored state). It is **not required** to play, and it is not wired into `index.html` by default.

```bash
cd worker
npx wrangler deploy   # needs a free Cloudflare account; Durable Objects free tier applies
```

See `worker/README.md` for details.

## Files

```
index.html            the whole game (engine + UI + multiplayer), single file
test/engine.test.js   engine unit tests (node)
worker/               optional Cloudflare Worker + Durable Object relay
wrangler.toml         Cloudflare Pages/Workers config
README.md             this file
LICENSE               MIT
```

## License

MIT — do what you want with it.
