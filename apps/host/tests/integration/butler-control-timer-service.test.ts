import { describe, expect, it, vi } from "vitest";

import { ButlerControlTimerService } from "../../src/modules/butler/butler-control-timer-service.js";
import type { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";
import type { ButlerControlSessionService } from "../../src/modules/butler/butler-control-session-service.js";
import type { ButlerControlTimerRepository } from "../../src/storage/repositories/butler-control-timer-repository.js";
import type { ButlerControlTimer } from "../../src/types/domain.js";

describe("ButlerControlTimerService", () => {
  it("会创建计时器并在到期后继续同一个控制会话", async () => {
    const records = new Map<string, ButlerControlTimer>();
    const repository = {
      create: vi.fn((record: ButlerControlTimer) => {
        records.set(record.id, record);
        return record;
      }),
      findById: vi.fn((id: string) => records.get(id) ?? null),
      list: vi.fn((filters?: { statuses?: string[] }) =>
        Array.from(records.values()).filter((record) =>
          !filters?.statuses || filters.statuses.includes(record.status)
        )
      ),
      listDueActive: vi.fn((referenceAt: string) =>
        Array.from(records.values()).filter(
          (record) => record.status === "active" && record.dueAt <= referenceAt
        )
      ),
      update: vi.fn((record: ButlerControlTimer) => {
        records.set(record.id, record);
        return record;
      })
    } as unknown as ButlerControlTimerRepository;
    const controlSessionService = {
      getCurrentSession: vi.fn(() => ({
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
      })),
      getSession: vi.fn(() => ({
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
      })),
      sendMessage: vi.fn(async () => ({
        controlSession: {
          id: "control-1"
        },
        sessionId: "assistant-session-1",
        provider: "codex",
        providerSessionId: "provider-assistant-1",
        acceptedAt: "2026-04-16T12:05:00.000Z",
        clientRequestId: "timer-request",
        message: {
          messageId: "message-1"
        }
      }))
    } as unknown as ButlerControlSessionService;
    const service = new ButlerControlTimerService(
      {
        ensureInitialized: vi.fn(() => ({
          id: "default"
        }))
      } as unknown as ButlerProfileService,
      controlSessionService,
      repository
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

    const result = await service.runDueTimers("2026-04-16T12:05:01.000Z");
    expect(result.dueTimerCount).toBe(1);
    expect(controlSessionService.sendMessage).toHaveBeenCalledWith("user-1", expect.objectContaining({
      controlSessionId: "control-1",
      content: "5 分钟后继续检查真实会话"
    }));
    expect(repository.update).toHaveBeenLastCalledWith(expect.objectContaining({
      id: created.id,
      status: "completed",
      triggeredAt: "2026-04-16T12:05:00.000Z"
    }));
  });
});
