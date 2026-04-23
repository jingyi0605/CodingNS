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
      steerTurn: vi.fn(async () => undefined),
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
      homeDir: tempDir,
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
      steerTurn: vi.fn(async () => undefined),
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
      homeDir: tempDir,
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

  it("继续已有 Codex 会话时，thread/resume 超时会退回本地 transcript 重建", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-runtime-resume-timeout-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "session.jsonl");
    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-04-23T10:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "rollout-2026-04-23T10-00-00-000z-timeout",
            cwd: tempDir
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-23T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "保留这段历史"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-23T10:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "这段历史要被续接"
          }
        })
      ].join("\n"),
      "utf8"
    );
    const resumeThreadFromHistory = vi.fn(async () => ({
      providerSessionId: "rebuilt-thread",
      rawStoreRef
    }));
    let closed = false;
    let closeHandler: ((error: Error | null) => void) | null = null;

    const transport: CodexAppServerTransport = {
      initialize: vi.fn(async () => undefined),
      startThread: vi.fn(async () => {
        throw new Error("UNEXPECTED_START_THREAD");
      }),
      resumeThread: vi.fn(async () => {
        throw new Error("SERVER_TIMEOUT");
      }),
      resumeThreadFromHistory,
      startTurn: vi.fn(async () => {
        queueMicrotask(() => {
          closeHandler?.(null);
        });

        return {
          notification: {
            method: "turn/completed",
            params: {
              threadId: "rebuilt-thread",
              turn: { id: "turn-timeout-1", items: [], status: "completed" }
            }
          }
        };
      }),
      steerTurn: vi.fn(async () => undefined),
      interruptTurn: vi.fn(async () => undefined),
      setNotificationHandler: () => undefined,
      setServerRequestHandler: () => undefined,
      setOnClose: (handler) => {
        closeHandler = handler;
      },
      isClosed: () => closed,
      close: () => {
        closed = true;
      }
    };
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      transportFactory: () => transport
    });
    const sink: ProviderRuntimeEventSink = {
      emit: vi.fn(async () => undefined),
      updateSessionBinding: vi.fn()
    };

    const launched = await adapter.continueSession(
      {
        sessionId: "session-timeout-1",
        workspaceId: "workspace-1",
        workspacePath: tempDir,
        provider: "codex",
        providerSessionId: "019da3bc-6401-74e1-90f6-52fcb30d225f",
        rawStoreRef,
        options: {
          content: "继续往下做",
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

    expect(resumeThreadFromHistory).toHaveBeenCalledTimes(1);
    expect(resumeThreadFromHistory).toHaveBeenCalledWith({
      providerSessionId: null,
      workspacePath: tempDir,
      history: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "保留这段历史" }]
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "这段历史要被续接" }]
        }
      ],
      model: null
    });
    expect(launched.providerSessionId).toBe("rebuilt-thread");
    await launched.interrupt();
  });

  it("会从 turn/start 返回的完成态 turn 中恢复最终 assistant 消息", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-runtime-turn-result-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "session.jsonl");
    writeFileSync(rawStoreRef, "", "utf8");
    let closed = false;

    const transport: CodexAppServerTransport = {
      initialize: vi.fn(async () => undefined),
      startThread: vi.fn(async () => ({
        providerSessionId: "thread-3",
        rawStoreRef
      })),
      resumeThread: vi.fn(async () => ({
        providerSessionId: "thread-3",
        rawStoreRef
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "thread-3",
        rawStoreRef
      })),
      startTurn: vi.fn(async () => ({
        notification: {
          method: "turn/completed",
          params: {
            threadId: "thread-3",
            turn: {
              id: "turn-3",
              status: "completed",
              items: [],
              lastAgentMessage:
                "```json\n{\"analysisSummary\":\"验证码问题\",\"generatedPrompt\":\"问题判断\\n补齐三次失败后的验证码。\\n\\n仓库现状\\n当前只恢复到了完成态消息。\\n\\n实际开发思路\\n先查登录失败计数，再补验证码触发。\\n\\n验证与风险\\n补登录失败三次后的验证。\",\"followUpObjective\":\"补齐验证码\",\"completionCriteria\":\"三次失败后显示图形验证码\",\"cliEvidence\":[\"codingns assistant capabilities list\",\"codingns assistant projects get demo\",\"codingns assistant sessions list --project demo\"]}\n```"
            }
          }
        }
      })),
      steerTurn: vi.fn(async () => undefined),
      interruptTurn: vi.fn(async () => undefined),
      setNotificationHandler: () => undefined,
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

    const launched = await adapter.startSession(
      {
        sessionId: "session-3",
        workspaceId: "workspace-1",
        workspacePath: tempDir,
        provider: "codex",
        providerSessionId: null,
        rawStoreRef: null,
        options: {
          content: "请分析验证码收尾",
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

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message",
        message: expect.objectContaining({
          role: "assistant",
          kind: "text",
          content: expect.stringContaining("\"analysisSummary\":\"验证码问题\"")
        })
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "complete",
        status: "completed"
      })
    );
  }, 10000);

  it("运行中追加消息会走 app-server steerTurn，而不是新开第二轮", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-runtime-steer-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "session.jsonl");
    writeFileSync(rawStoreRef, "", "utf8");
    const steerTurn = vi.fn(async () => undefined);
    let closed = false;

    const transport: CodexAppServerTransport = {
      initialize: vi.fn(async () => undefined),
      startThread: vi.fn(async () => ({
        providerSessionId: "thread-steer",
        rawStoreRef
      })),
      resumeThread: vi.fn(async () => ({
        providerSessionId: "thread-steer",
        rawStoreRef
      })),
      resumeThreadFromHistory: vi.fn(async () => ({
        providerSessionId: "thread-steer",
        rawStoreRef
      })),
      startTurn: vi.fn(async () => ({
        notification: {
          method: "turn/started",
          params: {
            turn: {
              id: "turn-steer-1"
            }
          }
        }
      })),
      steerTurn,
      interruptTurn: vi.fn(async () => undefined),
      setNotificationHandler: () => undefined,
      setServerRequestHandler: () => undefined,
      setOnClose: () => undefined,
      isClosed: () => closed,
      close: () => {
        closed = true;
      }
    };
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      transportFactory: () => transport
    });
    const sink: ProviderRuntimeEventSink = {
      emit: vi.fn(async () => undefined),
      updateSessionBinding: vi.fn()
    };

    const launched = await adapter.startSession(
      {
        sessionId: "session-steer",
        workspaceId: "workspace-1",
        workspacePath: tempDir,
        provider: "codex",
        providerSessionId: null,
        rawStoreRef: null,
        options: {
          content: "先跑第一条",
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

    await launched.submitDuringRun?.({
      content: "继续补充一条 steer",
      clientRequestId: "client-steer-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: "继续补充一条 steer",
      attachments: []
    });

    expect(steerTurn).toHaveBeenCalledTimes(1);
    expect(steerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "继续补充一条 steer",
        providerPrompt: "继续补充一条 steer"
      })
    );
  });
});
