import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
});
