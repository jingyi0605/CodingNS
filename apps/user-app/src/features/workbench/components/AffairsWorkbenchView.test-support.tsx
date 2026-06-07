// @ts-nocheck
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, vi } from "vitest";

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
  initialize: vi.fn(),
  openControlSession: vi.fn(),
  switchProvider: vi.fn(),
  startFreshSession: vi.fn(),
  sendMessage: vi.fn(),
  updateProfile: vi.fn(),
  replyPermissionRequest: vi.fn(),
  interrupt: vi.fn(),
  loadOlderMessages: vi.fn(),
  retryMessage: vi.fn()
}));

const butlerControlSessionsCatalogMock = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    providerId: string;
    sessionId: string;
    purpose: string;
    title: string | null;
    sourceItemId: string | null;
    status: "idle" | "running" | "failed" | "closed";
    lastContextVersion: string | null;
    lastSummary: string | null;
    createdAt: string;
    updatedAt: string;
    session: {
      sessionId: string;
      workspaceId: string;
      provider: string;
      providerSessionId: string;
      rawStoreRef: string;
      providerConfigMode: "global-default";
      providerPresetId: null;
      parentSessionId: null;
      isSubagent: false;
      subagentLabel: null;
      isArchived: false;
      isFavorite: boolean;
      title: string;
      messageCount: number;
      lastMessageAt: string | null;
      createdAt: string;
      updatedAt: string;
      syncStatus: "idle";
      syncCursor: null;
      lastSyncAt: string | null;
      lastErrorCode: null;
      lastErrorDetail: null;
      resumedAt: string | null;
      runningState: string;
      activitySource: string;
      lastEventAt: string | null;
      completedAt: string | null;
      lastSeenAt: string | null;
      activityState: string;
    };
  }>
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
      butlerRuntimeCallsMock.initialize.mockReset();
      butlerRuntimeCallsMock.openControlSession.mockReset();
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
  getAffairsAssistantSessionsSnapshot: vi.fn(),
  getAffairsLightweightSession: vi.fn(),
  getAffairsLightweightSessionMessages: vi.fn(),
  getGlobalAffairsDashboardState: vi.fn(),
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
  listAffairsLibraryFiles: vi.fn(),
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
  updateGlobalAffairsDashboardState: vi.fn(),
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
    getAffairsAssistantSessionsSnapshot: conversationApiMock.getAffairsAssistantSessionsSnapshot,
    getAffairsLightweightSession: conversationApiMock.getAffairsLightweightSession,
    getAffairsLightweightSessionMessages: conversationApiMock.getAffairsLightweightSessionMessages,
    getGlobalAffairsDashboardState: conversationApiMock.getGlobalAffairsDashboardState,
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
    listAffairsLibraryFiles: conversationApiMock.listAffairsLibraryFiles,
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
    updateGlobalAffairsDashboardState: conversationApiMock.updateGlobalAffairsDashboardState,
    updateGlobalAffairsLibraryFavorites: conversationApiMock.updateGlobalAffairsLibraryFavorites
  };
});

