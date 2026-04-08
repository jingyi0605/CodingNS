import { describe, expect, it, vi } from "vitest";

import type { ButlerInboxItem, ButlerProject } from "../../src/types/domain.js";
import type { ButlerInboxItemRepository } from "../../src/storage/repositories/butler-inbox-item-repository.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import { ButlerInboxService } from "../../src/modules/butler/butler-inbox-service.js";

describe("ButlerInboxService", () => {
  it("可以创建、筛选并更新收件箱事项", () => {
    const projectA: ButlerProject = {
      id: "project-a",
      workspaceId: "workspace-1",
      name: "项目甲",
      repoRoot: "/tmp/project-a",
      defaultProvider: "codex",
      instructionProfileId: null,
      approvalMode: "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: "2026-04-07T00:00:00.000Z",
      updatedAt: "2026-04-07T00:00:00.000Z",
      archivedAt: null
    };
    const projectB: ButlerProject = {
      ...projectA,
      id: "project-b",
      workspaceId: "workspace-2",
      name: "项目乙"
    };
    const items: ButlerInboxItem[] = [];

    const projectRepository = {
      findById: vi.fn((id: string) => [projectA, projectB].find((project) => project.id === id) ?? null),
      list: vi.fn(() => [projectA, projectB])
    } satisfies Pick<ButlerProjectRepository, "findById" | "list">;
    const inboxItemRepository = {
      create: vi.fn((record: ButlerInboxItem) => {
        items.push(record);
        return record;
      }),
      list: vi.fn((filters?: { projectId?: string; status?: string; itemType?: string }) =>
        items.filter((item) => {
          if (filters?.projectId && item.projectId !== filters.projectId) {
            return false;
          }

          if (filters?.status && item.status !== filters.status) {
            return false;
          }

          if (filters?.itemType && item.itemType !== filters.itemType) {
            return false;
          }

          return true;
        })
      ),
      findById: vi.fn((id: string) => items.find((item) => item.id === id) ?? null),
      update: vi.fn((record: ButlerInboxItem) => {
        const index = items.findIndex((item) => item.id === record.id);

        if (index >= 0) {
          items[index] = record;
        }

        return record;
      }),
      delete: vi.fn((id: string) => {
        const index = items.findIndex((item) => item.id === id);

        if (index >= 0) {
          items.splice(index, 1);
        }
      })
    } satisfies Pick<ButlerInboxItemRepository, "create" | "list" | "findById" | "update" | "delete">;

    const service = new ButlerInboxService(
      projectRepository as unknown as ButlerProjectRepository,
      inboxItemRepository as unknown as ButlerInboxItemRepository
    );

    const created = service.createItem({
      projectId: projectA.id,
      itemType: "bug",
      title: "登录失败",
      content: "用户反馈验证码通过后仍然无法登录",
      priority: "high"
    });

    expect(created.projectName).toBe("项目甲");
    expect(created.workspaceId).toBe("workspace-1");

    const filtered = service.listItems({
      workspaceId: "workspace-1"
    });
    expect(filtered).toHaveLength(1);

    const updated = service.updateItem(created.id, {
      status: "closed"
    });
    expect(updated.status).toBe("closed");
    expect(updated.closedAt).not.toBeNull();

    service.deleteItem(created.id);
    expect(service.listItems()).toHaveLength(0);
  });
});
