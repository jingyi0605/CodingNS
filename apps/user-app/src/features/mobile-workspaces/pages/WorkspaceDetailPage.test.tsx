import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

const { mockAnalyzeDebugTarget, mockGetRecentDebugRuntimes, mockGetFrameworkCompatibilityMatrix } = vi.hoisted(() => ({
  mockAnalyzeDebugTarget: vi.fn(),
  mockGetRecentDebugRuntimes: vi.fn(),
  mockGetFrameworkCompatibilityMatrix: vi.fn()
}));

const mockUseWorkbenchShell = vi.fn();
const mockShowToast = vi.fn();
const gitSnapshotListeners = new Set<
  (snapshot: {
    workspaceId: string;
    status: {
      snapshot: {
        branch: string | null;
      };
      changes: unknown[];
    };
  }) => void
>();

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual("../../conversation/api/conversation-api");
  return {
    ...actual,
    analyzeDebugTarget: mockAnalyzeDebugTarget,
    getFrameworkCompatibilityMatrix: mockGetFrameworkCompatibilityMatrix,
    getRecentDebugRuntimes: mockGetRecentDebugRuntimes,
    removeWorkspace: vi.fn()
  };
});

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: mockShowToast
  })
}));

function createWorkbenchShell(overrides?: Record<string, unknown>) {
  return {
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "项目一",
          path: "/repo/project-one"
        },
        sessions: [
          {
            sessionId: "session-1",
            title: "会话 Alpha",
            provider: "codex",
            messageCount: 3,
            isArchived: false
          },
          {
            sessionId: "session-2",
            title: "会话 Beta",
            provider: "claude-code",
            messageCount: 1,
            isArchived: true
          }
        ]
      }
    ],
    currentWorkspaceId: "workspace-1",
    favoriteSessionIds: [],
    workspaceManagementStateById: {
      "workspace-1": {
        detail: {
          workspaceId: "workspace-1",
          name: "项目一",
          path: "/repo/project-one",
          git: {
            isRepository: true,
            repoRoot: "/repo/project-one",
            currentBranch: "main",
            commitCount: 12,
            remotes: [],
            error: null
          },
          codeComposition: {
            scannedFileCount: 48,
            truncated: false,
            items: [
              {
                type: "TypeScript",
                count: 24,
                ratio: 0.5
              },
              {
                type: "Markdown",
                count: 12,
                ratio: 0.25
              },
              {
                type: "JSON",
                count: 12,
                ratio: 0.25
              }
            ],
            error: null
          }
        },
        loading: false,
        error: null
      }
    },
    selectWorkspace: vi.fn(),
    subscribeGitSnapshot: vi.fn(),
    subscribeWorkspaceManagementSnapshot: vi.fn(),
    requestGitRefresh: vi.fn((workspaceId: string) => {
      queueMicrotask(() => {
        gitSnapshotListeners.forEach((listener) => {
          listener({
            workspaceId,
            status: {
              snapshot: {
                branch: "main"
              },
              changes: []
            }
          });
        });
      });
    }),
    requestWorkspaceManagementRefresh: vi.fn(),
    addGitSnapshotListener: (listener: (snapshot: {
      workspaceId: string;
      status: {
        snapshot: {
          branch: string | null;
        };
        changes: unknown[];
      };
    }) => void) => {
      gitSnapshotListeners.add(listener);
      return () => {
        gitSnapshotListeners.delete(listener);
      };
    },
    toggleFavoriteSession: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    unarchiveSession: vi.fn(async () => undefined),
    startDraftSession: vi.fn(),
    ...overrides
  };
}

