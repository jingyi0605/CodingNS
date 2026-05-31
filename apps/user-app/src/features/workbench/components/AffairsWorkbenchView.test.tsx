import { render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { clearViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  AffairsAuxiliaryPanel,
  AffairsSidebarPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "./AffairsWorkbenchView";
import type { AffairsViewState } from "../types/workbench-mode";

const desktopBridgeMock = vi.hoisted(() => ({
  fs: {
    openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    revealInFileManager: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    pickDirectory: vi.fn().mockResolvedValue({ ok: true, value: "/Users/jackson/SynologyDrive" })
  }
}));

const conversationApiMock = vi.hoisted(() => ({
  getAffairsLibraryConfig: vi.fn(),
  getAffairsLibraryPreview: vi.fn(),
  getAffairsLibrarySnapshot: vi.fn(),
  listAffairsLibraryDocuments: vi.fn(),
  requestAffairsLibraryRefresh: vi.fn(),
  saveAffairsLibraryBinding: vi.fn(),
  saveAffairsLibraryConfig: vi.fn(),
  setAffairsLibraryEnabled: vi.fn(),
  updateAffairsLibraryFavorites: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<object>("../../conversation/api/conversation-api");
  return {
    ...actual,
    getAffairsLibraryConfig: conversationApiMock.getAffairsLibraryConfig,
    getAffairsLibraryPreview: conversationApiMock.getAffairsLibraryPreview,
    getAffairsLibrarySnapshot: conversationApiMock.getAffairsLibrarySnapshot,
    listAffairsLibraryDocuments: conversationApiMock.listAffairsLibraryDocuments,
    requestAffairsLibraryRefresh: conversationApiMock.requestAffairsLibraryRefresh,
    saveAffairsLibraryBinding: conversationApiMock.saveAffairsLibraryBinding,
    saveAffairsLibraryConfig: conversationApiMock.saveAffairsLibraryConfig,
    setAffairsLibraryEnabled: conversationApiMock.setAffairsLibraryEnabled,
    updateAffairsLibraryFavorites: conversationApiMock.updateAffairsLibraryFavorites
  };
});

vi.mock("../../butler/api/butler-api", () => ({
  listAssistantAutomations: vi.fn().mockResolvedValue({ items: [] }),
  listButlerFollowUpTasks: vi.fn().mockResolvedValue({ items: [] }),
  listButlerInboxItems: vi.fn().mockResolvedValue({ items: [] }),
  listRecentAssistantAutomationRuns: vi.fn().mockResolvedValue({ items: [] })
}));

vi.mock("../../butler/runtime/butler-runtime-store", () => ({
  ButlerRuntimeStore: class {
    constructor(_workspaceId: string) {}
  },
  useButlerRuntimeStore: vi.fn((_store, selector) => selector({
    initialized: true,
    loading: false,
    profile: null,
    activeProvider: null,
    controlSession: null,
    capabilities: null,
    messages: [],
    historyState: "idle",
    loadingOlderMessages: false,
    hasOlderMessages: false,
    runtimeHasActiveRun: false,
    runtimeCanInterrupt: false,
    contextUsage: null,
    permissionRequests: [],
    sending: false
  }))
}));

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: () => <div data-testid="affairs-composer" />
}));

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="affairs-timeline" />
}));

vi.mock("../../conversation/components/PermissionRequestList", () => ({
  PermissionRequestList: () => <div data-testid="affairs-permissions" />
}));

vi.mock("../../conversation/components/WorkspaceImportBrowserModal", () => ({
  WorkspaceImportBrowserModal: () => null
}));

vi.mock("../../../platform/desktop/codingns-desktop-bridge", () => ({
  getCodingNSDesktopBridge: vi.fn(() => desktopBridgeMock)
}));

vi.mock("../../conversation/timeline-source-items", () => ({
  buildConversationTimelineSourceItems: () => []
}));

const navigationGroups: WorkspaceSessionGroup[] = [
  {
    workspace: {
      id: "workspace-1",
      name: "事务工作区",
      path: "/tmp/workspace-1",
      repoRoot: "/tmp/workspace-1"
    },
    sessions: []
  }
];

function createState(): AffairsViewState {
  return {
    workspaceId: "workspace-1",
    primarySection: "library",
    selectedNodeId: "library:all",
    selectedObjectId: null,
    toolbarExpanded: false,
    auxiliaryTab: "detail",
    browseMode: "folder",
    viewMode: "grid",
    selectedFolderPath: null,
    selectedTagPath: null,
    selectedDocumentId: null,
    selectedFavoriteId: null
  };
}

