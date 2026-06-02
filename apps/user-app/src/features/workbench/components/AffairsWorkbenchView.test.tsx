import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  AffairsAuxiliaryPanel,
  AffairsSidebarPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "./AffairsWorkbenchView";
import type { AffairsViewState } from "../types/workbench-mode";
import { resolveAffairsDocumentVisual } from "../utils/affairs-document-visual";

const desktopBridgeMock = vi.hoisted(() => ({
  fs: {
    openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    revealInFileManager: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    pickDirectory: vi.fn().mockResolvedValue({ ok: true, value: "/Users/jackson/SynologyDrive" })
  }
}));

const platformBridgeMock = vi.hoisted(() => ({
  supported: true,
  writeClipboardText: vi.fn().mockResolvedValue({ ok: true, value: undefined })
}));

const platformStateMock = vi.hoisted(() => ({
  platform: "desktop",
  isDesktop: true,
  isWeb: false,
  isMobile: false,
  isNativeMobile: false,
  ui: {
    osFamily: "macos",
    windowControlsStyle: "traffic-lights",
    prefersDesktopChrome: true,
    prefersOverlayTitlebar: false,
    prefersSystemFontStack: true
  }
}));

const showDesktopContextMenuMock = vi.hoisted(() => vi.fn());

const conversationApiMock = vi.hoisted(() => ({
  createAffairsTag: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  deleteAffairsTag: vi.fn(),
  getAffairsDocumentTagDetails: vi.fn(),
  getAffairsFolderTagDetails: vi.fn(),
  getAffairsTagDetail: vi.fn(),
  getAffairsLibraryConfig: vi.fn(),
  getAffairsLibraryPreview: vi.fn(),
  getAffairsLibrarySnapshot: vi.fn(),
  downloadAffairsLibraryFile: vi.fn(),
  operateAffairsLibraryFile: vi.fn(),
  listAffairsTags: vi.fn(),
  listAffairsLibraryDocuments: vi.fn(),
  requestAffairsLibraryRefresh: vi.fn(),
  saveAffairsDocumentTags: vi.fn(),
  saveAffairsFolderTags: vi.fn(),
  saveAffairsLibraryBinding: vi.fn(),
  saveAffairsLibraryConfig: vi.fn(),
  setAffairsLibraryEnabled: vi.fn(),
  updateAffairsTag: vi.fn(),
  updateAffairsLibraryFavorites: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<object>("../../conversation/api/conversation-api");
  return {
    ...actual,
    createAffairsTag: conversationApiMock.createAffairsTag,
    createWorkspaceDirectory: conversationApiMock.createWorkspaceDirectory,
    deleteAffairsTag: conversationApiMock.deleteAffairsTag,
    getAffairsDocumentTagDetails: conversationApiMock.getAffairsDocumentTagDetails,
    getAffairsFolderTagDetails: conversationApiMock.getAffairsFolderTagDetails,
    getAffairsTagDetail: conversationApiMock.getAffairsTagDetail,
    getAffairsLibraryConfig: conversationApiMock.getAffairsLibraryConfig,
    getAffairsLibraryPreview: conversationApiMock.getAffairsLibraryPreview,
    getAffairsLibrarySnapshot: conversationApiMock.getAffairsLibrarySnapshot,
    downloadAffairsLibraryFile: conversationApiMock.downloadAffairsLibraryFile,
    operateAffairsLibraryFile: conversationApiMock.operateAffairsLibraryFile,
    listAffairsTags: conversationApiMock.listAffairsTags,
    listAffairsLibraryDocuments: conversationApiMock.listAffairsLibraryDocuments,
    requestAffairsLibraryRefresh: conversationApiMock.requestAffairsLibraryRefresh,
    saveAffairsDocumentTags: conversationApiMock.saveAffairsDocumentTags,
    saveAffairsFolderTags: conversationApiMock.saveAffairsFolderTags,
    saveAffairsLibraryBinding: conversationApiMock.saveAffairsLibraryBinding,
    saveAffairsLibraryConfig: conversationApiMock.saveAffairsLibraryConfig,
    setAffairsLibraryEnabled: conversationApiMock.setAffairsLibraryEnabled,
    updateAffairsTag: conversationApiMock.updateAffairsTag,
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

vi.mock("../../../platform/desktop/desktop-context-menu", () => ({
  showDesktopContextMenu: showDesktopContextMenuMock
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    platform: platformStateMock.platform,
    isDesktop: platformStateMock.isDesktop,
    isWeb: platformStateMock.isWeb,
    isMobile: platformStateMock.isMobile,
    isNativeMobile: platformStateMock.isNativeMobile,
    viewportClass: "expanded",
    ui: platformStateMock.ui,
    bridge: platformBridgeMock,
    windows: {},
    haptics: { supported: false, trigger: vi.fn() }
  })
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
const initialPreferenceState = userPreferenceStore.getState();

function createState(): AffairsViewState {
  return {
    workspaceId: "workspace-1",
    primarySection: "library",
    selectedNodeId: "library:all",
    selectedObjectId: null,
    toolbarExpanded: false,
    detailViewerCollapsed: false,
    auxiliaryTab: "detail",
    browseMode: "folder",
    viewMode: "grid",
    selectedFolderPath: null,
    selectedTagPath: null,
    selectedTagPaths: [],
    selectedDocumentId: null,
    selectedFavoriteId: null
  };
}

function createLibrarySnapshot(overrides?: Partial<ReturnType<typeof baseLibrarySnapshot>>) {
  return {
    ...baseLibrarySnapshot(),
    ...overrides
  };
}

function baseLibrarySnapshot() {
  return {
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
      runningStage: null,
      errorSummary: null
    },
      tags: [
        {
          path: "类型",
        name: "类型",
        parentPath: null,
        depth: 0,
        rootType: "类型",
        documentCount: 1
      },
      {
        path: "类型/文本",
        name: "文本",
        parentPath: "类型",
        depth: 1,
        rootType: "类型",
        documentCount: 1
      },
      {
        path: "类型/文本/纯文本",
        name: "纯文本",
        parentPath: "类型/文本",
        depth: 2,
        rootType: "类型",
        documentCount: 1
      },
      {
        path: "时间",
        name: "时间",
        parentPath: null,
        depth: 0,
        rootType: "时间",
        documentCount: 1
      },
        {
          path: "时间/2026/05",
          name: "05",
          parentPath: "时间",
          depth: 2,
          rootType: "时间",
          documentCount: 1
        },
        {
          path: "时间/最近7天",
          name: "最近7天",
          parentPath: "时间",
          depth: 1,
          rootType: "时间",
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
        documentCount: 1,
        createdAt: "2026-05-30T08:00:00.000Z",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      {
        path: "临时文件",
        name: "临时文件",
        parentPath: null,
        depth: 0,
        directDocumentCount: 2,
        documentCount: 2,
        createdAt: "2026-05-30T08:00:00.000Z",
        updatedAt: "2026-05-31T08:00:00.000Z"
      }
    ],
    documentCount: 1,
    lastError: null
  };
}

function createDocumentListResponse(items?: Array<Record<string, unknown>>) {
  return {
    total: items?.length ?? 1,
    offset: 0,
    limit: 120,
    tagFacetCounts: {},
    items: items ?? [
      {
        documentId: "doc-1",
        path: "Exchange 分层通讯簿.txt",
        title: "Exchange 分层通讯簿",
        summary: "事务文档摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]
  };
}

function createIsoForLocalDay(dayOffset: number, hour: number, minute: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0).toISOString();
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

function findTagTreeNode(label: string) {
  const tree = screen.getByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
  const labelNode = within(tree).getAllByText(label).find((node) => node.classList.contains("affairs-sidebar-item-title"));
  return labelNode?.closest(".affairs-tag-tree-node") ?? null;
}

describe("AffairsWorkbenchView", () => {
  afterEach(() => {
    userPreferenceStore.hydrate(initialPreferenceState);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    clearViewSnapshot("affairs.library.snapshot.workspace-1");
    clearViewSnapshot("affairs.library.config.workspace-1");
    clearViewSnapshot("affairs.library.documents::workspace-1::folder::.::.::.");
    window.localStorage.removeItem("codingns.affairs.tag-tree.state.workspace-1");
    window.sessionStorage.clear();

    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.getAffairsLibraryPreview.mockReset();
    conversationApiMock.downloadAffairsLibraryFile.mockReset();
    conversationApiMock.operateAffairsLibraryFile.mockReset();
    conversationApiMock.getAffairsLibraryConfig.mockReset();
    conversationApiMock.listAffairsTags.mockReset();
    conversationApiMock.getAffairsTagDetail.mockReset();
    conversationApiMock.deleteAffairsTag.mockReset();
    conversationApiMock.createAffairsTag.mockReset();
    conversationApiMock.createWorkspaceDirectory.mockReset();
    conversationApiMock.updateAffairsTag.mockReset();
    conversationApiMock.getAffairsDocumentTagDetails.mockReset();
    conversationApiMock.getAffairsFolderTagDetails.mockReset();
    conversationApiMock.saveAffairsDocumentTags.mockReset();
    conversationApiMock.saveAffairsFolderTags.mockReset();
    conversationApiMock.requestAffairsLibraryRefresh.mockReset();
    conversationApiMock.saveAffairsLibraryBinding.mockReset();
    conversationApiMock.saveAffairsLibraryConfig.mockReset();
    conversationApiMock.setAffairsLibraryEnabled.mockReset();
    conversationApiMock.updateAffairsLibraryFavorites.mockReset();

    desktopBridgeMock.fs.openFile.mockClear();
    desktopBridgeMock.fs.revealInFileManager.mockClear();
    desktopBridgeMock.fs.pickDirectory.mockClear();
    platformBridgeMock.writeClipboardText.mockClear();
    platformBridgeMock.supported = true;
    platformStateMock.platform = "desktop";
    platformStateMock.isDesktop = true;
    platformStateMock.isWeb = false;
    platformStateMock.isMobile = false;
    platformStateMock.isNativeMobile = false;
    platformStateMock.ui.osFamily = "macos";
    showDesktopContextMenuMock.mockReset();
    platformBridgeMock.writeClipboardText.mockResolvedValue({ ok: true, value: undefined });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot());
    conversationApiMock.listAffairsTags.mockResolvedValue({ items: [] });
    conversationApiMock.getAffairsTagDetail.mockResolvedValue(null);
    conversationApiMock.deleteAffairsTag.mockResolvedValue({
      deletedTagIds: ["tag-1"],
      deletedPaths: ["客户/合同"],
      exportRefreshTask: { taskId: "task-export-1", deduped: false, status: "queued" }
    });
    conversationApiMock.createAffairsTag.mockResolvedValue(null);
    conversationApiMock.createWorkspaceDirectory.mockResolvedValue({
      path: "/Users/jackson/WorkFile/临时文件/新建目录",
      name: "新建目录"
    });
    conversationApiMock.updateAffairsTag.mockResolvedValue(null);
    conversationApiMock.getAffairsDocumentTagDetails.mockResolvedValue({
      documentId: "doc-1",
      path: "Exchange 分层通讯簿.txt",
      title: "Exchange 分层通讯簿",
      manualTagIds: [],
      effectiveFolderBindings: [],
      resolvedTags: [
        { path: "类型/文本/Markdown", sourceType: "system_derived", sourceRef: "extension_rule", evidence: "扩展名命中：.md", confidence: 1, priority: 20 },
        { path: "时间/最近30天", sourceType: "system_derived", sourceRef: null, evidence: "最近30天有修改", confidence: 1, priority: 10 },
        { path: "时间/最近3天", sourceType: "system_derived", sourceRef: null, evidence: "最近3天有修改", confidence: 1, priority: 10 },
        { path: "时间/最近7天", sourceType: "system_derived", sourceRef: null, evidence: "最近7天有修改", confidence: 1, priority: 10 }
      ]
    });
    conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
      folderPath: "AGENTS",
      exists: true,
      bindingTagIds: [],
      bindings: []
    });
    conversationApiMock.saveAffairsDocumentTags.mockResolvedValue(undefined);
    conversationApiMock.saveAffairsFolderTags.mockResolvedValue(undefined);

    conversationApiMock.setAffairsLibraryEnabled.mockImplementation(async (_workspaceId, payload) => ({
      workspaceId: "workspace-1",
      rootDir: "/Users/jackson/WorkFile",
      enabled: payload.enabled,
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      includedHiddenPaths: [],
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
        includedHiddenPaths: [],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse());
    conversationApiMock.downloadAffairsLibraryFile.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "Exchange 分层通讯簿.txt",
      fileName: "Exchange 分层通讯簿.txt",
      contentBase64: "5LqL5Yqh5paH5qGj5YaF5a65",
      size: 18,
      updatedAt: "2026-05-31T08:00:00.000Z"
    });
    conversationApiMock.operateAffairsLibraryFile.mockResolvedValue({
      success: true,
      opType: "copy",
      sourcePath: "Exchange 分层通讯簿.txt",
      targetPath: "Exchange 分层通讯簿 2.txt"
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
        runningStage: null,
        errorSummary: null
      }
    });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }
    );
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
    expect(await screen.findByText(/纯文本|Plain Text/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerEdit") })).not.toBeInTheDocument();
  });


  it("macOS 桌面端会优先使用原生右键菜单", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") })).not.toBeInTheDocument();

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: t("shell.affairsLibraryContextPreview") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextOpen") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextDownload") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextCopy") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextDelete") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextTags") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextProperties") })
    ]));
  });

  it("桌面端空白处右键菜单会包含新建、刷新、粘贴和属性", async () => {
    renderWorkbench();

    const grid = await waitFor(() => {
      const element = document.querySelector(".affairs-doc-grid-viewport");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    fireEvent.contextMenu(grid, { clientX: 300, clientY: 260 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: t("shell.affairsLibraryContextNew") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextRefresh") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextPaste") }),
      expect.objectContaining({ label: t("shell.affairsLibraryContextProperties") })
    ]));
  });

  it("文档库文件右键菜单支持预览、复制路径、下载和删除", async () => {
    platformBridgeMock.supported = false;
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextPreview") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextOpen") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextDownload") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextCopy") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextDelete") })).toBeInTheDocument();

    await userEvent.hover(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextCopy") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: t("shell.affairsLibraryContextCopyRelativePath") }));
    expect(platformBridgeMock.writeClipboardText).toHaveBeenCalledWith("Exchange 分层通讯簿.txt");

    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    const downloadMenu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.click(within(downloadMenu).getByRole("menuitem", { name: t("shell.affairsLibraryContextDownload") }));
    await waitFor(() => {
      expect(conversationApiMock.downloadAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", "Exchange 分层通讯簿.txt");
    });

    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    const deleteMenu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.click(within(deleteMenu).getByRole("menuitem", { name: t("shell.affairsLibraryContextDelete") }));
    await waitFor(() => {
      expect(conversationApiMock.operateAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", {
        opType: "delete",
        srcPath: "Exchange 分层通讯簿.txt"
      });
    });
  });

  it("H5 环境下右键下载仍然可用", async () => {
    platformBridgeMock.supported = false;
    platformStateMock.isDesktop = false;
    platformStateMock.isWeb = true;
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.click(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextDownload") }));

    await waitFor(() => {
      expect(conversationApiMock.downloadAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", "Exchange 分层通讯簿.txt");
    });
  });

  it("文档库空白处右键菜单只保留可粘贴操作", async () => {
    platformBridgeMock.supported = false;
    platformStateMock.isDesktop = false;
    platformStateMock.isWeb = true;
    renderWorkbench();

    const grid = await waitFor(() => {
      const element = document.querySelector(".affairs-doc-grid-viewport");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    fireEvent.contextMenu(grid, { clientX: 300, clientY: 260 });
    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextPaste") })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextNew") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextRefresh") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextProperties") })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: t("shell.affairsLibraryContextPreview") })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: t("shell.affairsLibraryContextDelete") })).not.toBeInTheDocument();
  });

  it("H5 空白处右键可以新建目录并刷新列表", async () => {
    platformBridgeMock.supported = false;
    platformStateMock.isDesktop = false;
    platformStateMock.isWeb = true;
    renderWorkbench();

    const grid = await waitFor(() => {
      const element = document.querySelector(".affairs-doc-grid-viewport");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    fireEvent.contextMenu(grid, { clientX: 300, clientY: 260 });
    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.hover(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextNew") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: t("shell.affairsLibraryContextNewDirectory") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsLibraryCreateModalTitle") });
    const input = within(dialog).getByLabelText(t("shell.affairsLibraryCreateNameLabel"));
    await userEvent.clear(input);
    await userEvent.type(input, "资料目录");
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsLibraryCreateConfirmAction") }));

    await waitFor(() => {
      expect(conversationApiMock.operateAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", {
        opType: "create_directory",
        dstPath: "资料目录"
      });
    });
    expect(conversationApiMock.requestAffairsLibraryRefresh).toHaveBeenCalled();
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

    await screen.findByText("Exchange 分层通讯簿.txt");

    expect(screen.queryByRole("heading", { name: t("shell.affairsLibrarySidebarTitle") })).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsLibrarySummary"))).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("shell.affairsLibraryBrowseModeFolder") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("shell.affairsLibraryBrowseModeTag") })).not.toBeInTheDocument();
  });

  it("没有收藏内容时会自动隐藏收藏夹分组", async () => {
    renderWorkbench();

    await screen.findByText("Exchange 分层通讯簿.txt");

    expect(screen.queryByText(t("shell.affairsSectionGroupFavorites"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsFavoritesEmpty"))).not.toBeInTheDocument();
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

  it("索引状态指示灯会显示当前任务阶段", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValueOnce(createLibrarySnapshot({
      status: {
        state: "running",
        dirtyReasons: ["directory_hint"],
        lastRequestedAt: "2026-06-01T10:00:00.000Z",
        lastStartedAt: "2026-06-01T10:00:01.000Z",
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: "task-refresh-stage",
        runningStage: "incremental_index",
        errorSummary: null
      }
    }));

    renderWorkbench();

    const indicator = await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusRunning") })
    });

    await userEvent.hover(indicator);

    expect(await screen.findByText(t("shell.affairsLibraryStatusRunningStageLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusStageIncrementalIndex"))).toBeInTheDocument();
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
        runningStage: "index",
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

  it("接口返回新列表后会替换缓存旧列表，已删除文件不会继续显示", async () => {
    const cacheKey = "affairs.library.documents::workspace-1::folder::.::.::.";
    writeViewSnapshot(cacheKey, createDocumentListResponse([
      {
        documentId: "doc-agents",
        path: "AGENTS.md",
        title: "AGENTS",
        summary: "项目说明",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 3547,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-agents-copy",
        path: "AGENTS_副本.md",
        title: "AGENTS_副本",
        summary: "已经删除的旧缓存文件",
        updatedAt: "2026-05-31T08:00:01.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 3547,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-agents",
        path: "AGENTS.md",
        title: "AGENTS",
        summary: "项目说明",
        updatedAt: "2026-06-01T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 3547,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-agents-2",
        path: "AGENTS_2.md",
        title: "AGENTS_2",
        summary: "新建文件",
        updatedAt: "2026-06-01T08:00:01.000Z",
        createdAt: "2026-06-01T08:00:01.000Z",
        sizeBytes: 3547,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbench();

    expect(await screen.findByText("AGENTS_2.md")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("AGENTS_副本.md")).not.toBeInTheDocument();
    });
  });


  it("点击根路径按钮时会切回文件夹根目录", async () => {
    renderWorkbench();
    const user = userEvent.setup();

    const typeTagButton = (await screen.findAllByRole("button", { name: /类型/ }))[0];
    await user.click(typeTagButton);
    expect(await screen.findByRole("button", { name: "/" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "/" }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", {
        browseMode: "folder",
        selectedFolderPath: null,
        selectedTagPath: null,
        selectedTagPaths: [],
        selectedFavoriteId: null,
        offset: 0,
        limit: 120
      });
    });
  });

  it("列表模式表头会显示文件名大小时间和种类", async () => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    const todayAtEight = createIsoForLocalDay(0, 8, 0);
    const yesterdayAtEight = createIsoForLocalDay(-1, 8, 0);
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-1",
        path: "Exchange 分层通讯簿.txt",
        title: "Exchange 分层通讯簿",
        summary: "事务文档摘要",
        updatedAt: todayAtEight,
        createdAt: yesterdayAtEight,
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));
    renderWorkbench();

    fireEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    const header = document.querySelector(".affairs-finder-header");
    expect(header).not.toBeNull();
    const headerScope = within(header as HTMLElement);
    expect(headerScope.getByText(t("shell.affairsFinderColumnName"))).toBeInTheDocument();
    expect(headerScope.getByText(t("shell.affairsFinderColumnSize"))).toBeInTheDocument();
    expect(headerScope.getByText(t("shell.affairsFinderColumnUpdatedAt"))).toBeInTheDocument();
    expect(headerScope.getByText(t("shell.affairsFinderColumnType"))).toBeInTheDocument();
    expect(headerScope.getByText(t("shell.affairsFinderColumnCreatedAt"))).toBeInTheDocument();

    const row = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    const rowScope = within(row);
    expect(rowScope.getByText("2.0 KB")).toBeInTheDocument();
    expect(rowScope.getByText(t("shell.affairsFinderKindText"))).toBeInTheDocument();
    expect(rowScope.getAllByText(/(今天|昨天|20\d{2}\/)/).length).toBeGreaterThanOrEqual(2);

    const nameCell = row.querySelector(".affairs-finder-name");
    expect(nameCell).not.toBeNull();
    expect(nameCell).toHaveClass("affairs-finder-name");
    expect(nameCell).toHaveAttribute("title", "Exchange 分层通讯簿.txt");
  });

  it("列表模式文件夹种类会显示更像 macOS 的文案", async () => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    const folderRow = await screen.findByRole("button", { name: /AGENTS/i });
    expect(within(folderRow).getByText(t("shell.affairsFinderKindFolder"))).toBeInTheDocument();
    expect(folderRow.querySelector(".affairs-finder-name")).toHaveAttribute("title", "AGENTS");
  });

  it("列表模式会把 html json zip mp4 sql 分成更具体的类型文案", async () => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: [],
      documentCount: 5
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-sql",
        path: "schema.sql",
        title: "schema.sql",
        summary: "摘要",
        updatedAt: "2026-06-01T08:00:00.000Z",
        createdAt: "2026-06-01T07:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-html",
        path: "落地页.html",
        title: "落地页.html",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-json",
        path: "配置.json",
        title: "配置.json",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-zip",
        path: "归档资料.zip",
        title: "归档资料.zip",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-mp4",
        path: "讲解视频.mp4",
        title: "讲解视频.mp4",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbench();

    fireEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    await waitFor(() => {
      expect(within(screen.getByRole("button", { name: /schema\.sql/i })).getByText(t("shell.affairsFinderKindSql"))).toBeInTheDocument();
      expect(within(screen.getByRole("button", { name: /落地页\.html/i })).getByText(t("shell.affairsFinderKindHtml"))).toBeInTheDocument();
      expect(within(screen.getByRole("button", { name: /配置\.json/i })).getByText(t("shell.affairsFinderKindJson"))).toBeInTheDocument();
      expect(within(screen.getByRole("button", { name: /归档资料\.zip/i })).getByText(t("shell.affairsFinderKindArchive"))).toBeInTheDocument();
      expect(within(screen.getByRole("button", { name: /讲解视频\.mp4/i })).getByText(t("shell.affairsFinderKindVideo"))).toBeInTheDocument();
    });
  });

  it("文档名称显示真实文件名，不显示摘要标题", async () => {
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse([
      {
        documentId: "doc-actual-name",
        path: "26.05.25 山东电力工程咨询院有限公司2026年统一云平台扩容采购招标文件V1.0.docx",
        title: "中华人民共和国",
        summary: "事务文档摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbench();

    fireEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    const fileName = "26.05.25 山东电力工程咨询院有限公司2026年统一云平台扩容采购招标文件V1.0.docx";
    const documentRow = await screen.findByRole("button", { name: new RegExp(fileName.replace(/\./g, "\\."), "i") });
    await waitFor(() => {
      const nameCell = documentRow?.querySelector(".affairs-finder-name");
      expect(nameCell?.textContent?.trim()).toBe(fileName);
    });
    const fileNameNode = documentRow?.querySelector(".affairs-finder-name");
    const row = fileNameNode?.closest("button");
    expect(row).toBeTruthy();
    expect(fileNameNode?.textContent?.trim()).toBe(fileName);
    expect(within(row as HTMLElement).queryByText("中华人民共和国")).not.toBeInTheDocument();

    await userEvent.click(row as HTMLElement);
    const detailPanel = document.querySelector(".affairs-detail-block");
    expect(detailPanel).not.toBeNull();
    expect(within(detailPanel as HTMLElement).getByRole("heading", { name: fileName })).toBeInTheDocument();
  });

  it("列表模式列宽支持拖拽调整", async () => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    renderWorkbench();

    fireEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    const header = document.querySelector(".affairs-finder-header") as HTMLElement | null;
    expect(header).not.toBeNull();
    expect(header?.style.gridTemplateColumns).toContain("320px");

    const resizer = header?.querySelector(".affairs-finder-column-resizer") as HTMLElement | null;
    expect(resizer).not.toBeNull();

    resizer?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 320 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 420 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 420 }));

    const resizedRow = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    expect(header?.style.gridTemplateColumns).toContain("420px");
    expect((resizedRow as HTMLButtonElement).style.gridTemplateColumns).toContain("420px");
  });

  it("列表视图滚动后会继续显示后面的文件夹记录，不会只停在前几项", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: Array.from({ length: 140 }, (_, index) => ({
        path: `文件夹${String(index + 1).padStart(3, "0")}`,
        name: `文件夹${String(index + 1).padStart(3, "0")}`,
        parentPath: null,
        depth: 1,
        directDocumentCount: 1,
        documentCount: 1,
        createdAt: "2026-05-30T08:00:00.000Z",
        updatedAt: "2026-05-31T08:00:00.000Z"
      }))
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 0,
      offset: 0,
      limit: 120,
      tagFacetCounts: {},
      items: []
    });

    renderWorkbench();
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    await waitFor(() => {
      expect(document.querySelector(".affairs-finder-list")).not.toBeNull();
    });
    const listViewport = document.querySelector(".affairs-finder-list") as HTMLDivElement | null;
    expect(listViewport).not.toBeNull();
    if (!listViewport) {
      return;
    }

    Object.defineProperty(listViewport, "clientHeight", {
      configurable: true,
      get: () => 400
    });
    Object.defineProperty(listViewport, "scrollHeight", {
      configurable: true,
      get: () => 5600
    });

    listViewport.scrollTop = 4200;
    fireEvent.scroll(listViewport);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /文件夹110/i })).toBeInTheDocument();
    });
  });

  it("列表视图点击表头可以切换排序", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: [
        {
          path: "B项目",
          name: "B项目",
          parentPath: null,
          depth: 1,
          directDocumentCount: 1,
          documentCount: 1,
          createdAt: "2026-05-29T08:00:00.000Z",
          updatedAt: "2026-05-31T08:00:00.000Z"
        },
        {
          path: "A项目",
          name: "A项目",
          parentPath: null,
          depth: 1,
          directDocumentCount: 1,
          documentCount: 1,
          createdAt: "2026-05-30T08:00:00.000Z",
          updatedAt: "2026-05-30T08:00:00.000Z"
        }
      ]
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 2,
      offset: 0,
      limit: 120,
      tagFacetCounts: {},
      items: []
    });

    renderWorkbench();
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    await waitFor(() => {
      expect(document.querySelectorAll(".affairs-finder-row").length).toBeGreaterThan(0);
    });
    const rowsBefore = Array.from(document.querySelectorAll(".affairs-finder-row")) as HTMLButtonElement[];
    expect(rowsBefore[0]).toHaveTextContent("B项目");

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsFinderSortAction", { column: t("shell.affairsFinderColumnName") }) }));

    await waitFor(() => {
      const rowsAfter = Array.from(document.querySelectorAll(".affairs-finder-row")) as HTMLButtonElement[];
      expect(rowsAfter[0]).toHaveTextContent("A项目");
    });
  });

  it("标签树路径会在面包屑里显示每一级标签名称", async () => {
    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const typeLabel = (await screen.findAllByText("类型")).find((node) => node.classList.contains("affairs-sidebar-item-title"));
    expect(typeLabel).toBeTruthy();
    const typeNode = typeLabel.closest(".affairs-tag-tree-node");
    expect(typeNode).not.toBeNull();
    const expandButton = typeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle");
    expect(expandButton).not.toBeNull();
    await user.click(expandButton!);
    await waitFor(() => {
      expect(findTagTreeNode("类型")).toHaveAttribute("aria-expanded", "true");
    });
    const expandedTypeNode = findTagTreeNode("类型");
    expect(within(expandedTypeNode!).getByRole("button", { name: /文本/ })).toBeInTheDocument();
    await user.click(within(expandedTypeNode!).getByRole("button", { name: /文本/ }));

    const rootButton = await screen.findByRole("button", { name: "/" });
    const breadcrumb = rootButton.closest(".affairs-stage-breadcrumb");
    expect(rootButton).toBeInTheDocument();
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb).toHaveTextContent("类型");
    expect(breadcrumb).toHaveTextContent("文本");
  });

  it("标签支持多选过滤，并且顶部会出现重置按钮", async () => {
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-1",
        path: "alpha.md",
        title: "alpha",
        summary: "alpha",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 10,
        tags: ["类型/文本"],
        derivedTags: ["时间/最近7天"],
        isFavorite: false
      }
    ]));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce({
      total: 1,
      offset: 0,
      limit: 120,
      tagFacetCounts: {
        "类型": 1,
        "类型/文本": 1,
        "时间": 1,
        "时间/最近7天": 1
      },
      items: [
        {
          documentId: "doc-1",
          path: "alpha.md",
          title: "alpha",
          summary: "alpha",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 10,
          tags: ["类型/文本"],
          derivedTags: ["时间/最近7天"],
          isFavorite: false
        }
      ]
    });

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const typeNode = findTagTreeNode("类型");
    await user.click(typeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(within(findTagTreeNode("类型")!).getByRole("button", { name: /文本/ }));

    const timeNode = findTagTreeNode("时间");
    await user.click(timeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(within(findTagTreeNode("时间")!).getByRole("button", { name: /最近7天/ }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenLastCalledWith("workspace-1", {
        browseMode: "tag",
        selectedFolderPath: null,
        selectedTagPath: "时间/最近7天",
        selectedTagPaths: ["类型/文本", "时间/最近7天"],
        selectedFavoriteId: null,
        offset: 0,
        limit: 120
      });
    });

    expect(screen.getAllByRole("button", { name: "重置筛选" }).length).toBeGreaterThan(0);
  });

  it("有标签选中时，标签树只显示还有结果的选项", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "类型", name: "类型", parentPath: null, depth: 0, rootType: "类型", documentCount: 3 },
        { path: "类型/文本", name: "文本", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 2 },
        { path: "类型/表格", name: "表格", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "时间", name: "时间", parentPath: null, depth: 0, rootType: "时间", documentCount: 3 },
        { path: "时间/最近7天", name: "最近7天", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 2 },
        { path: "时间/2025", name: "2025", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 1 }
      ]
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-a",
        path: "alpha.md",
        title: "alpha",
        summary: "alpha",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 10,
        tags: ["类型/文本"],
        derivedTags: ["时间/最近7天"],
        isFavorite: false
      }
    ]));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce({
      total: 1,
      offset: 0,
      limit: 120,
      tagFacetCounts: {
        "类型": 1,
        "类型/文本": 1,
        "时间": 1,
        "时间/最近7天": 1
      },
      items: [
        {
          documentId: "doc-a",
          path: "alpha.md",
          title: "alpha",
          summary: "alpha",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 10,
          tags: ["类型/文本"],
          derivedTags: ["时间/最近7天"],
          isFavorite: false
        }
      ]
    });

    renderWorkbench();
    const user = userEvent.setup();
    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const typeNode = findTagTreeNode("类型");
    await user.click(typeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(within(findTagTreeNode("类型")!).getByRole("button", { name: /文本/ }));
    await user.click(findTagTreeNode("时间")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /表格/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /2025/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /最近7天/ })).toBeInTheDocument();
    });
  });

  it("组合筛选后，标签树徽标会显示筛选后的匹配数量", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "类型", name: "类型", parentPath: null, depth: 0, rootType: "类型", documentCount: 20 },
        { path: "类型/文本", name: "文本", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 10 },
        { path: "类型/表格", name: "表格", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 10 },
        { path: "时间", name: "时间", parentPath: null, depth: 0, rootType: "时间", documentCount: 30 },
        { path: "时间/最近7天", name: "最近7天", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 13 },
        { path: "时间/2025", name: "2025", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 17 }
      ]
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-a",
        path: "alpha.md",
        title: "alpha",
        summary: "alpha",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 10,
        tags: ["类型/文本"],
        derivedTags: ["时间/最近7天"],
        isFavorite: false
      }
    ]));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce({
      total: 1,
      offset: 0,
      limit: 120,
      tagFacetCounts: {
        "类型": 1,
        "类型/文本": 1,
        "时间": 1,
        "时间/最近7天": 1
      },
      items: [
        {
          documentId: "doc-a",
          path: "alpha.md",
          title: "alpha",
          summary: "alpha",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 10,
          tags: ["类型/文本"],
          derivedTags: ["时间/最近7天"],
          isFavorite: false
        }
      ]
    });

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const typeNode = findTagTreeNode("类型");
    await user.click(typeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(within(findTagTreeNode("类型")!).getByRole("button", { name: /文本/ }));

    await waitFor(() => {
      const typeTreeNode = findTagTreeNode("类型");
      const timeTreeNode = findTagTreeNode("时间");
      expect(within(typeTreeNode!).getAllByText("1").length).toBeGreaterThan(0);
      expect(within(timeTreeNode!).getAllByText("1").length).toBeGreaterThan(0);
      expect(screen.queryByText("20")).not.toBeInTheDocument();
      expect(screen.queryByText("30")).not.toBeInTheDocument();
    });
  });

  it("标签树只显示类型和时间根标签，并且不再显示说明文本", async () => {
    renderWorkbench();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });

    expect(findTagTreeNode("类型")).not.toBeNull();
    expect(findTagTreeNode("时间")).not.toBeNull();
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(screen.queryByText("主题")).not.toBeInTheDocument();
    expect(screen.queryByText("状态")).not.toBeInTheDocument();
    expect(screen.queryByText("类型/文本")).not.toBeInTheDocument();
    expect(screen.queryByText("时间/2026/05")).not.toBeInTheDocument();
  });

  it("时间标签按最新优先，其他标签按更常访问优先", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "类型", name: "类型", parentPath: null, depth: 0, rootType: "类型", documentCount: 9 },
        { path: "类型/办公", name: "办公", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 2 },
        { path: "类型/表格", name: "表格", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 4 },
        { path: "类型/文本", name: "文本", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 3 },
        { path: "时间", name: "时间", parentPath: null, depth: 0, rootType: "时间", documentCount: 9 },
        { path: "时间/2024", name: "2024", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 2 },
        { path: "时间/2026", name: "2026", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 4 },
        { path: "时间/最近3天", name: "最近3天", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 1 },
        { path: "时间/最近7天", name: "最近7天", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 3 },
        { path: "时间/最近30天", name: "最近30天", parentPath: "时间", depth: 1, rootType: "时间", documentCount: 3 }
      ],
      folders: []
    }));

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    await user.click(findTagTreeNode("类型")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(findTagTreeNode("时间")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);

    const expandedTypeNode = findTagTreeNode("类型");
    const expandedTimeNode = findTagTreeNode("时间");
    const typeChildren = Array.from(expandedTypeNode?.querySelectorAll(":scope > .affairs-tag-tree-children > .affairs-tag-tree-node .affairs-sidebar-item-title") ?? [])
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));
    expect(typeChildren).toEqual(expect.arrayContaining(["表格", "文本", "办公"]));

    const timeChildren = Array.from(expandedTimeNode?.querySelectorAll(":scope > .affairs-tag-tree-children > .affairs-tag-tree-node .affairs-sidebar-item-title") ?? [])
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));
    expect(timeChildren.slice(0, 5)).toEqual(["最近3天", "最近7天", "最近30天", "2026", "2024"]);

    await user.click(within(expandedTypeNode!).getByRole("button", { name: /办公/ }));
    await user.click(screen.getByRole("button", { name: "/" }));
    await user.click(within(findTagTreeNode("类型")!).getByRole("button", { name: /办公/ }));
    expect(window.localStorage.getItem("codingns.affairs.tag-tree.state.workspace-1")).toContain("\"类型/办公\":2");
  });

  it("每层标签默认最多显示 5 个，并记住展开更多状态", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "类型", name: "类型", parentPath: null, depth: 0, rootType: "类型", documentCount: 6 },
        { path: "类型/A", name: "A", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "类型/B", name: "B", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "类型/C", name: "C", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "类型/D", name: "D", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "类型/E", name: "E", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "类型/F", name: "F", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 }
      ],
      folders: []
    }));

    const user = userEvent.setup();
    const view = renderWorkbench();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    await user.click(findTagTreeNode("类型")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);

    const expandedTypeNode = findTagTreeNode("类型");
    expect(Array.from(expandedTypeNode?.querySelectorAll(":scope > .affairs-tag-tree-children > .affairs-tag-tree-node") ?? []).length).toBeGreaterThanOrEqual(5);
    await user.click(within(expandedTypeNode!).getByRole("button", { name: /Show More Tags|显示更多标签/ }));
    expect(Array.from(findTagTreeNode("类型")?.querySelectorAll(":scope > .affairs-tag-tree-children > .affairs-tag-tree-node") ?? []).length).toBeGreaterThanOrEqual(6);
    expect(window.localStorage.getItem("codingns.affairs.tag-tree.state.workspace-1")).toContain("\"expandedOverflowPaths\":[\"类型\"]");

    view.unmount();
    renderWorkbench();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const reloadedTypeNode = findTagTreeNode("类型");
    expect(Array.from(reloadedTypeNode?.querySelectorAll(":scope > .affairs-tag-tree-children > .affairs-tag-tree-node") ?? []).length).toBeGreaterThanOrEqual(6);
    expect(within(reloadedTypeNode!).getByRole("button", { name: /Show Fewer Tags|收起其他标签/ })).toBeInTheDocument();
  });

  it("时间树里会显示最近7天标签", async () => {
    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    const timeNode = findTagTreeNode("时间");
    expect(timeNode).not.toBeNull();
    await user.click(timeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);

    expect(within(timeNode!).getByRole("button", { name: /最近7天/ })).toBeInTheDocument();
  });

  it("进入事务视图时，不会仅因为快照较旧就自动发起刷新", async () => {
    const oldCompletedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        includedHiddenPaths: [],
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
        runningStage: null,
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
        runningStage: "index",
        errorSummary: null
      }
    });

    renderWorkbench();

    await screen.findByText("Exchange 分层通讯簿.txt");
    expect(conversationApiMock.requestAffairsLibraryRefresh).not.toHaveBeenCalled();
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
          runningStage: "sqlite",
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
          runningStage: null,
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

  it("目录模式下即使索引还在 running，也会主动重拉当前目录列表", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      status: {
        state: "running",
        dirtyReasons: ["refresh_requested"],
        lastRequestedAt: "2026-05-31T08:00:00.000Z",
        lastStartedAt: "2026-05-31T08:00:00.000Z",
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: "task-1",
        runningStage: "index",
        errorSummary: null
      }
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.listAffairsLibraryDocuments
      .mockResolvedValueOnce(createDocumentListResponse([
        {
          documentId: "doc-old",
          path: "Exchange 分层通讯簿.txt",
          title: "Exchange 分层通讯簿.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]))
      .mockResolvedValueOnce(createDocumentListResponse([
        {
          documentId: "doc-copy",
          path: "临时文件/账号_副本.txt",
          title: "账号_副本.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:03.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        },
        {
          documentId: "doc-old",
          path: "临时文件/账号.txt",
          title: "账号.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]))
      .mockResolvedValue(createDocumentListResponse([
        {
          documentId: "doc-copy",
          path: "临时文件/账号_副本.txt",
          title: "账号_副本.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:03.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        },
        {
          documentId: "doc-old",
          path: "临时文件/账号.txt",
          title: "账号.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]));

    renderWorkbench();
    await screen.findByText("Exchange 分层通讯簿.txt");
    await userEvent.click(screen.getByRole("button", { name: /临时文件.*2 个对象/ }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: "临时文件"
      }));
    });

    await new Promise((resolve) => setTimeout(resolve, 3_300));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByText("账号_副本.txt")).toBeInTheDocument();
  }, 10_000);

  it("配置里没写 allowedExtensions 时，会把默认支持后缀显示成已启用状态", async () => {
    conversationApiMock.getAffairsLibraryConfig.mockResolvedValueOnce({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [],
        includedHiddenPaths: [],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [],
      includedHiddenPaths: [],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    expect(screen.getByRole("button", { name: ".docx" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".md" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".pdf" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".txt" })).toHaveAttribute("aria-pressed", "true");
  });

  it("默认支持后缀保持原样保存时，仍然提交空白名单让索引器走默认支持范围", async () => {
    conversationApiMock.getAffairsLibraryConfig.mockResolvedValueOnce({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [],
        includedHiddenPaths: [],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [],
      includedHiddenPaths: [],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsLibraryConfig).toHaveBeenCalledWith("workspace-1", {
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [],
        includedHiddenPaths: []
      });
    });
  });

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

    const button = await screen.findByText("Exchange 分层通讯簿.txt");
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsLibraryRevealLocalFileAction") })).toBeInTheDocument();

    const bridge = getCodingNSDesktopBridge();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") }));

    expect(bridge.fs.openFile).toHaveBeenCalledWith("/Users/jackson/SynologyDrive/Exchange 分层通讯簿.txt");
  });

  it("可以按树状结构管理标签", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-root",
          path: "客户",
          name: "客户",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: "客户主分类",
          status: "active",
                    documentCount: 3,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        },
        {
          id: "tag-1",
          path: "客户/合同",
          name: "合同",
          rootType: "客户",
          parentId: "tag-root",
          parentPath: "客户",
          description: null,
          status: "active",
                    documentCount: 1,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        }
      ]
    });
    conversationApiMock.getAffairsTagDetail.mockResolvedValue({
      id: "tag-1",
      path: "客户/合同",
      name: "合同",
      rootType: "客户",
      parentId: "tag-root",
      parentPath: "客户",
      description: null,
      status: "active",
            documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
    });
    conversationApiMock.createAffairsTag.mockResolvedValue({
      id: "tag-new",
      path: "项目",
      name: "项目",
      rootType: "项目",
      parentId: null,
      parentPath: null,
      description: null,
      status: "active",
            documentCount: 0,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
    });
    conversationApiMock.updateAffairsTag.mockResolvedValue({
      id: "tag-1",
      path: "客户/项目合同",
      name: "项目合同",
      rootType: "客户",
      parentId: "tag-root",
      parentPath: "客户",
      description: null,
      status: "active",
            documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
    });

    renderWorkbench();

    expect(screen.queryByRole("button", { name: t("shell.affairsLibraryTagTreeReset") })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("tree", { name: t("shell.affairsTagTreeSectionTitle") })).toBeInTheDocument();
    expect((await screen.findAllByText("客户/合同")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagCreateRootAction") }));
    await userEvent.type(screen.getByPlaceholderText(t("shell.affairsTagNamePlaceholder")), "项目");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagCreateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.createAffairsTag).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        name: "项目",
        parentId: null,
        status: "active"
      }));
    });

    const tagTreeButton = screen.getByRole("button", { name: /合同.*客户\/合同/s });
    await userEvent.click(tagTreeButton);
    expect(await screen.findByText(t("shell.affairsTagEditorEditTitle"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagCreateChildAction") }));
    expect(await screen.findByText(t("shell.affairsTagEditorCreateChildDescription", { tag: "客户/合同" }))).toBeInTheDocument();

    await userEvent.click(tagTreeButton);
    const nameInput = screen.getByPlaceholderText(t("shell.affairsTagNamePlaceholder"));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "项目合同");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagUpdateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1", expect.objectContaining({
        tagId: "tag-1",
        name: "项目合同",
        parentId: "tag-root",
        status: "active"
      }));
    });

    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagDeleteAction") }));
    await waitFor(() => {
      expect(conversationApiMock.deleteAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1");
    });
  });

  it("文档详情通过输入匹配添加标签，并且不把时间和类型标签当普通标签", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-1",
          path: "客户/合同",
          name: "合同",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
                    documentCount: 0,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        },
        {
          id: "tag-time",
          path: "时间/最近7天",
          name: "最近7天",
          rootType: "时间",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
                    documentCount: 0,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        },
        {
          id: "tag-type",
          path: "类型/文本",
          name: "文本",
          rootType: "类型",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
                    documentCount: 0,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        }
      ]
    });
    conversationApiMock.getAffairsDocumentTagDetails.mockResolvedValue({
      documentId: "doc-1",
      path: "Exchange 分层通讯簿.txt",
      title: "Exchange 分层通讯簿",
      manualTagIds: [],
      effectiveFolderBindings: [],
      resolvedTags: [
        { path: "类型/文本/Markdown", sourceType: "system_derived", sourceRef: "extension_rule", evidence: "扩展名命中：.md", confidence: 1, priority: 20 },
        { path: "时间/最近30天", sourceType: "system_derived", sourceRef: null, evidence: "最近30天有修改", confidence: 1, priority: 10 },
        { path: "时间/最近3天", sourceType: "system_derived", sourceRef: null, evidence: "最近3天有修改", confidence: 1, priority: 10 },
        { path: "时间/最近7天", sourceType: "system_derived", sourceRef: null, evidence: "最近7天有修改", confidence: 1, priority: 10 }
      ]
    });
    conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
      folderPath: ".",
      exists: true,
      bindingTagIds: [],
      bindings: []
    });

    renderWorkbench();

    await userEvent.click(await screen.findByText("Exchange 分层通讯簿.txt"));
    expect(await screen.findByText(t("shell.affairsDocumentTagsSectionTitle"))).toBeInTheDocument();
    expect(await screen.findByText("类型/文本/Markdown")).toBeInTheDocument();
    expect(await screen.findByText("时间/最近3天")).toBeInTheDocument();
    expect(screen.queryByText("时间/最近7天")).not.toBeInTheDocument();
    expect(screen.queryByText("时间/最近30天")).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsTagSourceSystemDerived"))).not.toBeInTheDocument();
    expect(screen.queryByText("最近3天有修改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "客户/合同" })).not.toBeInTheDocument();

    const tagInput = screen.getByPlaceholderText(t("shell.affairsDocumentTagSearchPlaceholder"));
    await userEvent.type(tagInput, "时间");
    expect(screen.queryByRole("button", { name: "时间/最近7天" })).not.toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsDocumentTagNoMatch"))).toBeInTheDocument();

    await userEvent.clear(tagInput);
    await userEvent.type(tagInput, "合同");
    const documentTagButton = await screen.findByRole("button", { name: "客户/合同" });
    expect(documentTagButton.querySelector(".affairs-color-tag")).not.toBeNull();
    await userEvent.click(documentTagButton);

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsDocumentTags).toHaveBeenCalledWith("workspace-1", "doc-1", {
        tagIds: ["tag-1"]
      });
    });
  });

  it("文件夹详情仍然可以手动分配标签", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-1",
          path: "客户/合同",
          name: "合同",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
                    documentCount: 0,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        }
      ]
    });
    conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
      folderPath: ".",
      exists: true,
      bindingTagIds: [],
      bindings: []
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: "/" }));
    expect(await screen.findByText(t("shell.affairsFolderTagsSectionTitle"))).toBeInTheDocument();
    const folderTagButton = await screen.findByRole("button", { name: "客户/合同" });
    await userEvent.click(folderTagButton);

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsFolderTags).toHaveBeenCalledWith("workspace-1", {
        folderPath: ".",
        tagIds: ["tag-1"]
      });
    });
  });


  it("保存设置时会提交 mirrorRoot 和 allowedExtensions", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const mirrorRootInput = await screen.findByDisplayValue("/Users/jackson/SynologyDrive");

    await userEvent.clear(mirrorRootInput);
    await userEvent.type(mirrorRootInput, "/Users/jackson/SynologyDrive/Mirror");
    await userEvent.type(
      screen.getByLabelText(t("shell.affairsLibraryIncludedHiddenPathsLabel")),
      ".obsidian\nnotes/.draft.md"
    );
    await userEvent.click(screen.getByRole("button", { name: ".docx" }));
    await userEvent.click(screen.getByRole("button", { name: ".txt" }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsLibraryConfig).toHaveBeenCalledWith("workspace-1", {
        mirrorRoot: "/Users/jackson/SynologyDrive/Mirror",
        allowedExtensions: [".md", ".pdf", ".txt"],
        includedHiddenPaths: [".obsidian", "notes/.draft.md"]
      });
    });
  });

  it("可以手动添加自定义后缀", async () => {
    userPreferenceStore.hydrate({
      ...initialPreferenceState,
      profile: {
        ...initialPreferenceState.profile,
        language: "zh-CN"
      }
    });
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    await userEvent.type(
      screen.getByPlaceholderText(t("shell.affairsLibraryAllowedExtensionsCustomPlaceholder")),
      ".pages"
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryAllowedExtensionsCustomAddAction") }));

    expect(screen.getByRole("button", { name: /^\.pages (自定义|Custom)$/ })).toHaveAttribute("aria-pressed", "true");
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

  it("网格模式会给 html json zip mp4 文件显示对应徽标和色调", async () => {
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce(createDocumentListResponse([
      {
        documentId: "doc-html",
        path: "落地页.html",
        title: "落地页.html",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-json",
        path: "配置.json",
        title: "配置.json",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-zip",
        path: "归档资料.zip",
        title: "归档资料.zip",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      },
      {
        documentId: "doc-mp4",
        path: "讲解视频.mp4",
        title: "讲解视频.mp4",
        summary: "摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbench();

    const htmlCard = await screen.findByRole("button", { name: /落地页\.html/i });
    const jsonCard = await screen.findByRole("button", { name: /配置\.json/i });
    const zipCard = await screen.findByRole("button", { name: /归档资料\.zip/i });
    const videoCard = await screen.findByRole("button", { name: /讲解视频\.mp4/i });

    expect(htmlCard.querySelector(".affairs-document-badge")?.textContent?.trim()).toBe(resolveAffairsDocumentVisual("落地页.html").badge);
    expect(jsonCard.querySelector(".affairs-document-badge")?.textContent?.trim()).toBe(resolveAffairsDocumentVisual("配置.json").badge);
    expect(zipCard.querySelector(".affairs-document-badge")?.textContent?.trim()).toBe(resolveAffairsDocumentVisual("归档资料.zip").badge);
    expect(videoCard.querySelector(".affairs-document-badge")?.textContent?.trim()).toBe(resolveAffairsDocumentVisual("讲解视频.mp4").badge);

    expect(htmlCard.querySelector(".affairs-document-sheet")).toHaveClass("tone-sky");
    expect(jsonCard.querySelector(".affairs-document-sheet")).toHaveClass("tone-cyan");
    expect(zipCard.querySelector(".affairs-document-sheet")).toHaveClass("tone-amber");
    expect(videoCard.querySelector(".affairs-document-sheet")).toHaveClass("tone-violet");
  });


});
