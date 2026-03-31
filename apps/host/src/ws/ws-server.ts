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

interface SessionLoadOlderMessage {
  type: "session.load_older";
  sessionId: string;
  cursor?: string | null;
  limit?: number;
}

interface CombinedSubscription {
  sessionId: string;
  forwardEnvelope: (envelope: SessionHistoryEnvelope | SessionRuntimeEnvelope) => Promise<void>;
  close(): void;
}

interface SeenMessageEntry {
  signature: string;
  source: "history" | "runtime";
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

      if (isSessionLoadOlderMessage(payload)) {
        const subscription = subscriptions.get(payload.sessionId);

        if (!subscription) {
          sendWsError(client, payload.sessionId, "SESSION_NOT_SUBSCRIBED", "会话尚未订阅，不能加载更早消息");
          return;
        }

        try {
          const page = await sessionHistoryService.readSessionHistory(
            payload.sessionId,
            payload.cursor ?? null,
            typeof payload.limit === "number" ? payload.limit : 50,
            "backward",
            authContext.user.userId
          );

          await subscription.forwardEnvelope({
            type: "session.history_older",
            sessionId: payload.sessionId,
            cursor: null,
            olderCursor: page.nextCursor,
            messages: page.messages
          });
        } catch (error) {
          const appError =
            error instanceof AppError
              ? error
              : new AppError({
                  statusCode: 500,
                  errorCode: "INTERNAL_ERROR",
                  detail: "加载更早消息失败"
                });

          sendWsError(client, payload.sessionId, appError.errorCode, appError.message);
        }
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

      const seenMessages = new Map<string, SeenMessageEntry>();
      const forwardEnvelope = async (envelope: SessionHistoryEnvelope | SessionRuntimeEnvelope) => {
        const deduped = dedupeEnvelopeMessages(envelope, seenMessages);

        if (!deduped) {
          return;
        }

        client.send(JSON.stringify(deduped));

        if (
          deduped.type === "session.backfill" ||
          deduped.type === "session.delta" ||
          deduped.type === "session.activity" ||
          deduped.type === "session.runtime_message" ||
          deduped.type === "session.runtime_status" ||
          deduped.type === "session.runtime_error" ||
          deduped.type === "session.interrupted"
        ) {
          await workbenchWsHub.broadcastSnapshot(authContext.user.userId);
        }
      };

      const runtimeSubscription = sessionLiveRuntimeService.subscribeRuntime(
        payload.sessionId,
        forwardEnvelope
      );

      try {
        let currentCursor = payload.cursor ?? null;
        const safeLimit = typeof payload.limit === "number" ? payload.limit : 50;

        if (currentCursor === null) {
          const page = await sessionHistoryService.readSessionHistory(
            payload.sessionId,
            null,
            safeLimit,
            "backward",
            authContext.user.userId
          );

          currentCursor = page.cursor;

          await forwardEnvelope({
            type: "session.backfill",
            sessionId: payload.sessionId,
            cursor: page.cursor,
            olderCursor: page.nextCursor,
            messages: page.messages
          });
        }

        const historySubscription = await sessionHistoryService.subscribeSession(
          payload.sessionId,
          currentCursor,
          safeLimit,
          forwardEnvelope
        );

        subscriptions.set(payload.sessionId, {
          sessionId: payload.sessionId,
          forwardEnvelope,
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

function isSessionLoadOlderMessage(payload: unknown): payload is SessionLoadOlderMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    candidate?.type === "session.load_older" &&
    typeof candidate?.sessionId === "string"
  );
}

function dedupeEnvelopeMessages(
  envelope: SessionHistoryEnvelope | SessionRuntimeEnvelope,
  seenMessages: Map<string, SeenMessageEntry>
): SessionHistoryEnvelope | SessionRuntimeEnvelope | null {
  if (envelope.type === "session.runtime_message") {
    return shouldForwardMessage(envelope.message, "runtime", seenMessages) ? envelope : null;
  }

  if (
    envelope.type !== "session.backfill"
    && envelope.type !== "session.delta"
    && envelope.type !== "session.history_older"
  ) {
    return envelope;
  }

  const messages = envelope.messages.filter((message) => {
    return shouldForwardMessage(message, "history", seenMessages);
  });

  if (messages.length === 0 && envelope.type !== "session.history_older") {
    return null;
  }

  return {
    ...envelope,
    messages
  };
}

function shouldForwardMessage(
  message: SessionHistoryEnvelope["messages"][number],
  source: "history" | "runtime",
  seenMessages: Map<string, SeenMessageEntry>
): boolean {
  const signature = buildMessageSignature(message);
  const previous = seenMessages.get(message.messageId);

  if (previous && previous.signature === signature) {
    return false;
  }

  if (
    previous &&
    previous.source === "runtime" &&
    source === "history" &&
    isOlderMessageVersion(message, previous.signature)
  ) {
    return false;
  }

  seenMessages.set(message.messageId, {
    signature,
    source
  });
  return true;
}

function buildMessageSignature(
  message: SessionHistoryEnvelope["messages"][number]
): string {
  return JSON.stringify({
    provider: message.provider,
    providerSessionId: message.providerSessionId,
    role: message.role,
    kind: message.kind ?? null,
    content: message.content,
    timestamp: message.timestamp,
    rawRef: message.rawRef,
    attachments: message.attachments ?? [],
    toolCall: message.toolCall
      ? {
          callId: message.toolCall.callId,
          status: message.toolCall.status,
          input: message.toolCall.input,
          output: message.toolCall.output,
          error: message.toolCall.error
        }
      : null
  });
}

function isOlderMessageVersion(
  message: SessionHistoryEnvelope["messages"][number],
  previousSignature: string
): boolean {
  try {
    const previous = JSON.parse(previousSignature) as {
      content?: string;
      timestamp?: string;
      toolCall?: {
        status?: string;
        output?: string | null;
        error?: string | null;
      } | null;
    };
    const previousContent = typeof previous.content === "string" ? previous.content : "";
    const nextContent = typeof message.content === "string" ? message.content : "";

    if (previousContent.length > nextContent.length && previousContent.includes(nextContent)) {
      return true;
    }

    const previousTimestamp = typeof previous.timestamp === "string" ? previous.timestamp : "";

    if (previousTimestamp && message.timestamp < previousTimestamp) {
      return true;
    }

    const previousStatus = previous.toolCall?.status ?? null;
    const nextStatus = message.toolCall?.status ?? null;

    return (
      (previousStatus === "completed" || previousStatus === "failed")
      && nextStatus === "running"
    );
  } catch {
    return false;
  }
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