function renderWorkbench() {
  function TestHarness(): ReactElement {
    const [state, setState] = useState(createState());

    return (
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={navigationGroups}
        state={state}
        onStateChange={setState}
      >
        <div style={{ display: "flex" }}>
          <AffairsSidebarPanel />
          <AffairsWorkbenchView workspaceId="workspace-1" />
          <AffairsAuxiliaryPanel workspaceId="workspace-1" />
        </div>
      </AffairsWorkbenchProvider>
    );
  }

  return render(<TestHarness />);
}

describe("AffairsWorkbenchView", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    clearViewSnapshot("affairs.library.snapshot.workspace-1");
    clearViewSnapshot("affairs.library.config.workspace-1");
    clearViewSnapshot("affairs.library.documents::workspace-1::folder::.::.::.");
    window.sessionStorage.clear();

    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.getAffairsLibraryPreview.mockReset();
    conversationApiMock.getAffairsLibraryConfig.mockReset();
    conversationApiMock.requestAffairsLibraryRefresh.mockReset();
    conversationApiMock.saveAffairsLibraryBinding.mockReset();
    conversationApiMock.saveAffairsLibraryConfig.mockReset();
    conversationApiMock.setAffairsLibraryEnabled.mockReset();
    conversationApiMock.updateAffairsLibraryFavorites.mockReset();

    desktopBridgeMock.fs.openFile.mockClear();
    desktopBridgeMock.fs.revealInFileManager.mockClear();
    desktopBridgeMock.fs.pickDirectory.mockClear();

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      status: {
        state: "fresh",
        dirtyReasons: [],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: "2026-05-31T08:00:00.000Z",
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      },
      tags: [
        {
          path: "来源",
          name: "来源",
          parentPath: null,
          depth: 0,
          rootType: "来源",
          documentCount: 1
        },
        {
          path: "来源/目录",
          name: "目录",
          parentPath: "来源",
          depth: 1,
          rootType: "来源",
          documentCount: 1
        }
      ],
      favorites: [],
      folders: [
        {
          path: "AGENTS",
          name: "AGENTS",
          parentPath: null,
          depth: 0,
          directDocumentCount: 1,
          documentCount: 1
        }
      ],
      documentCount: 1,
      lastError: null
    });

    conversationApiMock.setAffairsLibraryEnabled.mockImplementation(async (_workspaceId, payload) => ({
      workspaceId: "workspace-1",
      rootDir: "/Users/jackson/WorkFile",
      enabled: payload.enabled,
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      exportMode: "v2",
      updatedAt: "2026-05-31T08:00:00.000Z"
    }));

    conversationApiMock.getAffairsLibraryConfig.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [".docx", ".md", ".pdf"],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 120,
      items: [
        {
          documentId: "doc-1",
          path: "Exchange 分层通讯簿.txt",
          title: "Exchange 分层通讯簿",
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]
    });

    conversationApiMock.getAffairsLibraryPreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "Exchange 分层通讯簿.txt",
      supported: true,
      kind: "text",
      reason: null,
      content: "这是事务文档内容",
      version: null,
      size: 24,
      updatedAt: "2026-05-31T08:00:00.000Z",
      previewPath: null,
      previewUrl: null,
      capabilities: {
        canEdit: false,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });

    conversationApiMock.saveAffairsLibraryConfig.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [".docx", ".md", ".pdf"],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true,
      applyConfigTaskId: "task-apply-1",
      applyConfigStatus: {
        state: "fresh",
        dirtyReasons: [],
        lastRequestedAt: "2026-05-31T08:00:00.000Z",
        lastStartedAt: "2026-05-31T08:00:00.000Z",
        lastCompletedAt: "2026-05-31T08:00:01.000Z",
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      }
    });
  });

  it("双击事务文档会复用文件预览工具并走事务预览接口", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.dblClick(card);

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryPreview).toHaveBeenCalledWith(
        "workspace-1",
        "Exchange 分层通讯簿.txt"
      );
    });

    expect(
      await screen.findByRole("dialog", { name: "Exchange 分层通讯簿.txt" })
    ).toBeInTheDocument();
    expect(await screen.findByText("Plain Text")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerEdit") })).not.toBeInTheDocument();
  });

  it("点击设置按钮后会在独立模态框里显示文档库设置", async () => {
    renderWorkbench();

    expect(screen.queryByText(t("shell.affairsLibraryConfigTitle"))).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    expect(await screen.findByRole("dialog", { name: t("shell.affairsLibraryConfigTitle") })).toBeInTheDocument();
    expect(screen.getByDisplayValue("/Users/jackson/SynologyDrive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ".docx" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".md" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".pdf" })).toHaveAttribute("aria-pressed", "true");
  });

  it("文档库左侧栏不再显示旧的说明头和浏览模式切换", async () => {
    renderWorkbench();

    expect(await screen.findByText(t("shell.affairsSectionGroupFavorites"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("shell.affairsLibrarySidebarTitle") })).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsLibrarySummary"))).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("shell.affairsLibraryBrowseModeFolder") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("shell.affairsLibraryBrowseModeTag") })).not.toBeInTheDocument();
  });

  it("可以切换文档库启用状态", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const toggleButton = await screen.findByRole("button", { name: t("shell.affairsLibraryDisableAction") });
    await userEvent.click(toggleButton);

    await waitFor(() => {
      expect(conversationApiMock.setAffairsLibraryEnabled).toHaveBeenCalledWith("workspace-1", {
        enabled: false
      });
    });
  });


  it("索引状态指示灯悬浮后会显示索引器状态详情", async () => {
    renderWorkbench();

    const indicator = await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusFresh") })
    });

    expect(screen.queryByText(t("shell.affairsLibraryStatusFresh"))).not.toBeInTheDocument();

    await userEvent.hover(indicator);

    expect(await screen.findByText(t("shell.affairsLibraryStatusPopoverTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusCurrentLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusLastCompletedAtLabel"))).toBeInTheDocument();
    const completedAtLabel = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date("2026-05-31T08:00:00.000Z"));
    expect(screen.getByText(completedAtLabel)).toBeInTheDocument();
  });

  it("点击刷新按钮会手动请求文档库刷新", async () => {
    conversationApiMock.requestAffairsLibraryRefresh.mockResolvedValue({
      taskId: "task-refresh-1",
      deduped: false,
      status: {
        state: "running",
        dirtyReasons: ["manual_refresh"],
        lastRequestedAt: "2026-05-31T08:00:00.000Z",
        lastStartedAt: "2026-05-31T08:00:00.000Z",
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: "task-refresh-1",
        errorSummary: null
      }
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryRefreshAction") }));

    await waitFor(() => {
      expect(conversationApiMock.requestAffairsLibraryRefresh).toHaveBeenCalledWith("workspace-1", {
        reason: "manual_refresh"
      });
    });
  });


  it("点击根路径按钮时会切回文件夹根目录", async () => {
    renderWorkbench();
    const user = userEvent.setup();

    const sourceText = await screen.findAllByText("来源");
    const sourceTagButton = sourceText
      .map((node) => node.closest("button"))
      .find((node) => node?.classList.contains("affairs-sidebar-item-button"));
    expect(sourceTagButton).not.toBeNull();
    await user.click(sourceTagButton!);
    expect(await screen.findByRole("button", { name: "/" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "/" }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenLastCalledWith("workspace-1", {
        browseMode: "folder",
        selectedFolderPath: null,
        selectedTagPath: null,
        selectedFavoriteId: null,
        offset: 0,
        limit: 120
      });
    });
  });

  it("标签树路径会在面包屑里显示每一级标签名称", async () => {
    renderWorkbench();
    const user = userEvent.setup();

    const sourceText = await screen.findAllByText("来源");
    const sourceTagButton = sourceText
      .map((node) => node.closest("button"))
      .find((node) => node?.classList.contains("affairs-sidebar-item-button"));
    expect(sourceTagButton).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Expand/ }));
    await user.click(sourceTagButton!);
    await user.click(await screen.findByRole("button", { name: "目录" }));

    const rootButton = await screen.findByRole("button", { name: "/" });
    const breadcrumb = rootButton.closest(".affairs-stage-breadcrumb");
    expect(rootButton).toBeInTheDocument();
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb).toHaveTextContent("来源");
    expect(breadcrumb).toHaveTextContent("目录");
  });

  it("进入事务视图时，如果索引结果太旧，会做一次懒检查刷新", async () => {
    const oldCompletedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      status: {
        state: "fresh",
        dirtyReasons: [],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: oldCompletedAt,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      },
      tags: [],
      favorites: [],
      folders: [],
      documentCount: 1,
      lastError: null
    });
    conversationApiMock.requestAffairsLibraryRefresh.mockResolvedValue({
      taskId: "task-refresh-lazy",
      deduped: false,
      status: {
        state: "running",
        dirtyReasons: ["view_lazy_check"],
        lastRequestedAt: oldCompletedAt,
        lastStartedAt: oldCompletedAt,
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: "task-refresh-lazy",
        errorSummary: null
      }
    });

    renderWorkbench();

    await waitFor(() => {
      expect(conversationApiMock.requestAffairsLibraryRefresh).toHaveBeenCalledWith("workspace-1", {
        reason: "view_lazy_check"
      });
    });
  });

  it("索引运行中会自动轮询状态并在完成后刷新显示", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot
      .mockResolvedValueOnce({
        binding: {
          workspaceId: "workspace-1",
          rootDir: "/Users/jackson/WorkFile",
          enabled: true,
          configRelativePath: ".ai-index/doc-semantic-index.config.json",
          exportMode: "v2",
          updatedAt: "2026-05-31T08:00:00.000Z"
        },
        status: {
          state: "running",
          dirtyReasons: ["refresh_requested"],
          lastRequestedAt: "2026-05-31T08:00:00.000Z",
          lastStartedAt: "2026-05-31T08:00:00.000Z",
          lastCompletedAt: null,
          lastFailedAt: null,
          nextAllowedAt: null,
          runningTaskId: "task-1",
          errorSummary: null
        },
        tags: [],
        favorites: [],
        folders: [],
        documentCount: 1,
        lastError: null
      })
      .mockResolvedValue({
        binding: {
          workspaceId: "workspace-1",
          rootDir: "/Users/jackson/WorkFile",
          enabled: true,
          configRelativePath: ".ai-index/doc-semantic-index.config.json",
          exportMode: "v2",
          updatedAt: "2026-05-31T08:00:00.000Z"
        },
        status: {
          state: "fresh",
          dirtyReasons: [],
          lastRequestedAt: "2026-05-31T08:00:00.000Z",
          lastStartedAt: "2026-05-31T08:00:00.000Z",
          lastCompletedAt: "2026-05-31T08:00:03.000Z",
          lastFailedAt: null,
          nextAllowedAt: null,
          runningTaskId: null,
          errorSummary: null
        },
        tags: [],
        favorites: [],
        folders: [],
        documentCount: 1,
        lastError: null
      });

    renderWorkbench();

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibrarySnapshot).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusRunning") })
    })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 3_300));

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibrarySnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusFresh") })
    })).toBeInTheDocument();
  }, 10_000);

  it("点击预设后缀会切换选中状态", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const txtChip = screen.getByRole("button", { name: ".txt" });
    expect(txtChip).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(txtChip);
    expect(txtChip).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(txtChip);
    expect(txtChip).toHaveAttribute("aria-pressed", "false");
  });

  it("详情区会提供打开本地镜像文件按钮", async () => {
    renderWorkbench();

    const button = await screen.findByText("Exchange 分层通讯簿");
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsLibraryRevealLocalFileAction") })).toBeInTheDocument();

    const bridge = getCodingNSDesktopBridge();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") }));

    expect(bridge.fs.openFile).toHaveBeenCalledWith("/Users/jackson/SynologyDrive/Exchange 分层通讯簿.txt");
  });


  it("保存设置时会提交 mirrorRoot 和 allowedExtensions", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const mirrorRootInput = await screen.findByDisplayValue("/Users/jackson/SynologyDrive");

    await userEvent.clear(mirrorRootInput);
    await userEvent.type(mirrorRootInput, "/Users/jackson/SynologyDrive/Mirror");
    await userEvent.click(screen.getByRole("button", { name: ".docx" }));
    await userEvent.click(screen.getByRole("button", { name: ".txt" }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsLibraryConfig).toHaveBeenCalledWith("workspace-1", {
        mirrorRoot: "/Users/jackson/SynologyDrive/Mirror",
        allowedExtensions: [".md", ".pdf", ".txt"]
      });
    });
  });

  it("可以手动添加自定义后缀", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    await userEvent.type(
      screen.getByPlaceholderText(t("shell.affairsLibraryAllowedExtensionsCustomPlaceholder")),
      ".pages"
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryAllowedExtensionsCustomAddAction") }));

    expect(screen.getByRole("button", { name: ".pages Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(t("shell.affairsLibraryCustomExtensionBadge"))).toBeInTheDocument();
  });

  it("保存接口返回空值时会回退重新读取配置", async () => {
    conversationApiMock.saveAffairsLibraryConfig.mockResolvedValueOnce(undefined);
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryConfig).toHaveBeenCalledTimes(2);
    });
  });
});
