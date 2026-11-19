// Optional server path for RNG Chess: Cloudflare Worker + Durable Object relay.
//
// The game itself does NOT need this — multiplayer runs peer-to-peer via
// PeerJS and the site is a static file on Cloudflare Pages ($0).
// This is here for later, if you want rooms that survive a refresh and
// server-side matchmaking. It is NOT wired into index.html by default.
//
// Deploy:  cd worker && npx wrangler deploy
//   (wrangler.toml at the repo root has the binding commented out;
//    uncomment it, or copy this folder's wrangler.worker.toml over it.)
//
// Protocol (JSON over WebSocket, same message shapes as the PeerJS path):
//   client -> server: {t:'hello', room, name}
//                       {t:'move', move:{from,to,promotion?}}
//                       {t:'setup', mode, seed, board}   (host only)
//                       {t:'state', state}               (host resync)
//                       {t:'resign', by}
//                       {t:'rematch', mode, seed, guestColor}
//   server -> client: the same messages, broadcast to the other socket
//                     in the room, plus {t:'joined', players} and
//                     {t:'state', state} (stored state replayed on rejoin).

export class RngRoom {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
    this.savedState = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/room' && request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      // Replay the stored game state to a rejoining player.
      if (this.savedState) server.send(JSON.stringify({ t: 'state', state: this.savedState }));
      server.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'state' || msg.t === 'setup') this.savedState = msg.state || msg;
        for (const s of this.sockets) {
          if (s !== server) {
            try { s.send(JSON.stringify(msg)); } catch { /* peer gone */ }
          }
        }
      });
      const close = () => this.sockets.delete(server);
      server.addEventListener('close', close);
      server.addEventListener('error', close);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('RNG Chess room relay. Use a WebSocket client.', { status: 200 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const room = (url.searchParams.get('room') || '').toUpperCase();
    if (!room) return new Response('Pass ?room=CODE', { status: 400 });
    const id = env.RNG_ROOM.idFromName('rngchess-' + room);
    const stub = env.RNG_ROOM.get(id);
    return stub.fetch(request);
  },
};