const butlerApiMock = vi.hoisted(() => ({
  getButlerSessionTarget: vi.fn(),
  listAssistantAutomations: vi.fn().mockResolvedValue({ items: [] }),
  listButlerControlSessions: vi.fn(async () => ({ items: butlerControlSessionsCatalogMock.items })),
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
  listButlerControlSessions: butlerApiMock.listButlerControlSessions,
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
      butlerRuntimeCallsMock.initialize();
      butlerRuntimeStateMock.emit();
    }

    async openControlSession(controlSessionId: string) {
      butlerRuntimeCallsMock.openControlSession(controlSessionId);
      const matchedControlSession = butlerControlSessionsCatalogMock.items.find((item) => item.id === controlSessionId) ?? null;
      if (matchedControlSession) {
        butlerRuntimeStateMock.setState({
          controlSession: matchedControlSession,
          activeProvider: matchedControlSession.providerId,
          historyState: "ready",
          loading: false,
          initialized: true
        });
        return;
      }
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

export const navigationGroups: WorkspaceSessionGroup[] = [
  {
    workspace: {
      id: "workspace-1",
      name: "事务工作区",
      path: "/tmp/workspace-1",
      repoRoot: "/tmp/workspace-1"
    },
    sessions: [],
    childWorktrees: []
  }
];

export const navigationGroupsWithBoundLibraryWorkspace: WorkspaceSessionGroup[] = [
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

export function createState(): AffairsViewState {
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
    librarySort: {
      mode: "recent",
      direction: "desc"
    },
    selectedFolderPath: null,
    selectedTagPath: null,
    selectedTagPaths: [],
    selectedDocumentId: null,
    selectedFavoriteId: null
  };
}

export function createAgentSnapshotSession(overrides: Partial<any> = {}) {
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

export function createNavigationGroupsWithAgentSessions(
  sessions: ReturnType<typeof createAgentSnapshotSession>[]
): WorkspaceSessionGroup[] {
  conversationApiMock.getAffairsAssistantSessionsSnapshot.mockResolvedValue({
    item: {
      projectId: "project-2",
      projectWorkspaceId: "workspace-2",
      agentWorkspacePath: "/Users/jackson/SynologyDrive",
      sessions,
      updatedAt: "2026-06-03T13:10:00.000Z"
    }
  });
  return navigationGroupsWithBoundLibraryWorkspace;
}

export function createConversationState(): AffairsViewState {
  return {
    ...createState(),
    primarySection: "conversation",
    selectedNodeId: "conversation:draft:lightweight:codex"
  };
}

export function createLibrarySnapshot(overrides?: Partial<ReturnType<typeof baseLibrarySnapshot>>) {
  return {
    ...baseLibrarySnapshot(),
    ...overrides
  };
}

export function baseLibrarySnapshot() {
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

export function createDocumentListResponse(items?: Array<Record<string, unknown>>) {
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

export function createIsoForLocalDay(dayOffset: number, hour: number, minute: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0).toISOString();
}

export function renderWorkbench() {
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

export function renderWorkbenchWithSectionMenu() {
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

export function renderWorkbenchWithState(initialState: AffairsViewState) {
  return renderWorkbenchWithCustomNavigationGroups(initialState, navigationGroups);
}

export function renderWorkbenchWithCustomNavigationGroups(initialState: AffairsViewState, groups: WorkspaceSessionGroup[]) {
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

export async function findAffairsGridViewport(): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector(".affairs-doc-grid-viewport");

    if (!(element instanceof HTMLElement)) {
      throw new Error("未找到事务文档网格视口");
    }

    return element;
  });
}

export function openDesktopContextMenu(target: HTMLElement, coordinates: { clientX: number; clientY: number }) {
  fireEvent.contextMenu(target, coordinates);
  expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
  return showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
}

export function findTagTreeNode(label: string) {
  const tree = screen.getByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
  const labelNode = within(tree).queryAllByText(label).find((node) => node.classList.contains("affairs-sidebar-item-title"));
  return labelNode?.closest(".affairs-tag-tree-node") ?? null;
}

export function mockAffairsConversationSidebarSessions() {
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
  clearViewSnapshot("workbench.affairs.dashboard.affairs-global");
  clearViewSnapshot("workbench.affairs.dashboard.workspace-1");
  window.localStorage.removeItem("codingns.affairs.tag-tree.state.workspace-1");
  window.sessionStorage.clear();
  clearProviderCatalogStore();
  clearSessionProviderPickerCapabilityCache();

  conversationApiMock.listAffairsLightweightSessions.mockReset();
  conversationApiMock.getAffairsAssistantSessionsSnapshot.mockReset();
  conversationApiMock.getAffairsLightweightSession.mockReset();
  conversationApiMock.getAffairsLightweightSessionMessages.mockReset();
  conversationApiMock.getGlobalAffairsDashboardState.mockReset();
  conversationApiMock.getGlobalAffairsDashboardState.mockResolvedValue({ dashboardState: {} });
  conversationApiMock.getSessionMessages.mockResolvedValue({ messages: [], nextCursor: null });
  conversationApiMock.getAffairsLibrarySnapshot.mockReset();
  conversationApiMock.getGlobalAffairsLibraryBinding.mockReset();
  conversationApiMock.getProviderCapabilities.mockReset();
  conversationApiMock.listAffairsLibraryFiles.mockReset();
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
  conversationApiMock.updateGlobalAffairsDashboardState.mockReset();
  conversationApiMock.updateGlobalAffairsDashboardState.mockImplementation(async (payload) => ({
    dashboardState: payload.dashboardState
  }));
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
  conversationApiMock.getAffairsAssistantSessionsSnapshot.mockResolvedValue({
    item: {
      projectId: "project-2",
      projectWorkspaceId: "workspace-2",
      agentWorkspacePath: "/Users/jackson/SynologyDrive",
      sessions: [],
      updatedAt: "2026-06-03T10:00:00.000Z"
    }
  });
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
    ],
    recommendedTags: []
  });
  conversationApiMock.getAffairsDocumentTagTask.mockResolvedValue(null);
  conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
    folderPath: "AGENTS",
    exists: true,
    bindingTagIds: [],
    bindings: [],
    recommendedTags: []
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

  conversationApiMock.listAffairsLibraryFiles.mockResolvedValue({ items: [] });
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
    version: "affairs-preview-v1",
    size: 24,
    updatedAt: "2026-05-31T08:00:00.000Z",
    previewPath: null,
    previewUrl: null,
    capabilities: {
      canEdit: true,
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

export { butlerApiMock, butlerRuntimeStateMock, conversationApiMock, platformStateMock, showDesktopContextMenuMock, t, writeViewSnapshot, butlerControlSessionsCatalogMock, butlerRuntimeCallsMock, useButlerRuntimeStoreMock, AffairsAuxiliaryPanel, AffairsSectionMenu, AffairsSidebarPanel, AffairsWorkbenchProvider, AffairsWorkbenchView, render, userPreferenceStore };
