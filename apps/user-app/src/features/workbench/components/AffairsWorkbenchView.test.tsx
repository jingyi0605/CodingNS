import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { clearProviderCatalogStore } from "../../conversation/capability/provider-catalog-store";
import { clearSessionProviderPickerCapabilityCache } from "../../conversation/components/SessionProviderPicker";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  AffairsAuxiliaryPanel,
  AffairsSectionMenu,
  AffairsSidebarPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "./AffairsWorkbenchView";
import { useButlerRuntimeStore } from "../../butler/runtime/butler-runtime-store";
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

const liveSessionControllerMock = vi.hoisted(() => ({
  useLiveSessionController: vi.fn()
}));

const butlerRuntimeStateMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let state = {
    initialized: true,
    loading: false,
    profile: null as null | {
      displayName: string;
      providerId: string;
      persona: {
        tone: string;
      };
    },
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
    sending: false,
    bootstrapErrorCode: null as string | null,
    error: null as string | null
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: () => {
      listeners.forEach((listener) => listener());
    },
    reset: () => {
      listeners.clear();
      state = {
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
        sending: false,
        bootstrapErrorCode: null,
        error: null
      };
    },
    setState: (nextState: Partial<typeof state>) => {
      state = {
        ...state,
        ...nextState
      };
      listeners.forEach((listener) => listener());
    }
  };
});

const conversationApiMock = vi.hoisted(() => ({
  createAffairsTag: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  deleteAffairsTag: vi.fn(),
  getGlobalAffairsLibraryBinding: vi.fn(),
  getAffairsDocumentTagDetails: vi.fn(),
  getProviderCapabilities: vi.fn(),
  getAffairsTagRecomputeTask: vi.fn(),
  getAffairsTagRecoveryStatus: vi.fn(),
  getAffairsFolderTagTask: vi.fn(),
  getAffairsFolderTagDetails: vi.fn(),
  getAffairsTagDetail: vi.fn(),
  getAffairsLibraryConfig: vi.fn(),
  getAffairsLibraryPreview: vi.fn(),
  getAffairsLibrarySnapshot: vi.fn(),
  downloadAffairsLibraryFile: vi.fn(),
  operateAffairsLibraryFile: vi.fn(),
  listProviderCatalog: vi.fn(),
  listProviderCapabilities: vi.fn(),
  listAffairsTags: vi.fn(),
  listAffairsLibraryDocuments: vi.fn(),
  requestAffairsLibraryRefresh: vi.fn(),
  requestAffairsTagFullRecompute: vi.fn(),
  requestAffairsTagRecoveryRecompute: vi.fn(),
  saveAffairsDocumentTags: vi.fn(),
  saveAffairsDocumentTagsWithCreate: vi.fn(),
  saveAffairsFolderTags: vi.fn(),
  saveAffairsFolderTagsWithCreate: vi.fn(),
  saveGlobalAffairsLibraryBinding: vi.fn(),
  saveAffairsLibraryConfig: vi.fn(),
  setGlobalAffairsLibraryEnabled: vi.fn(),
  startLiveSession: vi.fn(),
  updateAffairsTag: vi.fn(),
  updateGlobalAffairsLibraryFavorites: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<object>("../../conversation/api/conversation-api");
  return {
    ...actual,
    createAffairsTag: conversationApiMock.createAffairsTag,
    createWorkspaceDirectory: conversationApiMock.createWorkspaceDirectory,
    deleteAffairsTag: conversationApiMock.deleteAffairsTag,
    getGlobalAffairsLibraryBinding: conversationApiMock.getGlobalAffairsLibraryBinding,
    getAffairsDocumentTagDetails: conversationApiMock.getAffairsDocumentTagDetails,
    getProviderCapabilities: conversationApiMock.getProviderCapabilities,
    getAffairsTagRecomputeTask: conversationApiMock.getAffairsTagRecomputeTask,
    getAffairsTagRecoveryStatus: conversationApiMock.getAffairsTagRecoveryStatus,
    getAffairsFolderTagTask: conversationApiMock.getAffairsFolderTagTask,
    getAffairsFolderTagDetails: conversationApiMock.getAffairsFolderTagDetails,
    getAffairsTagDetail: conversationApiMock.getAffairsTagDetail,
    getAffairsLibraryConfig: conversationApiMock.getAffairsLibraryConfig,
    getAffairsLibraryPreview: conversationApiMock.getAffairsLibraryPreview,
    getAffairsLibrarySnapshot: conversationApiMock.getAffairsLibrarySnapshot,
    downloadAffairsLibraryFile: conversationApiMock.downloadAffairsLibraryFile,
    operateAffairsLibraryFile: conversationApiMock.operateAffairsLibraryFile,
    listProviderCatalog: conversationApiMock.listProviderCatalog,
    listProviderCapabilities: conversationApiMock.listProviderCapabilities,
    listAffairsTags: conversationApiMock.listAffairsTags,
    listAffairsLibraryDocuments: conversationApiMock.listAffairsLibraryDocuments,
    requestAffairsLibraryRefresh: conversationApiMock.requestAffairsLibraryRefresh,
    requestAffairsTagFullRecompute: conversationApiMock.requestAffairsTagFullRecompute,
    requestAffairsTagRecoveryRecompute: conversationApiMock.requestAffairsTagRecoveryRecompute,
    saveAffairsDocumentTags: conversationApiMock.saveAffairsDocumentTags,
    saveAffairsDocumentTagsWithCreate: conversationApiMock.saveAffairsDocumentTagsWithCreate,
    saveAffairsFolderTags: conversationApiMock.saveAffairsFolderTags,
    saveAffairsFolderTagsWithCreate: conversationApiMock.saveAffairsFolderTagsWithCreate,
    saveGlobalAffairsLibraryBinding: conversationApiMock.saveGlobalAffairsLibraryBinding,
    saveAffairsLibraryConfig: conversationApiMock.saveAffairsLibraryConfig,
    setGlobalAffairsLibraryEnabled: conversationApiMock.setGlobalAffairsLibraryEnabled,
    startLiveSession: conversationApiMock.startLiveSession,
    updateAffairsTag: conversationApiMock.updateAffairsTag,
    updateGlobalAffairsLibraryFavorites: conversationApiMock.updateGlobalAffairsLibraryFavorites
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

    getState() {
      return butlerRuntimeStateMock.getState();
    }

    subscribe(listener: () => void) {
      return butlerRuntimeStateMock.subscribe(listener);
    }

    async initialize() {
      butlerRuntimeStateMock.emit();
    }

    async initializeProfile(payload: {
      displayName?: string;
      providerId?: string;
      persona?: {
        tone?: string;
      };
    }) {
      butlerRuntimeStateMock.setState({
        initialized: true,
        loading: false,
        bootstrapErrorCode: null,
        error: null,
        profile: {
          displayName: payload.displayName ?? "事务助手",
          providerId: payload.providerId ?? "codex",
          persona: {
            tone: payload.persona?.tone ?? "direct"
          }
        }
      });
    }
  },
  useButlerRuntimeStore: vi.fn((store, selector) => selector(store.getState()))
}));

