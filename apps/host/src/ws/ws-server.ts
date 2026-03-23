import type { Server } from "node:http";

import { WebSocketServer } from "ws";

import type { WsAuthGuard } from "./ws-auth-guard.js";

export function createWsServer(server: Server, wsAuthGuard: WsAuthGuard) {
  const wss = new WebSocketServer({
    noServer: true
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    try {
      const authContext = wsAuthGuard.authenticate(request);

      wss.handleUpgrade(request, socket, head, (client) => {
        client.send(
          JSON.stringify({
            type: "system.connected",
            user: authContext.user
          })
        );

        wss.emit("connection", client, request);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  return {
    wss,
    close: async (): Promise<void> => {
      for (const client of wss.clients) {
        client.terminate();
      }

      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
