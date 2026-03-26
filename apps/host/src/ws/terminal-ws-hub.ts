import type { WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import type { AuthContext } from "../modules/auth/auth-service.js";
import type { TerminalService } from "../modules/terminal/terminal-service.js";

interface TerminalSubscribeMessage {
  type: "terminal.subscribe";
  terminalId: string;
  lastCursor?: string | null;
}

interface TerminalInputMessage {
  type: "terminal.input";
  terminalId: string;
  content: string;
}

interface TerminalResizeMessage {
  type: "terminal.resize";
  terminalId: string;
  cols: number;
  rows: number;
}

type TerminalWsMessage = TerminalSubscribeMessage | TerminalInputMessage | TerminalResizeMessage;

export class TerminalWsHub {
  private readonly clientSubscriptions = new WeakMap<WebSocket, Map<string, { close(): void }>>();

  constructor(private readonly terminalService: TerminalService) {}

  handleMessage(
    client: WebSocket,
    payload: unknown,
    authContext: AuthContext
  ): payload is TerminalWsMessage {
    if (isTerminalSubscribeMessage(payload)) {
      void this.subscribeTerminal(client, payload, authContext);
      return true;
    }

    if (isTerminalInputMessage(payload)) {
      void this.handleTerminalInput(client, payload);
      return true;
    }

    if (isTerminalResizeMessage(payload)) {
      void this.handleTerminalResize(client, payload);
      return true;
    }

    return false;
  }

  cleanupClient(client: WebSocket): void {
    const subscriptions = this.clientSubscriptions.get(client);

    if (!subscriptions) {
      return;
    }

    for (const subscription of subscriptions.values()) {
      subscription.close();
    }

    subscriptions.clear();
  }

  private async subscribeTerminal(
    client: WebSocket,
    payload: TerminalSubscribeMessage,
    authContext: AuthContext
  ): Promise<void> {
    const subscriptions = this.getClientSubscriptions(client);
    subscriptions.get(payload.terminalId)?.close();
    subscriptions.delete(payload.terminalId);

    try {
      const subscription = this.terminalService.subscribeTerminal(
        payload.terminalId,
        payload.lastCursor ?? null,
        {
          onBackfill: async (backfill) => {
            client.send(
              JSON.stringify({
                type: "terminal.backfill",
                terminalId: payload.terminalId,
                truncated: backfill.truncated,
                cursorReset: backfill.cursorReset,
                latestCursor: backfill.latestCursor,
                chunks: backfill.chunks
              })
            );
          },
          onOutput: async (chunk) => {
            client.send(
              JSON.stringify({
                type: "terminal.output",
                terminalId: payload.terminalId,
                chunk
              })
            );
          },
          onStatus: async (terminal) => {
            client.send(
              JSON.stringify({
                type: "terminal.status",
                terminal
              })
            );
          },
          onExit: async (event) => {
            client.send(
              JSON.stringify({
                type: "terminal.exit",
                terminalId: payload.terminalId,
                requestedClose: event.requestedClose,
                terminal: event.terminal
              })
            );
          }
        }
      );

      client.send(
        JSON.stringify({
          type: "terminal.subscribed",
          terminalId: payload.terminalId,
          userId: authContext.user.userId
        })
      );

      subscriptions.set(payload.terminalId, subscription);
    } catch (error) {
      subscriptions.delete(payload.terminalId);
      const appError =
        error instanceof AppError
          ? error
          : new AppError({
              statusCode: 500,
              errorCode: "INTERNAL_ERROR",
              detail: "订阅终端失败"
            });

      client.send(
        JSON.stringify({
          type: "terminal.error",
          terminalId: payload.terminalId,
          error_code: appError.errorCode,
          detail: appError.message,
          timestamp: new Date().toISOString()
        })
      );
    }
  }

  private async handleTerminalInput(
    client: WebSocket,
    payload: TerminalInputMessage
  ): Promise<void> {
    try {
      this.terminalService.writeInput(payload.terminalId, payload.content);
      client.send(
        JSON.stringify({
          type: "terminal.input.accepted",
          terminalId: payload.terminalId
        })
      );
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError({
              statusCode: 500,
              errorCode: "INTERNAL_ERROR",
              detail: "终端输入失败"
            });

      client.send(
        JSON.stringify({
          type: "terminal.error",
          terminalId: payload.terminalId,
          error_code: appError.errorCode,
          detail: appError.message,
          timestamp: new Date().toISOString()
        })
      );
    }
  }

  private async handleTerminalResize(
    client: WebSocket,
    payload: TerminalResizeMessage
  ): Promise<void> {
    try {
      this.terminalService.resizeTerminal(payload.terminalId, payload.cols, payload.rows);
      client.send(
        JSON.stringify({
          type: "terminal.resize.accepted",
          terminalId: payload.terminalId,
          cols: payload.cols,
          rows: payload.rows
        })
      );
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError({
              statusCode: 500,
              errorCode: "INTERNAL_ERROR",
              detail: "终端尺寸调整失败"
            });

      client.send(
        JSON.stringify({
          type: "terminal.error",
          terminalId: payload.terminalId,
          error_code: appError.errorCode,
          detail: appError.message,
          timestamp: new Date().toISOString()
        })
      );
    }
  }

  private getClientSubscriptions(client: WebSocket): Map<string, { close(): void }> {
    let subscriptions = this.clientSubscriptions.get(client);

    if (!subscriptions) {
      subscriptions = new Map<string, { close(): void }>();
      this.clientSubscriptions.set(client, subscriptions);
    }

    return subscriptions;
  }
}

function isTerminalSubscribeMessage(payload: unknown): payload is TerminalSubscribeMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    candidate?.type === "terminal.subscribe" &&
    typeof candidate?.terminalId === "string"
  );
}

function isTerminalInputMessage(payload: unknown): payload is TerminalInputMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    candidate?.type === "terminal.input" &&
    typeof candidate?.terminalId === "string" &&
      typeof candidate?.content === "string"
  );
}

function isTerminalResizeMessage(payload: unknown): payload is TerminalResizeMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    candidate?.type === "terminal.resize" &&
    typeof candidate?.terminalId === "string" &&
    typeof candidate?.cols === "number" &&
    typeof candidate?.rows === "number"
  );
}
