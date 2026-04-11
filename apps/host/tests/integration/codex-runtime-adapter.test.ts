import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    writeFileSync(rawStoreRef, "", "utf8");
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
      resumeThreadFromHistory: vi.fn(async () => ({
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

  it("synthetic rollout rawStoreRef 会先用历史恢复 thread，再把当前输入作为独立新消息发送", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-runtime-history-"));
    tempDirs.push(tempDir);
    const syntheticRawStoreRef = path.join(tempDir, "rollout-session.jsonl");
    const resumedRawStoreRef = path.join(tempDir, "thread-2.jsonl");
    let notificationHandler: ((notification: Record<string, unknown>) => void | Promise<void>) | null =
      null;
    let closed = false;

    writeFileSync(
      syntheticRawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-04-11T12:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "rollout-2026-04-11T12-00-00-000z-test",
            cwd: tempDir
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-11T12:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "下面是需要继承到新会话里的历史文本。"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(resumedRawStoreRef, "", "utf8");

    const transport: CodexAppServerTransport = {
      initialize: vi.fn(async () => undefined),
      startThread: vi.fn(async () => ({
        providerSessionId: "should-not-start",
        rawStoreRef: resumedRawStoreRef
      })),
      resumeThread: vi.fn(async () => ({
        providerSessionId: "should-not-resume",
        rawStoreRef: resumedRawStoreRef
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "thread-2",
        rawStoreRef: resumedRawStoreRef
      })),
      startTurn: vi.fn(async () => {
        queueMicrotask(() => {
          void notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId: "thread-2",
              turn: { id: "turn-2", items: [], status: "completed" }
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
    const sink: ProviderRuntimeEventSink = {
      emit: vi.fn(async () => undefined),
      updateSessionBinding: vi.fn()
    };

    const launched = await adapter.startSession(
      {
        sessionId: "session-2",
        workspaceId: "workspace-1",
        workspacePath: tempDir,
        provider: "codex",
        providerSessionId: null,
        rawStoreRef: syntheticRawStoreRef,
        options: {
          content: "这才是 fork 后的首条真实用户消息",
          clientRequestId: null,
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      },
      sink
    );

    await launched.completed;

    expect(transport.startThread).not.toHaveBeenCalled();
    expect(transport.resumeThread).not.toHaveBeenCalled();
    expect(transport.resumeThreadFromHistory).toHaveBeenCalledWith({
      providerSessionId: null,
      workspacePath: tempDir,
      history: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "下面是需要继承到新会话里的历史文本。" }]
        }
      ],
      model: null
    });
    expect(transport.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        rawStoreRef: syntheticRawStoreRef,
        options: expect.objectContaining({
          content: "这才是 fork 后的首条真实用户消息",
          providerPrompt: null
        })
      }),
      "thread-2"
    );
  });
});