const useButlerRuntimeStoreMock = vi.mocked(useButlerRuntimeStore);

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: ({ onSend, isSubmitting }: { onSend?: (content: string) => Promise<void>; isSubmitting?: boolean }) => (
    <button
      type="button"
      data-testid="affairs-composer-send"
      disabled={Boolean(isSubmitting)}
      onClick={() => {
        if (onSend) {
          void onSend("请帮我查一下今天的事务重点");
        }
      }}
    >
      发送
    </button>
  )
}));

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: ({ sessionId, items }: { sessionId?: string; items?: Array<unknown> }) => (
    <div data-testid="affairs-timeline">{`${sessionId ?? "draft"}:${items?.length ?? 0}`}</div>
  )
}));

vi.mock("../../conversation/components/PermissionRequestList", () => ({
  PermissionRequestList: () => <div data-testid="affairs-permissions" />
}));

vi.mock("../../conversation/components/WorkspaceImportBrowserModal", () => ({
  WorkspaceImportBrowserModal: () => null
}));

vi.mock("../../conversation/runtime/use-live-session-controller", () => ({
  useLiveSessionController: liveSessionControllerMock.useLiveSessionController
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

function createConversationState(): AffairsViewState {
  return {
    ...createState(),
    primarySection: "conversation",
    selectedNodeId: "conversation:draft:lightweight:codex"
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

function renderWorkbenchWithSectionMenu() {
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
        <div style={{ display: "flex", gap: 12 }}>
          <AffairsSectionMenu />
          <AffairsSidebarPanel />
          <AffairsWorkbenchView workspaceId="workspace-1" />
          <AffairsAuxiliaryPanel workspaceId="workspace-1" />
        </div>
      </AffairsWorkbenchProvider>
    );
  }

  return render(<TestHarness />);
}

function renderWorkbenchWithState(initialState: AffairsViewState) {
  function TestHarness(): ReactElement {
    const [state, setState] = useState(initialState);

    return (
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={navigationGroups}
        state={state}
        onStateChange={setState}
      >
        <div style={{ display: "flex", gap: 12 }}>
          <AffairsSectionMenu />
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
  const labelNode = within(tree).queryAllByText(label).find((node) => node.classList.contains("affairs-sidebar-item-title"));
  return labelNode?.closest(".affairs-tag-tree-node") ?? null;
}

describe("AffairsWorkbenchView", () => {
  afterEach(() => {
    userPreferenceStore.hydrate(initialPreferenceState);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    butlerRuntimeStateMock.reset();
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
    clearProviderCatalogStore();
    clearSessionProviderPickerCapabilityCache();

    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getGlobalAffairsLibraryBinding.mockReset();
    conversationApiMock.getProviderCapabilities.mockReset();
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.getAffairsLibraryPreview.mockReset();
    conversationApiMock.downloadAffairsLibraryFile.mockReset();
    conversationApiMock.operateAffairsLibraryFile.mockReset();
    conversationApiMock.listProviderCatalog.mockReset();
    conversationApiMock.listProviderCapabilities.mockReset();
    conversationApiMock.getAffairsLibraryConfig.mockReset();
    conversationApiMock.listAffairsTags.mockReset();
    conversationApiMock.getAffairsTagDetail.mockReset();
    conversationApiMock.deleteAffairsTag.mockReset();
    conversationApiMock.createAffairsTag.mockReset();
    conversationApiMock.createWorkspaceDirectory.mockReset();
    conversationApiMock.updateAffairsTag.mockReset();
    conversationApiMock.getAffairsDocumentTagDetails.mockReset();
    conversationApiMock.getAffairsTagRecomputeTask.mockReset();
    conversationApiMock.getAffairsTagRecoveryStatus.mockReset();
    conversationApiMock.getAffairsFolderTagDetails.mockReset();
    conversationApiMock.requestAffairsTagFullRecompute.mockReset();
    conversationApiMock.requestAffairsTagRecoveryRecompute.mockReset();
    conversationApiMock.saveAffairsDocumentTags.mockReset();
    conversationApiMock.saveAffairsDocumentTagsWithCreate.mockReset();
    conversationApiMock.saveAffairsFolderTags.mockReset();
    conversationApiMock.saveAffairsFolderTagsWithCreate.mockReset();
    conversationApiMock.requestAffairsLibraryRefresh.mockReset();
    conversationApiMock.saveGlobalAffairsLibraryBinding.mockReset();
    conversationApiMock.saveAffairsLibraryConfig.mockReset();
    conversationApiMock.setGlobalAffairsLibraryEnabled.mockReset();
    conversationApiMock.startLiveSession.mockReset();
    conversationApiMock.updateGlobalAffairsLibraryFavorites.mockReset();
    liveSessionControllerMock.useLiveSessionController.mockReset();

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
    useButlerRuntimeStoreMock.mockImplementation((store, selector) => selector(store.getState()));

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot());
    conversationApiMock.getGlobalAffairsLibraryBinding.mockResolvedValue(baseLibrarySnapshot().binding);
    conversationApiMock.getProviderCapabilities.mockResolvedValue({
      provider: "gemini",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: false,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    });
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
    conversationApiMock.getAffairsTagRecomputeTask.mockResolvedValue(null);
    conversationApiMock.getAffairsTagRecoveryStatus.mockResolvedValue({
      task: null,
      bindingStats: {
        identityBindingCount: 0,
        legacyBindingCount: 0,
        legacyFallbackBindingCount: 0,
        legacyFallbackDocumentCount: 0,
      },
    });
    conversationApiMock.getAffairsFolderTagTask.mockResolvedValue(null);
    conversationApiMock.requestAffairsTagFullRecompute.mockResolvedValue({
      taskId: "task-recompute-1",
      deduped: false,
      status: "queued",
      scope: "full",
    });
    conversationApiMock.requestAffairsTagRecoveryRecompute.mockResolvedValue({
      taskId: "task-recompute-1",
      deduped: false,
      status: "queued",
      scope: "full",
    });
    conversationApiMock.saveAffairsDocumentTags.mockResolvedValue(undefined);
    conversationApiMock.saveAffairsDocumentTagsWithCreate.mockResolvedValue(undefined);
    conversationApiMock.saveAffairsFolderTags.mockResolvedValue({
      target: { type: "folder", folderPath: "." },
      items: [],
      refreshTask: null
    });
    conversationApiMock.saveAffairsFolderTagsWithCreate.mockResolvedValue({
      target: { type: "folder", folderPath: "." },
      items: [],
      refreshTask: null
    });

    conversationApiMock.setGlobalAffairsLibraryEnabled.mockImplementation(async (payload) => ({
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
    conversationApiMock.listProviderCatalog.mockResolvedValue([
      { provider: "gemini", enabled: true },
      { provider: "kimi", enabled: true },
      { provider: "codex", enabled: true },
      { provider: "claude-code", enabled: true },
      { provider: "opencode", enabled: true },
      { provider: "legna-code", enabled: true }
    ]);
    conversationApiMock.listProviderCapabilities.mockResolvedValue({});
    conversationApiMock.startLiveSession.mockResolvedValue({
      sessionId: "session-live-1",
      provider: "gemini",
      providerSessionId: "gemini-session-1",
      acceptedAt: "2026-06-02T10:00:00.000Z",
      clientRequestId: "client-request-1",
      message: {
        messageId: "message-1",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        role: "user",
        kind: "text",
        content: "请帮我查一下今天的事务重点",
        attachments: [],
        timestamp: "2026-06-02T10:00:00.000Z",
        sequence: 1,
        rawRef: "synthetic://gemini/session-live-1/client-request-1"
      },
      session: {
        sessionId: "session-live-1",
        workspaceId: "workspace-1",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        rawStoreRef: "synthetic://gemini/session-live-1",
        title: "Gemini 草稿",
        messageCount: 1,
        lastMessageAt: "2026-06-02T10:00:00.000Z",
        createdAt: "2026-06-02T10:00:00.000Z",
        updatedAt: "2026-06-02T10:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "starting",
        activitySource: "runtime",
        lastEventAt: "2026-06-02T10:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      }
    });
    liveSessionControllerMock.useLiveSessionController.mockImplementation((input: { sessionId: string; externalSession?: Record<string, unknown> | null }) => ({
      session: input.externalSession ?? {
        sessionId: input.sessionId,
        workspaceId: "workspace-1",
        provider: "gemini",
        providerSessionId: "gemini-session-1",
        rawStoreRef: "synthetic://gemini/session-live-1",
        title: "Gemini 草稿",
        messageCount: 1,
        lastMessageAt: "2026-06-02T10:00:00.000Z",
        createdAt: "2026-06-02T10:00:00.000Z",
        updatedAt: "2026-06-02T10:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "starting",
        activitySource: "runtime",
        lastEventAt: "2026-06-02T10:00:00.000Z",
        completedAt: null,
        lastSeenAt: null,
        activityState: "running"
      },
      capabilities: null,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      messages: [],
      timelineItems: [],
      permissionRequests: [],
      queuedMessages: [],
      contextUsage: null,
      historyState: "ready",
      runtimeErrorCode: null,
      runtimeErrorDetail: null,
      runtimeInterruptSource: null,
      loadingOlderMessages: false,
      hasOlderMessages: false,
      connectionState: "connected",
      sending: false,
      replyingPermissionRequestId: null,
      deletingQueueItemId: null,
      steeringQueueItemId: null,
      forkDraft: null,
      setForkDraft: vi.fn(),
      composerHasActiveRun: false,
      composerCanInterrupt: false,
      composerIsRunning: false,
      canSteerQueuedMessage: false,
      hasPendingQueuedMessages: false,
      reconnect: vi.fn(),
      loadOlderMessages: vi.fn(),
      retryMessage: vi.fn(),
      send: vi.fn(),
      queue: vi.fn(),
      interrupt: vi.fn(),
      replyPermissionRequest: vi.fn(),
      deleteQueuedMessage: vi.fn(),
      steerQueuedMessage: vi.fn()
    }));

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

  it("macOS 原生右键菜单点击删除后会先打开确认弹窗", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const deleteItem = items.find((item: { label?: string }) => item.label === t("shell.affairsLibraryContextDelete"));
    expect(deleteItem).toBeTruthy();
    if (!deleteItem || !("onSelect" in deleteItem)) {
      throw new Error("未找到删除菜单项");
    }

    await act(async () => {
      await deleteItem.onSelect();
    });

    expect(await screen.findByRole("dialog", { name: t("shell.affairsLibraryDeleteConfirmTitle") })).toBeInTheDocument();
    expect(conversationApiMock.operateAffairsLibraryFile).not.toHaveBeenCalledWith("workspace-1", {
      opType: "delete",
      srcPath: "Exchange 分层通讯簿.txt"
    });
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

  it("文档库文件右键菜单点击删除后会先确认再删除", async () => {
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
    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsLibraryDeleteConfirmTitle") });
    expect(within(dialog).getByText(t("shell.affairsLibraryDeleteDocumentConfirm", { path: "Exchange 分层通讯簿.txt" }))).toBeInTheDocument();
    expect(conversationApiMock.operateAffairsLibraryFile).not.toHaveBeenCalledWith("workspace-1", {
      opType: "delete",
      srcPath: "Exchange 分层通讯簿.txt"
    });
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsLibraryDeleteConfirmAction") }));
    await waitFor(() => {
      expect(conversationApiMock.operateAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", {
        opType: "delete",
        srcPath: "Exchange 分层通讯簿.txt"
      });
    });
  });

  it("H5 右键菜单点击分配标签后会打开快捷分配面板", async () => {
    platformBridgeMock.supported = false;
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.click(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextTags") }));

    expect(await screen.findByRole("dialog", { name: t("shell.affairsTagQuickAssignModalTitle") })).toBeInTheDocument();
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

  it("事务左侧新增对话入口，并在中间主区显示对话空态壳层", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithSectionMenu();

    const conversationTab = screen.getByRole("tab", { name: "对话" });
    expect(conversationTab).toBeInTheDocument();

    await user.click(conversationTab);

    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    const conversationScope = within(conversationShell as HTMLElement);
    expect(conversationScope.getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(conversationScope.queryByText("轻量会话 · Codex")).not.toBeInTheDocument();

    await user.click(conversationScope.getByRole("button", { name: "新建对话" }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const dialogScope = within(dialog);
    expect(dialogScope.getByText("轻量模式")).toBeInTheDocument();
    expect(dialogScope.getByText("助手模式")).toBeInTheDocument();
    expect(dialogScope.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
    expect(dialogScope.getByRole("button", { name: "Kimi" })).toBeInTheDocument();
    expect(dialogScope.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(dialogScope.getByRole("button", { name: "Claude Code" })).toBeInTheDocument();
  });

  it("事务轻量草稿发送首条消息后会创建隐藏 live session 并切到 runtime 页面", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithSectionMenu();

    await user.click(screen.getByRole("tab", { name: "对话" }));
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    await user.click(await screen.findByRole("button", { name: "Gemini" }));

    expect(await screen.findByTestId("affairs-composer-send")).toBeInTheDocument();

    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(conversationApiMock.startLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          provider: "gemini",
          content: "请帮我查一下今天的事务重点",
          sessionVisibility: "affairs_lightweight"
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-live-1:0");
    });
  });

  it("事务模式未初始化时会强制回到初始化页，并禁用其他事务分区", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      profile: null,
      activeProvider: "codex",
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
    }));
    renderWorkbenchWithState({
      ...createState(),
      primarySection: "automation",
      selectedNodeId: "automation:all"
    });

    expect(await screen.findAllByText("设置助手")).not.toHaveLength(0);
    expect(screen.getAllByText(t("shell.affairsInitRouteGuardHint")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("shell.affairsInitRouteGuardSidebarEmpty"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsInitRouteGuardAuxiliaryEmpty"))).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "文档库" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "待办" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "自动化" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "对话" })).not.toBeDisabled();
  });

  it("事务模式未初始化时即使旧状态停在文档库，也会改为初始化页", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      profile: null,
      activeProvider: "codex",
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
    }));

    renderWorkbenchWithState(createState());

    expect(await screen.findAllByText("设置助手")).not.toHaveLength(0);
    expect(screen.queryByText("Exchange 分层通讯簿.txt")).not.toBeInTheDocument();
  });

  it("事务服务连不上时会显示单独的不可用页面，不会误导成初始化页", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      bootstrapErrorCode: "NETWORK_ERROR",
      error: "请求 http://127.0.0.1:4174/api/butler/profile 失败：fetch failed",
      profile: null,
      activeProvider: "codex",
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
    }));

    renderWorkbenchWithState(createState());

    expect((await screen.findAllByRole("heading", { name: t("shell.affairsHostUnavailableTitle") })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("shell.affairsHostUnavailableDescription")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: t("shell.affairsHostUnavailableRetryAction") }).length).toBeGreaterThan(0);
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务返回无效响应时也会显示不可用页面，不会误导成初始化页", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      bootstrapErrorCode: "INVALID_RESPONSE",
      error: "服务返回了无效的 JSON 响应：Unexpected token '<'",
      profile: null,
      activeProvider: "codex",
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
    }));

    renderWorkbenchWithState(createState());

    expect((await screen.findAllByRole("heading", { name: t("shell.affairsHostUnavailableTitle") })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("shell.affairsHostUnavailableDescription")).length).toBeGreaterThan(0);
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务连接检查中时会显示单独的检查页面，不会先误导成初始化页", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: true,
      bootstrapErrorCode: null,
      error: null,
      profile: null,
      activeProvider: "codex",
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
    }));

    renderWorkbenchWithState(createState());

    expect((await screen.findAllByText(t("shell.affairsConnectionCheckingTitle"))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("shell.affairsConnectionCheckingDescription")).length).toBeGreaterThan(0);
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("辅助面板从连接检查切回正常态时不会触发 hooks 顺序错误", async () => {
    butlerRuntimeStateMock.setState({
      initialized: false,
      loading: true,
      bootstrapErrorCode: null,
      error: null,
      profile: null,
      activeProvider: "codex"
    });

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
          <div style={{ display: "flex", gap: 12 }}>
            <AffairsSectionMenu />
            <AffairsSidebarPanel />
            <AffairsWorkbenchView workspaceId="workspace-1" />
            <AffairsAuxiliaryPanel workspaceId="workspace-1" />
          </div>
        </AffairsWorkbenchProvider>
      );
    }

    const view = render(<TestHarness />);

    expect((await screen.findAllByText(t("shell.affairsConnectionCheckingTitle"))).length).toBeGreaterThan(0);

    butlerRuntimeStateMock.setState({
      initialized: true,
      loading: false,
      bootstrapErrorCode: null,
      error: null,
      profile: {
        displayName: "事务助手",
        providerId: "codex",
        persona: {
          tone: "direct"
        }
      },
      activeProvider: "codex"
    });

    view.rerender(<TestHarness />);

    expect(await screen.findByRole("tab", { name: t("shell.affairsDetailTitle") })).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
  });

  it("事务模式初始化完成后会自动切到文档库", async () => {
    const user = userEvent.setup();
    butlerRuntimeStateMock.setState({
      initialized: false,
      profile: null,
      activeProvider: "codex"
    });

    function TestHarness(): ReactElement {
      const [state, setState] = useState(createConversationState());

      return (
        <AffairsWorkbenchProvider
          workspaceId="workspace-1"
          workspaceName="事务工作区"
          navigationGroups={navigationGroups}
          state={state}
          onStateChange={setState}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <AffairsSectionMenu />
            <AffairsSidebarPanel />
            <AffairsWorkbenchView workspaceId="workspace-1" />
            <AffairsAuxiliaryPanel workspaceId="workspace-1" />
          </div>
        </AffairsWorkbenchProvider>
      );
    }

    const view = render(<TestHarness />);

    const submitButton = await screen.findByRole("button", { name: t("shell.affairsInitSubmit") });
    await user.type(screen.getByPlaceholderText(t("shell.butlerDisplayNamePlaceholder")), "哆哆");
    await user.click(submitButton);

    await waitFor(() => {
      expect(conversationApiMock.saveGlobalAffairsLibraryBinding).toHaveBeenCalledWith({
        rootDir: "/Users/jackson/WorkFile"
      });
    });
    await waitFor(() => {
      expect(conversationApiMock.setGlobalAffairsLibraryEnabled).toHaveBeenCalledWith({
        enabled: true
      });
    });

    view.rerender(<TestHarness />);

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文档库" })).toHaveAttribute("aria-selected", "true");
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
      expect(conversationApiMock.setGlobalAffairsLibraryEnabled).toHaveBeenCalledWith({
        enabled: false
      });
    });
  });

  it("文档库未启用时不会请求文档和文件夹标签详情", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      binding: {
        ...baseLibrarySnapshot().binding,
        enabled: false,
      },
      status: {
        ...baseLibrarySnapshot().status,
        state: "idle",
      },
      tags: [],
      folders: [],
      documentCount: 0,
    }));

    renderWorkbench();

    await screen.findAllByText(t("shell.affairsLibraryEmpty"));

    expect(conversationApiMock.getAffairsDocumentTagDetails).not.toHaveBeenCalled();
    expect(conversationApiMock.getAffairsFolderTagDetails).not.toHaveBeenCalled();
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
    expect(await screen.findByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }));

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

    const rootButton = await screen.findByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") });
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

  it("标签树显示手动业务标签，同时继续隐藏来源、主题、状态这类噪音根标签", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "类型", name: "类型", parentPath: null, depth: 0, rootType: "类型", documentCount: 2 },
        { path: "类型/文本", name: "文本", parentPath: "类型", depth: 1, rootType: "类型", documentCount: 1 },
        { path: "时间", name: "时间", parentPath: null, depth: 0, rootType: "时间", documentCount: 2 },
        { path: "时间/2026/05", name: "05", parentPath: "时间", depth: 2, rootType: "时间", documentCount: 1 },
        { path: "系统集成", name: "系统集成", parentPath: null, depth: 0, rootType: "系统集成", documentCount: 1 },
        { path: "系统集成/售前", name: "售前", parentPath: "系统集成", depth: 1, rootType: "系统集成", documentCount: 1 },
        { path: "来源", name: "来源", parentPath: null, depth: 0, rootType: "来源", documentCount: 1 },
        { path: "来源/邮件", name: "邮件", parentPath: "来源", depth: 1, rootType: "来源", documentCount: 1 },
        { path: "主题", name: "主题", parentPath: null, depth: 0, rootType: "主题", documentCount: 1 },
        { path: "主题/投标", name: "投标", parentPath: "主题", depth: 1, rootType: "主题", documentCount: 1 },
        { path: "状态", name: "状态", parentPath: null, depth: 0, rootType: "状态", documentCount: 1 },
        { path: "状态/待处理", name: "待处理", parentPath: "状态", depth: 1, rootType: "状态", documentCount: 1 }
      ],
      folders: []
    }));

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });

    expect(findTagTreeNode("类型")).not.toBeNull();
    expect(findTagTreeNode("时间")).not.toBeNull();
    expect(findTagTreeNode("系统集成")).not.toBeNull();
    expect(findTagTreeNode("来源")).toBeNull();
    expect(findTagTreeNode("主题")).toBeNull();
    expect(findTagTreeNode("状态")).toBeNull();

    await user.click(findTagTreeNode("系统集成")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    expect(within(findTagTreeNode("系统集成")!).getByRole("button", { name: /售前/ })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }));
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
      smartRules: [],
      smartRuleEnabled: false,
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
      smartRules: [],
      smartRuleEnabled: false,
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
      smartRules: [],
      smartRuleEnabled: false,
    });

    renderWorkbench();

    expect(screen.queryByRole("button", { name: t("shell.affairsLibraryTagTreeReset") })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("tree", { name: t("shell.affairsTagTreeSectionTitle") })).toBeInTheDocument();
    expect((await screen.findAllByText("客户/合同")).length).toBeGreaterThan(0);

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagCreateRootAction") }));
    await userEvent.type(within(dialog).getByPlaceholderText(t("shell.affairsTagNamePlaceholder")), "项目");
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagCreateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.createAffairsTag).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        name: "项目",
        parentId: null,
        status: "active"
      }));
    });

    const tagTreeButton = within(dialog).getByRole("button", { name: /合同.*客户\/合同/s });
    await userEvent.click(tagTreeButton);
    expect(await within(dialog).findByText(t("shell.affairsTagEditorEditTitle"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagCreateChildAction") }));
    await waitFor(() => {
      expect((within(dialog).getByPlaceholderText(t("shell.affairsTagNamePlaceholder")) as HTMLInputElement).value).toBe("");
      expect(within(dialog).getByText("这个新标签会放到“客户/合同”下面。")).toBeInTheDocument();
    });

    await userEvent.click(tagTreeButton);
    const nameInput = within(dialog).getByPlaceholderText(t("shell.affairsTagNamePlaceholder"));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "项目合同");
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        {
          path: "客户",
          name: "客户",
          parentPath: null,
          depth: 0,
          rootType: "客户",
          documentCount: 3
        },
        {
          path: "客户/项目合同",
          name: "项目合同",
          parentPath: "客户",
          depth: 1,
          rootType: "客户",
          documentCount: 1
        }
      ]
    }));
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagUpdateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1", expect.objectContaining({
        tagId: "tag-1",
        name: "项目合同",
        parentId: "tag-root",
        status: "active"
      }));
    });

    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagDeleteAction") }));
    await waitFor(() => {
      expect(conversationApiMock.deleteAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1");
    });
  });

  it("标签改名后会主动刷新左侧标签树名称", async () => {
    const oldSnapshot = createLibrarySnapshot({
      tags: [
        {
          path: "客户",
          name: "客户",
          parentPath: null,
          depth: 0,
          rootType: "客户",
          documentCount: 1730,
        },
        {
          path: "客户/中电绿能科技有限公司",
          name: "中电绿能科技有限公司",
          parentPath: "客户",
          depth: 1,
          rootType: "客户",
          documentCount: 318,
        },
      ],
    });
    const newSnapshot = createLibrarySnapshot({
      status: {
        ...oldSnapshot.status,
        lastCompletedAt: "2026-06-02T08:00:00.000Z",
      },
      tags: [
        {
          path: "客户",
          name: "客户",
          parentPath: null,
          depth: 0,
          rootType: "客户",
          documentCount: 1730,
        },
        {
          path: "客户/中电投绿能科技有限公司",
          name: "中电投绿能科技有限公司",
          parentPath: "客户",
          depth: 1,
          rootType: "客户",
          documentCount: 318,
        },
      ],
    });
    conversationApiMock.getAffairsLibrarySnapshot
      .mockResolvedValueOnce(oldSnapshot)
      .mockResolvedValue(newSnapshot);
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-root",
          path: "客户",
          name: "客户",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
          documentCount: 1730,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null,
        },
        {
          id: "tag-company",
          path: "客户/中电绿能科技有限公司",
          name: "中电绿能科技有限公司",
          rootType: "客户",
          parentId: "tag-root",
          parentPath: "客户",
          description: null,
          status: "active",
          documentCount: 318,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null,
        },
      ],
    });
    conversationApiMock.getAffairsTagDetail.mockResolvedValue({
      id: "tag-company",
      path: "客户/中电绿能科技有限公司",
      name: "中电绿能科技有限公司",
      rootType: "客户",
      parentId: "tag-root",
      parentPath: "客户",
      description: null,
      status: "active",
      documentCount: 318,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
      smartRules: [],
      smartRuleEnabled: false,
    });
    conversationApiMock.updateAffairsTag.mockResolvedValue({
      id: "tag-company",
      path: "客户/中电投绿能科技有限公司",
      name: "中电投绿能科技有限公司",
      rootType: "客户",
      parentId: "tag-root",
      parentPath: "客户",
      description: null,
      status: "active",
      documentCount: 318,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-02T08:00:00.000Z",
      disabledAt: null,
      smartRules: [],
      smartRuleEnabled: false,
    });
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse());

    renderWorkbench();

    const rootNode = await waitFor(() => {
      const node = findTagTreeNode("客户");
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    await userEvent.click(within(rootNode).getByRole("button", { name: /展开子代理列表/ }));
    expect(await screen.findByText("中电绿能科技有限公司")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    await userEvent.click(screen.getByRole("button", { name: /中电绿能科技有限公司.*客户\/中电绿能科技有限公司/s }));
    const nameInput = screen.getByPlaceholderText(t("shell.affairsTagNamePlaceholder"));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "中电投绿能科技有限公司");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagUpdateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-company", expect.objectContaining({
        tagId: "tag-company",
        name: "中电投绿能科技有限公司",
      }));
    });

    await waitFor(() => {
      expect(screen.getByText("中电投绿能科技有限公司")).toBeInTheDocument();
    });
  });

  it("标签管理模态框支持添加智能规则并保存", async () => {
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
      parentId: null,
      parentPath: null,
      description: null,
      status: "active",
      documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
      smartRules: [],
      smartRuleEnabled: false,
    });
    conversationApiMock.updateAffairsTag.mockResolvedValue({
      id: "tag-1",
      path: "客户/合同",
      name: "合同",
      rootType: "客户",
      parentId: null,
      parentPath: null,
      description: null,
      status: "active",
      documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
      smartRules: [
        {
          id: "rule-1",
          relation: "and",
          ruleType: "file_name_contains",
          matcher: { keyword: "合同" },
          enabled: true,
          priority: 0
        }
      ],
      smartRuleEnabled: true,
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    await userEvent.click(await screen.findByRole("button", { name: /合同.*客户\/合同/s }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagSmartRuleAddAction") }));
    await userEvent.type(screen.getByPlaceholderText(t("shell.affairsTagSmartRuleKeywordPlaceholder")), "合同");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagUpdateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1", expect.objectContaining({
        name: "合同",
        smartRules: [
          expect.objectContaining({
            relation: "and",
            ruleType: "file_name_contains",
            matcher: { keyword: "合同" },
            enabled: true,
            priority: 0
          })
        ]
      }));
    });
  });

  it("标签管理模态框支持配置按文件夹子树命中的智能规则", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-1",
          path: "客户/售前",
          name: "售前",
          rootType: "客户",
          parentId: null,
          parentPath: null,
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
      path: "客户/售前",
      name: "售前",
      rootType: "客户",
      parentId: null,
      parentPath: null,
      description: null,
      status: "active",
      documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
      smartRules: [],
      smartRuleEnabled: false,
    });
    conversationApiMock.updateAffairsTag.mockResolvedValue({
      id: "tag-1",
      path: "客户/售前",
      name: "售前",
      rootType: "客户",
      parentId: null,
      parentPath: null,
      description: null,
      status: "active",
      documentCount: 1,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      disabledAt: null,
      smartRules: [
        {
          id: "rule-folder-1",
          relation: "and",
          ruleType: "document_path_in_folder",
          matcher: { folderPath: "售前/方案" },
          enabled: true,
          priority: 0
        }
      ],
      smartRuleEnabled: true,
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });
    await userEvent.click(await screen.findByRole("button", { name: /售前.*客户\/售前/s }));
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagSmartRuleAddAction") }));
    const comboboxes = within(dialog).getAllByRole("combobox");
    await userEvent.selectOptions(
      comboboxes[comboboxes.length - 1]!,
      "document_path_in_folder",
    );
    await userEvent.clear(within(dialog).getByPlaceholderText(t("shell.affairsTagSmartRuleFolderPathPlaceholder")));
    await userEvent.type(within(dialog).getByPlaceholderText(t("shell.affairsTagSmartRuleFolderPathPlaceholder")), "售前/方案");
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagUpdateSubmitAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1", expect.objectContaining({
        name: "售前",
        smartRules: [
          expect.objectContaining({
            relation: "and",
            ruleType: "document_path_in_folder",
            matcher: { folderPath: "售前/方案" },
            enabled: true,
            priority: 0
          })
        ]
      }));
    });
  });

  it("标签管理模态框支持批量修改标签上级和状态", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-root",
          path: "客户",
          name: "客户",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
          documentCount: 2,
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
        },
        {
          id: "tag-2",
          path: "客户/报价",
          name: "报价",
          rootType: "客户",
          parentId: "tag-root",
          parentPath: "客户",
          description: null,
          status: "active",
          documentCount: 1,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null
        },
        {
          id: "tag-archive",
          path: "归档",
          name: "归档",
          rootType: "归档",
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
    conversationApiMock.getAffairsTagDetail.mockImplementation(async (_workspaceId, tagId) => {
      const details: Record<string, object> = {
        "tag-1": {
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
          smartRules: [],
          smartRuleEnabled: false,
        },
        "tag-2": {
          id: "tag-2",
          path: "客户/报价",
          name: "报价",
          rootType: "客户",
          parentId: "tag-root",
          parentPath: "客户",
          description: null,
          status: "active",
          documentCount: 1,
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: "2026-06-01T08:00:00.000Z",
          disabledAt: null,
          smartRules: [],
          smartRuleEnabled: false,
        }
      };
      return details[tagId] ?? null;
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    await userEvent.click(screen.getByRole("checkbox", { name: t("shell.affairsTagBatchCheckboxLabel", { tag: "客户/合同" }) }));
    await userEvent.click(screen.getByRole("checkbox", { name: t("shell.affairsTagBatchCheckboxLabel", { tag: "客户/报价" }) }));
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsTagBatchParentLabel")), "tag-archive");
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsTagBatchStatusLabel")), "disabled");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagBatchUpdateAction") }));

    await waitFor(() => {
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-1", expect.objectContaining({
        name: "合同",
        parentId: "tag-archive",
        status: "disabled",
      }));
      expect(conversationApiMock.updateAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-2", expect.objectContaining({
        name: "报价",
        parentId: "tag-archive",
        status: "disabled",
      }));
    });
  });

  it("标签管理模态框批量删除时会自动忽略已被父标签覆盖的子标签", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-root",
          path: "客户",
          name: "客户",
          rootType: "客户",
          parentId: null,
          parentPath: null,
          description: null,
          status: "active",
          documentCount: 2,
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

    renderWorkbench();

    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    await userEvent.click(screen.getByRole("checkbox", { name: t("shell.affairsTagBatchCheckboxLabel", { tag: "客户" }) }));
    await userEvent.click(screen.getByRole("checkbox", { name: t("shell.affairsTagBatchCheckboxLabel", { tag: "客户/合同" }) }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsTagBatchDeleteAction") }));

    await waitFor(() => {
      expect(conversationApiMock.deleteAffairsTag).toHaveBeenCalledTimes(1);
      expect(conversationApiMock.deleteAffairsTag).toHaveBeenCalledWith("workspace-1", "tag-root");
    });
  });

  it("标签管理模态框可以发起全量标签重算恢复任务", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagRecoveryAction") }));

    await waitFor(() => {
      expect(conversationApiMock.requestAffairsTagRecoveryRecompute).toHaveBeenCalledWith("workspace-1");
    });
  });

  it("标签管理模态框会显示全量标签重算的当前进度", async () => {
    conversationApiMock.getAffairsTagRecoveryStatus.mockResolvedValue({
      task: {
        taskId: "task-recompute-1",
        taskType: "affairs.library_tag_recompute",
        key: "workspace-1:full",
        executionLane: "helper_process",
        status: "running",
        source: "affairs_tag.request_full_recompute",
        attempt: 1,
        enqueuedAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: null,
        timeoutMs: 30000,
        progress: {
          phase: "recompute",
          label: "正在重算标签",
          detail: "125 / 6000",
          current: 125,
          total: 6000,
          percent: 18,
          updatedAt: Date.now(),
        },
      },
      bindingStats: {
        identityBindingCount: 120,
        legacyBindingCount: 30,
        legacyFallbackBindingCount: 8,
        legacyFallbackDocumentCount: 3,
      },
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });

    await waitFor(() => {
      expect(conversationApiMock.getAffairsTagRecoveryStatus).toHaveBeenCalledWith("workspace-1");
    });

    expect(within(dialog).getByText(t("shell.affairsTagRecoveryStatusLabel"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.affairsFolderTagTaskStatusRunning"))).toBeInTheDocument();
    expect(within(dialog).getAllByText("125 / 6000").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("120")).toBeInTheDocument();
    expect(within(dialog).getByText("30")).toBeInTheDocument();
    expect(within(dialog).getByText("8")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.affairsTagRecoveryRunningAction") })).toBeInTheDocument();
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

    const tagInput = screen.getByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "时间");
    expect(screen.queryByRole("button", { name: "时间/最近7天" })).not.toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsTagQuickCreateAction", { tag: "时间" }))).toBeInTheDocument();

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

  it("文档详情输入不存在的标签时会直接创建并分配", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: []
    });

    renderWorkbench();

    await userEvent.click(await screen.findByText("Exchange 分层通讯簿.txt"));
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "项目/报价");
    await userEvent.click(screen.getByRole("button", { name: /创建并分配“项目\/报价”/ }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsDocumentTagsWithCreate).toHaveBeenCalledWith("workspace-1", "doc-1", {
        tagIds: [],
        createTagPaths: ["项目/报价"]
      });
    });
  });

  it("文件夹详情可以通过输入分配已有标签", async () => {
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
    conversationApiMock.saveAffairsFolderTags.mockResolvedValue({
      target: { type: "folder", folderPath: "." },
      items: [],
      refreshTask: {
        taskId: "task-folder-1",
        deduped: false,
        affectedPaths: ["."]
      }
    });
    conversationApiMock.getAffairsFolderTagTask.mockResolvedValue({
      taskId: "task-folder-1",
      taskType: "affairs.library_tag_apply_bindings",
      key: "workspace-1:folder:.",
      executionLane: "helper_process",
      status: "running",
      source: "affairs_tag.save_folder_bindings",
      attempt: 1,
      enqueuedAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      timeoutMs: 30000,
      progress: {
        phase: "recompute",
        label: "正在应用文件夹标签",
        detail: "25 / 120",
        current: 25,
        total: 120,
        percent: 29,
        updatedAt: Date.now(),
      }
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }));
    expect(await screen.findByText(t("shell.affairsFolderTagsSectionTitle"))).toBeInTheDocument();
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "合同");
    const folderTagButton = await screen.findByRole("button", { name: "客户/合同" });
    await userEvent.click(folderTagButton);

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsFolderTags).toHaveBeenCalledWith("workspace-1", {
        folderPath: ".",
        tagIds: ["tag-1"]
      });
    });

    expect(await screen.findByRole("button", {
      name: t("shell.affairsFolderTagTaskButtonLabel", {
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        folder: t("shell.affairsLibraryDirectoryStatusRootPath"),
        status: t("shell.affairsFolderTagTaskStatusRunning"),
        percent: 29,
      })
    })).toBeInTheDocument();
  });

  it("文件夹标签请求提交后会立刻显示右上角进度入口", async () => {
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
          documentCount: 4,
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
    let resolveSave: ((value: {
      target: { type: "folder"; folderPath: string };
      items: [];
      refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
    }) => void) | null = null;
    conversationApiMock.saveAffairsFolderTags.mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }));
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "合同");
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));

    expect(await screen.findByRole("button", {
      name: t("shell.affairsFolderTagTaskButtonLabel", {
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        folder: t("shell.affairsLibraryDirectoryStatusRootPath"),
        status: t("shell.affairsFolderTagTaskStatusQueued"),
        percent: 0,
      })
    })).toBeInTheDocument();

    resolveSave?.({
      target: { type: "folder", folderPath: "." },
      items: [],
      refreshTask: {
        taskId: "task-folder-1",
        deduped: false,
        affectedPaths: ["."]
      }
    });
  });

  it("文件夹详情输入不存在的标签时会直接创建并绑定", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({ items: [] });
    conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
      folderPath: ".",
      exists: true,
      bindingTagIds: [],
      bindings: []
    });

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }));
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "归档/待签");
    await userEvent.click(screen.getByRole("button", { name: /创建并分配“归档\/待签”/ }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsFolderTagsWithCreate).toHaveBeenCalledWith("workspace-1", {
        folderPath: ".",
        tagIds: [],
        createTagPaths: ["归档/待签"]
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
