import type { IncomingMessage, Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import type { AuthContext } from "../modules/auth/auth-service.js";
import type {
  SessionHistoryEnvelope,
  SessionHistoryService
} from "../modules/sessions/session-history-service.js";
import type {
  SessionLiveRuntimeService,
  SessionRuntimeEnvelope
} from "../modules/sessions/session-live-runtime-service.js";
import type { TerminalWsHub } from "./terminal-ws-hub.js";
import type { WorkbenchWsHub } from "./workbench-ws-hub.js";
import type { WsAuthGuard } from "./ws-auth-guard.js";

interface SessionSubscribeMessage {
  type: "session.subscribe";
  sessionId: string;
  cursor?: string | null;
  limit?: number;
}

interface CombinedSubscription {
  close(): void;
}

export function createWsServer(
  server: Server,
  wsAuthGuard: WsAuthGuard,
  sessionHistoryService: SessionHistoryService,
  sessionLiveRuntimeService: SessionLiveRuntimeService,
  terminalWsHub: TerminalWsHub,
  workbenchWsHub: WorkbenchWsHub
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
      (request as IncomingMessageWithAuthContext).authContext = authContext;

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

  wss.on("connection", (client, request) => {
    const authContext = (request as IncomingMessageWithAuthContext).authContext;
    const subscriptions = new Map<string, CombinedSubscription>();

    const cleanup = () => {
      for (const subscription of subscriptions.values()) {
        subscription.close();
      }

      subscriptions.clear();
      terminalWsHub.cleanupClient(client);
      workbenchWsHub.cleanupClient(client);
    };

    client.on("message", async (raw) => {
      let payload: unknown;

      try {
        payload = JSON.parse(raw.toString());
      } catch {
        sendWsError(client, null, "INVALID_INPUT", "WebSocket 消息必须是合法 JSON");
        return;
      }

      if (terminalWsHub.handleMessage(client, payload, authContext)) {
        return;
      }

      if (workbenchWsHub.handleMessage(client, payload, authContext)) {
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

      const sentMessageIds = new Set<string>();
      const forwardEnvelope = async (envelope: SessionHistoryEnvelope | SessionRuntimeEnvelope) => {
        const deduped = dedupeEnvelopeMessages(envelope, sentMessageIds);

        if (!deduped) {
          return;
        }

        client.send(JSON.stringify(deduped));
      };

      const runtimeSubscription = sessionLiveRuntimeService.subscribeRuntime(
        payload.sessionId,
        forwardEnvelope
      );

      try {
        const historySubscription = await sessionHistoryService.subscribeSession(
          payload.sessionId,
          payload.cursor ?? null,
          typeof payload.limit === "number" ? payload.limit : 50,
          forwardEnvelope
        );

        subscriptions.set(payload.sessionId, {
          close() {
            historySubscription.close();
            runtimeSubscription.close();
          }
        });
      } catch (error) {
        runtimeSubscription.close();

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

interface IncomingMessageWithAuthContext extends IncomingMessage {
  authContext: AuthContext;
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

function dedupeEnvelopeMessages(
  envelope: SessionHistoryEnvelope | SessionRuntimeEnvelope,
  sentMessageIds: Set<string>
): SessionHistoryEnvelope | SessionRuntimeEnvelope | null {
  if (envelope.type !== "session.backfill" && envelope.type !== "session.delta") {
    return envelope;
  }

  const messages = envelope.messages.filter((message) => {
    if (sentMessageIds.has(message.messageId)) {
      return false;
    }

    sentMessageIds.add(message.messageId);
    return true;
  });

  if (messages.length === 0) {
    return null;
  }

  return {
    ...envelope,
    messages
  };
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
