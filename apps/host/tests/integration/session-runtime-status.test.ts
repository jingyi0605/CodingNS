import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { inspectSessionActivity } from "../../src/modules/sessions/session-activity-inspector.js";
import {
  createProviderFixture,
  createTestApp,
  destroyFixture,
  type ProviderFixture
} from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: ProviderFixture[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }

  while (tempDirs.length > 0) {
    const target = tempDirs.pop();

    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("session runtime status", () => {
  it("Codex 出现 task_complete 后，不会再把未闭合 tool call 误判为运行中", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "codex.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-03-26T10:00:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-1",
            name: "shell_command",
            arguments: {
              command: "git status --short"
            }
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T10:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "task_complete"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "codex",
      rawStoreRef,
      Date.parse("2026-03-26T10:00:06.000Z")
    );

    expect(inspection.runningState).toBe("idle");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBe("2026-03-26T10:00:05.000Z");
  });

  it("Codex task_complete 后如果还有新输出，不能继续显示已完成", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "codex-complete-then-message.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-03-26T10:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "task_complete"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T10:00:06.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "还在继续输出" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "codex",
      rawStoreRef,
      Date.parse("2026-03-26T10:00:07.000Z")
    );

    expect(inspection.runningState).toBe("running");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBeNull();
  });

  it("Codex 纯文本输出阶段，只要最近仍有事件，就应继续判定为运行中", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "codex-running.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-03-26T10:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "still working" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "codex",
      rawStoreRef,
      Date.parse("2026-03-26T10:01:10.000Z")
    );

    expect(inspection.runningState).toBe("running");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBeNull();
  });

  it("Codex 工具输出刚结束时，只要还在活跃窗口内，就不能提前判成 completed", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "codex-tool-output.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-03-26T10:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-1",
            name: "shell_command",
            arguments: {
              command: "git status --short"
            }
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-26T10:02:05.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "Exit code: 0"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "codex",
      rawStoreRef,
      Date.parse("2026-03-26T10:02:10.000Z")
    );

    expect(inspection.runningState).toBe("running");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBeNull();
  });

  it("Codex 出现 turn_aborted 后，应把会话判定为 interrupted", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "codex-turn-aborted.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-04-15T09:25:01.565Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: "turn-1"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-15T09:25:48.261Z",
          type: "event_msg",
          payload: {
            type: "turn_aborted",
            turn_id: "turn-1",
            reason: "interrupted"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "codex",
      rawStoreRef,
      Date.parse("2026-04-15T09:25:50.000Z")
    );

    expect(inspection.runningState).toBe("interrupted");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBe("2026-04-15T09:25:48.261Z");
    expect(inspection.errorDetail).toBe("codex turn interrupted by user");
  });

  it("Codex 原始会话出现 task_failed 后，runtime 接口应该返回 failed 和稳定错误码", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    appendFileSync(
      fixture.codexSessionFile,
      `\n${JSON.stringify({
        timestamp: "2026-03-23T09:00:14.000Z",
        type: "event_msg",
        payload: {
          type: "task_failed",
          error: "command exited with code 1"
        }
      })}`,
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: codexSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-23T09:00:12.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-23T09:00:12.000Z"
    });

    const runtime = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/runtime`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      hasActiveRun: false,
      runningState: "failed",
      errorCode: "CODEX_CLI_TURN_FAILED",
      errorDetail: "command exited with code 1",
      detail: "command exited with code 1"
    });
  });

  it("Claude 原始日志已经出现 end_turn 时，应清掉残留的 runtime running", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    appendFileSync(
      fixture.claudeSessionFile,
      `\n${JSON.stringify({
        type: "assistant",
        sessionId: "claude-session-1",
        cwd: fixture.workspaceDir,
        timestamp: "2026-03-23T08:00:20.000Z",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "这轮已经结束。" }]
        }
      })}`,
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessionsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionsResponse.statusCode).toBe(200);

    const claudeSession = sessionsResponse
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");
    expect(claudeSession).toBeTruthy();

    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: claudeSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-23T08:00:12.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-23T08:00:12.000Z"
    });

    const refreshedState = await (
      hosted.services.modules.sessionHistoryService as unknown as {
        refreshSessionState: (sessionId: string, userId: string) => Promise<{
          runningState: string;
          activitySource: string;
          completedAt: string | null;
        } | null>;
      }
    ).refreshSessionState(claudeSession.sessionId, adminUser!.id);

    expect(refreshedState).toMatchObject({
      runningState: "completed",
      activitySource: "inferred",
      completedAt: "2026-03-23T08:00:20.000Z"
    });
  });

  it("没有任何本地证据且已过宽限期的 runtime running，应该回收成 idle", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessionsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionsResponse.statusCode).toBe(200);

    const codexSession = sessionsResponse
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    const existingBinding = hosted.services.repositories.sessionBindingRepository.findBySessionId(
      codexSession.sessionId
    );
    expect(existingBinding).toBeTruthy();

    hosted.services.repositories.sessionBindingRepository.upsert({
      ...existingBinding!,
      rawStoreRef: "opencode://session/stale-runtime",
      updatedAt: "2026-03-23T09:00:12.000Z"
    });
    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: codexSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-23T09:00:12.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-23T09:00:12.000Z"
    });

    const refreshedState = await (
      hosted.services.modules.sessionHistoryService as unknown as {
        refreshSessionState: (sessionId: string, userId: string) => Promise<{
          runningState: string;
          activitySource: string;
          completedAt: string | null;
          lastEventAt: string | null;
        } | null>;
      }
    ).refreshSessionState(codexSession.sessionId, adminUser!.id);

    expect(refreshedState).toMatchObject({
      runningState: "idle",
      activitySource: "none",
      completedAt: null,
      lastEventAt: "2026-03-23T09:00:12.000Z"
    });
  });

  it("Gemini 当前 jsonl 历史已完整落盘时，应把残留 runtime running 回刷成 completed", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const geminiProjectDir = path.join(fixture.geminiHomeDir, "tmp", "codingns");
    mkdirSync(path.join(geminiProjectDir, "chats"), { recursive: true });
    writeFileSync(path.join(geminiProjectDir, ".project_root"), fixture.workspaceDir, "utf8");
    writeFileSync(
      path.join(geminiProjectDir, "chats", "session-2026-04-25T15-24-7f75c9df.jsonl"),
      [
        JSON.stringify({
          sessionId: "7f75c9df-c657-4197-8cf4-48c97d5fbbcd",
          projectHash: "hash-alpha",
          startTime: "2026-04-25T15:24:02.097Z",
          lastUpdated: "2026-04-25T15:24:02.097Z",
          kind: "main"
        }),
        JSON.stringify({
          id: "msg-user-1",
          timestamp: "2026-04-25T15:24:02.104Z",
          type: "user",
          content: [{ text: "请只回复 OK，不要调用任何工具。" }]
        }),
        JSON.stringify({
          $set: {
            lastUpdated: "2026-04-25T15:24:02.104Z"
          }
        }),
        JSON.stringify({
          id: "msg-assistant-1",
          timestamp: "2026-04-25T15:24:29.090Z",
          type: "gemini",
          content: "OK",
          thoughts: [],
          tokens: {
            input: 9941,
            output: 1,
            total: 10078
          },
          model: "gemini-3.1-pro"
        }),
        JSON.stringify({
          $set: {
            lastUpdated: "2026-04-25T15:24:29.090Z"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessionsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionsResponse.statusCode).toBe(200);

    const geminiSession = sessionsResponse
      .json()
      .items.find((item: { provider: string }) => item.provider === "gemini");
    expect(geminiSession).toBeTruthy();

    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: geminiSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-04-25T15:24:05.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-04-25T15:24:05.000Z"
    });

    const refreshedState = await (
      hosted.services.modules.sessionHistoryService as unknown as {
        refreshSessionState: (sessionId: string, userId: string) => Promise<{
          runningState: string;
          activitySource: string;
          completedAt: string | null;
          lastEventAt: string | null;
        } | null>;
      }
    ).refreshSessionState(geminiSession.sessionId, adminUser!.id);

    expect(refreshedState).toMatchObject({
      runningState: "completed",
      activitySource: "inferred",
      completedAt: "2026-04-25T15:24:29.090Z",
      lastEventAt: "2026-04-25T15:24:29.090Z"
    });
  });

  it("会话列表和 runtime 接口应该返回同一份 authority 裁决字段", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const firstList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstList.statusCode).toBe(200);

    const claudeSession = firstList
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");
    expect(claudeSession).toBeTruthy();

    const hookResult = await hosted.services.modules.sessionLiveRuntimeService.ingestClaudeHookEvent({
      hook_event_name: "SessionStart",
      session_id: "claude-session-1",
      cwd: fixture.workspaceDir,
      transcript_path: fixture.claudeSessionFile
    });
    expect(hookResult.accepted).toBe(true);
    expect(hookResult.ignored).toBe(false);
    expect(hookResult.sessionId).toBe(claudeSession.sessionId);

    const list = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(list.statusCode).toBe(200);

    const listedClaudeSession = list
      .json()
      .items.find((item: { provider: string }) => item.provider === "claude-code");
    expect(listedClaudeSession).toMatchObject({
      sessionId: claudeSession.sessionId,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_provider_event",
      activityConfidence: "authoritative",
      activityState: "running",
      runId: null
    });

    const runtime = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${claudeSession.sessionId}/runtime`,
      headers: {
        authorization: `Bearer ${
          (
            await hosted.app.inject({
              method: "POST",
              url: "/api/auth/login",
              payload: {
                username: "admin",
                password: "password123"
              }
            })
          ).json().accessToken as string
        }`
      }
    });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({
      sessionId: claudeSession.sessionId,
      hasActiveRun: true,
      runningState: "running",
      activityResolutionSource: "authoritative_provider_event",
      activityConfidence: "authoritative",
      runId: null
    });
  });

  it("会话列表刷新时，应优先使用 live runtime 的权威状态，而不是退回 inferred", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const firstList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(firstList.statusCode).toBe(200);

    const firstCodexSession = firstList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(firstCodexSession).toBeTruthy();
    expect(firstCodexSession).toMatchObject({
      activitySource: "inferred",
      activityResolutionSource: "inferred_log"
    });

    (
      hosted.services.modules.sessionLiveRuntimeService as unknown as {
        resolveLiveActivityObservation: (sessionId: string) => unknown;
      }
    ).resolveLiveActivityObservation = vi.fn((sessionId: string) => {
      if (sessionId !== firstCodexSession!.sessionId) {
        return null;
      }

      return {
        sessionId,
        runId: "codex-live-run-1",
        runningState: "running",
        source: "authoritative_runtime",
        confidence: "authoritative",
        detail: "Host 正在跟踪这轮运行",
        errorCode: null,
        observedAt: "2026-03-23T09:00:12.000Z"
      };
    });

    const secondList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(secondList.statusCode).toBe(200);

    const secondCodexSession = secondList
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(secondCodexSession).toBeTruthy();
    expect(secondCodexSession).toMatchObject({
      sessionId: firstCodexSession!.sessionId,
      runningState: "running",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      activityState: "running"
    });
  });

  it("Claude 出现 end_turn 后，不会再把旧的 tool_use 残留判成运行中", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "claude.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "progress",
          timestamp: "2026-03-26T11:00:00.000Z",
          data: {
            message: {
              type: "assistant",
              timestamp: "2026-03-26T11:00:00.000Z",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    id: "toolu-1",
                    name: "Read"
                  }
                ]
              }
            }
          }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-03-26T11:00:02.000Z",
          message: {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "done" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "claude-code",
      rawStoreRef,
      Date.parse("2026-03-26T11:00:03.000Z")
    );

    expect(inspection.runningState).toBe("idle");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBe("2026-03-26T11:00:02.000Z");
  });

  it("Claude 把 end_turn 包在 progress assistant 里时，也必须落成已完成", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "claude-progress-stop.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "progress",
          timestamp: "2026-03-26T11:03:00.000Z",
          data: {
            message: {
              type: "assistant",
              timestamp: "2026-03-26T11:03:00.000Z",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    id: "toolu-1",
                    name: "Read"
                  }
                ]
              }
            }
          }
        }),
        JSON.stringify({
          type: "progress",
          timestamp: "2026-03-26T11:03:02.000Z",
          data: {
            message: {
              type: "assistant",
              timestamp: "2026-03-26T11:03:02.000Z",
              message: {
                role: "assistant",
                stop_reason: "end_turn",
                content: [{ type: "text", text: "done" }]
              }
            }
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "claude-code",
      rawStoreRef,
      Date.parse("2026-03-26T11:03:03.000Z")
    );

    expect(inspection.runningState).toBe("idle");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBe("2026-03-26T11:03:02.000Z");
  });

  it("Claude 刚收到用户新消息时，即使还没进入 tool_use，也应保持运行中", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-runtime-status-"));
    tempDirs.push(tempDir);
    const rawStoreRef = path.join(tempDir, "claude-running.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-03-26T11:05:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "continue" }]
          }
        })
      ].join("\n"),
      "utf8"
    );

    const inspection = inspectSessionActivity(
      "claude-code",
      rawStoreRef,
      Date.parse("2026-03-26T11:05:10.000Z")
    );

    expect(inspection.runningState).toBe("running");
    expect(inspection.hasPendingTools).toBe(false);
    expect(inspection.completedAtCandidate).toBeNull();
  });

  it("runtime 接口在 active run 不存在时，会回退到原始记录里的最近活动状态", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessions = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessions.statusCode).toBe(200);

    const codexSession = sessions
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: codexSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-26T12:00:00.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-26T12:00:00.000Z"
    });

    const runtime = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/runtime`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      hasActiveRun: false,
      runningState: "running"
    });
  });

  it("active run 已经失活时，runtime 接口和会话列表都会自动回退，不再继续显示运行中", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const setup = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(setup.statusCode).toBe(201);

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "password123"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const adminUser = hosted.services.repositories.authUserRepository.findByUsername("admin");
    expect(adminUser).toBeTruthy();

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const sessionsResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(sessionsResponse.statusCode).toBe(200);

    const codexSession = sessionsResponse
      .json()
      .items.find((item: { provider: string }) => item.provider === "codex");
    expect(codexSession).toBeTruthy();

    hosted.services.repositories.sessionStateRepository.upsert({
      sessionId: codexSession.sessionId,
      userId: adminUser!.id,
      runningState: "running",
      activitySource: "runtime",
      lastEventAt: "2026-03-23T09:00:12.000Z",
      completedAt: null,
      lastSeenAt: null,
      updatedAt: "2026-03-23T09:00:12.000Z"
    });

    const binding = hosted.services.repositories.sessionBindingRepository.findBySessionId(
      codexSession.sessionId
    );
    expect(binding).toBeTruthy();

    let active = true;
    const abandonRun = vi.fn(async (sessionId: string) => {
      if (sessionId === codexSession.sessionId) {
        active = false;
      }
    });
    const deadRuntimeSnapshot = {
      sessionId: codexSession.sessionId,
      workspaceId,
      provider: "codex" as const,
      providerSessionId: binding!.providerSessionId,
      rawStoreRef: binding!.rawStoreRef,
      runningState: "running" as const,
      attachedClients: 1,
      startedAt: "2026-03-23T09:00:11.000Z",
      lastEventAt: "2026-03-23T09:00:12.000Z",
      completedAt: null,
      detail: "native session attached",
      interruptSource: null,
      errorCode: null,
      supportsInterrupt: true
    };

    const runtimeProvider = (
      hosted.services.modules.sessionLiveRuntimeService as unknown as {
        providerRuntimeService: {
          getSnapshot: (sessionId: string) => unknown;
          isRunHealthy: (sessionId: string) => boolean | null;
          abandonRun: (sessionId: string) => Promise<void>;
        };
      }
    ).providerRuntimeService;

    const originalGetSnapshot = runtimeProvider.getSnapshot.bind(runtimeProvider);
    const originalIsRunHealthy = runtimeProvider.isRunHealthy.bind(runtimeProvider);
    const originalAbandonRun = runtimeProvider.abandonRun.bind(runtimeProvider);

    runtimeProvider.getSnapshot = ((sessionId: string) => {
      if (!active || sessionId !== codexSession.sessionId) {
        return originalGetSnapshot(sessionId);
      }

      return deadRuntimeSnapshot;
    }) as typeof runtimeProvider.getSnapshot;
    runtimeProvider.isRunHealthy = ((sessionId: string) => {
      if (!active || sessionId !== codexSession.sessionId) {
        return originalIsRunHealthy(sessionId);
      }

      return false;
    }) as typeof runtimeProvider.isRunHealthy;
    runtimeProvider.abandonRun = (async (sessionId: string) => {
      if (sessionId === codexSession.sessionId) {
        active = false;
        await abandonRun(sessionId);
        return;
      }

      await originalAbandonRun(sessionId);
    }) as typeof runtimeProvider.abandonRun;

    const runtime = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${codexSession.sessionId}/runtime`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({
      sessionId: codexSession.sessionId,
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      runningState: "interrupted",
      activityResolutionSource: "authoritative_runtime"
    });

    for (let attempt = 0; attempt < 20 && abandonRun.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }

    expect(abandonRun).toHaveBeenCalledWith(codexSession.sessionId);

    const recoveredList = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(recoveredList.statusCode).toBe(200);

    const recoveredCodexSession = recoveredList
      .json()
      .items.find((item: { sessionId: string }) => item.sessionId === codexSession.sessionId);
    expect(recoveredCodexSession).toMatchObject({
      sessionId: codexSession.sessionId,
      runningState: "interrupted",
      activitySource: "runtime",
      activityResolutionSource: "authoritative_runtime"
    });
  });
});
