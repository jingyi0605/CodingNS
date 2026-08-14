import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { PlatformProvider } from "../platform/platform-provider";
import { I18nProvider, t } from "../shared/i18n";
import { SessionCleanupPanel } from "./SessionCleanupPanel";

const originalFetch = global.fetch;

describe("SessionCleanupPanel", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate(createAuthSession());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    authStore.clear();
  });

  it("设置页先显示入口按钮，打开后读取最近扫描结果", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/settings/session-cleanup/scans/latest") && method === "GET") {
        return createJsonResponse({
          latestScan: {
            id: "scan-1",
            userId: "user-1",
            providerFilterJson: "[\"codex\",\"claude-code\",\"opencode\"]",
            timeRangeStart: null,
            timeRangeEnd: null,
            candidateCount: 2,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: "2026-06-17T10:00:00.000Z",
            summary: {
              providers: ["codex", "claude-code", "opencode"],
              forced: true,
              candidates: createCandidates()
            }
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/latest-delete") && method === "GET") {
        return createJsonResponse({
          latestDeleteTask: {
            taskId: "task-delete-latest-1",
            taskType: "session_cleanup.delete",
            status: "succeeded",
            operationId: "operation-delete-1",
            totalCount: 3,
            successCount: 2,
            failedCount: 1,
            partialCount: 0,
            skippedCount: 0,
            conflictCount: 0
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/delete-detail") && method === "GET") {
        return createJsonResponse({
          deleteTask: {
            taskId: "task-delete-latest-1",
            taskType: "session_cleanup.delete",
            status: "succeeded",
            operationId: "operation-delete-1",
            phase: "completed",
            label: "删除任务已完成",
            detail: "成功 2 条，失败 1 条",
            current: 3,
            total: 3,
            percent: 100,
            totalCount: 3,
            successCount: 2,
            failedCount: 1,
            partialCount: 0,
            skippedCount: 0,
            conflictCount: 0,
            items: []
          }
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    expect(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") })).toBeInTheDocument();
    expect(screen.queryByText("Codex 会话 A")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupModalTitle") });
    await waitFor(() => {
      expect(within(dialog).getByText("Codex 会话 A")).toBeInTheDocument();
    });

    expect(within(dialog).getByLabelText(t("settings.sessionCleanupSummaryTitle"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupSummaryCandidates"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupSummarySelected"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupSummaryRestorable"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupFilterSectionTitle"))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t("settings.sessionCleanupFilterStartAtLabel"))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t("settings.sessionCleanupFilterEndAtLabel"))).toBeInTheDocument();
    expect(dialog.querySelector(".settings-session-cleanup-list-shell")).not.toBeNull();
    expect(within(dialog).getByText("Claude Code 会话 B")).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupDeleteTaskHint", {
      taskId: "task-delete-latest-1",
      totalCount: 3,
      deletedCount: 2,
      failedCount: 1
    }))).toBeInTheDocument();
  });

  it("支持关键字过滤和快捷时间筛选", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/settings/session-cleanup/scans/latest") && method === "GET") {
        return createJsonResponse({
          latestScan: {
            id: "scan-3",
            userId: "user-1",
            providerFilterJson: "[\"codex\",\"claude-code\",\"opencode\"]",
            timeRangeStart: null,
            timeRangeEnd: null,
            candidateCount: 2,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: "2026-06-17T10:00:00.000Z",
            summary: {
              providers: ["codex", "claude-code", "opencode"],
              forced: true,
              candidates: createCandidates()
            }
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/latest-delete") && method === "GET") {
        return createJsonResponse({
          latestDeleteTask: null
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/delete-detail") && method === "GET") {
        return createJsonResponse({
          deleteTask: null
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupModalTitle") });
    await within(dialog).findByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    });

    const keywordInput = within(dialog).getByRole("textbox", {
      name: t("settings.sessionCleanupFilterKeywordLabel")
    });
    await userEvent.type(keywordInput, "Claude");

    expect(within(dialog).queryByText("Codex 会话 A")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Claude Code 会话 B")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", {
      name: t("settings.sessionCleanupFilterQuick7Days")
    }));

    expect(String(within(dialog).getByLabelText(t("settings.sessionCleanupFilterStartAtLabel")).getAttribute("value"))).toBe("");
    expect(String(within(dialog).getByLabelText(t("settings.sessionCleanupFilterEndAtLabel")).getAttribute("value"))).toContain("T");
  });

  it("全选当前只会选中过滤后的会话", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/settings/session-cleanup/scans/latest") && method === "GET") {
        return createJsonResponse({
          latestScan: {
            id: "scan-4",
            userId: "user-1",
            providerFilterJson: "[\"codex\",\"claude-code\",\"opencode\"]",
            timeRangeStart: null,
            timeRangeEnd: null,
            candidateCount: 2,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: "2026-06-17T10:00:00.000Z",
            summary: {
              providers: ["codex", "claude-code", "opencode"],
              forced: true,
              candidates: createCandidates()
            }
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/latest-delete") && method === "GET") {
        return createJsonResponse({
          latestDeleteTask: null
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/delete-detail") && method === "GET") {
        return createJsonResponse({
          deleteTask: null
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupModalTitle") });
    await within(dialog).findByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    });

    await userEvent.type(within(dialog).getByRole("textbox", {
      name: t("settings.sessionCleanupFilterKeywordLabel")
    }), "Claude");

    await userEvent.click(within(dialog).getByRole("button", {
      name: t("settings.sessionCleanupSelectAllVisibleAction")
    }));

    expect(within(dialog).getByText("1")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Claude Code 会话 B" })
    })).toBeChecked();
    expect(within(dialog).queryByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    })).not.toBeInTheDocument();
  });

  it("全选当前再次点击会取消当前过滤结果的选择", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/settings/session-cleanup/scans/latest") && method === "GET") {
        return createJsonResponse({
          latestScan: {
            id: "scan-5",
            userId: "user-1",
            providerFilterJson: "[\"codex\",\"claude-code\",\"opencode\"]",
            timeRangeStart: null,
            timeRangeEnd: null,
            candidateCount: 2,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: "2026-06-17T10:00:00.000Z",
            summary: {
              providers: ["codex", "claude-code", "opencode"],
              forced: true,
              candidates: createCandidates()
            }
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/latest-delete") && method === "GET") {
        return createJsonResponse({
          latestDeleteTask: null
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/delete-detail") && method === "GET") {
        return createJsonResponse({
          deleteTask: null
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupModalTitle") });
    await within(dialog).findByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    });

    await userEvent.type(within(dialog).getByRole("textbox", {
      name: t("settings.sessionCleanupFilterKeywordLabel")
    }), "Claude");

    const selectAllButton = within(dialog).getByRole("button", {
      name: t("settings.sessionCleanupSelectAllVisibleAction")
    });

    await userEvent.click(selectAllButton);
    expect(within(dialog).getByText("1")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Claude Code 会话 B" })
    })).toBeChecked();

    await userEvent.click(selectAllButton);
    expect(within(dialog).getByText(t("settings.sessionCleanupSummarySelected")).nextElementSibling?.textContent).toBe("0");
    expect(within(dialog).getByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Claude Code 会话 B" })
    })).not.toBeChecked();
  });

  it("可以触发扫描、备份、读取备份、恢复和删除", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ method, url, body });

      if (url.endsWith("/api/settings/session-cleanup/scans/latest") && method === "GET") {
        return createJsonResponse({
          latestScan: {
            id: "scan-2",
            userId: "user-1",
            providerFilterJson: "[\"codex\",\"claude-code\",\"opencode\"]",
            timeRangeStart: null,
            timeRangeEnd: null,
            candidateCount: 2,
            createdAt: "2026-06-17T10:00:00.000Z",
            updatedAt: "2026-06-17T10:00:00.000Z",
            summary: {
              providers: ["codex", "claude-code", "opencode"],
              forced: true,
              candidates: createCandidates()
            }
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/latest-delete") && method === "GET") {
        return createJsonResponse({
          latestDeleteTask: {
            taskId: "task-delete-1",
            taskType: "session_cleanup.delete",
            status: "succeeded",
            operationId: "operation-delete-1",
            totalCount: 1,
            successCount: 1,
            failedCount: 0,
            partialCount: 0,
            skippedCount: 0,
            conflictCount: 0
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/tasks/delete-detail") && method === "GET") {
        return createJsonResponse({
          deleteTask: {
            taskId: "task-delete-1",
            taskType: "session_cleanup.delete",
            status: "running",
            operationId: "operation-delete-1",
            phase: "deleting",
            label: "正在删除会话",
            detail: "已处理 1 / 2 条",
            current: 1,
            total: 2,
            percent: 50,
            totalCount: 1,
            successCount: 1,
            failedCount: 0,
            partialCount: 0,
            skippedCount: 0,
            conflictCount: 0,
            items: [
              {
                id: "item-delete-1",
                operationId: "operation-delete-1",
                taskKind: "delete",
                candidateId: "candidate-1",
                provider: "codex",
                sessionId: "session-1",
                providerSessionId: "provider-session-1",
                rawStoreRef: "/tmp/codex/session-1.jsonl",
                status: "success",
                backupStatus: null,
                providerDeleteStatus: "deleted",
                localDeleteStatus: "deleted",
                restoreStatus: null,
                detail: "已复用单条删除主链路完成级联删除",
                createdAt: "2026-06-17T10:00:00.000Z",
                updatedAt: "2026-06-17T10:00:05.000Z"
              }
            ]
          }
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/scans") && method === "POST") {
        return createJsonResponse({
          taskId: "task-scan-1",
          taskType: "session_cleanup.scan",
          key: "scan",
          deduped: false
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/backups") && method === "POST") {
        return createJsonResponse({
          taskId: "task-backup-1",
          taskType: "session_cleanup.backup",
          key: "backup",
          deduped: false
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/backup-inspections") && method === "POST") {
        return createJsonResponse({
          manifest: {
            version: "1",
            createdAt: "2026-06-17T10:00:00.000Z",
            createdBy: "tester",
            entries: [
              {
                entryId: "entry-1",
                candidateId: "candidate-1",
                provider: "codex",
                title: "Codex 会话 A",
                startedAt: "2026-06-16T08:00:00.000Z",
                lastMessageAt: "2026-06-16T09:00:00.000Z",
                completeness: "complete",
                restorable: true
              }
            ],
            summary: {
              sessionCount: 1,
              completeCount: 1,
              partialCount: 0,
              providerCounts: {
                codex: 1
              }
            }
          },
          restorableEntries: [
            {
              entryId: "entry-1",
              candidateId: "candidate-1",
              provider: "codex",
              title: "Codex 会话 A",
              startedAt: "2026-06-16T08:00:00.000Z",
              lastMessageAt: "2026-06-16T09:00:00.000Z",
              completeness: "complete",
              restorable: true,
              conflict: {
                hasConflict: false,
                reasons: []
              }
            }
          ]
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/restores") && method === "POST") {
        return createJsonResponse({
          taskId: "task-restore-1",
          taskType: "session_cleanup.restore",
          key: "restore",
          deduped: false
        });
      }

      if (url.endsWith("/api/settings/session-cleanup/deletions") && method === "POST") {
        return createJsonResponse({
          taskId: "task-delete-1",
          taskType: "session_cleanup.delete",
          key: "delete",
          deduped: false
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.sessionCleanupOpenAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupModalTitle") });
    await within(dialog).findByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.sessionCleanupScanAction") }));
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/scans")
        )
      ).toBe(true);
    });
    expect(within(dialog).getByText(t("settings.sessionCleanupScanQueued"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("checkbox", {
      name: t("settings.sessionCleanupSelectCandidate", { title: "Codex 会话 A" })
    }));
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.sessionCleanupBackupAction") }));
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/backups")
        )
      ).toBe(true);
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.sessionCleanupInspectArchiveAction") }));
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/backup-inspections")
        )
      ).toBe(true);
    });
    expect(within(dialog).getByText(t("settings.sessionCleanupArchiveLoaded"))).toBeInTheDocument();

    expect(within(dialog).getByRole("checkbox", {
      name: t("settings.sessionCleanupSelectRestoreEntry", { title: "Codex 会话 A" })
    })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.sessionCleanupRestoreAction") }));
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/restores")
        )
      ).toBe(true);
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.sessionCleanupDeleteAction") }));
    const deleteConfirmDialog = await screen.findByRole("dialog", { name: t("settings.sessionCleanupDeleteConfirmTitle") });
    expect(within(deleteConfirmDialog).getByText(t("settings.sessionCleanupDeleteConfirmSelection", { count: 1 }))).toBeInTheDocument();
    expect(within(deleteConfirmDialog).getByText(t("settings.sessionCleanupDeleteConfirmImpact"))).toBeInTheDocument();
    expect(
      requests.some((request) =>
        request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/deletions")
      )
    ).toBe(false);

    await userEvent.click(within(deleteConfirmDialog).getByRole("button", { name: t("settings.sessionCleanupDeleteConfirmAction") }));
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/settings/session-cleanup/deletions")
        )
      ).toBe(true);
    });
    expect(within(dialog).getByText(t("settings.sessionCleanupDeleteProgressTitle"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.sessionCleanupTaskStatus.running"))).toBeInTheDocument();
    expect(within(dialog).getByText("已复用单条删除主链路完成级联删除")).toBeInTheDocument();

    expect(
      requests.some((request) =>
        request.method === "POST"
        && request.url.endsWith("/api/settings/session-cleanup/backups")
        && isRecord(request.body)
        && Array.isArray(request.body.candidateIds)
        && request.body.candidateIds.includes("candidate-1")
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.method === "POST"
        && request.url.endsWith("/api/settings/session-cleanup/restores")
        && isRecord(request.body)
        && Array.isArray(request.body.entryIds)
        && request.body.entryIds.includes("entry-1")
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.method === "POST"
        && request.url.endsWith("/api/settings/session-cleanup/deletions")
        && isRecord(request.body)
        && Array.isArray(request.body.candidateIds)
        && request.body.candidateIds.includes("candidate-1")
      )
    ).toBe(true);
  });
});

function renderPanel() {
  return render(
    <PlatformProvider>
      <I18nProvider language={clientConfigStore.getState().language}>
        <SessionCleanupPanel />
      </I18nProvider>
    </PlatformProvider>
  );
}

function createAuthSession() {
  return {
    accessToken: "token-1",
    refreshToken: "refresh-1",
    expiresIn: 3600,
    user: {
      userId: "user-1",
      username: "tester",
      role: "admin" as const
    }
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createCandidates() {
  return [
    {
      candidateId: "candidate-1",
      provider: "codex",
      sessionId: "session-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: null,
      workspaceId: "workspace-1",
      workspacePath: "/tmp/workspace-1",
      title: "Codex 会话 A",
      startedAt: "2026-06-16T08:00:00.000Z",
      lastMessageAt: "2026-06-16T09:00:00.000Z",
      estimatedBytes: 1024,
      sourceHealth: "healthy",
      deletable: true,
      backupable: true,
      restorable: true
    },
    {
      candidateId: "candidate-2",
      provider: "claude-code",
      sessionId: "session-2",
      providerSessionId: "provider-session-2",
      rawStoreRef: null,
      workspaceId: "workspace-2",
      workspacePath: "/tmp/workspace-2",
      title: "Claude Code 会话 B",
      startedAt: "2026-06-15T08:00:00.000Z",
      lastMessageAt: "2026-06-15T09:00:00.000Z",
      estimatedBytes: 2048,
      sourceHealth: "partial",
      deletable: true,
      backupable: true,
      restorable: false
    }
  ] as const;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
