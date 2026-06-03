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

const butlerRuntimeCallsMock = vi.hoisted(() => ({
  constructedWorkspaceIds: [] as string[],
  switchProvider: vi.fn(),
  startFreshSession: vi.fn(),
  sendMessage: vi.fn(),
  updateProfile: vi.fn(),
  replyPermissionRequest: vi.fn(),
  interrupt: vi.fn(),
  loadOlderMessages: vi.fn(),
  retryMessage: vi.fn()
}));

const butlerRuntimeStateMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let state = {
    initialized: true,
    loading: false,
    profile: null as null | {
      displayName: string;
      providerId: string;
      workspacePath?: string;
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
      butlerRuntimeCallsMock.switchProvider.mockReset();
      butlerRuntimeCallsMock.startFreshSession.mockReset();
      butlerRuntimeCallsMock.sendMessage.mockReset();
      butlerRuntimeCallsMock.updateProfile.mockReset();
      butlerRuntimeCallsMock.replyPermissionRequest.mockReset();
      butlerRuntimeCallsMock.interrupt.mockReset();
      butlerRuntimeCallsMock.loadOlderMessages.mockReset();
      butlerRuntimeCallsMock.retryMessage.mockReset();
      butlerRuntimeCallsMock.constructedWorkspaceIds.splice(0, butlerRuntimeCallsMock.constructedWorkspaceIds.length);
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
  deleteAffairsLightweightSession: vi.fn(),
  deleteAffairsTag: vi.fn(),
  getAffairsLightweightSession: vi.fn(),
  getAffairsLightweightSessionMessages: vi.fn(),
  getGlobalAffairsLibraryBinding: vi.fn(),
  getAffairsDocumentTagDetails: vi.fn(),
  getAffairsDocumentTagTask: vi.fn(),
  getProviderCapabilities: vi.fn(),
  getAffairsTagRecomputeTask: vi.fn(),
  getAffairsTagRecoveryStatus: vi.fn(),
  getAffairsFolderTagTask: vi.fn(),
  getAffairsFolderTagDetails: vi.fn(),
  getAffairsTagDetail: vi.fn(),
  getAffairsLibraryConfig: vi.fn(),
  getAffairsLibraryPreview: vi.fn(),
  getAffairsLibraryPreviewWithOptions: vi.fn(),
  getAffairsLibrarySnapshot: vi.fn(),
  downloadAffairsLibraryFile: vi.fn(),
  listAffairsLightweightSessions: vi.fn(),
  markAffairsLightweightSessionSeen: vi.fn(),
  operateAffairsLibraryFile: vi.fn(),
  listProviderCatalog: vi.fn(),
  listProviderCapabilities: vi.fn(),
  listAffairsTags: vi.fn(),
  listAffairsLibraryDocuments: vi.fn(),
  requestAffairsLibraryRefresh: vi.fn(),
  requestAffairsTagFullRecompute: vi.fn(),
  requestAffairsTagRecoveryRecompute: vi.fn(),
  renameAffairsLightweightSessionTitle: vi.fn(),
  saveAffairsDocumentTags: vi.fn(),
  saveAffairsDocumentTagsWithCreate: vi.fn(),
  saveAffairsFolderTags: vi.fn(),
  saveAffairsFolderTagsWithCreate: vi.fn(),
  saveGlobalAffairsLibraryBinding: vi.fn(),
  saveAffairsLibraryConfig: vi.fn(),
  sendAffairsLightweightSessionMessage: vi.fn(),
  sendAffairsLightweightSessionMessageStream: vi.fn(),
  markSessionSeen: vi.fn(),
  renameSessionTitle: vi.fn(),
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  setGlobalAffairsLibraryEnabled: vi.fn(),
  startAffairsLightweightSession: vi.fn(),
  startAffairsLightweightSessionStream: vi.fn(),
  updateAffairsLightweightSessionArchiveState: vi.fn(),
  updateAffairsLightweightSessionFavoriteState: vi.fn(),
  updateSessionArchiveState: vi.fn(),
  updateSessionFavoriteState: vi.fn(),
  updateAffairsTag: vi.fn(),
  updateGlobalAffairsLibraryFavorites: vi.fn()
}));

