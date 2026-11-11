import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * Vite plugin that runs a lightweight WebSocket relay alongside the dev server.
 *
 * Remote tracker pages connect as `role: "tracker"` and send hand-landmark
 * messages.  The game page connects as `role: "game"` and receives them.
 * The relay simply forwards every tracking message from trackers to games.
 */
export function wsRelayPlugin(): Plugin {
  return {
    name: 'ws-tracking-relay',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const trackers = new Set<WebSocket>();
      const games = new Set<WebSocket>();

      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (request.url?.startsWith('/ws-tracking')) {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      });

      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'register') {
              if (msg.role === 'tracker') {
                trackers.add(ws);
                // Notify every game client that a tracker connected.
                const notice = JSON.stringify({ type: 'tracker-connected' });
                for (const game of games) {
                  if (game.readyState === WebSocket.OPEN) game.send(notice);
                }
              } else {
                games.add(ws);
                // Let the game know immediately if a tracker is already live.
                if (trackers.size > 0) {
                  ws.send(JSON.stringify({ type: 'tracker-connected' }));
                }
              }
              return;
            }

            // Relay tracking data from trackers to all game clients.
            if (msg.type === 'tracking' && trackers.has(ws)) {
              const payload = raw.toString();
              for (const game of games) {
                if (game.readyState === WebSocket.OPEN) game.send(payload);
              }
            }
          } catch {
            /* ignore malformed messages */
          }
        });

        ws.on('close', () => {
          if (trackers.delete(ws)) {
            const notice = JSON.stringify({ type: 'tracker-disconnected' });
            for (const game of games) {
              if (game.readyState === WebSocket.OPEN) game.send(notice);
            }
          }
          games.delete(ws);
        });
      });
    },
  };
}

