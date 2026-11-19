# Worker relay (optional)

The game does **not** need this to play — multiplayer runs peer-to-peer via
PeerJS and the site is a static file on Cloudflare Pages.

This folder is the optional upgrade path: a Cloudflare Worker fronting one
Durable Object per room. The object holds the two WebSockets, broadcasts
moves, and stores the latest game state so a player who refreshes can rejoin
and get the board back.

## Deploy

```bash
cd worker
# uncomment the [[durable_objects.bindings]] + [[migrations]] block in
# the repo-root wrangler.toml first (or copy wrangler.worker.toml there)
npx wrangler deploy
```

Then a client connects to `wss://<your-worker>/room?room=CODE` instead of
using PeerJS. Wiring that switch into `index.html` is a small, deliberate
change — the message shapes (`setup`, `move`, `state`, `resign`, `rematch`)
are intentionally the same as the PeerJS path, so only the transport changes.

## Cost

Cloudflare Workers + Durable Objects free tier covers casual play
(100k requests/day on Workers; Durable Objects include a free allowance).
For a hobby game with friends, expect $0.
