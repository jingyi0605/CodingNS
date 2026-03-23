import type { Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import type { SessionRuntimeService } from "../modules/sessions/session-runtime-service.js";
import type { WsAuthGuard } from "./ws-auth-guard.js";

interface SessionSubscribeMessage {
  type: "session.subscribe";
  sessionId: string;
  cursor?: string | null;
  limit?: number;
}

export function createWsServer(
  server: Server,
  wsAuthGuard: WsAuthGuard,
  sessionRuntimeService: SessionRuntimeService
) {
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
            userId: authContext.user.userId,
            username: authContext.user.username
          })
        );

        wss.emit("connection", client, request);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (client) => {
    const subscriptions = new Map<string, { close(): void }>();

    const cleanup = () => {
      for (const subscription of subscriptions.values()) {
        subscription.close();
      }

      subscriptions.clear();
    };

    client.on("message", async (raw) => {
      let payload: unknown;

      try {
        payload = JSON.parse(raw.toString());
      } catch {
        sendWsError(client, null, "INVALID_INPUT", "WebSocket 消息必须是合法 JSON");
        return;
      }

      if (!isSessionSubscribeMessage(payload)) {
        sendWsError(client, null, "INVALID_INPUT", "不支持的 WebSocket 消息类型");
        return;
      }

      subscriptions.get(payload.sessionId)?.close();

      client.send(
        JSON.stringify({
          type: "session.subscribed",
          sessionId: payload.sessionId
        })
      );

      try {
        const subscription = await sessionRuntimeService.subscribeSession(
          payload.sessionId,
          payload.cursor ?? null,
          typeof payload.limit === "number" ? payload.limit : 50,
          async (envelope) => {
            client.send(JSON.stringify(envelope));
          }
        );

        subscriptions.set(payload.sessionId, subscription);
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError({
                statusCode: 500,
                errorCode: "INTERNAL_ERROR",
                detail: "订阅会话失败"
              });

        sendWsError(client, payload.sessionId, appError.errorCode, appError.message);
      }
    });

    client.on("close", cleanup);
    client.on("error", cleanup);
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

function isSessionSubscribeMessage(payload: unknown): payload is SessionSubscribeMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    candidate?.type === "session.subscribe" &&
    typeof candidate?.sessionId === "string"
  );
}

function sendWsError(
  client: WebSocket,
  sessionId: string | null,
  errorCode: string,
  detail: string
): void {
  client.send(
    JSON.stringify({
      type: "session.error",
      sessionId,
      error_code: errorCode,
      detail,
      timestamp: new Date().toISOString()
    })
  );
}
