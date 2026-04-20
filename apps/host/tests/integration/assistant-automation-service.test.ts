import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantAutomationService } from "../../src/modules/butler/assistant-automation-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { AssistantAutomationRunRepository } from "../../src/storage/repositories/assistant-automation-run-repository.js";
import { AssistantAutomationTaskRepository } from "../../src/storage/repositories/assistant-automation-task-repository.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/storage/sqlite/client.js";

describe("AssistantAutomationService", () => {
  const databases: DatabaseClient[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (databases.length > 0) {
      databases.pop()?.close();
    }
  });

  function createService(options: {
    sendAcceptedAt?: string;
    sendMessageError?: Error;
    gitLatestTag?: { tag: string | null; ref: string | null };
    runtime?: {
      runningState: string;
      hasActiveRun: boolean;
    };
  } = {}) {
    const database = createDatabaseClient(":memory:");
    databases.push(database);
    database.db.exec(`
      INSERT INTO auth_users (
        id,
        username,
        password_hash,
        role,
        created_at,
        updated_at
      ) VALUES (
        'user-1',
        'admin',
        'hash',
        'admin',
        '2026-04-16T12:00:00.000Z',
        '2026-04-16T12:00:00.000Z'
      );

      INSERT INTO workspaces (
        id,
        name,
        path,
        repo_root,
        favorite,
        sort_order,
        created_at,
        updated_at
      ) VALUES (
        'workspace-1',
        'CodingNS',
        '/tmp/codingns',
        '/tmp/codingns',
        0,
        0,
        '2026-04-16T12:00:00.000Z',
        '2026-04-16T12:00:00.000Z'
      );

      INSERT INTO session_bindings (
        session_id,
        workspace_id,
        provider,
        provider_session_id,
        raw_store_ref,
        created_at,
        updated_at
      ) VALUES (
        'assistant-session-1',
        'workspace-1',
        'codex',
        'provider-session-1',
        'store://assistant-session-1',
        '2026-04-16T12:00:00.000Z',
        '2026-04-16T12:00:00.000Z'
      );

      INSERT INTO butler_control_sessions (
        id,
        provider_id,
        session_id,
        purpose,
        title,
        source_item_id,
        model,
        reasoning_level,
        permission_mode,
        status,
        last_context_version,
        last_summary,
        created_at,
        updated_at
      ) VALUES (
        'control-1',
        'codex',
        'assistant-session-1',
        'chat',
        '代码助手',
        NULL,
        'gpt-5.4',
        'high',
        'default',
        'running',
        NULL,
        NULL,
        '2026-04-16T12:00:00.000Z',
        '2026-04-16T12:00:00.000Z'
      );
    `);
    const controlSession = {
      id: "control-1",
      providerId: "codex",
      sessionId: "assistant-session-1",
      purpose: "chat",
      title: "代码助手",
      sourceItemId: null,
      model: "gpt-5.4",
      reasoningLevel: "high",
      permissionMode: "default",
      status: "running",
      lastContextVersion: null,
      lastSummary: null,
      createdAt: "2026-04-16T12:00:00.000Z",
      updatedAt: "2026-04-16T12:00:00.000Z",
      session: {
        sessionId: "assistant-session-1"
      }
    };
    const butlerControlSessionService = {
      getCurrentSession: vi.fn(() => controlSession),
      getSession: vi.fn(() => controlSession),
      sendMessage: vi.fn(async () => {
        if (options.sendMessageError) {
          throw options.sendMessageError;
        }

        return {
          controlSession,
          sessionId: "assistant-session-1",
          provider: "codex",
          providerSessionId: "provider-session-1",
          acceptedAt: options.sendAcceptedAt ?? "2026-04-16T12:05:00.000Z",
          clientRequestId: "automation-request-1",
          message: {
            messageId: "message-1"
          }
        };
      })
    };
    const gitCommandRunner = {
      run: vi.fn(async () => ({
        stdout: options.gitLatestTag
          ? options.gitLatestTag.tag
            ? `${options.gitLatestTag.ref}\trefs/tags/${options.gitLatestTag.tag}\n`
            : ""
          : "4e0f4506fb629a5d370ef1fabfeaea6889f86e02\trefs/tags/v0.3.6\n",
        stderr: "",
        exitCode: 0
      }))
    };
    const sessionLiveRuntimeService = {
      getSessionRuntime: vi.fn(async () => ({
        sessionId: "assistant-session-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        runningState: options.runtime?.runningState ?? "running",
        hasActiveRun: options.runtime?.hasActiveRun ?? true,
        canAttach: false,
        canInterrupt: false,
        inRunInputMode: "blocked",
        activityResolutionSource: "authoritative_runtime",
        activityConfidence: "authoritative",
        runId: null,
        detail: null,
        interruptSource: null,
        errorCode: null,
        errorDetail: null,
        updatedAt: "2026-04-16T12:00:00.000Z",
        watchdogTriggeredAt: null,
        contextUsage: null
      }))
    };
    const taskRepository = new AssistantAutomationTaskRepository(database.db);
    const runRepository = new AssistantAutomationRunRepository(database.db);
    const service = new AssistantAutomationService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default"
        }))
      } as any,
      butlerControlSessionService as any,
      taskRepository,
      runRepository,
      undefined,
      {
        gitCommandRunner: gitCommandRunner as any,
        sessionLiveRuntimeService: sessionLiveRuntimeService as any,
        gitWorkingDirectory: "/tmp"
      }
    );

    return {
      service,
      butlerControlSessionService,
      gitCommandRunner,
      sessionLiveRuntimeService,
      taskRepository,
      runRepository
    };
  }

  it("会创建一次性自动化并在到期后执行", async () => {
    const { service, butlerControlSessionService } = createService();

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "监控 CodingNS tag",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "请检查 codingns 是否有新 tag",
        targetSessionId: "session-1"
      }
    });

    expect(automation.status).toBe("active");
    expect(automation.triggerType).toBe("once");

    const result = await service.runDueTasks("2026-04-16T12:05:01.000Z");

    expect(result).toEqual({
      activeTaskCount: 1,
      dueTaskCount: 1,
      processedTaskCount: 1,
      idle: false
    });
    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      controlSessionId: "control-1",
      content: "请检查 codingns 是否有新 tag"
    }));

    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("completed");
    expect(updated.nextRunAt).toBeNull();
    expect(updated.lastRunSummary).toBe("请检查 codingns 是否有新 tag");

    const runs = service.listRuns(automation.id, "user-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationId: automation.id,
      runSeq: 1,
      status: "succeeded",
      summary: "请检查 codingns 是否有新 tag"
    });
  });

  it("单次自动化遇到套餐限额时会顺延到恢复后 5 分钟", async () => {
    const { service, butlerControlSessionService } = createService({
      sendMessageError: new AppError({
        statusCode: 429,
        errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED",
        detail: "助手控制会话检测到 provider 套餐限额。",
        data: {
          providerUsageLimit: {
            category: "usage_limit",
            providerId: "codex",
            source: "error",
            retryAt: "2026-04-16T13:30:00.000Z",
            retryAfterSeconds: null,
            rawText: "You've hit your usage limit.",
            summary: "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
          },
          blockedUntil: "2026-04-16T13:35:00.000Z",
          sessionId: "assistant-session-1",
          sourceLabel: "助手控制会话"
        }
      })
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "一次性提醒",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "5 分钟后提醒我"
      }
    });

    await service.runDueTasks("2026-04-16T12:05:01.000Z");

    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-16T13:35:00.000Z");
    expect(updated.lastRunSummary).toContain("套餐限额");
    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("会更新进行中自动化的提示词和触发配置", () => {
    const { service } = createService();
    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "夜间巡视",
      trigger: {
        type: "interval",
        minutes: 30
      },
      action: {
        type: "send_control_message",
        content: "执行项目巡视"
      }
    });

    const updated = service.updateTask({
      taskId: automation.id,
      userId: "user-1",
      title: "夜间巡视升级版",
      content: "执行项目巡视并补充摘要",
      includeTriggerContext: true,
      everyMinutes: 45,
      stopAt: "2099-04-16T18:00:00.000Z"
    });

    expect(updated.title).toBe("夜间巡视升级版");
    expect(updated.actionConfig).toMatchObject({
      content: "执行项目巡视并补充摘要",
      includeTriggerContext: true
    });
    expect(updated.triggerConfig).toMatchObject({
      type: "interval",
      minutes: 45,
      stopAt: "2099-04-16T18:00:00.000Z"
    });
    expect(updated.nextRunAt).toBeTruthy();
  });

  it("不允许修改已经结束的自动化", () => {
    const { service } = createService();
    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "单次检查",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "检查结果"
      }
    });

    service.cancelTask(automation.id, "user-1");

    expect(() => service.updateTask({
      taskId: automation.id,
      userId: "user-1",
      title: "不该成功"
    })).toThrowError(AppError);
  });

  it("重启后会把已成功但未收口的任务直接补成 completed，不会重复发消息", async () => {
    const { service, butlerControlSessionService, runRepository } = createService();

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "监控 CodingNS tag",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "请检查 codingns 是否有新 tag",
        targetSessionId: "session-1"
      }
    });

    runRepository.create({
      id: "run-1",
      automationId: automation.id,
      runSeq: 1,
      triggerType: "once",
      triggerSnapshotJson: automation.triggerConfigJson,
      actionType: "send_control_message",
      actionSnapshotJson: automation.actionConfigJson,
      status: "succeeded",
      summary: "请检查 codingns 是否有新 tag",
      error: null,
      scheduledAt: "2026-04-16T12:05:00.000Z",
      startedAt: "2026-04-16T12:05:00.000Z",
      finishedAt: "2026-04-16T12:05:01.000Z",
      createdAt: "2026-04-16T12:05:00.000Z"
    });

    const result = await service.runDueTasks("2026-04-16T12:05:02.000Z");

    expect(result.processedTaskCount).toBe(1);
    expect(butlerControlSessionService.sendMessage).not.toHaveBeenCalled();

    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("completed");
    expect(updated.lastRunAt).toBe("2026-04-16T12:05:01.000Z");
    expect(updated.nextRunAt).toBeNull();
  });

  it("重启后会把卡在 running 的旧 run 标记失败，再补一次当前执行", async () => {
    const { service, butlerControlSessionService, runRepository } = createService();

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "监控 CodingNS tag",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "请检查 codingns 是否有新 tag",
        targetSessionId: "session-1"
      }
    });

    runRepository.create({
      id: "run-1",
      automationId: automation.id,
      runSeq: 1,
      triggerType: "once",
      triggerSnapshotJson: automation.triggerConfigJson,
      actionType: "send_control_message",
      actionSnapshotJson: automation.actionConfigJson,
      status: "running",
      summary: null,
      error: null,
      scheduledAt: "2026-04-16T12:05:00.000Z",
      startedAt: "2026-04-16T12:05:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-16T12:05:00.000Z"
    });

    await service.runDueTasks("2026-04-16T12:05:02.000Z");

    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);

    const runs = service.listRuns(automation.id, "user-1");
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({
      runSeq: 1,
      status: "failed",
      error: "ASSISTANT_AUTOMATION_RUN_INTERRUPTED"
    });
    expect(runs[0]).toMatchObject({
      runSeq: 2,
      status: "succeeded"
    });

    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("completed");
  });

  it("interval 自动化成功后会推进到下一次运行时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service, butlerControlSessionService } = createService({
      sendAcceptedAt: "2026-04-16T13:00:00.000Z"
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "每小时巡检",
      trigger: {
        type: "interval",
        hours: 1
      },
      action: {
        type: "send_control_message",
        content: "每小时检查一次"
      }
    });

    expect(automation.triggerType).toBe("interval");
    expect(automation.nextRunAt).toBe("2026-04-16T13:00:00.000Z");

    await service.runDueTasks("2026-04-16T13:00:01.000Z");

    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);
    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-16T14:00:00.000Z");

    const runs = service.listRuns(automation.id, "user-1");
    expect(runs[0]).toMatchObject({
      status: "succeeded",
      triggerType: "interval"
    });
  });

  it("循环自动化遇到套餐限额时会跳过冷却窗口内的轮次，并从下一次自然调度点继续", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service, butlerControlSessionService } = createService({
      sendMessageError: new AppError({
        statusCode: 429,
        errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED",
        detail: "助手控制会话检测到 provider 套餐限额。",
        data: {
          providerUsageLimit: {
            category: "usage_limit",
            providerId: "codex",
            source: "error",
            retryAt: "2026-04-16T13:30:00.000Z",
            retryAfterSeconds: null,
            rawText: "You've hit your usage limit.",
            summary: "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
          },
          blockedUntil: "2026-04-16T13:35:00.000Z",
          sessionId: "assistant-session-1",
          sourceLabel: "助手控制会话"
        }
      })
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "每小时巡检",
      trigger: {
        type: "interval",
        hours: 1
      },
      action: {
        type: "send_control_message",
        content: "每小时检查一次"
      }
    });

    await service.runDueTasks("2026-04-16T13:00:01.000Z");

    let updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("paused");
    expect(updated.nextRunAt).toBe("2026-04-16T13:35:00.000Z");
    expect(updated.lastRunSummary).toContain("套餐限额");

    await service.runDueTasks("2026-04-16T13:35:01.000Z");

    updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-16T14:35:01.000Z");
    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("interval 自动化可以只取消本次等待并保留后续调度", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service } = createService();

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "每小时巡检",
      trigger: {
        type: "interval",
        hours: 1
      },
      action: {
        type: "send_control_message",
        content: "每小时检查一次"
      }
    });

    const updated = service.skipCurrentWait(automation.id, "user-1");

    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-16T14:00:00.000Z");

    const runs = service.listRuns(automation.id, "user-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "cancelled",
      scheduledAt: "2026-04-16T13:00:00.000Z",
      summary: "已手动取消本次等待，保留自动化并重新安排下一次运行。"
    });
  });

  it("单次自动化不支持只取消本次等待", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service } = createService();

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "一次性提醒",
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z"
      },
      action: {
        type: "send_control_message",
        content: "5 分钟后提醒我"
      }
    });

    let receivedError: unknown = null;

    try {
      service.skipCurrentWait(automation.id, "user-1");
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(AppError);
    expect(receivedError).toMatchObject({
      statusCode: 409,
      errorCode: "ASSISTANT_AUTOMATION_WAIT_SKIP_UNSUPPORTED"
    });
  });

  it("cron 自动化成功后会计算下一次匹配时间", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T00:00:00.000Z"));
    const { service } = createService({
      sendAcceptedAt: "2026-04-17T01:30:00.000Z"
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "工作日晨检",
      trigger: {
        type: "cron",
        minute: 30,
        hour: 9,
        daysOfWeek: [1, 2, 3, 4, 5]
      },
      action: {
        type: "send_control_message",
        content: "工作日 09:30 检查"
      }
    });

    expect(automation.nextRunAt).toBe("2026-04-17T01:30:00.000Z");

    await service.runDueTasks("2026-04-17T01:30:01.000Z");

    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-20T01:30:00.000Z");
  });

  it("condition git.remote_tag_changed 首次只写基线，不会直接发消息；出现新 tag 后才触发", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service, butlerControlSessionService, gitCommandRunner } = createService({
      sendAcceptedAt: "2026-04-16T13:00:00.000Z"
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "新 tag 通知",
      trigger: {
        type: "condition",
        conditionKind: "git.remote_tag_changed",
        repositoryUrl: "https://github.com/jingyi0605/codingns.git",
        pollIntervalSeconds: 3600
      },
      action: {
        type: "send_control_message",
        content: "发现新 tag 后通知我",
        includeTriggerContext: true
      }
    });

    await service.runDueTasks("2026-04-16T13:00:00.000Z");

    expect(butlerControlSessionService.sendMessage).not.toHaveBeenCalled();
    let updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("active");
    expect(updated.nextRunAt).toBe("2026-04-16T14:00:00.000Z");
    expect(gitCommandRunner.run).toHaveBeenCalledTimes(1);

    gitCommandRunner.run.mockResolvedValueOnce({
      stdout: "5f9a2b7e1234567890abcdef1234567890abcd12\trefs/tags/v0.3.7\n",
      stderr: "",
      exitCode: 0
    });

    await service.runDueTasks("2026-04-16T14:00:01.000Z");

    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);
    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        content: expect.stringContaining("触发条件：远端仓库出现新 tag")
      })
    );

    updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("completed");
    expect(updated.nextRunAt).toBeNull();
    const runs = service.listRuns(automation.id, "user-1");
    expect(runs[0].triggerSnapshot.triggerContext).toMatchObject({
      previousTag: "v0.3.6",
      currentTag: "v0.3.7"
    });
  });

  it("condition session.runtime_idle 只有从活跃变为空闲时才触发", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    const { service, butlerControlSessionService, sessionLiveRuntimeService } = createService({
      runtime: {
        runningState: "running",
        hasActiveRun: true
      }
    });

    const automation = service.createTask({
      userId: "user-1",
      projectId: "project-1",
      title: "会话空闲后继续",
      trigger: {
        type: "condition",
        conditionKind: "session.runtime_idle",
        sessionId: "assistant-session-1",
        pollIntervalSeconds: 300
      },
      action: {
        type: "send_control_message",
        content: "会话空闲后继续下一步",
        includeTriggerContext: true
      }
    });

    await service.runDueTasks("2026-04-16T12:05:01.000Z");

    expect(butlerControlSessionService.sendMessage).not.toHaveBeenCalled();
    sessionLiveRuntimeService.getSessionRuntime.mockResolvedValueOnce({
      sessionId: "assistant-session-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      runningState: "completed",
      hasActiveRun: false,
      canAttach: false,
      canInterrupt: false,
      inRunInputMode: "blocked",
      activityResolutionSource: "authoritative_runtime",
      activityConfidence: "authoritative",
      runId: null,
      detail: null,
      interruptSource: null,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-04-16T12:09:00.000Z",
      watchdogTriggeredAt: null,
      contextUsage: null
    });

    await service.runDueTasks("2026-04-16T12:10:01.000Z");

    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledTimes(1);
    expect(butlerControlSessionService.sendMessage).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        content: expect.stringContaining("目标会话已进入空闲状态")
      })
    );
    const updated = service.getTask(automation.id, "user-1");
    expect(updated.status).toBe("completed");
  });
});