const docsApiMock = vi.hoisted(() => ({
  destroyEditor: vi.fn(),
  docEditor: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<object>("../../conversation/api/conversation-api");
  return {
    ...actual,
    createAffairsTag: conversationApiMock.createAffairsTag,
    createWorkspaceDirectory: conversationApiMock.createWorkspaceDirectory,
    deleteAffairsLightweightSession: conversationApiMock.deleteAffairsLightweightSession,
    deleteAffairsTag: conversationApiMock.deleteAffairsTag,
    getAffairsLightweightSession: conversationApiMock.getAffairsLightweightSession,
    getAffairsLightweightSessionMessages: conversationApiMock.getAffairsLightweightSessionMessages,
    getGlobalAffairsLibraryBinding: conversationApiMock.getGlobalAffairsLibraryBinding,
    getAffairsDocumentTagDetails: conversationApiMock.getAffairsDocumentTagDetails,
    getAffairsDocumentTagTask: conversationApiMock.getAffairsDocumentTagTask,
    getProviderCapabilities: conversationApiMock.getProviderCapabilities,
    getAffairsTagRecomputeTask: conversationApiMock.getAffairsTagRecomputeTask,
    getAffairsTagRecoveryStatus: conversationApiMock.getAffairsTagRecoveryStatus,
    getAffairsFolderTagTask: conversationApiMock.getAffairsFolderTagTask,
    getAffairsFolderTagDetails: conversationApiMock.getAffairsFolderTagDetails,
    getAffairsTagDetail: conversationApiMock.getAffairsTagDetail,
    getAffairsLibraryConfig: conversationApiMock.getAffairsLibraryConfig,
    getAffairsLibraryPreview: conversationApiMock.getAffairsLibraryPreview,
    getAffairsLibraryPreviewWithOptions: conversationApiMock.getAffairsLibraryPreviewWithOptions,
    getAffairsLibrarySnapshot: conversationApiMock.getAffairsLibrarySnapshot,
    downloadAffairsLibraryFile: conversationApiMock.downloadAffairsLibraryFile,
    listAffairsLightweightSessions: conversationApiMock.listAffairsLightweightSessions,
    markAffairsLightweightSessionSeen: conversationApiMock.markAffairsLightweightSessionSeen,
    operateAffairsLibraryFile: conversationApiMock.operateAffairsLibraryFile,
    listProviderCatalog: conversationApiMock.listProviderCatalog,
    listProviderCapabilities: conversationApiMock.listProviderCapabilities,
    listAffairsTags: conversationApiMock.listAffairsTags,
    listAffairsLibraryDocuments: conversationApiMock.listAffairsLibraryDocuments,
    requestAffairsLibraryRefresh: conversationApiMock.requestAffairsLibraryRefresh,
    requestAffairsTagFullRecompute: conversationApiMock.requestAffairsTagFullRecompute,
    requestAffairsTagRecoveryRecompute: conversationApiMock.requestAffairsTagRecoveryRecompute,
    renameAffairsLightweightSessionTitle: conversationApiMock.renameAffairsLightweightSessionTitle,
    saveAffairsDocumentTags: conversationApiMock.saveAffairsDocumentTags,
    saveAffairsDocumentTagsWithCreate: conversationApiMock.saveAffairsDocumentTagsWithCreate,
    saveAffairsFolderTags: conversationApiMock.saveAffairsFolderTags,
    saveAffairsFolderTagsWithCreate: conversationApiMock.saveAffairsFolderTagsWithCreate,
    saveGlobalAffairsLibraryBinding: conversationApiMock.saveGlobalAffairsLibraryBinding,
    saveAffairsLibraryConfig: conversationApiMock.saveAffairsLibraryConfig,
    sendAffairsLightweightSessionMessage: conversationApiMock.sendAffairsLightweightSessionMessage,
    sendAffairsLightweightSessionMessageStream: conversationApiMock.sendAffairsLightweightSessionMessageStream,
    markSessionSeen: conversationApiMock.markSessionSeen,
    renameSessionTitle: conversationApiMock.renameSessionTitle,
    deleteSession: conversationApiMock.deleteSession,
    getSessionMessages: conversationApiMock.getSessionMessages,
    setGlobalAffairsLibraryEnabled: conversationApiMock.setGlobalAffairsLibraryEnabled,
    startAffairsLightweightSession: conversationApiMock.startAffairsLightweightSession,
    startAffairsLightweightSessionStream: conversationApiMock.startAffairsLightweightSessionStream,
    updateAffairsLightweightSessionArchiveState: conversationApiMock.updateAffairsLightweightSessionArchiveState,
    updateAffairsLightweightSessionFavoriteState: conversationApiMock.updateAffairsLightweightSessionFavoriteState,
    updateSessionArchiveState: conversationApiMock.updateSessionArchiveState,
    updateSessionFavoriteState: conversationApiMock.updateSessionFavoriteState,
    updateAffairsTag: conversationApiMock.updateAffairsTag,
    updateGlobalAffairsLibraryFavorites: conversationApiMock.updateGlobalAffairsLibraryFavorites
  };
});

const butlerApiMock = vi.hoisted(() => ({
  getButlerSessionTarget: vi.fn(),
  listAssistantAutomations: vi.fn().mockResolvedValue({ items: [] }),
  listButlerFollowUpTasks: vi.fn().mockResolvedValue({ items: [] }),
  listButlerInboxItems: vi.fn().mockResolvedValue({ items: [] }),
  listButlerProjectSessions: vi.fn(),
  listButlerProjects: vi.fn(),
  listRecentAssistantAutomationRuns: vi.fn().mockResolvedValue({ items: [] }),
  resumeButlerProjectSession: vi.fn()
}));

vi.mock("../../butler/api/butler-api", () => ({
  getButlerSessionTarget: butlerApiMock.getButlerSessionTarget,
  listAssistantAutomations: butlerApiMock.listAssistantAutomations,
  listButlerFollowUpTasks: butlerApiMock.listButlerFollowUpTasks,
  listButlerInboxItems: butlerApiMock.listButlerInboxItems,
  listButlerProjectSessions: butlerApiMock.listButlerProjectSessions,
  listButlerProjects: butlerApiMock.listButlerProjects,
  listRecentAssistantAutomationRuns: butlerApiMock.listRecentAssistantAutomationRuns,
  resumeButlerProjectSession: butlerApiMock.resumeButlerProjectSession
}));

vi.mock("../../butler/runtime/butler-runtime-store", () => ({
  ButlerRuntimeStore: class {
    constructor(workspaceId: string) {
      butlerRuntimeCallsMock.constructedWorkspaceIds.push(workspaceId);
    }

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
        activeProvider: payload.providerId ?? "codex",
        profile: {
          displayName: payload.displayName ?? "事务助手",
          providerId: payload.providerId ?? "codex",
          workspacePath: payload.workspacePath ?? "/tmp/butler",
          persona: {
            tone: payload.persona?.tone ?? "direct"
          }
        }
      });
    }

    async updateProfile(payload: { workspacePath?: string; providerId?: string }) {
      butlerRuntimeCallsMock.updateProfile(payload);
      const current = butlerRuntimeStateMock.getState();
      butlerRuntimeStateMock.setState({
        profile: current.profile
          ? {
              ...current.profile,
              providerId: payload.providerId ?? current.profile.providerId,
              workspacePath: payload.workspacePath ?? current.profile.workspacePath
            }
          : current.profile
      });
    }

    async switchProvider(providerId: string) {
      butlerRuntimeCallsMock.switchProvider(providerId);
      butlerRuntimeStateMock.setState({
        activeProvider: providerId,
        controlSession: null,
        messages: [],
        historyState: "ready",
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false,
        capabilities: {
          provider: providerId,
          canStartSession: true,
          canResumeSession: true,
          canSendMessage: true,
          inRunInputMode: providerId === "claude-code" ? "streaming_guidance" : "none",
          supportsSubagents: false,
          supportsInterrupt: true,
          supportsStructuredToolCalls: true,
          supportsTokenUsage: true,
          supportsAttachments: false,
          supportsPermissionPrompt: true,
          supportsCheckpoint: false,
          supportsSlashMenu: false,
          supportsReasoningSelector: false,
          supportsRunSteering: false,
          supportsQueueWhileRunning: false,
          limitations: []
        }
      });
    }

    async startFreshSession() {
      butlerRuntimeCallsMock.startFreshSession();
      butlerRuntimeStateMock.setState({
        controlSession: null,
        messages: [],
        historyState: "ready",
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false
      });
    }

    async sendMessage(content: string) {
      butlerRuntimeCallsMock.sendMessage(content);
      const provider = butlerRuntimeStateMock.getState().activeProvider ?? "codex";
      butlerRuntimeStateMock.setState({
        controlSession: {
          id: "control-session-1",
          providerId: provider,
          sessionId: "agent-session-1",
          purpose: "chat",
          title: "Agent 对话",
          sourceItemId: null,
          status: "idle",
          lastContextVersion: null,
          lastSummary: null,
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:00:05.000Z",
          session: {
            sessionId: "agent-session-1",
            workspaceId: "workspace-1",
            provider,
            providerSessionId: `provider://${provider}/agent-session-1`,
            rawStoreRef: `raw://${provider}/agent-session-1`,
            providerConfigMode: "global-default",
            providerPresetId: null,
            parentSessionId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            isFavorite: false,
            title: "Agent 对话",
            messageCount: 2,
            lastMessageAt: "2026-06-03T12:00:05.000Z",
            createdAt: "2026-06-03T12:00:00.000Z",
            updatedAt: "2026-06-03T12:00:05.000Z",
            syncStatus: "idle",
            syncCursor: null,
            lastSyncAt: "2026-06-03T12:00:05.000Z",
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "completed",
            activitySource: "runtime",
            lastEventAt: "2026-06-03T12:00:05.000Z",
            completedAt: "2026-06-03T12:00:05.000Z",
            lastSeenAt: null,
            activityState: "completed_unread"
          }
        },
        messages: [
          {
            id: "agent-msg-1",
            sessionId: "agent-session-1",
            role: "user",
            kind: "text",
            content,
            toolCall: null,
            attachments: [],
            attachmentPayloads: null,
            origin: null,
            originRef: null,
            timestamp: "2026-06-03T12:00:00.000Z",
            sequence: 1,
            rawRef: "raw://agent-session-1#1",
            deliveryState: "sent",
            clientRequestId: null
          }
        ],
        historyState: "ready",
        sending: false,
        runtimeHasActiveRun: false,
        runtimeCanInterrupt: false
      });
    }

    async replyPermissionRequest(requestId: string, payload: { action: string; answers?: Record<string, string[]> }) {
      butlerRuntimeCallsMock.replyPermissionRequest(requestId, payload);
    }

    async interrupt() {
      butlerRuntimeCallsMock.interrupt();
    }

    async loadOlderMessages() {
      butlerRuntimeCallsMock.loadOlderMessages();
    }

    async retryMessage(clientRequestId: string) {
      butlerRuntimeCallsMock.retryMessage(clientRequestId);
    }

    dispose() {
      return undefined;
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
    sessions: [],
    affairsAssistantProjectId: "project-2",
    affairsAssistantProjectWorkspaceId: "workspace-2",
    affairsAssistantSessions: [],
    affairsAssistantSessionsUpdatedAt: "2026-06-03T10:00:00.000Z"
  }
];

const navigationGroupsWithBoundLibraryWorkspace: WorkspaceSessionGroup[] = [
  ...navigationGroups,
  {
    workspace: {
      id: "workspace-2",
      name: "事务文档库",
      path: "/Users/jackson/SynologyDrive",
      repoRoot: "/Users/jackson/SynologyDrive"
    },
    sessions: [],
    childWorktrees: []
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

function createAgentSnapshotSession(overrides: Partial<NonNullable<WorkspaceSessionGroup["affairsAssistantSessions"]>[number]> = {}) {
  return {
    sessionId: overrides.sessionId ?? "agent-session-1",
    workspaceId: overrides.workspaceId ?? "workspace-2",
    provider: overrides.provider ?? "codex",
    providerSessionId: overrides.providerSessionId ?? (overrides.sessionId ?? "agent-session-1"),
    rawStoreRef: overrides.rawStoreRef ?? `butler://${overrides.sessionId ?? "agent-session-1"}`,
    providerConfigMode: "global-default" as const,
    providerPresetId: null,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: overrides.isArchived ?? false,
    isFavorite: overrides.isFavorite ?? false,
    title: overrides.title ?? "事务 Agent 会话",
    messageCount: overrides.messageCount ?? 0,
    lastMessageAt: overrides.lastMessageAt ?? "2026-06-03T13:08:00.000Z",
    createdAt: overrides.createdAt ?? "2026-06-03T13:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-03T13:08:00.000Z",
    syncStatus: "idle" as const,
    syncCursor: null,
    lastSyncAt: overrides.lastSyncAt ?? "2026-06-03T13:08:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: overrides.runningState ?? "completed",
    activitySource: overrides.activitySource ?? "inferred",
    lastEventAt: overrides.lastEventAt ?? "2026-06-03T13:08:00.000Z",
    completedAt: overrides.completedAt ?? "2026-06-03T13:08:00.000Z",
    lastSeenAt: null,
    activityState: overrides.activityState ?? "completed_unread"
  };
}

function createNavigationGroupsWithAgentSessions(
  sessions: ReturnType<typeof createAgentSnapshotSession>[]
): WorkspaceSessionGroup[] {
  return navigationGroupsWithBoundLibraryWorkspace.map((group) => (
    group.workspace.id === "workspace-1"
      ? {
          ...group,
          affairsAssistantProjectId: "project-2",
          affairsAssistantProjectWorkspaceId: "workspace-2",
          affairsAssistantSessions: sessions,
          affairsAssistantSessionsUpdatedAt: "2026-06-03T13:10:00.000Z"
        }
      : group
  ));
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
      mirrorRoot: "/Users/jackson/SynologyDrive",
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
  return renderWorkbenchWithCustomNavigationGroups(initialState, navigationGroups);
}

function renderWorkbenchWithCustomNavigationGroups(initialState: AffairsViewState, groups: WorkspaceSessionGroup[]) {
  function TestHarness(): ReactElement {
    const [state, setState] = useState(initialState);

    return (
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={groups}
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

function mockAffairsConversationSidebarSessions() {
  const lightweightSession = {
    sessionId: "light-session-1",
    workspaceId: "workspace-1",
    provider: "codex" as const,
    providerSessionId: "provider://codex/light-session-1",
    rawStoreRef: "raw://codex/light-session-1",
    providerConfigMode: "global-default" as const,
    providerPresetId: null,
    parentSessionId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: "事务轻量会话",
    messageCount: 3,
    lastMessageAt: "2026-06-03T12:48:00.000Z",
    createdAt: "2026-06-03T12:30:00.000Z",
    updatedAt: "2026-06-03T12:48:00.000Z",
    syncStatus: "idle" as const,
    syncCursor: null,
    lastSyncAt: "2026-06-03T12:48:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "completed" as const,
    activitySource: "runtime" as const,
    lastEventAt: "2026-06-03T12:48:00.000Z",
    completedAt: "2026-06-03T12:48:00.000Z",
    lastSeenAt: null,
    activityState: "completed_unread" as const
  };
  const managedAgentSession = {
    id: "butler-session-merged-1",
    projectId: "project-2",
    sessionId: "agent-session-merged-1",
    provider: "claude-code" as const,
    title: "事务 Agent 会话",
    isArchived: false,
    role: "adhoc" as const,
    ownershipMode: "managed" as const,
    status: "idle" as const,
    runningState: "completed" as const,
    lastSummary: null,
    lastCheckpointAt: null,
    createdAt: "2026-06-03T09:00:00.000Z",
    updatedAt: "2026-06-03T09:16:00.000Z"
  };
  const agentSessionTarget = {
    workspaceId: "workspace-2",
    project: {
      id: "project-2",
      workspaceId: "workspace-2",
      name: "事务文档库",
      repoRoot: "/Users/jackson/SynologyDrive",
      lifecycleStatus: "active" as const,
      riskLevel: "low" as const
    },
    session: {
      ...managedAgentSession
    }
  };

  conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
    items: [lightweightSession]
  });
  butlerApiMock.listButlerProjectSessions.mockResolvedValue({
    items: [managedAgentSession]
  });
  butlerApiMock.getButlerSessionTarget.mockResolvedValue({
    target: agentSessionTarget
  });
  butlerApiMock.listButlerProjects.mockResolvedValue({
    items: [
      {
        id: "project-2",
        workspaceId: "workspace-2",
        name: "事务文档库",
        repoRoot: "/Users/jackson/SynologyDrive",
        defaultProvider: null,
        instructionProfileId: null,
        approvalMode: "controlled",
        lifecycleStatus: "active",
        riskLevel: "low",
        config: {},
        lastPatrolAt: null,
        lastVerificationAt: null,
        createdAt: "2026-06-03T10:00:00.000Z",
        updatedAt: "2026-06-03T10:00:00.000Z",
        archivedAt: null
      }
    ]
  });

  return {
    lightweightSession,
    managedAgentSession
  };
}

describe("AffairsWorkbenchView", () => {
  afterEach(() => {
    delete window.DocsAPI;
    userPreferenceStore.hydrate(initialPreferenceState);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    docsApiMock.destroyEditor.mockReset();
    docsApiMock.docEditor.mockReset();
    docsApiMock.docEditor.mockImplementation(() => ({
      destroyEditor: docsApiMock.destroyEditor
    }));
    window.DocsAPI = {
      DocEditor: docsApiMock.docEditor as unknown as NonNullable<typeof window.DocsAPI>["DocEditor"]
    };
    document.head.querySelectorAll("script[data-onlyoffice-src]").forEach((node) => node.remove());
    const script = document.createElement("script");
    script.dataset.onlyofficeSrc = "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js";
    script.dataset.loaded = "true";
    document.head.appendChild(script);

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
    clearViewSnapshot("affairs.conversation.lightweight.sessions.workspace-1");
    clearViewSnapshot("affairs.conversation.agent.sessions.workspace-1");
    window.localStorage.removeItem("codingns.affairs.tag-tree.state.workspace-1");
    window.sessionStorage.clear();
    clearProviderCatalogStore();
    clearSessionProviderPickerCapabilityCache();

    conversationApiMock.listAffairsLightweightSessions.mockReset();
    conversationApiMock.getAffairsLightweightSession.mockReset();
    conversationApiMock.getAffairsLightweightSessionMessages.mockReset();
    conversationApiMock.getSessionMessages.mockResolvedValue({ messages: [], nextCursor: null });
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
    conversationApiMock.getAffairsDocumentTagTask.mockReset();
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
    conversationApiMock.sendAffairsLightweightSessionMessage.mockReset();
    conversationApiMock.sendAffairsLightweightSessionMessageStream.mockReset();
    conversationApiMock.markSessionSeen.mockReset();
    conversationApiMock.renameSessionTitle.mockReset();
    conversationApiMock.deleteSession.mockReset();
    conversationApiMock.getSessionMessages.mockReset();
    conversationApiMock.setGlobalAffairsLibraryEnabled.mockReset();
    conversationApiMock.startAffairsLightweightSession.mockReset();
    conversationApiMock.startAffairsLightweightSessionStream.mockReset();
    conversationApiMock.updateSessionArchiveState.mockReset();
    conversationApiMock.updateSessionFavoriteState.mockReset();
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

    butlerApiMock.listButlerProjects.mockReset();
    butlerApiMock.listButlerProjectSessions.mockReset();
    butlerApiMock.getButlerSessionTarget.mockReset();
    butlerApiMock.resumeButlerProjectSession.mockReset();
    butlerApiMock.listButlerProjects.mockResolvedValue({
      items: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "事务工作区",
          repoRoot: "/tmp/workspace-1",
          defaultProvider: null,
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "low",
          config: {},
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z",
          archivedAt: null
        }
      ]
    });
    butlerApiMock.listButlerProjectSessions.mockResolvedValue({ items: [] });
    butlerApiMock.getButlerSessionTarget.mockResolvedValue({
      target: {
        workspaceId: "workspace-1",
        project: {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "事务工作区",
          repoRoot: "/tmp/workspace-1",
          lifecycleStatus: "active",
          riskLevel: "low"
        },
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "agent-session-1",
          provider: "codex",
          title: "Agent 对话",
          role: "adhoc",
          ownershipMode: "managed",
          status: "idle",
          runningState: "completed",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:00:05.000Z"
        }
      }
    });
    butlerApiMock.resumeButlerProjectSession.mockResolvedValue({
      resumed: {
        session: {
          id: "butler-session-1",
          projectId: "project-1",
          sessionId: "agent-session-1",
          provider: "codex",
          title: "Agent 对话",
          isArchived: false,
          role: "adhoc",
          ownershipMode: "managed",
          status: "idle",
          runningState: "completed",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:00:05.000Z"
        },
        resumedAt: "2026-06-03T12:00:05.000Z",
        provider: "codex",
        providerSessionId: "provider://codex/agent-session-1"
      }
    });

    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({ items: [] });
    conversationApiMock.getAffairsLightweightSession.mockResolvedValue({
      sessionId: "light-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "affairs-lightweight:codex:light-1",
      rawStoreRef: "light-1.json",
      title: "轻量对话",
      messageCount: 2,
      lastMessageAt: "2026-06-03T12:00:00.000Z",
      createdAt: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-03T12:00:00.000Z",
      syncStatus: "idle",
      syncCursor: null,
      lastSyncAt: "2026-06-03T12:00:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: "completed",
      activitySource: "runtime",
      lastEventAt: "2026-06-03T12:00:00.000Z",
      completedAt: "2026-06-03T12:00:00.000Z",
      lastSeenAt: null,
      activityState: "completed_unread"
    });
    conversationApiMock.getAffairsLightweightSessionMessages.mockResolvedValue({
      messages: [],
      cursor: null,
      nextCursor: null,
      total: 0
    });
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
    conversationApiMock.getAffairsDocumentTagTask.mockResolvedValue(null);
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
    conversationApiMock.saveAffairsDocumentTags.mockResolvedValue({
      target: { type: "document", documentId: "doc-1" },
      items: [],
      refreshTask: null
    });
    conversationApiMock.saveAffairsDocumentTagsWithCreate.mockResolvedValue({
      target: { type: "document", documentId: "doc-1" },
      items: [],
      refreshTask: null
    });
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
    conversationApiMock.getAffairsLibraryPreviewWithOptions.mockImplementation(
      async (workspaceId: string, filePath: string, options?: { officeDisplayMode?: "default" | "reading" }) =>
        conversationApiMock.getAffairsLibraryPreview(workspaceId, filePath, options)
    );
    conversationApiMock.listProviderCatalog.mockResolvedValue([
      { provider: "gemini", enabled: true },
      { provider: "kimi", enabled: true },
      { provider: "codex", enabled: true },
      { provider: "claude-code", enabled: true },
      { provider: "opencode", enabled: true },
      { provider: "legna-code", enabled: true }
    ]);
    conversationApiMock.listProviderCapabilities.mockResolvedValue({});
    const lightweightStartResponse = {
      acceptedAt: "2026-06-02T10:00:00.000Z",
      clientRequestId: "client-request-1",
      userMessage: {
        messageId: "message-user-1",
        provider: "codex",
        providerSessionId: "affairs-lightweight:codex:session-light-1",
        role: "user",
        kind: "text",
        content: "请帮我查一下今天的事务重点",
        attachments: [],
        timestamp: "2026-06-02T10:00:00.000Z",
        sequence: 1,
        rawRef: "session-light-1.json#client-request-1"
      },
      assistantMessage: {
        messageId: "message-assistant-1",
        provider: "codex",
        providerSessionId: "affairs-lightweight:codex:session-light-1",
        role: "assistant",
        kind: "text",
        content: "这是轻量回复",
        attachments: [],
        timestamp: "2026-06-02T10:00:05.000Z",
        sequence: 2,
        rawRef: "session-light-1.json#assistant-2"
      },
      session: {
        sessionId: "session-light-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "affairs-lightweight:codex:session-light-1",
        rawStoreRef: "session-light-1.json",
        title: "Codex 草稿",
        messageCount: 2,
        lastMessageAt: "2026-06-02T10:00:05.000Z",
        createdAt: "2026-06-02T10:00:00.000Z",
        updatedAt: "2026-06-02T10:00:05.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-06-02T10:00:05.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-02T10:00:05.000Z",
        completedAt: "2026-06-02T10:00:05.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      },
      messages: [
        {
          messageId: "message-user-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-1",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-1.json#client-request-1"
        },
        {
          messageId: "message-assistant-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-1",
          role: "assistant",
          kind: "text",
          content: "这是轻量回复",
          attachments: [],
          timestamp: "2026-06-02T10:00:05.000Z",
          sequence: 2,
          rawRef: "session-light-1.json#assistant-2"
        }
      ]
    };
    conversationApiMock.startAffairsLightweightSession.mockResolvedValue(lightweightStartResponse);
    conversationApiMock.getAffairsLightweightSessionMessages.mockResolvedValue({
      messages: lightweightStartResponse.messages,
      cursor: null,
      nextCursor: null,
      total: lightweightStartResponse.messages.length
    });
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, _payload, onEvent) => {
      await onEvent({
        type: "started",
        session: lightweightStartResponse.session,
        acceptedAt: lightweightStartResponse.acceptedAt,
        clientRequestId: lightweightStartResponse.clientRequestId,
        userMessage: lightweightStartResponse.userMessage
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-1",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: null,
        output: null
      });
      await onEvent({
        type: "delta",
        delta: "这是轻量回复"
      });
      await onEvent({
        type: "completed",
        result: lightweightStartResponse
      });
      return lightweightStartResponse;
    });
    conversationApiMock.sendAffairsLightweightSessionMessageStream.mockImplementation(async (_workspaceId, _sessionId, _payload, onEvent) => {
      await onEvent({
        type: "started",
        session: lightweightStartResponse.session,
        acceptedAt: lightweightStartResponse.acceptedAt,
        clientRequestId: lightweightStartResponse.clientRequestId,
        userMessage: lightweightStartResponse.userMessage
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-1",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: null,
        output: null
      });
      await onEvent({
        type: "delta",
        delta: "这是轻量回复"
      });
      await onEvent({
        type: "completed",
        result: lightweightStartResponse
      });
      return lightweightStartResponse;
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
      expect(conversationApiMock.getAffairsLibraryPreviewWithOptions).toHaveBeenCalledWith(
        "workspace-1",
        "Exchange 分层通讯簿.txt",
        {
          officeDisplayMode: "default"
        }
      );
    });

    expect(
      await screen.findByRole("dialog", { name: "Exchange 分层通讯簿.txt" })
    ).toBeInTheDocument();
    expect(await screen.findByText(/纯文本|Plain Text/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerEdit") })).not.toBeInTheDocument();
  });

  it("右侧对象详情栏底部的 Office 预览会走阅读视图，不影响双击正式预览", async () => {
    conversationApiMock.getAffairsLibraryPreviewWithOptions.mockImplementation(
      async (_workspaceId: string, _filePath: string, options?: { officeDisplayMode?: "default" | "reading" }) => ({
        workspaceId: "workspace-1",
        path: "Exchange 分层通讯簿.txt",
        supported: true,
        kind: "office",
        reason: null,
        content: null,
        version: "doc-v1",
        size: 24,
        updatedAt: "2026-05-31T08:00:00.000Z",
        previewPath: null,
        previewUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
        onlyOffice: options?.officeDisplayMode === "reading"
          ? {
              apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
              editorMode: "view",
              documentUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
              callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
              editorConfig: {
                documentType: "word",
                type: "embedded",
                document: {
                  fileType: "docx",
                  key: "doc-v1",
                  title: "Exchange 分层通讯簿.docx",
                  url: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
                  permissions: {
                    edit: false,
                    review: false,
                    comment: false,
                    download: true,
                    print: true,
                    copy: true
                  }
                },
                editorConfig: {
                  callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
                  mode: "view",
                  coEditing: {
                    mode: "strict",
                    change: false
                  },
                  customization: {
                    features: {
                      spellcheck: false
                    },
                    anonymous: {
                      request: false
                    }
                  }
                }
              }
            }
          : {
              apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
              editorMode: "edit",
              documentUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
              callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
              editorConfig: {
                documentType: "word",
                type: "desktop",
                document: {
                  fileType: "docx",
                  key: "doc-v1",
                  title: "Exchange 分层通讯簿.docx",
                  url: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
                  permissions: {
                    edit: true,
                    download: true,
                    print: true,
                    copy: true
                  }
                },
                editorConfig: {
                  callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
                  mode: "edit",
                  customization: {
                    features: {
                      spellcheck: false
                    },
                    anonymous: {
                      request: false
                    }
                  }
                }
              }
            },
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: false,
          canPaginate: false
        }
      })
    );

    conversationApiMock.getAffairsLibraryPreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "Exchange 分层通讯簿.txt",
      supported: true,
      kind: "office",
      reason: null,
      content: null,
      version: "doc-v1",
      size: 24,
      updatedAt: "2026-05-31T08:00:00.000Z",
      previewPath: null,
      previewUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
      onlyOffice: {
        apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
        editorMode: "edit",
        documentUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
        callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
        editorConfig: {
          documentType: "word",
          document: {
            fileType: "docx",
            key: "doc-v1",
            title: "Exchange 分层通讯簿.docx",
            url: "http://127.0.0.1:3002/preview/affairs-files/mock/Exchange%20%E5%88%86%E5%B1%82%E9%80%9A%E8%AE%AF%E7%B0%BF.docx",
            permissions: {
              edit: true,
              download: true,
              print: true,
              copy: true
            }
          },
          editorConfig: {
            callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
            mode: "edit",
            customization: {
              features: {
                spellcheck: false
              },
              anonymous: {
                request: false
              }
            }
          }
        }
      },
      capabilities: {
        canEdit: false,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });

    renderWorkbenchWithState({
      ...createState(),
      primarySection: "library",
      selectedNodeId: "library:folder:root",
      auxiliaryTab: "detail",
      detailViewerCollapsed: false
    });

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.click(card);

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryPreviewWithOptions).toHaveBeenCalledWith(
        "workspace-1",
        "Exchange 分层通讯簿.txt",
        {
          officeDisplayMode: "reading"
        }
      );
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(docsApiMock.docEditor).toHaveBeenCalledTimes(1);
    });

    expect(docsApiMock.docEditor).toHaveBeenLastCalledWith(
      expect.stringMatching(/^onlyoffice-/),
      expect.objectContaining({
        type: "embedded",
        document: expect.objectContaining({
          permissions: expect.objectContaining({
            edit: false,
            review: false,
            comment: false
          })
        }),
        editorConfig: expect.objectContaining({
          mode: "view",
          coEditing: expect.objectContaining({
            mode: "strict",
            change: false
          })
        })
      })
    );

    await userEvent.dblClick(card);

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryPreviewWithOptions).toHaveBeenCalledWith(
        "workspace-1",
        "Exchange 分层通讯簿.txt",
        {
          officeDisplayMode: "default"
        }
      );
    });
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
      expect.objectContaining({ label: t("shell.affairsLibraryContextLocate") }),
      expect.objectContaining({ label: t("shell.affairsLibraryOpenWithLocalAppAction") }),
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

  it("macOS 原生右键菜单点击定位后会切到文件所在目录", async () => {
    conversationApiMock.listAffairsLibraryDocuments
      .mockResolvedValueOnce(createDocumentListResponse())
      .mockResolvedValueOnce(createDocumentListResponse([]));

    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const locateItem = items.find((item: { label?: string }) => item.label === t("shell.affairsLibraryContextLocate"));
    expect(locateItem).toBeTruthy();
    if (!locateItem || !("onSelect" in locateItem)) {
      throw new Error("未找到定位菜单项");
    }

    await act(async () => {
      await locateItem.onSelect();
    });

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenLastCalledWith("workspace-1", expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: null
      }));
    });
  });

  it("macOS 原生右键菜单点击使用本地应用程序打开会走镜像路径", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const openLocalAppItem = items.find((item: { label?: string }) => item.label === t("shell.affairsLibraryOpenWithLocalAppAction"));
    expect(openLocalAppItem).toBeTruthy();
    if (!openLocalAppItem || !("onSelect" in openLocalAppItem)) {
      throw new Error("未找到使用本地应用程序打开菜单项");
    }

    await act(async () => {
      await openLocalAppItem.onSelect();
    });

    expect(desktopBridgeMock.fs.openFile).toHaveBeenCalledWith("/Users/jackson/SynologyDrive/Exchange 分层通讯簿.txt");
  });

  it("文档库文件右键菜单点击删除后会先确认再删除", async () => {
    platformBridgeMock.supported = false;
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextPreview") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextOpen") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextLocate") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryOpenWithLocalAppAction") })).toBeInTheDocument();
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

  it("打开文档库设置后切换到其他事务分区时会关闭设置弹层", async () => {
    renderWorkbenchWithSectionMenu();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));
    expect(await screen.findByRole("dialog", { name: t("shell.affairsLibraryConfigTitle") })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("shell.affairsConversationNav") }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.affairsLibraryConfigTitle") })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: t("shell.affairsConversationNav") })).toHaveAttribute("aria-selected", "true");
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
    expect(dialogScope.getAllByRole("button", { name: "Codex" })).toHaveLength(2);
    expect(dialogScope.getAllByRole("button", { name: "Claude Code" })).toHaveLength(2);
    expect(dialogScope.queryByRole("button", { name: "Gemini" })).not.toBeInTheDocument();
    expect(dialogScope.queryByRole("button", { name: "Kimi" })).not.toBeInTheDocument();
  });

  it("事务轻量草稿发送首条消息后会走独立 lightweight runtime 并切到对话页面", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: null
    }, navigationGroupsWithBoundLibraryWorkspace);
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const lightweightSection = within(dialog).getByText("轻量模式").closest("section");
    expect(lightweightSection).not.toBeNull();
    await user.click(within(lightweightSection as HTMLElement).getByRole("button", { name: "Codex" }));

    expect(await screen.findByTestId("affairs-composer-send")).toBeInTheDocument();

    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(conversationApiMock.startAffairsLightweightSessionStream).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          provider: "codex",
          content: "请帮我查一下今天的事务重点"
        }),
        expect.any(Function)
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-1:");
    });
  });

  it("事务轻量会话联网搜索时会把工具调用和结果写进时间线", async () => {
    const user = userEvent.setup();
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, _payload, onEvent) => {
      await onEvent({
        type: "started",
        session: {
          sessionId: "session-light-tool-result",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-tool-result",
          rawStoreRef: "session-light-tool-result.json",
          title: "轻量搜索结果",
          messageCount: 1,
          lastMessageAt: "2026-06-02T10:00:00.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:00.000Z",
          syncStatus: "syncing",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        },
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-tool-result",
        userMessage: {
          messageId: "message-user-tool-result",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-tool-result",
          role: "user",
          kind: "text",
          content: "搜索今天关于 openai 的热点新闻",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-tool-result.json#client-request-tool-result"
        }
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-tool-result",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: "今天关于 openai 的热点新闻",
        output: null
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-tool-result",
        toolName: "web_search",
        status: "completed",
        detail: "已找到 2 条结果",
        input: "今天关于 openai 的热点新闻",
        output: JSON.stringify({
          detail: "已整理 2 条热点结果",
          query: "今天关于 openai 的热点新闻",
          sources: [
            { title: "OpenAI News 1", url: "https://example.com/openai-1" },
            { title: "OpenAI News 2", url: "https://example.com/openai-2" }
          ]
        })
      });
      await onEvent({
        type: "delta",
        delta: "这是整理后的摘要。"
      });

      return {
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-tool-result",
        userMessage: {
          messageId: "message-user-tool-result",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-tool-result",
          role: "user",
          kind: "text",
          content: "搜索今天关于 openai 的热点新闻",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-tool-result.json#client-request-tool-result"
        },
        assistantMessage: {
          messageId: "message-assistant-tool-result",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-tool-result",
          role: "assistant",
          kind: "text",
          content: "这是整理后的摘要。",
          attachments: [],
          timestamp: "2026-06-02T10:00:05.000Z",
          sequence: 3,
          rawRef: "session-light-tool-result.json#assistant-3"
        },
        session: {
          sessionId: "session-light-tool-result",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-tool-result",
          rawStoreRef: "session-light-tool-result.json",
          title: "轻量搜索结果",
          messageCount: 3,
          lastMessageAt: "2026-06-02T10:00:05.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:05.000Z",
          completedAt: "2026-06-02T10:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        },
        messages: []
      };
    });

    renderWorkbenchWithSectionMenu();

    await user.click(screen.getByRole("tab", { name: "对话" }));
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const lightweightSection = within(dialog).getByText("轻量模式").closest("section");
    expect(lightweightSection).not.toBeNull();
    await user.click(within(lightweightSection as HTMLElement).getByRole("button", { name: "Codex" }));
    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-tool-result:0");
    });
  });

  it("事务轻量会话联网搜索时会显示明显的实时状态条", async () => {
    const user = userEvent.setup();
    let releaseCompletion: (() => void) | null = null;
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, _payload, onEvent) => {
      await onEvent({
        type: "started",
        session: {
          sessionId: "session-light-pending",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-pending",
          rawStoreRef: "session-light-pending.json",
          title: "轻量对话",
          messageCount: 1,
          lastMessageAt: "2026-06-02T10:00:00.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:00.000Z",
          syncStatus: "syncing",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        },
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-pending",
        userMessage: {
          messageId: "message-user-pending",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-pending",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-pending.json#client-request-pending"
        }
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-pending",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: null,
        output: null
      });

      await new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      });

      return {
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-pending",
        userMessage: {
          messageId: "message-user-pending",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-pending",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-pending.json#client-request-pending"
        },
        assistantMessage: {
          messageId: "message-assistant-pending",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-pending",
          role: "assistant",
          kind: "text",
          content: "这是轻量回复",
          attachments: [],
          timestamp: "2026-06-02T10:00:05.000Z",
          sequence: 2,
          rawRef: "session-light-pending.json#assistant-2"
        },
        session: {
          sessionId: "session-light-pending",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-pending",
          rawStoreRef: "session-light-pending.json",
          title: "轻量对话",
          messageCount: 2,
          lastMessageAt: "2026-06-02T10:00:05.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:05.000Z",
          completedAt: "2026-06-02T10:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        },
        messages: []
      };
    });
    renderWorkbenchWithSectionMenu();

    await user.click(screen.getByRole("tab", { name: "对话" }));
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const lightweightSection = within(dialog).getByText("轻量模式").closest("section");
    expect(lightweightSection).not.toBeNull();
    await user.click(within(lightweightSection as HTMLElement).getByRole("button", { name: "Codex" }));

    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-pending:0");
    });
    expect(screen.getByTestId("affairs-composer-send")).toBeInTheDocument();
    releaseCompletion?.();
  });

  it("事务轻量会话切到别的分区再切回时，仍保留流式状态和消息", async () => {
    const user = userEvent.setup();
    let releaseCompletion: (() => void) | null = null;
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "session-light-switching",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          rawStoreRef: "session-light-switching.json",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "切页中的轻量对话",
          messageCount: 2,
          lastMessageAt: "2026-06-02T10:00:05.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:05.000Z",
          completedAt: "2026-06-02T10:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, _payload, onEvent) => {
      await onEvent({
        type: "started",
        session: {
          sessionId: "session-light-switching",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          rawStoreRef: "session-light-switching.json",
          title: "切页中的轻量对话",
          messageCount: 1,
          lastMessageAt: "2026-06-02T10:00:00.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:00.000Z",
          syncStatus: "syncing",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "running",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:00.000Z",
          completedAt: null,
          lastSeenAt: null,
          activityState: "running"
        },
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-switching",
        userMessage: {
          messageId: "message-user-switching",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-switching.json#client-request-switching"
        }
      });
      await onEvent({
        type: "tool",
        toolCallId: "search-switching",
        toolName: "web_search",
        status: "running",
        detail: "正在联网搜索",
        input: "今天的热点新闻",
        output: null
      });
      await onEvent({
        type: "delta",
        delta: "先给你整理中。"
      });

      await new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      });

      return {
        acceptedAt: "2026-06-02T10:00:00.000Z",
        clientRequestId: "client-request-switching",
        userMessage: {
          messageId: "message-user-switching",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: "2026-06-02T10:00:00.000Z",
          sequence: 1,
          rawRef: "session-light-switching.json#client-request-switching"
        },
        assistantMessage: {
          messageId: "message-assistant-switching",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          role: "assistant",
          kind: "text",
          content: "先给你整理中。",
          attachments: [],
          timestamp: "2026-06-02T10:00:05.000Z",
          sequence: 2,
          rawRef: "session-light-switching.json#assistant-2"
        },
        session: {
          sessionId: "session-light-switching",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-switching",
          rawStoreRef: "session-light-switching.json",
          title: "切页中的轻量对话",
          messageCount: 2,
          lastMessageAt: "2026-06-02T10:00:05.000Z",
          createdAt: "2026-06-02T10:00:00.000Z",
          updatedAt: "2026-06-02T10:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-02T10:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-02T10:00:05.000Z",
          completedAt: "2026-06-02T10:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        },
        messages: [
          {
            messageId: "message-user-switching",
            provider: "codex",
            providerSessionId: "affairs-lightweight:codex:session-light-switching",
            role: "user",
            kind: "text",
            content: "请帮我查一下今天的事务重点",
            attachments: [],
            timestamp: "2026-06-02T10:00:00.000Z",
            sequence: 1,
            rawRef: "session-light-switching.json#client-request-switching"
          },
          {
            messageId: "message-assistant-switching",
            provider: "codex",
            providerSessionId: "affairs-lightweight:codex:session-light-switching",
            role: "assistant",
            kind: "text",
            content: "先给你整理中。",
            attachments: [],
            timestamp: "2026-06-02T10:00:05.000Z",
            sequence: 2,
            rawRef: "session-light-switching.json#assistant-2"
          }
        ]
      };
    });

    renderWorkbenchWithSectionMenu();

    await user.click(screen.getByRole("tab", { name: "对话" }));
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const lightweightSection = within(dialog).getByText("轻量模式").closest("section");
    expect(lightweightSection).not.toBeNull();
    await user.click(within(lightweightSection as HTMLElement).getByRole("button", { name: "Codex" }));
    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-switching:0");
    });
    expect(screen.getByTestId("affairs-composer-send")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") }));
    await screen.findByText("Exchange 分层通讯簿.txt");
    await user.click(screen.getByRole("tab", { name: "对话" }));

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-switching:0");
    });
    expect(screen.getByTestId("affairs-composer-send")).toBeInTheDocument();

    releaseCompletion?.();
    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-switching:");
    });
  });


  it("事务 Agent 草稿发送首条消息后会复用共享 Butler runtime 并切到 Agent 会话", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithSectionMenu();

    await user.click(screen.getByRole("tab", { name: "对话" }));
    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const assistantSection = within(dialog).getByText("助手模式").closest("section");
    expect(assistantSection).not.toBeNull();
    await user.click(within(assistantSection as HTMLElement).getByRole("button", { name: "Codex" }));

    expect(await screen.findByTestId("affairs-composer-send")).toBeInTheDocument();

    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.switchProvider).toHaveBeenCalledWith("codex");
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("当前还没有选中事务对象")
      );
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("请帮我查一下今天的事务重点")
      );
    });
    expect(conversationApiMock.startAffairsLightweightSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("agent-session-1:0");
    });
  });

  it("新建 Agent 会话会切到文档库绑定工作区并同步 Butler workspacePath", async () => {
    const user = userEvent.setup();
    butlerRuntimeStateMock.setState({
      profile: {
        displayName: "事务助手",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        persona: {
          tone: "direct"
        }
      },
      activeProvider: "codex"
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: null
    }, navigationGroupsWithBoundLibraryWorkspace);

    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const assistantSection = within(dialog).getByText("助手模式").closest("section");
    expect(assistantSection).not.toBeNull();
    await user.click(within(assistantSection as HTMLElement).getByRole("button", { name: "Codex" }));

    await user.click((await screen.findAllByTestId("affairs-composer-send"))[0]);

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.constructedWorkspaceIds).toContain("workspace-2");
      expect(butlerRuntimeCallsMock.updateProfile).toHaveBeenCalledWith({
        workspacePath: "/Users/jackson/SynologyDrive"
      });
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalled();
    });
  });

  it("事务 Agent 首条消息会默认带上当前事务对象上下文", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "library",
      selectedNodeId: "library:all"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await user.click(card);
    await user.click(screen.getByRole("tab", { name: "对话" }));

    const conversationHeading = await screen.findByRole("heading", { name: "事务对话" });
    const conversationShell = conversationHeading.closest(".affairs-conversation-empty-state");
    expect(conversationShell).not.toBeNull();
    await user.click(within(conversationShell as HTMLElement).getByRole("button", { name: "新建对话" }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const assistantSection = within(dialog).getByText("助手模式").closest("section");
    expect(assistantSection).not.toBeNull();
    await user.click(within(assistantSection as HTMLElement).getByRole("button", { name: "Codex" }));
    await user.click((await screen.findAllByTestId("affairs-composer-send"))[0]);

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("当前事务对象：Exchange 分层通讯簿.txt")
      );
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("来源：Exchange 分层通讯簿.txt")
      );
    });
  });

  it("事务对话页切回历史 Agent 会话时会自动恢复对应的 Butler 会话", async () => {
    butlerApiMock.resumeButlerProjectSession.mockResolvedValue({
      resumed: {
        session: {
          id: "butler-session-history-1",
          projectId: "project-2",
          sessionId: "agent-history-1",
          provider: "claude-code",
          title: "历史 Agent 会话",
          isArchived: false,
          role: "adhoc",
          ownershipMode: "managed",
          status: "idle",
          runningState: "completed",
          lastSummary: null,
          lastCheckpointAt: null,
          createdAt: "2026-06-03T11:00:00.000Z",
          updatedAt: "2026-06-03T11:05:00.000Z"
        },
        resumedAt: "2026-06-03T11:05:00.000Z",
        provider: "claude-code",
        providerSessionId: "provider://claude-code/agent-history-1"
      }
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:agent:session:agent-history-1"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-history-1",
        provider: "claude-code",
        title: "历史 Agent 会话",
        rawStoreRef: "butler://butler-session-history-1",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T11:05:00.000Z",
        lastMessageAt: "2026-06-03T11:05:00.000Z",
        lastSyncAt: "2026-06-03T11:05:00.000Z",
        lastEventAt: "2026-06-03T11:05:00.000Z",
        completedAt: "2026-06-03T11:05:00.000Z"
      })
    ]));

    await waitFor(() => {
      expect(butlerApiMock.resumeButlerProjectSession).toHaveBeenCalledWith("project-2", "butler-session-history-1");
    });
  });

  it("事务对话页选中了已经不在当前快照里的 Agent 会话时，不会继续尝试恢复", async () => {
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:agent:session:agent-missing-1"
    }, createNavigationGroupsWithAgentSessions([]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(butlerApiMock.resumeButlerProjectSession).not.toHaveBeenCalled();
  });

  it("历史 Agent 会话列表只显示当前文档库绑定工作区的 CLI 会话", async () => {
    butlerRuntimeStateMock.setState({
      controlSession: {
        id: "control-session-other",
        providerId: "claude-code",
        sessionId: "agent-live-other",
        purpose: "chat",
        title: "其他工作区当前会话",
        sourceItemId: null,
        status: "idle",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: "2026-06-03T12:00:00.000Z",
        updatedAt: "2026-06-03T12:00:05.000Z",
        session: {
          sessionId: "agent-live-other",
          workspaceId: "workspace-1",
          provider: "claude-code",
          providerSessionId: "provider://claude-code/agent-live-other",
          rawStoreRef: "raw://claude-code/agent-live-other",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "其他工作区当前会话",
          messageCount: 1,
          lastMessageAt: "2026-06-03T12:00:05.000Z",
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:00:05.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:00:05.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:00:05.000Z",
          completedAt: "2026-06-03T12:00:05.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      }
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:agent:codex"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-current-1",
        title: "当前工作区 Agent 会话",
        rawStoreRef: "butler://butler-session-current-1",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T11:05:00.000Z",
        lastMessageAt: "2026-06-03T11:05:00.000Z",
        lastSyncAt: "2026-06-03T11:05:00.000Z",
        lastEventAt: "2026-06-03T11:05:00.000Z",
        completedAt: "2026-06-03T11:05:00.000Z"
      })
    ]));

    const conversationSidebar = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = conversationSidebar.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    await waitFor(() => {
      expect(within(sidebarSection as HTMLElement).getByText("当前工作区 Agent 会话")).toBeInTheDocument();
    });
    expect(within(sidebarSection as HTMLElement).queryByText("其他工作区 Agent 会话")).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText("其他工作区当前会话")).not.toBeInTheDocument();
  });

  it("事务对话侧栏会把轻量会话和 Agent 会话合并到同一份列表里", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "light-session-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-1",
          rawStoreRef: "raw://codex/light-session-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "事务轻量会话",
          messageCount: 3,
          lastMessageAt: "2026-06-03T12:48:00.000Z",
          createdAt: "2026-06-03T12:30:00.000Z",
          updatedAt: "2026-06-03T12:48:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:48:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:48:00.000Z",
          completedAt: "2026-06-03T12:48:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-session-merged-1",
        provider: "claude-code",
        title: "事务 Agent 会话",
        rawStoreRef: "butler://butler-session-merged-1",
        createdAt: "2026-06-03T09:00:00.000Z",
        updatedAt: "2026-06-03T09:16:00.000Z",
        lastMessageAt: "2026-06-03T09:16:00.000Z",
        lastSyncAt: "2026-06-03T09:16:00.000Z",
        lastEventAt: "2026-06-03T09:16:00.000Z",
        completedAt: "2026-06-03T09:16:00.000Z"
      })
    ]));

    expect(await screen.findByText("事务轻量会话")).toBeInTheDocument();
    expect(await screen.findByText("事务 Agent 会话")).toBeInTheDocument();

    const sidebar = document.querySelector(".affairs-sidebar-block");
    expect(sidebar).not.toBeNull();

    expect(sidebar?.querySelectorAll(".affairs-sidebar-group")).toHaveLength(1);
    expect(within(sidebar as HTMLElement).queryByText("当前准备创建的会话")).not.toBeInTheDocument();
    expect(within(sidebar as HTMLElement).queryByText("轻量会话")).not.toBeInTheDocument();
    expect(within(sidebar as HTMLElement).queryByText("Agent 会话")).not.toBeInTheDocument();
    expect(sidebar?.querySelectorAll(".affairs-conversation-session-card")).toHaveLength(2);
  });

  it("事务会话列表在网页端右键菜单会包含完整操作", async () => {
    mockAffairsConversationSidebarSessions();
    platformStateMock.platform = "web";
    platformStateMock.isDesktop = false;
    platformStateMock.isWeb = true;

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: t("shell.sessionMoreAction") });
    expect(within(menu).getByRole("button", { name: t("shell.renameAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("conversation.exportAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.favoriteAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.archiveAction") })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: t("shell.deleteSessionAction") })).toBeInTheDocument();
  });

  it("事务会话列表桌面端右键菜单会包含完整操作", async () => {
    mockAffairsConversationSidebarSessions();

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: t("shell.renameAction") }),
      expect.objectContaining({ label: t("conversation.exportAction") }),
      expect.objectContaining({ label: t("shell.favoriteAction") }),
      expect.objectContaining({ label: t("shell.archiveAction") }),
      expect.objectContaining({ label: t("shell.deleteSessionAction") })
    ]));
    const exportItem = items.find((entry: { label?: string }) => entry.label === t("conversation.exportAction"));
    expect(exportItem).toEqual(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ label: t("conversation.exportMarkdownAction") }),
        expect.objectContaining({ label: t("conversation.exportPdfAction") }),
        expect.objectContaining({ label: t("conversation.exportHtmlAction") })
      ])
    }));
  });

  it("事务会话列表收藏操作会更新卡片标记", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.updateAffairsLightweightSessionFavoriteState.mockResolvedValue({
      ...lightweightSession,
      isFavorite: true
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const favoriteItem = items.find((entry: { label?: string }) => entry.label === t("shell.favoriteAction"));
    expect(favoriteItem).toBeTruthy();
    if (!favoriteItem || !("onSelect" in favoriteItem)) {
      throw new Error("未找到收藏菜单项");
    }

    await act(async () => {
      await favoriteItem.onSelect();
    });

    expect(conversationApiMock.updateAffairsLightweightSessionFavoriteState).toHaveBeenCalledWith("workspace-1", "light-session-1", true);
    await waitFor(() => {
      expect((sessionCard as HTMLElement).querySelector(".affairs-conversation-favorite-badge")).not.toBeNull();
    });
  });

  it("事务会话列表归档操作后会从主列表移除会话", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.updateAffairsLightweightSessionArchiveState.mockResolvedValue({
      ...lightweightSession,
      isArchived: true
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const archiveItem = items.find((entry: { label?: string }) => entry.label === t("shell.archiveAction"));
    expect(archiveItem).toBeTruthy();
    if (!archiveItem || !("onSelect" in archiveItem)) {
      throw new Error("未找到归档菜单项");
    }

    await act(async () => {
      await archiveItem.onSelect();
    });

    expect(conversationApiMock.updateAffairsLightweightSessionArchiveState).toHaveBeenCalledWith("workspace-1", "light-session-1", true);
    await waitFor(() => {
      expect(screen.queryByText("事务轻量会话")).not.toBeInTheDocument();
    });
  });

  it("事务会话列表重命名操作会调用重命名接口", async () => {
    const { lightweightSession } = mockAffairsConversationSidebarSessions();
    conversationApiMock.renameAffairsLightweightSessionTitle.mockResolvedValue({
      ...lightweightSession,
      title: "已重命名会话"
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const renameItem = items.find((entry: { label?: string }) => entry.label === t("shell.renameAction"));
    expect(renameItem).toBeTruthy();
    if (!renameItem || !("onSelect" in renameItem)) {
      throw new Error("未找到重命名菜单项");
    }

    await act(async () => {
      await renameItem.onSelect();
    });

    const input = await screen.findByLabelText(t("shell.renameInputLabel"));
    await userEvent.clear(input);
    await userEvent.type(input, "已重命名会话");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(conversationApiMock.renameAffairsLightweightSessionTitle).toHaveBeenCalledWith("workspace-1", "light-session-1", "已重命名会话");
    });
    expect(await screen.findByText("已重命名会话")).toBeInTheDocument();
  });

  it("事务会话列表删除操作会调用删除接口", async () => {
    mockAffairsConversationSidebarSessions();
    conversationApiMock.deleteAffairsLightweightSession.mockResolvedValue(undefined);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const deleteItem = items.find((entry: { label?: string }) => entry.label === t("shell.deleteSessionAction"));
    expect(deleteItem).toBeTruthy();
    if (!deleteItem || !("onSelect" in deleteItem)) {
      throw new Error("未找到删除菜单项");
    }

    await act(async () => {
      await deleteItem.onSelect();
    });

    expect(await screen.findByText(t("shell.deleteSessionConfirmDescription"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("shell.deleteSessionAction") }));

    await waitFor(() => {
      expect(conversationApiMock.deleteAffairsLightweightSession).toHaveBeenCalledWith("workspace-1", "light-session-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("事务轻量会话")).not.toBeInTheDocument();
    });
  });

  it("事务会话列表导出操作会调用消息加载接口", async () => {
    mockAffairsConversationSidebarSessions();
    conversationApiMock.getAffairsLightweightSessionMessages.mockResolvedValue({ messages: [], cursor: null, nextCursor: null, total: 0 });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const sessionCard = (await screen.findByText("事务轻量会话")).closest(".affairs-conversation-session-card");
    expect(sessionCard).not.toBeNull();

    fireEvent.contextMenu(sessionCard as HTMLElement, { clientX: 240, clientY: 180 });

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const items = showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
    const exportItem = items.find((entry: { label?: string; items?: Array<{ label?: string; onSelect?: () => void | Promise<void> }> }) => entry.label === t("conversation.exportAction"));
    expect(exportItem).toBeTruthy();
    const markdownItem = exportItem?.items?.find((entry) => entry.label === t("conversation.exportMarkdownAction"));
    expect(markdownItem).toBeTruthy();
    if (!markdownItem || !("onSelect" in markdownItem)) {
      throw new Error("未找到导出 markdown 菜单项");
    }

    await act(async () => {
      await markdownItem.onSelect?.();
    });

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLightweightSessionMessages).toHaveBeenCalledWith("workspace-1", "light-session-1");
    });
  });


  it("事务模式未初始化时切到自动化分区也不会被强制打回对话初始化页", async () => {
    butlerApiMock.listAssistantAutomations.mockResolvedValue({ payload: { items: [] } });
    butlerApiMock.listRecentAssistantAutomationRuns.mockResolvedValue({ payload: { items: [] } });
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

    expect(await screen.findByRole("tab", { name: "自动化" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(t("shell.affairsAutomationEmpty")).length).toBeGreaterThan(0);
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).not.toBeDisabled();
    expect(screen.getByRole("tab", { name: "待办" })).not.toBeDisabled();
    expect(screen.getByRole("tab", { name: "自动化" })).not.toBeDisabled();
  });

  it("事务模式未初始化时刷新到文档页会直接显示文档内容", async () => {
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

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务连不上时文档主区也不会被不可用页接管", async () => {
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

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务返回无效响应时文档主区也不会被不可用页接管", async () => {
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

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务连接检查中时文档主区仍然直接显示文档内容", async () => {
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

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("文档库视图正常显示时，右侧辅助面板不会再显示事务连接检查占位", async () => {
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

    renderWorkbenchWithState({
      ...createState(),
      primarySection: "library",
      auxiliaryTab: "detail",
      selectedNodeId: "library:folder:root"
    });

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingDescription"))).not.toBeInTheDocument();
  });

  it("文档首页初次渲染时不会提前预热事务对话列表，切到对话后才开始加载", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithState(createState());

    await screen.findByText("Exchange 分层通讯簿.txt");

    expect(conversationApiMock.listAffairsLightweightSessions).not.toHaveBeenCalled();
    expect(butlerApiMock.listButlerProjects).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "对话" }));

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLightweightSessions).toHaveBeenCalledWith("workspace-1");
    });
    expect(butlerApiMock.listButlerProjects).not.toHaveBeenCalled();
  });

  it("事务对话侧栏已有轻量会话时，不会继续被助手会话加载占位挡住", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({
      items: [
        {
          sessionId: "light-session-visible-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-visible-1",
          rawStoreRef: "raw://codex/light-session-visible-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "事务轻量会话",
          messageCount: 3,
          lastMessageAt: "2026-06-03T12:48:00.000Z",
          createdAt: "2026-06-03T12:30:00.000Z",
          updatedAt: "2026-06-03T12:48:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:48:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:48:00.000Z",
          completedAt: "2026-06-03T12:48:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroups);

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(await within(sidebarSection as HTMLElement).findByText("事务轻量会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("common.loading"))).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("shell.affairsConversationSidebarLoadingAgent"))).not.toBeInTheDocument();
  });

  it("事务对话刷新时会先显示缓存的轻量会话标题，再后台刷新更新", async () => {
    writeViewSnapshot("affairs.conversation.lightweight.sessions.workspace-1", [
      {
        sessionId: "light-session-cached-1",
        workspaceId: "workspace-1",
        provider: "codex",
        providerSessionId: "provider://codex/light-session-cached-1",
        rawStoreRef: "raw://codex/light-session-cached-1",
        providerConfigMode: "global-default",
        providerPresetId: null,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "缓存轻量会话",
        messageCount: 2,
        lastMessageAt: "2026-06-03T12:40:00.000Z",
        createdAt: "2026-06-03T12:10:00.000Z",
        updatedAt: "2026-06-03T12:40:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-06-03T12:40:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-03T12:40:00.000Z",
        completedAt: "2026-06-03T12:40:00.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      }
    ]);
    let resolveLightweightSessions: ((value: { items: Array<unknown> }) => void) | null = null;
    conversationApiMock.listAffairsLightweightSessions.mockImplementation(
      () => new Promise((resolve) => {
        resolveLightweightSessions = resolve;
      })
    );
    butlerApiMock.listButlerProjects.mockResolvedValue({ items: [] });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroups);

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(within(sidebarSection as HTMLElement).getByText("缓存轻量会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).getByText(t("shell.affairsConversationSidebarLoadingLightweight"))).toBeInTheDocument();

    resolveLightweightSessions?.({
      items: [
        {
          sessionId: "light-session-fresh-1",
          workspaceId: "workspace-1",
          provider: "codex",
          providerSessionId: "provider://codex/light-session-fresh-1",
          rawStoreRef: "raw://codex/light-session-fresh-1",
          providerConfigMode: "global-default",
          providerPresetId: null,
          parentSessionId: null,
          isSubagent: false,
          subagentLabel: null,
          isArchived: false,
          isFavorite: false,
          title: "刷新后的轻量会话",
          messageCount: 3,
          lastMessageAt: "2026-06-03T12:58:00.000Z",
          createdAt: "2026-06-03T12:50:00.000Z",
          updatedAt: "2026-06-03T12:58:00.000Z",
          syncStatus: "idle",
          syncCursor: null,
          lastSyncAt: "2026-06-03T12:58:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: "completed",
          activitySource: "runtime",
          lastEventAt: "2026-06-03T12:58:00.000Z",
          completedAt: "2026-06-03T12:58:00.000Z",
          lastSeenAt: null,
          activityState: "completed_unread"
        }
      ]
    });

    await waitFor(() => {
      expect(within(sidebarSection as HTMLElement).getByText("刷新后的轻量会话")).toBeInTheDocument();
    });
    expect(within(sidebarSection as HTMLElement).queryByText("缓存轻量会话")).not.toBeInTheDocument();
  });

  it("事务对话刷新时会先显示缓存的助手会话标题，不再等实时检索完成", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({ items: [] });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:agent:codex"
    }, createNavigationGroupsWithAgentSessions([
      createAgentSnapshotSession({
        sessionId: "agent-session-cached-1",
        title: "缓存助手会话",
        rawStoreRef: "butler://agent-session-cached-1"
      })
    ]));

    const sidebarHeading = await screen.findByRole("heading", { name: "对话" });
    const sidebarSection = sidebarHeading.closest(".affairs-sidebar-block");
    expect(sidebarSection).not.toBeNull();
    expect(within(sidebarSection as HTMLElement).getByText("缓存助手会话")).toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("shell.affairsConversationSidebarLoadingAgent"))).not.toBeInTheDocument();
    expect(within(sidebarSection as HTMLElement).queryByText(t("common.loading"))).not.toBeInTheDocument();
  });

  it("进入事务对话时不会重复请求 Butler 项目列表", async () => {
    conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({ items: [] });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex"
    }, navigationGroups);

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLightweightSessions).toHaveBeenCalledWith("workspace-1");
    });
    expect(butlerApiMock.listButlerProjects).not.toHaveBeenCalled();
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

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingTitle"))).not.toBeInTheDocument();

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
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).toHaveAttribute("aria-selected", "true");
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
        errorSummary: null,
        progress: {
          scannedCount: 12,
          indexedCount: 3,
          unchangedCount: 8,
          skippedCount: 1,
          failedCount: 0,
          totalCount: null,
          maxConcurrency: 1
        }
      }
    }));

    renderWorkbench();

    const indicator = await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusRunning") })
    });

    await userEvent.hover(indicator);

    expect(screen.getByText(t("shell.affairsLibraryStatusIndicatorProgress", { scanned: 12 }))).toBeInTheDocument();
    expect(await screen.findByText(t("shell.affairsLibraryStatusRunningStageLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusStageIncrementalIndex"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusProgressScannedLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusProgressUnchangedLabel"))).toBeInTheDocument();
  });

  it("索引状态指示灯会显示细分导出阶段", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValueOnce(createLibrarySnapshot({
      status: {
        state: "running",
        dirtyReasons: ["periodic_refresh"],
        lastRequestedAt: "2026-06-03T09:39:15.000Z",
        lastStartedAt: "2026-06-03T09:39:15.000Z",
        lastCompletedAt: null,
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: "task-export-search",
        runningStage: "export_search",
        errorSummary: null
      }
    }));

    renderWorkbench();

    const indicator = await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusRunning") })
    });

    await userEvent.hover(indicator);

    expect(await screen.findByText(t("shell.affairsLibraryStatusRunningStageLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusStageExportSearch"))).toBeInTheDocument();
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

  it("详情区在有镜像路径时会提供本地文件动作，并显示完整元信息", async () => {
    renderWorkbench();

    const button = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsLibraryRevealLocalFileAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsLibraryLocateFolderAction") })).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryDocumentCreatedAt"), { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryDocumentSize"), { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    const expectedCreatedAt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date("2026-05-30T08:00:00.000Z"));
    const expectedUpdatedAt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date("2026-05-31T08:00:00.000Z"));
    const detailBlock = document.querySelector(".affairs-detail-meta-list") as HTMLElement | null;
    expect(detailBlock?.textContent).toContain(expectedCreatedAt);
    expect(detailBlock?.textContent).toContain(expectedUpdatedAt);

    const bridge = getCodingNSDesktopBridge();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") }));

    expect(bridge.fs.openFile).toHaveBeenCalledWith("/Users/jackson/SynologyDrive/Exchange 分层通讯簿.txt");
  });

  it("详情区在没有镜像路径时会隐藏本地文件动作", async () => {
    conversationApiMock.getAffairsLibraryConfig.mockResolvedValueOnce({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: null,
        allowedExtensions: [],
        includedHiddenPaths: [],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: null,
      allowedExtensions: [],
      includedHiddenPaths: [],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse([
      {
        documentId: "doc-1",
        path: "Exchange 分层通讯簿.txt",
        title: "Exchange 分层通讯簿",
        summary: "第一行\n第二行\n第三行\n第四行",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbench();

    const button = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.click(button);

    expect(screen.queryByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsLibraryRevealLocalFileAction") })).not.toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryMirrorRootEmpty"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsDocumentSummaryExpandAction") })).toBeInTheDocument();
  });

  it("详情区文档路径支持逐级点击跳转", async () => {
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse([
      {
        documentId: "doc-1",
        path: "客户/合同/Exchange 分层通讯簿.txt",
        title: "Exchange 分层通讯簿",
        summary: "第一行\n第二行\n第三行\n第四行",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    const { container } = renderWorkbenchWithState({
      ...createState(),
      selectedFolderPath: "客户/合同"
    });

    const button = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.click(button);

    const detailPathButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".affairs-detail-path-segment"));
    const customerPathButton = detailPathButtons.find((item) => item.textContent?.trim() === "客户");
    expect(customerPathButton).toBeTruthy();
    await userEvent.click(customerPathButton!);

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: "客户"
      }));
    });
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
      documentCount: 0,
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
    expect(await within(dialog).findByRole("button", { name: "客户/合同" })).toBeInTheDocument();

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

    const tagTreeButton = within(dialog).getByRole("button", { name: "客户/合同" });
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
    await userEvent.click(screen.getByRole("button", { name: "客户/中电绿能科技有限公司" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "客户/售前" }));
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

  it("标签管理模态框点击标签后直接进入编辑，并在详情区显示文档数量", async () => {
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

    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsTagManagerAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagManagerTitle") });
    expect(within(dialog).queryByText(t("shell.affairsTagBatchSectionTitle"))).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.affairsTagManagerDescription"))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.affairsTagEditorEditDescription"))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.affairsTagSmartRulesSectionDescription"))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.affairsTagRecoveryCleanHint"))).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "客户/合同" }));

    expect(await within(dialog).findByText(t("shell.affairsTagEditorEditTitle"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.affairsTagEditorPathLabel"))).toBeInTheDocument();
    expect(within(dialog).getByText("客户/合同")).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.affairsTagEditorDocumentCountLabel"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.affairsTagTreeDocumentCount", { count: 1 }))).toBeInTheDocument();
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
    expect(within(dialog).queryByText(t("shell.affairsTagRecoveryPendingHint", { documents: 3 }))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("shell.affairsTagRecoveryRunningHint"))).not.toBeInTheDocument();
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

  it("文档标签请求提交后会立刻显示右上角进度入口", async () => {
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
    let resolveSave: ((value: {
      target: { type: "document"; documentId: string };
      items: [];
      refreshTask: { taskId: string; deduped: boolean; affectedPaths: string[] } | null;
    }) => void) | null = null;
    conversationApiMock.saveAffairsDocumentTags.mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    renderWorkbench();

    await userEvent.click(await screen.findByText("Exchange 分层通讯簿.txt"));
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "合同");
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));

    expect(await screen.findByRole("button", {
      name: t("shell.affairsTagTaskHistoryButtonLabel", {
        count: 1,
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        target: "Exchange 分层通讯簿",
        status: t("shell.affairsFolderTagTaskStatusQueued"),
        percent: 0,
      })
    })).toBeInTheDocument();

    resolveSave?.({
      target: { type: "document", documentId: "doc-1" },
      items: [],
      refreshTask: {
        taskId: "task-doc-1",
        deduped: false,
        affectedPaths: ["Exchange 分层通讯簿.txt"]
      }
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

    await userEvent.click((await screen.findAllByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }))[0]);
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
      name: t("shell.affairsTagTaskHistoryButtonLabel", {
        count: 1,
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        target: t("shell.affairsLibraryDirectoryStatusRootPath"),
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

    await userEvent.click((await screen.findAllByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }))[0]);
    const tagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(tagInput, "合同");
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));

    expect(await screen.findByRole("button", {
      name: t("shell.affairsTagTaskHistoryButtonLabel", {
        count: 1,
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        target: t("shell.affairsLibraryDirectoryStatusRootPath"),
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

  it("右上角标签任务入口可以展开最近一次标签任务记录", async () => {
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
    conversationApiMock.saveAffairsDocumentTags.mockResolvedValue({
      target: { type: "document", documentId: "doc-1" },
      items: [],
      refreshTask: {
        taskId: "task-doc-1",
        deduped: false,
        affectedPaths: ["Exchange 分层通讯簿.txt"]
      }
    });
    conversationApiMock.getAffairsDocumentTagTask.mockResolvedValue({
      taskId: "task-doc-1",
      taskType: "affairs.library_tag_apply_bindings",
      key: "workspace-1:doc:doc-1",
      executionLane: "helper_process",
      status: "running",
      source: "affairs_tag.save_document_bindings",
      attempt: 1,
      enqueuedAt: Date.now() - 1000,
      startedAt: Date.now() - 900,
      finishedAt: null,
      timeoutMs: 30000,
      progress: {
        phase: "recompute",
        label: "正在应用文档标签",
        detail: "1 / 1",
        current: 1,
        total: 1,
        percent: 60,
        updatedAt: Date.now(),
      }
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

    await userEvent.click(await screen.findByText("Exchange 分层通讯簿.txt"));
    const documentTagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(documentTagInput, "合同");
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));

    await userEvent.click((await screen.findAllByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }))[0]);
    const folderTagInput = await screen.findByPlaceholderText(t("shell.affairsTagQuickSearchPlaceholder"));
    await userEvent.type(folderTagInput, "合同");
    await userEvent.click(await screen.findByRole("button", { name: "客户/合同" }));

    const historyButton = await screen.findByRole("button", {
      name: t("shell.affairsTagTaskHistoryButtonLabel", {
        count: 2,
        operation: t("shell.affairsFolderTagTaskOperationAttach"),
        target: t("shell.affairsLibraryDirectoryStatusRootPath"),
        status: t("shell.affairsFolderTagTaskStatusRunning"),
        percent: 29,
      })
    });
    await userEvent.click(historyButton);

    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagTaskHistoryTitle") });
    expect(within(dialog).getByText("Exchange 分层通讯簿")).toBeInTheDocument();
    expect(within(dialog).getAllByText(t("shell.affairsLibraryDirectoryStatusRootPath")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(t("shell.affairsTagTaskDocumentLabel"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("shell.affairsFolderTagTaskFolderLabel"))).toBeInTheDocument();
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

    await userEvent.click((await screen.findAllByRole("button", { name: t("shell.affairsLibraryFolderRootLabel") }))[0]);
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
