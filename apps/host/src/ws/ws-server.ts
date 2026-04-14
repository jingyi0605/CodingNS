import type { IncomingMessage, Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import { hashContent } from "../shared/utils/hash.js";
import type { AuthContext } from "../modules/auth/auth-service.js";
import type {
  SessionHistoryEnvelope,
  SessionHistoryService
} from "../modules/sessions/session-history-service.js";
import type {
  SessionLiveRuntimeService,
  SessionRuntimeEnvelope
} from "../modules/sessions/session-live-runtime-service.js";
import type { ButlerActionContextService } from "../modules/butler/butler-action-context-service.js";
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
  timestamp: string;
  contentLength: number;
  contentPreview: string;
  toolCallStatus: "running" | "completed" | "failed" | null;
}

const MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION = 2_048;
const MAX_STORED_MESSAGE_PREVIEW_CHARS = 2_048;

export function createWsServer(
  server: Server,
  wsAuthGuard: WsAuthGuard,
  sessionHistoryService: SessionHistoryService,
  sessionLiveRuntimeService: SessionLiveRuntimeService,
  terminalWsHub: TerminalWsHub,
  workbenchWsHub: WorkbenchWsHub,
  butlerActionContextService?: Pick<ButlerActionContextService, "preloadSessionActionContext">
) {
  const wss = new WebSocketServer({
    noServer: true
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (pathname !== "/ws") {
      if (!pathname.startsWith("/proxy/")) {
        socket.destroy();
      }
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

      butlerActionContextService?.preloadSessionActionContext(
        payload.sessionId,
        authContext.user.userId
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

        client.send(
          JSON.stringify({
            type: "session.subscribed",
            sessionId: payload.sessionId
          })
        );
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
  const nextEntry = buildSeenMessageEntry(message, source);
  const previous = seenMessages.get(message.messageId);

  if (previous && previous.signature === nextEntry.signature) {
    return false;
  }

  if (
    previous &&
    previous.source === "runtime" &&
    source === "history" &&
    isOlderMessageVersion(message, previous)
  ) {
    return false;
  }

  rememberSeenMessage(seenMessages, message.messageId, nextEntry);
  return true;
}

function buildMessageSignature(
  message: SessionHistoryEnvelope["messages"][number]
): string {
  const attachments = message.attachments ?? [];
  const toolCall = message.toolCall;

  return hashContent(
    [
      message.provider,
      message.providerSessionId,
      message.role,
      message.kind ?? "",
      message.timestamp,
      message.rawRef,
      hashContent(message.content),
      String(message.content.length),
      hashContent(JSON.stringify(attachments)),
      String(attachments.length),
      toolCall?.callId ?? "",
      toolCall?.name ?? "",
      toolCall?.status ?? "",
      toolCall ? hashContent(toolCall.input) : "",
      toolCall ? String(toolCall.input.length) : "0",
      toolCall?.output === null || toolCall?.output === undefined ? "" : hashContent(toolCall.output),
      toolCall?.output === null || toolCall?.output === undefined ? "0" : String(toolCall.output.length),
      toolCall?.error === null || toolCall?.error === undefined ? "" : hashContent(toolCall.error),
      toolCall?.error === null || toolCall?.error === undefined ? "0" : String(toolCall.error.length)
    ].join("\u001f")
  );
}

function buildSeenMessageEntry(
  message: SessionHistoryEnvelope["messages"][number],
  source: "history" | "runtime"
): SeenMessageEntry {
  return {
    signature: buildMessageSignature(message),
    source,
    timestamp: message.timestamp,
    contentLength: message.content.length,
    contentPreview: createStoredPreview(message.content),
    toolCallStatus: message.toolCall?.status ?? null
  };
}

function isOlderMessageVersion(
  message: SessionHistoryEnvelope["messages"][number],
  previous: SeenMessageEntry
): boolean {
  const nextContent = message.content;

  if (
    previous.contentLength > nextContent.length &&
    nextContent.length > 0 &&
    nextContent.length <= MAX_STORED_MESSAGE_PREVIEW_CHARS &&
    previous.contentPreview.includes(nextContent)
  ) {
    return true;
  }

  if (previous.timestamp && message.timestamp < previous.timestamp) {
    return true;
  }

  const nextStatus = message.toolCall?.status ?? null;

  return (
    (previous.toolCallStatus === "completed" || previous.toolCallStatus === "failed") &&
    nextStatus === "running"
  );
}

function createStoredPreview(value: string): string {
  if (value.length <= MAX_STORED_MESSAGE_PREVIEW_CHARS) {
    return value;
  }

  return value.slice(0, MAX_STORED_MESSAGE_PREVIEW_CHARS);
}

function rememberSeenMessage(
  seenMessages: Map<string, SeenMessageEntry>,
  messageId: string,
  entry: SeenMessageEntry
): void {
  if (seenMessages.has(messageId)) {
    seenMessages.delete(messageId);
  }

  seenMessages.set(messageId, entry);

  while (seenMessages.size > MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION) {
    const oldestMessageId = seenMessages.keys().next().value;

    if (typeof oldestMessageId !== "string") {
      break;
    }

    seenMessages.delete(oldestMessageId);
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

export const __internal__ = {
  MAX_TRACKED_MESSAGES_PER_SUBSCRIPTION,
  MAX_STORED_MESSAGE_PREVIEW_CHARS,
  buildMessageSignature,
  buildSeenMessageEntry,
  isOlderMessageVersion,
  shouldForwardMessage
};
