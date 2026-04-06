import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodexRuntimeAdapter,
  type CodexAppServerTransport,
  type ProviderRuntimeEventSink,
  type ProviderRuntimeRunRequest
} from "@codingns/session-sync-core";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("CodexRuntimeAdapter", () => {
  it("app-server 发出致命 error 通知时会落成 failed 事件", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-runtime-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "session.jsonl");
    let notificationHandler: ((notification: Record<string, unknown>) => void | Promise<void>) | null =
      null;
    let closed = false;

    const transport: CodexAppServerTransport = {
      initialize: vi.fn(async () => undefined),
      startThread: vi.fn(async () => ({
        providerSessionId: "thread-1",
        rawStoreRef
      })),
      resumeThread: vi.fn(async () => ({
        providerSessionId: "thread-1",
        rawStoreRef
      })),
      startTurn: vi.fn(async () => {
        queueMicrotask(() => {
          void notificationHandler?.({
            method: "error",
            params: {
              turnId: "turn-1",
              willRetry: false,
              error: {
                message: "401 Unauthorized",
                additionalDetails: "Missing bearer authentication"
              }
            }
          });
        });
      }),
      interruptTurn: vi.fn(async () => undefined),
      setNotificationHandler: (handler) => {
        notificationHandler = handler;
      },
      setServerRequestHandler: () => undefined,
      setOnClose: () => undefined,
      isClosed: () => closed,
      close: () => {
        closed = true;
      }
    };
    const adapter = new CodexRuntimeAdapter({
      transportFactory: () => transport
    });
    const events: Array<Parameters<ProviderRuntimeEventSink["emit"]>[0]> = [];
    const sink: ProviderRuntimeEventSink = {
      emit: async (event) => {
        events.push(event);
      },
      updateSessionBinding: vi.fn()
    };
    const request: ProviderRuntimeRunRequest = {
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspacePath: tempDir,
      provider: "codex",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "你好",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    };

    const launched = await adapter.startSession(request, sink);
    await launched.completed;

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        status: "failed",
        errorCode: "CODEX_CLI_TURN_FAILED",
        detail: "401 Unauthorized\nMissing bearer authentication"
      })
    );
  }, 10000);
});