describe("WorkspaceDetailPage", () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockAnalyzeDebugTarget.mockReset();
    mockGetFrameworkCompatibilityMatrix.mockReset();
    mockGetRecentDebugRuntimes.mockReset();
    window.sessionStorage.clear();
    gitSnapshotListeners.clear();
    mockAnalyzeDebugTarget.mockResolvedValue({
      target: {
        id: "debug-target-1",
        workspaceId: "workspace-1",
        rootPath: "/repo/project-one",
        displayName: "project-one",
        sourceType: "repo",
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z"
      },
      services: [
        {
          id: "service-1",
          targetId: "debug-target-1",
          role: "frontend",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          defaultPortHint: 5173,
          protocol: "http",
          healthPath: null,
          adapterKind: "cli",
          frameworkAnalysisId: "analysis-1",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "service-2",
          targetId: "debug-target-1",
          role: "backend",
          name: "host",
          cwd: "/repo/project-one/apps/api",
          command: "pnpm",
          args: ["dev"],
          env: {},
          defaultPortHint: 3000,
          protocol: "http",
          healthPath: null,
          adapterKind: "env",
          frameworkAnalysisId: "analysis-2",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "service-3",
          targetId: "debug-target-1",
          role: "frontend",
          name: "desktop",
          cwd: "/repo/project-one/apps/desktop",
          command: "pnpm",
          args: ["dev"],
          env: {},
          defaultPortHint: null,
          protocol: "http",
          healthPath: null,
          adapterKind: "cli",
          frameworkAnalysisId: "analysis-3",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        }
      ],
      analyses: [
        {
          id: "analysis-1",
          targetId: "debug-target-1",
          serviceId: "service-1",
          primaryFramework: "vite",
          confidence: "high",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli",
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          reasons: ["检测到 vite.config.ts"],
          detectedFiles: ["package.json", "vite.config.ts"],
          createdAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "analysis-2",
          targetId: "debug-target-1",
          serviceId: "service-2",
          primaryFramework: "node-custom",
          confidence: "medium",
          compatibilityLevel: "conditional",
          recommendedInjectionMode: "env",
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          reasons: ["检测到 package.json"],
          detectedFiles: ["package.json", "src/main.ts"],
          createdAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "analysis-3",
          targetId: "debug-target-1",
          serviceId: "service-3",
          primaryFramework: "tauri",
          confidence: "high",
          compatibilityLevel: "conditional",
          recommendedInjectionMode: "none",
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "forbidden",
          reasons: ["检测到 src-tauri/tauri.conf.json"],
          detectedFiles: ["package.json", "src-tauri/tauri.conf.json"],
          createdAt: "2026-04-14T00:00:00.000Z"
        }
      ],
      autoInjectionEligible: true
    });
    mockGetRecentDebugRuntimes.mockResolvedValue({
      targetId: "debug-target-1",
      items: [{
        runtimeSession: {
          id: "runtime-1",
          targetId: "debug-target-1",
          status: "FAILED",
          failureStage: "service_discovery",
          startedAt: "2026-04-14T00:00:00.000Z",
          stoppedAt: "2026-04-14T00:01:00.000Z",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:01:00.000Z"
        },
        target: {
          id: "debug-target-1",
          workspaceId: "workspace-1",
          rootPath: "/repo/project-one",
          displayName: "project-one",
          sourceType: "repo",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        },
        services: [
          {
            service: {
              id: "service-1",
              targetId: "debug-target-1",
              role: "frontend",
              name: "web",
              cwd: "/repo/project-one",
              command: "pnpm",
              args: ["dev"],
              env: {},
              defaultPortHint: 5173,
              protocol: "http",
              healthPath: null,
              adapterKind: "cli",
              frameworkAnalysisId: "analysis-1",
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z"
            },
            analysis: null,
            binding: {
              id: "binding-1",
              runtimeId: "runtime-1",
              serviceId: "service-1",
              processInstanceId: "terminal-1",
              expectedPort: 5173,
              leasedPort: 43000,
              observedPort: null,
              proxyPath: null,
              status: "FAILED",
              updatedAt: "2026-04-14T00:01:00.000Z"
            },
            portLease: {
              id: "lease-1",
              runtimeId: "runtime-1",
              serviceId: "service-1",
              port: 43000,
              protocol: "tcp",
              status: "RELEASED",
              leasedAt: "2026-04-14T00:00:00.000Z",
              expiresAt: null,
              releasedAt: "2026-04-14T00:01:00.000Z"
            },
            processInstance: {
              id: "terminal-1",
              workspaceId: "workspace-1",
              name: "web",
              cwd: "/repo/project-one",
              shell: "/bin/zsh",
              runtimeType: "embedded-pty",
              runtimeSessionId: "terminal-runtime-1",
              attachTarget: "terminal-1",
              status: "error",
              processId: 123,
              createdByUserId: "user-1",
              createdAt: "2026-04-14T00:00:00.000Z",
              lastActiveAt: "2026-04-14T00:00:30.000Z",
              closedAt: "2026-04-14T00:01:00.000Z",
              exitCode: 1,
              statusDetail: "boom",
              debugRuntimeSessionId: "runtime-1",
              debugTargetId: "debug-target-1",
              debugServiceId: "service-1",
              frameworkAnalysisId: "analysis-1",
              launcherSourceType: "debug_service",
              launchStage: "command_dispatched",
              failureStage: "process_runtime_error",
              adapterKind: "cli",
              envPatchSummary: {},
              artifactRef: null
            },
            aiFallbackEdits: [
              {
                id: "edit-1",
                runtimeId: "runtime-1",
                serviceId: "service-1",
                reason: "test",
                allowedFiles: ["server.js"],
                targetPort: 43000,
                patchRef: null,
                rollbackRef: null,
                status: "PENDING",
                createdAt: "2026-04-14T00:00:00.000Z"
              }
            ]
          }
        ]
      }]
    });
    mockGetFrameworkCompatibilityMatrix.mockResolvedValue({
      version: "2026-04-13",
      items: [
        {
          framework: "vite",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli",
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          notes: "Vite 端口入口清楚，第一阶段默认支持"
        },
        {
          framework: "unknown",
          compatibilityLevel: "unknown",
          recommendedInjectionMode: "none",
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          notes: "证据不足时默认不自动注入"
        },
        {
          framework: "tauri",
          compatibilityLevel: "conditional",
          recommendedInjectionMode: "none",
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "forbidden",
          notes: "桌面壳默认只做识别，不参与 Web 端口编排"
        }
      ]
    });
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell());
  });

  it("会展示项目摘要和会话列表", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: "切换工作区" })).toHaveTextContent("项目一");
    expect(screen.getAllByText("/repo/project-one")).toHaveLength(2);
    expect(screen.getByText("会话 Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏会话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档会话" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getAllByText("48").length).toBeGreaterThan(0);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(document.querySelector(".workbench-manage-type-chart-ring")).not.toBeNull();
    });

    const compositionHeading = screen.getByRole("heading", { name: "代码类型组成" });
    const recentHeading = screen.getByRole("heading", { name: "最近会话" });
    expect(Boolean(compositionHeading.compareDocumentPosition(recentHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("会展示服务状态信息和最新失败阶段", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "服务状态" })).toBeInTheDocument();
      expect(screen.getAllByText("vite").length).toBeGreaterThan(0);
      expect(screen.getAllByText("可以直接使用").length).toBeGreaterThan(0);
      expect(screen.getAllByText("启动参数").length).toBeGreaterThan(0);
      expect(screen.getByText("启动失败")).toBeInTheDocument();
      expect(screen.getByText("还缺少服务地址相关处理")).toBeInTheDocument();
      expect(screen.getByText("识别到的服务")).toBeInTheDocument();
      expect(screen.getByText("apps/web")).toBeInTheDocument();
      expect(screen.getByText("apps/api")).toBeInTheDocument();
      expect(screen.getByText("apps/desktop")).toBeInTheDocument();
      expect(screen.getAllByText("桌面壳服务").length).toBeGreaterThan(0);
      expect(
        screen.getByText("当前识别到 2 个网页服务，以及 1 个桌面壳服务。桌面壳服务会单独展示，不参与网页服务的自动处理。")
      ).toBeInTheDocument();
      expect(screen.getByText("最近一次启动")).toBeInTheDocument();
      expect(screen.getByText("支持说明")).toBeInTheDocument();
      expect(screen.getAllByText("Vite 端口入口清楚，第一阶段默认支持").length).toBeGreaterThan(0);
    });

    expect(mockAnalyzeDebugTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      rootPath: "/repo/project-one"
    });
    expect(mockGetRecentDebugRuntimes).toHaveBeenCalledWith("debug-target-1", 5);
    expect(mockGetFrameworkCompatibilityMatrix).toHaveBeenCalled();
  });

  it("没有运行记录时会显示未启动占位", async () => {
    mockGetRecentDebugRuntimes.mockResolvedValueOnce({
      targetId: "debug-target-1",
      items: []
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("未启动")).toBeInTheDocument();
      expect(screen.getByText("当前还没有运行记录。")).toBeInTheDocument();
    });
  });

  it("命中新鲜缓存时不会主动刷新 Git 和工作区摘要", async () => {
    const shell = createWorkbenchShell({
      workspaceManagementStateById: {}
    });
    writeViewSnapshot("git-sidebar.snapshot.workspace-1", {
      status: {
        snapshot: {
          branch: "cached/main"
        },
        changes: []
      }
    });
    writeViewSnapshot("workspace-management.summary.workspace-1", {
      workspaceId: "workspace-1",
      name: "项目一",
      path: "/repo/project-one",
      git: {
        isRepository: true,
        repoRoot: "/repo/project-one",
        currentBranch: "cached/main",
        commitCount: 99,
        remotes: [],
        error: null
      },
      codeComposition: {
        scannedFileCount: 128,
        truncated: false,
        items: [],
        error: null
      }
    });
    mockUseWorkbenchShell.mockReturnValue(shell);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("cached/main")).toBeInTheDocument();
    });

    expect(shell.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.subscribeWorkspaceManagementSnapshot).toHaveBeenCalledWith("workspace-1");
    expect(shell.requestGitRefresh).not.toHaveBeenCalled();
    expect(shell.requestWorkspaceManagementRefresh).not.toHaveBeenCalled();
  });

  it("新建会话会先弹出工作区和供应商选择", async () => {
    const user = userEvent.setup();
    const startDraftSession = vi.fn();

    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: []
        }
      ],
      currentWorkspaceId: "workspace-1",
      startDraftSession
    }));

    renderPage();

    await user.click(screen.getByRole("button", { name: "新建会话" }));

    expect(screen.getByRole("button", { name: /选择工作区 项目一/ })).toHaveTextContent("项目一");

    await user.click(screen.getByRole("button", { name: "OpenCode" }));

    expect(startDraftSession).toHaveBeenCalledWith("workspace-1", "opencode");
  });

  it("子工作树详情页会显示子工作树名称和自己的会话", async () => {
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: [],
          childWorktrees: [
            {
              workspace: {
                id: "workspace-1-child",
                name: "登录分支",
                path: "/repo/project-one/.worktrees/login"
              },
              meta: {
                workspaceId: "workspace-1-child",
                rootWorkspaceId: "workspace-1",
                parentWorkspaceId: "workspace-1",
                sourceWorkspaceId: "workspace-1",
                mergeTargetWorkspaceId: "workspace-1",
                branchName: "feat/login-codex",
                baseRef: "main",
                baseCommit: "commit-base",
                headCommit: "commit-head",
                displayName: "feat/login-codex",
                depth: 1,
                lifecycleStatus: "active",
                mergedAt: null,
                removedAt: null,
                createdAt: "2026-04-12T08:00:00.000Z",
                updatedAt: "2026-04-12T08:00:00.000Z"
              },
              sessions: [
                {
                  sessionId: "session-child-1",
                  title: "工作树会话",
                  provider: "codex",
                  messageCount: 2,
                  isArchived: false
                }
              ],
              children: []
            }
          ]
        }
      ],
      currentWorkspaceId: "workspace-1-child"
    }));

    renderPage("/workspaces/workspace-1-child");

    expect(screen.getByRole("button", { name: "切换工作区" })).toHaveTextContent("feat/login-codex");
    expect(screen.getAllByText("/repo/project-one/.worktrees/login").length).toBeGreaterThan(0);
    expect(screen.getByText("工作树会话")).toBeInTheDocument();
  });

  it("归档会话默认显示最近 10 条，并支持继续加载", async () => {
    const user = userEvent.setup();
    const archivedSessions = Array.from({ length: 15 }, (_, index) => ({
      sessionId: `archived-${index + 1}`,
      title: `归档会话 ${index + 1}`,
      provider: "codex",
      messageCount: index + 1,
      isArchived: true,
      updatedAt: `2026-03-${String(28 - index).padStart(2, "0")}T10:00:00.000Z`,
      createdAt: `2026-03-${String(28 - index).padStart(2, "0")}T09:00:00.000Z`,
      lastEventAt: `2026-03-${String(28 - index).padStart(2, "0")}T11:00:00.000Z`
    }));

    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: [
            {
              sessionId: "session-1",
              title: "会话 Alpha",
              provider: "codex",
              messageCount: 3,
              isArchived: false
            },
            ...archivedSessions
          ]
        }
      ]
    }));

    renderPage();

    expect(screen.getAllByRole("button", { name: "取消归档" })).toHaveLength(10);
    expect(screen.getByRole("button", { name: "查看更多归档会话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看更多归档会话" }));

    expect(screen.getAllByRole("button", { name: "取消归档" })).toHaveLength(15);
    expect(screen.queryByRole("button", { name: "查看更多归档会话" })).not.toBeInTheDocument();
  });
});

function renderPage(initialEntry = "/workspaces/workspace-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}
