import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { WorkspaceDetailPage } from "./WorkspaceDetailPage";

const {
  mockAnalyzeDebugTarget,
  mockGetFrameworkCompatibilityMatrix,
  mockListWorkspaceTemplates,
  mockListWorkspaceTemplateRuntimeStatuses
} = vi.hoisted(() => ({
  mockAnalyzeDebugTarget: vi.fn(),
  mockGetFrameworkCompatibilityMatrix: vi.fn(),
  mockListWorkspaceTemplates: vi.fn(),
  mockListWorkspaceTemplateRuntimeStatuses: vi.fn()
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
    removeWorkspace: vi.fn()
  };
});

vi.mock("../../terminal/api/terminal-api", () => ({
  listWorkspaceTemplates: mockListWorkspaceTemplates,
  listWorkspaceTemplateRuntimeStatuses: mockListWorkspaceTemplateRuntimeStatuses
}));

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
    mockListWorkspaceTemplates.mockReset();
    mockListWorkspaceTemplateRuntimeStatuses.mockReset();
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
    mockListWorkspaceTemplates.mockResolvedValue({
      items: [
        {
          id: "template-web",
          workspaceId: "workspace-1",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 43000,
          proxyEnabled: true,
          proxySlug: "web",
          runtimeType: "node",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "template-host",
          workspaceId: "workspace-1",
          name: "host",
          cwd: "/repo/project-one/apps/api",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 44000,
          proxyEnabled: false,
          proxySlug: null,
          runtimeType: "node",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        },
        {
          id: "template-desktop",
          workspaceId: "workspace-1",
          name: "desktop",
          cwd: "/repo/project-one/apps/desktop",
          command: "pnpm",
          args: ["tauri", "dev"],
          env: {},
          port: null,
          proxyEnabled: false,
          proxySlug: null,
          runtimeType: "node",
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z"
        }
      ]
    });
    mockListWorkspaceTemplateRuntimeStatuses.mockResolvedValue({
      items: [
        {
          templateId: "template-web",
          port: 43000,
          occupied: false,
          processId: null,
          processName: null,
          processCommandLine: null
        },
        {
          templateId: "template-host",
          port: 44000,
          occupied: true,
          processId: 2048,
          processName: "node",
          processCommandLine: "node host-dev.js"
        }
      ]
    });
    mockUseWorkbenchShell.mockReturnValue(createWorkbenchShell());
  });

  it("会展示项目摘要和会话列表", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") })).toHaveTextContent("项目一");
    expect(screen.getAllByText("/repo/project-one")).toHaveLength(2);
    expect(screen.getByText("会话 Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.favoriteAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.archiveAction") })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getAllByText("48").length).toBeGreaterThan(0);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(document.querySelector(".workbench-manage-type-chart-ring")).not.toBeNull();
    });

    const compositionHeading = screen.getByRole("heading", { name: t("shell.manageWorkspaceCodeCompositionLabel") });
    const recentHeading = screen.getByRole("heading", { name: t("shell.recentSessionsSectionTitle") });
    expect(Boolean(compositionHeading.compareDocumentPosition(recentHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("会展示只读仓库分析和已注册启动项", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: t("shell.workspaceDetailRegisteredDebugAnalysisTitle") })
      ).toBeInTheDocument();
      expect(screen.getByText("web")).toBeInTheDocument();
      expect(screen.getByText("host")).toBeInTheDocument();
      expect(screen.getByText("desktop")).toBeInTheDocument();
      expect(screen.getAllByText("apps/web").length).toBeGreaterThan(0);
      expect(screen.getAllByText("apps/api").length).toBeGreaterThan(0);
      expect(screen.getAllByText("apps/desktop").length).toBeGreaterThan(0);
      expect(
        screen.getByRole("heading", { name: t("shell.workspaceDetailRegisteredDebugTemplatesTitle") })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t("shell.workspaceDetailRegisteredDebugOpenProcessManagerAction") })
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(t("shell.workspaceDetailRegisteredDebugTemplateStatusOccupied")).length
      ).toBeGreaterThan(0);
      expect(screen.getByText(t("shell.workspaceDetailRegisteredDebugPlanReasonPortMissing"))).toBeInTheDocument();
      expect(screen.getAllByText(t("shell.workspaceDetailDebugSummaryServiceCountLabel")).length).toBeGreaterThan(0);
      expect(screen.queryByText(t("shell.workspaceDetailDebugDetectedServicesTitle"))).not.toBeInTheDocument();
      expect(document.querySelectorAll(".mobile-debug-service-card")).toHaveLength(0);
    });

    expect(mockAnalyzeDebugTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      rootPath: "/repo/project-one"
    });
    expect(mockGetFrameworkCompatibilityMatrix).toHaveBeenCalled();
    expect(mockListWorkspaceTemplates).toHaveBeenCalledWith("workspace-1");
    expect(mockListWorkspaceTemplateRuntimeStatuses).toHaveBeenCalledWith("workspace-1");
  });

  it("没有已注册启动项时会提示先去进程管理登记", async () => {
    mockListWorkspaceTemplates.mockResolvedValueOnce({
      items: []
    });
    mockListWorkspaceTemplateRuntimeStatuses.mockResolvedValueOnce({
      items: []
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(t("shell.workspaceDetailRegisteredDebugTemplatesEmpty"))).toBeInTheDocument();
    });
  });

  it("命中新鲜缓存时不会主动刷新 Git 和工作区摘要", async () => {
    const shell = createWorkbenchShell({
      workspaceManagementStateById: {}
    });
    writeViewSnapshot("git-sidebar.snapshot.workspace-1", {
      revision: "git-rev-1",
      status: {
        snapshot: {
          branch: "cached/main"
        },
        changes: []
      }
    });
    writeViewSnapshot("workspace-management.summary.workspace-1", {
      revision: "management-rev-1",
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

    expect(shell.subscribeGitSnapshot).toHaveBeenCalledWith("workspace-1", {
      knownRevision: "git-rev-1"
    });
    expect(shell.subscribeWorkspaceManagementSnapshot).toHaveBeenCalledWith("workspace-1", {
      knownRevision: "management-rev-1"
    });
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

    await user.click(screen.getByRole("button", { name: t("shell.createSession") }));

    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${t("shell.createSessionWorkspaceLabel")} 项目一$`)
      })
    ).toHaveTextContent("项目一");

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

    expect(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") })).toHaveTextContent("feat/login-codex");
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

    expect(screen.getAllByRole("button", { name: t("shell.unarchiveAction") })).toHaveLength(10);
    expect(screen.getByRole("button", { name: t("shell.archiveExpandMore") })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("shell.archiveExpandMore") }));

    expect(screen.getAllByRole("button", { name: t("shell.unarchiveAction") })).toHaveLength(15);
    expect(screen.queryByRole("button", { name: t("shell.archiveExpandMore") })).not.toBeInTheDocument();
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
