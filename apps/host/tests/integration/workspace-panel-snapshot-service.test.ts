import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacePanelSnapshotService } from "../../src/modules/workbench/workspace-panel-snapshot-service.js";
import type { FileTreeService } from "../../src/modules/file/file-tree-service.js";
import type { GitReadService } from "../../src/modules/git/git-read-service.js";
import type { CommandTemplateService } from "../../src/modules/terminal/command-template-service.js";
import type { TerminalService } from "../../src/modules/terminal/terminal-service.js";
import type { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";

describe("WorkspacePanelSnapshotService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Git 变更从未暂存切到已暂存时，不会误用旧缓存", async () => {
    vi.useFakeTimers();

    const workspaceId = "workspace-1";
    const statusQueue = [
      createGitStatus(workspaceId, false),
      createGitStatus(workspaceId, true)
    ];
    let historyCallCount = 0;

    const gitReadService = {
      getStatus: vi.fn(async () => statusQueue.shift() ?? createGitStatus(workspaceId, true)),
      getHistory: vi.fn(async () => {
        historyCallCount += 1;
        return {
          items: [
            {
              commitHash: historyCallCount === 1 ? "11111111" : "22222222",
              authorName: "Linus",
              authoredAt: "2026-04-02T00:00:00.000Z",
              subject: historyCallCount === 1 ? "feat: first snapshot" : "feat: second snapshot",
              body: "",
              commitKind: "shared" as const,
              refs: []
            }
          ],
          cursor: "0",
          nextCursor: null,
          totalCount: 1
        };
      }),
      getBranches: vi.fn(async () => ({
        currentBranch: "main",
        local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
        remote: []
      }))
    } satisfies Pick<GitReadService, "getStatus" | "getHistory" | "getBranches">;

    const service = new WorkspacePanelSnapshotService(
      {
        list: vi.fn()
      } as unknown as FileTreeService,
      gitReadService as unknown as GitReadService,
      {
        listTerminalSnapshotItems: vi.fn()
      } as unknown as TerminalService,
      {
        listTemplates: vi.fn(),
        listTemplateRuntimeStatuses: vi.fn()
      } as unknown as CommandTemplateService,
      {
        getManagementSummary: vi.fn()
      } as unknown as WorkspaceService
    );

    const first = await service.getGitPanelSnapshot(workspaceId);

    expect(first.status.changes[0]?.staged).toBe(false);
    expect(first.history[0]?.subject).toBe("feat: first snapshot");
    expect(gitReadService.getHistory).toHaveBeenCalledTimes(1);
    expect(gitReadService.getBranches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_001);

    const second = await service.getGitPanelSnapshot(workspaceId);

    expect(second.status.changes[0]?.staged).toBe(true);
    expect(second.history[0]?.subject).toBe("feat: second snapshot");
    expect(gitReadService.getHistory).toHaveBeenCalledTimes(2);
    expect(gitReadService.getBranches).toHaveBeenCalledTimes(2);
  });

  it("Git 快照请求取消后会中断整条快照链", async () => {
    const workspaceId = "workspace-1";
    let receivedSignal: AbortSignal | null = null;
    const gitReadService = {
      getStatus: vi.fn(async (_workspaceId: string, signal?: AbortSignal) => {
        receivedSignal = signal ?? null;

        await new Promise<never>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("missing signal"));
            return;
          }

          if (signal.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }

          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new Error("aborted"));
          }, { once: true });
        });
      }),
      getHistory: vi.fn(),
      getBranches: vi.fn()
    } satisfies Pick<GitReadService, "getStatus" | "getHistory" | "getBranches">;

    const service = new WorkspacePanelSnapshotService(
      {
        list: vi.fn()
      } as unknown as FileTreeService,
      gitReadService as unknown as GitReadService,
      {
        listTerminalSnapshotItems: vi.fn()
      } as unknown as TerminalService,
      {
        listTemplates: vi.fn(),
        listTemplateRuntimeStatuses: vi.fn()
      } as unknown as CommandTemplateService,
      {
        getManagementSummary: vi.fn()
      } as unknown as WorkspaceService
    );
    const controller = new AbortController();
    const promise = service.getGitPanelSnapshot(workspaceId, {
      force: true,
      signal: controller.signal
    });

    await Promise.resolve();
    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal?.aborted).toBe(false);

    controller.abort(new Error("manual abort"));

    await expect(promise).rejects.toThrow("manual abort");
    expect(receivedSignal?.aborted).toBe(true);
    expect(gitReadService.getHistory).not.toHaveBeenCalled();
    expect(gitReadService.getBranches).not.toHaveBeenCalled();
  });

  it("已中止但尚未清理的 Git inflight 任务不会被后续请求复用", async () => {
    const workspaceId = "workspace-1";
    let releaseFirstAbort: (() => void) | null = null;

    const gitReadService = {
      getStatus: vi.fn(async (_workspaceId: string, signal?: AbortSignal) => {
        const callIndex = gitReadService.getStatus.mock.calls.length;

        if (callIndex === 1) {
          await new Promise<never>((_resolve, reject) => {
            if (!signal) {
              reject(new Error("missing signal"));
              return;
            }

            if (signal.aborted) {
              reject(signal.reason ?? new Error("aborted"));
              return;
            }

            signal.addEventListener("abort", () => {
              releaseFirstAbort = () => {
                reject(signal.reason ?? new Error("aborted"));
              };
            }, { once: true });
          });
        }

        return createGitStatus(workspaceId, false);
      }),
      getHistory: vi.fn(async () => ({
        items: [
          {
            commitHash: "11111111",
            authorName: "Linus",
            authoredAt: "2026-04-02T00:00:00.000Z",
            subject: "feat: snapshot",
            body: "",
            commitKind: "shared" as const,
            refs: []
          }
        ],
        cursor: "0",
        nextCursor: null,
        totalCount: 1
      })),
      getBranches: vi.fn(async () => ({
        currentBranch: "main",
        local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
        remote: []
      }))
    } satisfies Pick<GitReadService, "getStatus" | "getHistory" | "getBranches">;

    const service = new WorkspacePanelSnapshotService(
      {
        list: vi.fn()
      } as unknown as FileTreeService,
      gitReadService as unknown as GitReadService,
      {
        listTerminalSnapshotItems: vi.fn()
      } as unknown as TerminalService,
      {
        listTemplates: vi.fn(),
        listTemplateRuntimeStatuses: vi.fn()
      } as unknown as CommandTemplateService,
      {
        getManagementSummary: vi.fn()
      } as unknown as WorkspaceService
    );

    const controller = new AbortController();
    const firstPromise = service.getGitPanelSnapshot(workspaceId, {
      force: true,
      signal: controller.signal
    });

    await Promise.resolve();
    controller.abort(new Error("first aborted"));
    await Promise.resolve();

    expect(releaseFirstAbort).not.toBeNull();

    const secondPromise = service.getGitPanelSnapshot(workspaceId, {
      force: true
    });

    expect(gitReadService.getStatus).toHaveBeenCalledTimes(2);

    releaseFirstAbort?.();

    await expect(firstPromise).rejects.toThrow("first aborted");
    await expect(secondPromise).resolves.toMatchObject({
      workspaceId,
      status: {
        snapshot: {
          branch: "main"
        }
      }
    });
  });
});

function createGitStatus(workspaceId: string, staged: boolean) {
  return {
    snapshot: {
      workspaceId,
      repoRoot: "/repo",
      branch: "main",
      ahead: 0,
      behind: 0,
      hasRemote: true,
      isDirty: true,
      lastFetchedAt: null
    },
    changes: [
      {
        path: "apps/user-app/src/app/App.tsx",
        status: "M",
        staged,
        oldPath: null,
        binary: false,
        stagedStatus: staged ? "M" : null,
        worktreeStatus: staged ? null : "M"
      }
    ]
  };
}
