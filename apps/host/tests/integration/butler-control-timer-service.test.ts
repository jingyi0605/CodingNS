import { describe, expect, it, vi } from "vitest";

import { ButlerControlTimerService } from "../../src/modules/butler/butler-control-timer-service.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlTimerRepository } from "../../src/storage/repositories/butler-control-timer-repository.js";

describe("ButlerControlTimerService", () => {
  it("会把旧 timer 创建请求映射成 once 自动化", () => {
    const controlSessionService = {
      getCurrentSession: vi.fn(),
      getSession: vi.fn(),
      sendMessage: vi.fn()
    } as unknown as ButlerControlSessionService;
    const assistantAutomationService = {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      createTask: vi.fn(() => ({
        id: "automation-1",
        controlSessionId: "control-1",
        userId: "user-1",
        projectId: "project-1",
        title: "等待真实会话",
        triggerType: "once",
        triggerConfigJson: JSON.stringify({
          dueAt: "2026-04-16T12:05:00.000Z"
        }),
        actionType: "send_control_message",
        actionConfigJson: JSON.stringify({
          content: "5 分钟后继续检查真实会话",
          includeTriggerContext: false,
          targetSessionId: "session-1"
        }),
        status: "active",
        nextRunAt: "2026-04-16T12:05:00.000Z",
        lastRunAt: null,
        lastRunSummary: null,
        lastError: null,
        createdAt: "2026-04-16T12:00:00.000Z",
        updatedAt: "2026-04-16T12:00:00.000Z",
        cancelledAt: null,
        controlSession: {
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
        }
      })),
      cancelTask: vi.fn(),
      runDueTasks: vi.fn(async () => ({
        activeTaskCount: 1,
        dueTaskCount: 1,
        processedTaskCount: 1,
        idle: false
      }))
    };
    const service = new ButlerControlTimerService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default"
        }))
      } as unknown as ButlerProfileService,
      controlSessionService,
      {} as ButlerControlTimerRepository,
      assistantAutomationService as any
    );

    const created = service.createTimer({
      userId: "user-1",
      content: "5 分钟后继续检查真实会话",
      dueAt: "2026-04-16T12:05:00.000Z",
      projectId: "project-1",
      targetSessionId: "session-1"
    });

    expect(created.status).toBe("active");
    expect(created.controlSessionId).toBe("control-1");
    expect(assistantAutomationService.createTask).toHaveBeenCalledWith({
      userId: "user-1",
      controlSessionId: undefined,
      projectId: "project-1",
      title: undefined,
      trigger: {
        type: "once",
        dueAt: "2026-04-16T12:05:00.000Z",
        afterSeconds: null
      },
      action: {
        type: "send_control_message",
        content: "5 分钟后继续检查真实会话",
        includeTriggerContext: false,
        targetSessionId: "session-1"
      }
    });
  });

  it("会把旧 timer 到期扫描转发给自动化执行器", async () => {
    const assistantAutomationService = {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      createTask: vi.fn(),
      cancelTask: vi.fn(),
      runDueTasks: vi.fn(async () => ({
        activeTaskCount: 3,
        dueTaskCount: 2,
        processedTaskCount: 2,
        idle: false
      }))
    };
    const service = new ButlerControlTimerService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default"
        }))
      } as unknown as ButlerProfileService,
      {
        getCurrentSession: vi.fn(),
        getSession: vi.fn(),
        sendMessage: vi.fn()
      } as unknown as ButlerControlSessionService,
      {} as ButlerControlTimerRepository,
      assistantAutomationService as any
    );

    const result = await service.runDueTimers("2026-04-16T12:05:01.000Z");

    expect(assistantAutomationService.runDueTasks).toHaveBeenCalledWith("2026-04-16T12:05:01.000Z");
    expect(result).toEqual({
      activeTimerCount: 3,
      dueTimerCount: 2,
      processedTimerCount: 2,
      idle: false
    });
  });

  it("列出兼容 timer 时会忽略非 once 自动化，而不是直接报错", () => {
    const assistantAutomationService = {
      listTasks: vi.fn(() => [
        {
          id: "automation-once-1",
          controlSessionId: "control-1",
          userId: "user-1",
          projectId: "project-1",
          title: "等待真实会话",
          triggerType: "once",
          triggerConfigJson: JSON.stringify({
            dueAt: "2026-04-16T12:05:00.000Z"
          }),
          actionType: "send_control_message",
          actionConfigJson: JSON.stringify({
            content: "5 分钟后继续检查真实会话",
            includeTriggerContext: false,
            targetSessionId: "session-1"
          }),
          status: "active",
          nextRunAt: "2026-04-16T12:05:00.000Z",
          lastRunAt: null,
          lastRunSummary: null,
          lastError: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          cancelledAt: null,
          controlSession: {
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
          }
        },
        {
          id: "automation-interval-1",
          controlSessionId: "control-1",
          userId: "user-1",
          projectId: "project-1",
          title: "每小时巡检",
          triggerType: "interval",
          triggerConfigJson: JSON.stringify({
            type: "interval",
            hours: 1,
            minutes: null,
            seconds: null,
            stopAt: null
          }),
          actionType: "send_control_message",
          actionConfigJson: JSON.stringify({
            content: "每小时检查一次",
            includeTriggerContext: false,
            targetSessionId: "session-1"
          }),
          status: "active",
          nextRunAt: "2026-04-16T13:00:00.000Z",
          lastRunAt: null,
          lastRunSummary: null,
          lastError: null,
          createdAt: "2026-04-16T12:00:00.000Z",
          updatedAt: "2026-04-16T12:00:00.000Z",
          cancelledAt: null,
          controlSession: {
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
          }
        }
      ]),
      getTask: vi.fn(),
      createTask: vi.fn(),
      cancelTask: vi.fn(),
      runDueTasks: vi.fn()
    };
    const service = new ButlerControlTimerService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default"
        }))
      } as unknown as ButlerProfileService,
      {
        getCurrentSession: vi.fn(),
        getSession: vi.fn(),
        sendMessage: vi.fn()
      } as unknown as ButlerControlSessionService,
      {} as ButlerControlTimerRepository,
      assistantAutomationService as any
    );

    const timers = service.listTimers({
      userId: "user-1"
    });

    expect(timers).toHaveLength(1);
    expect(timers[0]?.id).toBe("automation-once-1");
  });
});
