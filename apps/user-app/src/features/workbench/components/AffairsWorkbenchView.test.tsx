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
import type { HistoryMessageDto, SessionSummaryDto } from "../../conversation/api/conversation-api";
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
import { createAffairsDashboardWidgetState, createAffairsShortcutAppState, createDefaultAffairsDashboardState } from "../utils/affairs-dashboard-state";

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
const showToastMock = vi.hoisted(() => vi.fn(() => "toast-test-id"));
const composerPanelRenderMock = vi.hoisted(() => vi.fn());

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
  getGlobalAffairsLibraryBinding: vi.fn(),
  getGlobalAffairsDashboardState: vi.fn(),
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

const fileContextApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn(),
  getFilePreviewLink: vi.fn(),
  getFileTree: vi.fn()
}));

const workspaceBridgeApiMock = vi.hoisted(() => ({
  listWorkspaceBridgeDir: vi.fn()
}));

const htmlPreviewBridgeMock = vi.hoisted(() => ({
  createHtmlPreviewWorkspaceBridge: vi.fn(() => ({
    onMessage: vi.fn(),
    dispose: vi.fn()
  }))
}));

const teableRuntimeApiMock = vi.hoisted(() => ({
  listTeableRuntimeTables: vi.fn(),
  listTeableRuntimeViews: vi.fn(),
  listTeableRuntimeFields: vi.fn(),
  listTeableRuntimeRecords: vi.fn(),
  createTeableRuntimeRecord: vi.fn(),
  updateTeableRuntimeRecord: vi.fn(),
  deleteTeableRuntimeRecords: vi.fn(),
  listTeableLinkedRecordOptions: vi.fn()
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
    getGlobalAffairsLibraryBinding: conversationApiMock.getGlobalAffairsLibraryBinding,
    getGlobalAffairsDashboardState: conversationApiMock.getGlobalAffairsDashboardState,
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
  listAssistantAutomations: vi.fn().mockResolvedValue({ payload: { items: [] } }),
  listButlerControlSessions: vi.fn(async () => ({ items: butlerControlSessionsCatalogMock.items })),
  listButlerFollowUpTasks: vi.fn().mockResolvedValue({ items: [] }),
  listButlerInboxItems: vi.fn().mockResolvedValue({ items: [] }),
  listButlerProjectSessions: vi.fn(),
  listButlerProjects: vi.fn(),
  listRecentAssistantAutomationRuns: vi.fn().mockResolvedValue({ payload: { items: [] } }),
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
  ComposerPanel: ({
    onSend,
    isSubmitting,
    capabilities
  }: {
    onSend?: (content: string) => Promise<void>;
    isSubmitting?: boolean;
    capabilities?: { supportsAttachments?: boolean };
  }) => {
    composerPanelRenderMock(capabilities);
    return (
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
    );
  }
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

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: showToastMock,
    dismissToast: vi.fn()
  })
}));

vi.mock("../../conversation/api/file-context-api", () => ({
  getFilePreview: fileContextApiMock.getFilePreview,
  saveFileContent: fileContextApiMock.saveFileContent,
  getFilePreviewLink: fileContextApiMock.getFilePreviewLink,
  getFileTree: fileContextApiMock.getFileTree
}));

vi.mock("../../../platform/preview/codingns-workspace-bridge", () => ({
  listWorkspaceBridgeDir: workspaceBridgeApiMock.listWorkspaceBridgeDir
}));

vi.mock("../../../platform/preview/html-preview-workspace-bridge", () => ({
  createHtmlPreviewWorkspaceBridge: htmlPreviewBridgeMock.createHtmlPreviewWorkspaceBridge
}));

vi.mock("../teable/api/teable-runtime-api", async () => {
  const actual = await vi.importActual<object>("../teable/api/teable-runtime-api");
  return {
    ...actual,
    listTeableRuntimeTables: teableRuntimeApiMock.listTeableRuntimeTables,
    listTeableRuntimeViews: teableRuntimeApiMock.listTeableRuntimeViews,
    listTeableRuntimeFields: teableRuntimeApiMock.listTeableRuntimeFields,
    listTeableRuntimeRecords: teableRuntimeApiMock.listTeableRuntimeRecords,
    createTeableRuntimeRecord: teableRuntimeApiMock.createTeableRuntimeRecord,
    updateTeableRuntimeRecord: teableRuntimeApiMock.updateTeableRuntimeRecord,
    deleteTeableRuntimeRecords: teableRuntimeApiMock.deleteTeableRuntimeRecords,
    listTeableLinkedRecordOptions: teableRuntimeApiMock.listTeableLinkedRecordOptions
  };
});

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
    childWorktrees: []
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
    librarySort: {
      mode: "recent",
      direction: "desc"
    },
    selectedFolderPath: null,
    selectedFolderEntryPath: null,
    selectedTagPath: null,
    selectedTagPaths: [],
    selectedDocumentId: null,
    selectedFavoriteId: null
  };
}

function createAgentSnapshotSession(overrides: Partial<SessionSummaryDto> = {}) {
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

function createButlerControlSession(
  overrides: Partial<typeof butlerControlSessionsCatalogMock.items[number]> = {}
) {
  const sessionId = overrides.session?.sessionId ?? overrides.sessionId ?? "agent-session-1";
  const providerId = overrides.providerId ?? "codex";
  const title = overrides.session?.title ?? overrides.title ?? "Agent 对话";
  return {
    id: overrides.id ?? "control-session-1",
    providerId,
    sessionId,
    purpose: overrides.purpose ?? "chat",
    title,
    sourceItemId: overrides.sourceItemId ?? null,
    status: overrides.status ?? "idle",
    lastContextVersion: overrides.lastContextVersion ?? null,
    lastSummary: overrides.lastSummary ?? null,
    createdAt: overrides.createdAt ?? "2026-06-03T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-03T12:08:00.000Z",
    session: {
      sessionId,
      workspaceId: overrides.session?.workspaceId ?? "workspace-2",
      provider: overrides.session?.provider ?? providerId,
      providerSessionId: overrides.session?.providerSessionId ?? `provider://${providerId}/${sessionId}`,
      rawStoreRef: overrides.session?.rawStoreRef ?? `raw://${providerId}/${sessionId}`,
      providerConfigMode: "global-default" as const,
      providerPresetId: null,
      parentSessionId: null,
      isSubagent: false,
      subagentLabel: null,
      isArchived: false,
      isFavorite: false,
      title,
      messageCount: overrides.session?.messageCount ?? 2,
      lastMessageAt: overrides.session?.lastMessageAt ?? "2026-06-03T12:08:00.000Z",
      createdAt: overrides.session?.createdAt ?? "2026-06-03T12:00:00.000Z",
      updatedAt: overrides.session?.updatedAt ?? "2026-06-03T12:08:00.000Z",
      syncStatus: "idle" as const,
      syncCursor: null,
      lastSyncAt: overrides.session?.lastSyncAt ?? "2026-06-03T12:08:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null,
      resumedAt: null,
      runningState: overrides.session?.runningState ?? "completed",
      activitySource: overrides.session?.activitySource ?? "runtime",
      lastEventAt: overrides.session?.lastEventAt ?? "2026-06-03T12:08:00.000Z",
      completedAt: overrides.session?.completedAt ?? "2026-06-03T12:08:00.000Z",
      lastSeenAt: null,
      activityState: overrides.session?.activityState ?? "completed_unread"
    }
  };
}

function createNavigationGroupsWithAgentSessions(
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

async function findAffairsGridViewport(): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector(".affairs-doc-grid-viewport");

    if (!(element instanceof HTMLElement)) {
      throw new Error("未找到事务文档网格视口");
    }

    return element;
  });
}

function openDesktopContextMenu(target: HTMLElement, coordinates: { clientX: number; clientY: number }) {
  fireEvent.contextMenu(target, coordinates);
  expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
  return showDesktopContextMenuMock.mock.calls[0]?.[0] ?? [];
}

function findTagTreeNode(label: string) {
  const tree = screen.getByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
  const labelNode = within(tree).queryAllByText(label).find((node) => node.classList.contains("affairs-sidebar-item-title"));
  return labelNode?.closest(".affairs-tag-tree-node") ?? null;
}

async function chooseShortcutSource(path: string) {
  await userEvent.click(screen.getByLabelText(t("shell.affairsShortcutRailSourceSelectField")));
  const dialog = await screen.findByRole("dialog", { name: t("shell.affairsShortcutRailSourcePickerTitle") });
  const segments = path.split("/").filter(Boolean);

  for (const segment of segments.slice(0, -1)) {
    await userEvent.click(within(dialog).getByRole("button", { name: segment }));
  }

  await userEvent.click(within(dialog).getByRole("button", { name: segments.at(-1) ?? path }));
  await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsShortcutRailSourcePickerConfirmAction") }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: t("shell.affairsShortcutRailSourcePickerTitle") })).toBeNull();
  });
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
    showToastMock.mockClear();
    docsApiMock.destroyEditor.mockReset();
    docsApiMock.docEditor.mockReset();
    Object.values(teableRuntimeApiMock).forEach((mock) => mock.mockReset());
    teableRuntimeApiMock.listTeableRuntimeTables.mockResolvedValue({
      tables: [{ tableId: "tbl-1", tableName: "客户跟进" }]
    });
    teableRuntimeApiMock.listTeableRuntimeViews.mockResolvedValue({
      views: [{
        viewId: "viw-1",
        viewName: "主表格",
        viewType: "grid",
        options: {},
        columnMeta: {
          fld_formula: { width: 120 },
          fld_title: { width: 240 },
          fld_hidden: { hidden: true }
        }
      }, {
        viewId: "frm-create",
        viewName: "客户录入表单",
        viewType: "form",
        options: {
          fields: [
            { fieldId: "fld_title", label: "客户标题", required: true },
            { fieldId: "fld_hidden", hidden: true },
            { fieldId: "fld_formula", hidden: true }
          ]
        }
      }, {
        viewId: "frm-edit",
        viewName: "客户维护表单",
        viewType: "form",
        options: {
          fields: [
            { fieldId: "fld_title", label: "维护标题", required: true },
            { fieldId: "fld_formula", hidden: true },
            { fieldId: "fld_hidden", hidden: true }
          ]
        }
      }]
    });
    teableRuntimeApiMock.listTeableRuntimeFields.mockResolvedValue({
      fields: [
        { fieldId: "fld_title", fieldName: "标题", fieldType: "singleLineText", isPrimary: true, isComputed: false, isLookup: false, isMultipleCellValue: false, recordRead: true, recordCreate: true, recordUpdate: true, options: {}, linkOptions: null },
        { fieldId: "fld_formula", fieldName: "得分", fieldType: "formula", isPrimary: false, isComputed: true, isLookup: false, isMultipleCellValue: false, recordRead: true, recordCreate: false, recordUpdate: false, options: {}, linkOptions: null },
        { fieldId: "fld_hidden", fieldName: "Teable 隐藏字段", fieldType: "singleLineText", isPrimary: false, isComputed: false, isLookup: false, isMultipleCellValue: false, recordRead: true, recordCreate: true, recordUpdate: true, options: {}, linkOptions: null }
      ]
    });
    teableRuntimeApiMock.listTeableRuntimeRecords.mockResolvedValue({
      records: [{ recordId: "rec-1", fields: { fld_title: "张三跟进", fld_formula: 88, fld_hidden: "不该显示" } }],
      skip: 0,
      take: 100,
      total: 1
    });
    teableRuntimeApiMock.updateTeableRuntimeRecord.mockResolvedValue({ record: null });
    teableRuntimeApiMock.createTeableRuntimeRecord.mockResolvedValue({ record: null });
    teableRuntimeApiMock.deleteTeableRuntimeRecords.mockResolvedValue({ deletedRecordIds: ["rec-1"] });
    teableRuntimeApiMock.listTeableLinkedRecordOptions.mockResolvedValue({ options: [], skip: 0, take: 50, hasMore: false });
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

    fileContextApiMock.getFilePreview.mockReset();
    fileContextApiMock.saveFileContent.mockReset();
    fileContextApiMock.getFilePreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "tools/report/index.html",
      supported: true,
      kind: "html",
      reason: null,
      content: "<html><body><h1>报表</h1></body></html>",
      version: "workspace-preview-v1",
      size: 0,
      updatedAt: null,
      previewPath: "/preview/files/token/tools/report/index.html",
      previewUrl: "http://127.0.0.1:3002/preview/files/token/tools/report/index.html",
      onlyOffice: null,
      capabilities: {
        canEdit: true,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });
    fileContextApiMock.getFilePreviewLink.mockReset();
    fileContextApiMock.getFilePreviewLink.mockResolvedValue({
      previewPath: "/preview/files/token/tools/report/index.html",
      previewUrl: "http://127.0.0.1:3002/preview/files/token/tools/report/index.html",
      expiresAt: "2026-06-05T00:00:00.000Z"
    });
    fileContextApiMock.getFileTree.mockReset();
    fileContextApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => {
      if (!filePath) {
        return {
          items: [
            {
              name: "tools",
              path: "tools",
              kind: "directory",
              size: null,
              updatedAt: null
            },
            {
              name: "Exchange 分层通讯簿.txt",
              path: "Exchange 分层通讯簿.txt",
              kind: "file",
              size: 1024,
              updatedAt: null
            }
          ]
        };
      }
      if (filePath === "tools") {
        return {
          items: [
            {
              name: "report",
              path: "tools/report",
              kind: "directory",
              size: null,
              updatedAt: null
            }
          ]
        };
      }
      if (filePath === "tools/report") {
        return {
          items: [
            {
              name: "index.html",
              path: "tools/report/index.html",
              kind: "file",
              size: 1024,
              updatedAt: null
            }
          ]
        };
      }
      return { items: [] };
    });
    workspaceBridgeApiMock.listWorkspaceBridgeDir.mockReset();
    workspaceBridgeApiMock.listWorkspaceBridgeDir.mockResolvedValue({
      path: "",
      items: [
        {
          name: "index.html",
          path: "tools/report/index.html",
          kind: "file",
          size: 1024,
          mtime: Date.now()
        }
      ]
    });
    htmlPreviewBridgeMock.createHtmlPreviewWorkspaceBridge.mockClear();
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
    conversationApiMock.markSessionSeen.mockResolvedValue(undefined);
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
    butlerApiMock.listButlerControlSessions.mockReset();
    butlerApiMock.listButlerProjectSessions.mockReset();
    butlerApiMock.getButlerSessionTarget.mockReset();
    butlerApiMock.resumeButlerProjectSession.mockReset();
    butlerControlSessionsCatalogMock.items = [];
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
    butlerApiMock.listButlerControlSessions.mockImplementation(async () => ({
      items: butlerControlSessionsCatalogMock.items
    }));
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
      folderOpenBehavior: "double_click",
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
    expect(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") })).toBeInTheDocument();
  });

  it("事务文档预览编辑后会走文档库写回接口保存", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.dblClick(card);

    await userEvent.click(await screen.findByRole("tab", { name: t("conversation.fileViewerEdit") }));
    const editor = await screen.findByTestId("file-viewer-editor");
    await userEvent.clear(editor);
    await userEvent.type(editor, "这是更新后的事务文档内容");
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(conversationApiMock.operateAffairsLibraryFile).toHaveBeenCalledWith("workspace-1", {
        opType: "write",
        srcPath: "Exchange 分层通讯簿.txt",
        content: "这是更新后的事务文档内容",
        expectedVersion: "affairs-preview-v1"
      });
    });
    expect(fileContextApiMock.saveFileContent).not.toHaveBeenCalled();
  });

  it("目录详情标题会居中显示，并复用和文档详情一致的摘要折叠逻辑", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: /临时文件.*2 个对象/ }));

    expect(await screen.findByText(t("shell.affairsLibraryFolderDetailTitle"))).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "临时文件" })).toBeInTheDocument();
    expect(screen.getByText(/当前目录是 临时文件。这里有 0 个直接子目录、0 份直接文档，整个目录树一共 2 份文档。/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsDocumentSummaryExpandAction") })).not.toBeInTheDocument();
  });

  it("文档库文件夹默认双击进入，单击只选中并显示目录详情", async () => {
    renderWorkbench();

    const folderCard = await screen.findByRole("button", { name: /临时文件.*2 个对象/ });
    await userEvent.click(folderCard);

    expect(await screen.findByRole("heading", { name: "临时文件" })).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryFolderDetailTitle"))).toBeInTheDocument();
    expect(screen.getByText(/Exchange 分层通讯簿.txt/)).toBeInTheDocument();

    await userEvent.dblClick(folderCard);

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: "临时文件"
      }));
    });
  });

  it("单击选中文件夹时，当前目录下的文件不会消失", async () => {
    renderWorkbench();

    const folderCard = await screen.findByRole("button", { name: /临时文件.*2 个对象/ });
    await userEvent.click(folderCard);

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();

    expect(conversationApiMock.listAffairsLibraryDocuments).not.toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: "临时文件"
      })
    );
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
    const items = openDesktopContextMenu(card, { clientX: 240, clientY: 180 });
    expect(screen.queryByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") })).not.toBeInTheDocument();
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
    const items = openDesktopContextMenu(card, { clientX: 240, clientY: 180 });
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

    const grid = await findAffairsGridViewport();
    const items = openDesktopContextMenu(grid, { clientX: 300, clientY: 260 });
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
    const items = openDesktopContextMenu(card, { clientX: 240, clientY: 180 });
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
    const items = openDesktopContextMenu(card, { clientX: 240, clientY: 180 });
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

  it("右键分配标签面板会显示最多 8 个推荐标签，并可一键分配", async () => {
    platformBridgeMock.supported = false;
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: Array.from({ length: 9 }, (_, index) => ({
        id: `tag-${index + 1}`,
        path: `客户/推荐${index + 1}`,
        name: `推荐${index + 1}`,
        rootType: "客户",
        parentId: null,
        parentPath: null,
        description: null,
        status: "active",
        documentCount: 0,
        createdAt: "2026-06-01T08:00:00.000Z",
        updatedAt: "2026-06-01T08:00:00.000Z",
        disabledAt: null
      }))
    });
    const initialDocumentTagDetails = {
      documentId: "doc-1",
      path: "Exchange 分层通讯簿.txt",
      title: "Exchange 分层通讯簿",
      manualTagIds: [],
      effectiveFolderBindings: [],
      resolvedTags: [],
      recommendedTags: Array.from({ length: 9 }, (_, index) => ({
        tagId: `tag-${index + 1}`,
        path: `客户/推荐${index + 1}`,
        name: `推荐${index + 1}`,
        score: 100 - index,
        reason: "name_match" as const,
        evidence: "文件名命中"
      }))
    };
    const updatedDocumentTagDetails = {
      ...initialDocumentTagDetails,
      manualTagIds: ["tag-1"],
      resolvedTags: [{
        path: "客户/推荐1",
        sourceType: "manual_document",
        sourceRef: null,
        evidence: "手动分配",
        confidence: 1,
        priority: 1
      }],
      recommendedTags: Array.from({ length: 8 }, (_, index) => ({
        tagId: `tag-${index + 2}`,
        path: `客户/推荐${index + 2}`,
        name: `推荐${index + 2}`,
        score: 99 - index,
        reason: "name_match" as const,
        evidence: "文件名命中"
      }))
    };
    conversationApiMock.getAffairsDocumentTagDetails
      .mockResolvedValueOnce(initialDocumentTagDetails)
      .mockResolvedValue(updatedDocumentTagDetails);
    let resolveSaveDocumentTags: ((value: {
      target: { type: "document"; documentId: string };
      items: [];
      refreshTask: null;
    }) => void) | null = null;
    conversationApiMock.saveAffairsDocumentTags.mockImplementation(() => new Promise((resolve) => {
      resolveSaveDocumentTags = resolve;
    }));

    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    fireEvent.contextMenu(card, { clientX: 240, clientY: 180 });
    const menu = await screen.findByRole("menu", { name: t("shell.affairsLibraryContextMenuLabel") });
    await userEvent.click(within(menu).getByRole("menuitem", { name: t("shell.affairsLibraryContextTags") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.affairsTagQuickAssignModalTitle") });
    expect(within(dialog).getByText(t("shell.affairsTagRecommendationsLabel"))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/推荐1" }) })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/推荐9" }) })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/推荐1" }) }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent(t("shell.affairsTagQuickAssignSubmitting"));
    resolveSaveDocumentTags?.({
      target: { type: "document", documentId: "doc-1" },
      items: [],
      refreshTask: null
    });
    await waitFor(() => {
      expect(conversationApiMock.saveAffairsDocumentTags).toHaveBeenCalledWith("workspace-1", "doc-1", {
        tagIds: ["tag-1"]
      });
    });
    expect(screen.getByRole("dialog", { name: t("shell.affairsTagQuickAssignModalTitle") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.affairsDocumentTagRemoveAction", { tag: "客户/推荐1" }) })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/推荐1" }) })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/推荐9" }) })).toBeInTheDocument();
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

    const grid = await findAffairsGridViewport();
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

    const grid = await findAffairsGridViewport();
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

  it("文档库右栏停在对象详情时，切到工作台再切回来仍保持对象详情", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithSectionMenu();

    const detailTab = await screen.findByRole("tab", { name: t("shell.affairsDetailTitle") });
    expect(detailTab).toHaveClass("workbench-info-tab", "active");

    await user.click(screen.getByRole("tab", { name: t("shell.affairsWorkbenchNav") }));
    expect(await screen.findByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab", "active");
    expect(screen.queryByRole("tab", { name: t("shell.affairsDetailTitle") })).toBeNull();

    await user.click(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: t("shell.affairsDetailTitle") })).toHaveClass("workbench-info-tab", "active");
      expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab");
    });
  });

  it("文档库右栏切到事务助手后，切到对话再切回来仍保持事务助手", async () => {
    const user = userEvent.setup();
    renderWorkbenchWithSectionMenu();

    await user.click(await screen.findByRole("tab", { name: t("shell.affairsAssistantTitle") }));
    expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab", "active");

    await user.click(screen.getByRole("tab", { name: t("shell.affairsConversationNav") }));
    expect(await screen.findByRole("heading", { name: "事务对话" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab", "active");
      expect(screen.getByRole("tab", { name: t("shell.affairsDetailTitle") })).toHaveClass("workbench-info-tab");
    });
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

  it("事务轻量模式会打开 Composer 图片和文件附件能力", async () => {
    const user = userEvent.setup();
    composerPanelRenderMock.mockClear();
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
    expect(composerPanelRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      supportsAttachments: true
    }));
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

  it("事务轻量新建流请求断开但服务端已创建时，会把草稿切到真实轻量会话", async () => {
    const user = userEvent.setup();
    const recoveredSession = createAgentSnapshotSession({
      sessionId: "session-light-recovered",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "affairs-lightweight:codex:session-light-recovered",
      rawStoreRef: "session-light-recovered.json",
      title: "断流后恢复的轻量对话",
      messageCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      activitySource: "runtime"
    });
    let recoveredMessages: HistoryMessageDto[] = [];
    conversationApiMock.startAffairsLightweightSessionStream.mockImplementation(async (_workspaceId, payload) => {
      const clientRequestId = payload.clientRequestId ?? "client-request-recovered";
      recoveredMessages = [
        {
          messageId: "message-user-recovered",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-recovered",
          role: "user",
          kind: "text",
          content: "请帮我查一下今天的事务重点",
          attachments: [],
          timestamp: new Date().toISOString(),
          sequence: 1,
          rawRef: `session-light-recovered.json#${clientRequestId}`
        },
        {
          messageId: "message-assistant-recovered",
          provider: "codex",
          providerSessionId: "affairs-lightweight:codex:session-light-recovered",
          role: "assistant",
          kind: "text",
          content: "服务端已经完成回复",
          attachments: [],
          timestamp: new Date().toISOString(),
          sequence: 2,
          rawRef: "session-light-recovered.json#assistant-2"
        }
      ];
      conversationApiMock.listAffairsLightweightSessions.mockResolvedValue({ items: [recoveredSession] });
      throw new TypeError("Load failed");
    });
    conversationApiMock.getAffairsLightweightSessionMessages.mockImplementation(async (_workspaceId, sessionId) => ({
      messages: sessionId === "session-light-recovered" ? recoveredMessages : [],
      cursor: null,
      nextCursor: null,
      total: sessionId === "session-light-recovered" ? recoveredMessages.length : 0
    }));
    conversationApiMock.getAffairsLightweightSession.mockResolvedValue(recoveredSession);

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

    await user.click(await screen.findByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("session-light-recovered:");
    });
    expect(conversationApiMock.markAffairsLightweightSessionSeen).toHaveBeenCalledWith(
      "workspace-1",
      "session-light-recovered",
      expect.any(String)
    );
    expect(screen.queryByText("重发")).not.toBeInTheDocument();
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
    expect(within(dialog).getByText(/\/Users\/jackson\/WorkFile/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/当前文档库：事务工作区/)).toBeNull();
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

  it("新建 Agent 会话会复用文档库绑定工作区对应的共享 runtime，而不会改 Butler workspacePath", async () => {
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
      expect(butlerRuntimeCallsMock.updateProfile).not.toHaveBeenCalled();
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalled();
    });
  });

  it("切到事务文档页时也会先初始化 Butler 状态，避免卡在空白页", async () => {
    butlerRuntimeStateMock.setState({
      initialized: false,
      loading: false,
      profile: null,
      bootstrapErrorCode: null,
      error: null
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "library",
      selectedNodeId: "library:all"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.initialize).toHaveBeenCalled();
      expect(butlerRuntimeCallsMock.constructedWorkspaceIds).toContain("workspace-2");
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

  it("工作台右栏只显示事务助手，并围绕当前代办筛选生成上下文", async () => {
    const user = userEvent.setup();
    butlerRuntimeCallsMock.sendMessage.mockClear();
    butlerRuntimeStateMock.setState({
      initialized: true,
      loading: false,
      bootstrapErrorCode: null,
      error: null,
      profile: {
        displayName: "事务助手",
        providerId: "codex",
        workspacePath: "/tmp/workspace-1",
        persona: {
          tone: "direct"
        }
      },
      activeProvider: "codex",
      capabilities: null
    });
    butlerApiMock.listButlerInboxItems.mockResolvedValue({
      items: [
        {
          id: "inbox-1",
          workspaceId: "workspace-1",
          title: "整理合同台账",
          content: "补齐本周待确认合同",
          status: "pending",
          assistantState: {
            analysisSummary: "优先核对待确认合同和责任人",
            generatedPrompt: null,
            lastError: null,
            linkedSessionId: "session-contract-1"
          },
          updatedAt: "2026-06-04T09:00:00.000Z",
          projectName: "事务工作区"
        }
      ]
    });
    butlerApiMock.listButlerFollowUpTasks.mockResolvedValue({ items: [] });
    butlerApiMock.listAssistantAutomations.mockResolvedValue({
      payload: {
        items: []
      }
    });
    butlerApiMock.listRecentAssistantAutomationRuns.mockResolvedValue({
      payload: {
        items: []
      }
    });

    renderWorkbenchWithState({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:todo:inbox",
      auxiliaryTab: "detail"
    });

    expect(await screen.findByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: t("shell.affairsDetailTitle") })).toBeNull();
    expect(await screen.findByText(t("shell.affairsWorkbenchAssistantContextTitle"))).toBeInTheDocument();
    expect(screen.getByText(/当前筛选是 待分析事项，共 1 条代办。优先关注：整理合同台账/)).toBeInTheDocument();

    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      const message = butlerRuntimeCallsMock.sendMessage.mock.calls.at(-1)?.[0];
      expect(message).toContain("当前事务对象：当前工作台代办");
      expect(message).toContain("整理合同台账");
      expect(message).not.toContain("Exchange 分层通讯簿.txt");
    });
  });

  it("右侧事务助手新建 Agent 会话时会留在助手页并复用共享会话", async () => {
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
      activeProvider: null
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      auxiliaryTab: "assistant"
    }, navigationGroupsWithBoundLibraryWorkspace);

    expect(await screen.findByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("shell.butlerNewSessionAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.createSessionModalTitle") });
    const dialogScope = within(dialog);
    expect(dialogScope.queryByText("轻量模式")).toBeNull();
    expect(dialogScope.getByText("助手模式")).toBeInTheDocument();

    await user.click(dialogScope.getByRole("button", { name: "Codex" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.createSessionModalTitle") })).toBeNull();
      expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab", "active");
      expect(screen.getByTestId("affairs-composer-send")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Exchange 分层通讯簿/i })).toBeInTheDocument();
    });
    expect(screen.getByText(t("shell.affairsAssistantPlaceholderEmpty"))).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "事务对话" })).toBeNull();
    expect(butlerRuntimeCallsMock.switchProvider).toHaveBeenCalledWith("codex");
    expect(butlerRuntimeCallsMock.updateProfile).not.toHaveBeenCalled();

    expect(screen.getAllByTestId("affairs-timeline")).toHaveLength(1);
    await user.click(screen.getByTestId("affairs-composer-send"));

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.sendMessage).toHaveBeenCalledTimes(1);
      expect(screen.getAllByTestId("affairs-timeline")).toHaveLength(1);
      expect(screen.getByTestId("affairs-timeline")).toHaveTextContent("agent-session-1:");
      expect(screen.queryByText(t("shell.affairsAssistantPlaceholderEmpty"))).toBeNull();
    });

    await user.click(screen.getByRole("tab", { name: t("shell.affairsConversationNav") }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Agent 对话" })).toBeInTheDocument();
      expect(screen.getAllByTestId("affairs-timeline")).toHaveLength(2);
      expect(screen.getAllByTestId("affairs-timeline").every((item) => item.textContent?.startsWith("agent-session-1:"))).toBe(true);
    });
  });

  it("事务模式隐藏信息栏按钮会出现在整个右侧头部最左侧", async () => {
    const onToggleCollapse = vi.fn();

    render(
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={navigationGroupsWithBoundLibraryWorkspace}
        state={{
          ...createState(),
          auxiliaryTab: "assistant"
        }}
        onStateChange={() => undefined}
      >
        <AffairsAuxiliaryPanel workspaceId="workspace-1" onToggleCollapse={onToggleCollapse} />
      </AffairsWorkbenchProvider>
    );

    const hideButton = await screen.findByRole("button", { name: t("shell.hideInfoSidebar") });
    const header = hideButton.closest(".workbench-auxiliary-header");
    const tabs = screen.getByRole("tablist", { name: t("shell.affairsAuxiliaryTabsLabel") });
    const toolbar = header?.querySelector(".affairs-auxiliary-header-tools");

    expect(header).not.toBeNull();
    expect(header?.firstElementChild).toBe(hideButton);
    expect(tabs.previousElementSibling).toBe(hideButton);
    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: t("shell.butlerHistoryAction") })).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: t("shell.butlerNewSessionAction") })).toBeInTheDocument();
  });

  it("右侧事务助手点击历史会话时会在助手页内部切换，不会跳到事务对话主视图", async () => {
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
    butlerControlSessionsCatalogMock.items = [
      createButlerControlSession({
        id: "control-session-history-1",
        title: "事务 Agent 会话",
        session: {
          sessionId: "agent-session-history-1",
          workspaceId: "workspace-2",
          provider: "codex",
          rawStoreRef: "raw://codex/agent-session-history-1"
        }
      })
    ];
    conversationApiMock.getAffairsAssistantSessionsSnapshot.mockResolvedValue({
      item: {
        projectId: "project-2",
        projectWorkspaceId: "workspace-2",
        agentWorkspacePath: "/Users/jackson/SynologyDrive",
        sessions: [
          createAgentSnapshotSession({
            sessionId: "agent-session-history-1",
            title: "事务 Agent 会话",
            rawStoreRef: "butler://butler-session-history-1"
          })
        ],
        updatedAt: "2026-06-03T13:10:00.000Z"
      }
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      auxiliaryTab: "assistant"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await user.click(await screen.findByRole("button", { name: t("shell.butlerHistoryAction") }));
    const historyDialog = await screen.findByRole("dialog", { name: t("shell.affairsConversationSidebarTitle") });
    expect(document.querySelector(".affairs-assistant-history-backdrop")).toBeNull();
    await user.click(within(historyDialog).getByText("事务 Agent 会话").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(butlerRuntimeCallsMock.openControlSession).toHaveBeenCalledWith("control-session-history-1");
      expect(screen.getByRole("tab", { name: t("shell.affairsAssistantTitle") })).toHaveClass("workbench-info-tab", "active");
      expect(screen.getByTestId("affairs-composer-send")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Agent 对话" })).toBeNull();
    });
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
    expect(screen.queryByText(t("shell.affairsLibraryStatusLastCompletedAtLabel"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryStatusTechnicalToggle") }));

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
    expect(screen.getByText(t("shell.affairsLibraryStatusSummaryTotalLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusSummaryScannedLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusSummaryIssueLabel"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsLibraryStatusSummaryUpdatedLabel"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsLibraryStatusProgressUnchangedLabel"))).not.toBeInTheDocument();

    const summary = document.querySelector(".affairs-index-status-summary");
    expect(summary).not.toBeNull();
    expect(summary?.children).toHaveLength(4);

    const toggle = screen.getByRole("button", { name: t("shell.affairsLibraryStatusTechnicalToggle") });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
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

  it("技术详情超出可视区域时会限制高度并允许内部滚动", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 360,
    });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValueOnce(createLibrarySnapshot({
      status: {
        state: "fresh",
        dirtyReasons: ["manual_refresh"],
        lastRequestedAt: "2026-06-03T09:39:15.000Z",
        lastStartedAt: "2026-06-03T09:39:16.000Z",
        lastCompletedAt: "2026-06-03T09:39:17.000Z",
        lastFailedAt: "2026-06-03T09:39:18.000Z",
        nextAllowedAt: "2026-06-03T09:39:19.000Z",
        runningTaskId: "task-long-status",
        runningStage: "export_search",
        errorSummary: "test",
        progress: {
          scannedCount: 100,
          indexedCount: 4,
          unchangedCount: 90,
          skippedCount: 5,
          failedCount: 1,
          totalCount: 100,
          maxConcurrency: 1
        },
        workerHealth: {
          workerKey: "worker-1",
          rootDir: ".",
          state: "idle",
          pid: 1234,
          inflightLocalCount: 0,
          inflightRemoteRequestCount: 0,
          startedAt: "2026-06-03T09:39:20.000Z",
          lastHeartbeatAt: "2026-06-03T09:39:21.000Z",
          lastStartedAt: "2026-06-03T09:39:22.000Z",
          lastCompletedAt: "2026-06-03T09:39:23.000Z",
          lastFailedAt: "2026-06-03T09:39:24.000Z",
          lastSoftCancelRequestedAt: "2026-06-03T09:39:25.000Z",
          lastHardKillAt: "2026-06-03T09:39:26.000Z",
          lastExitAt: "2026-06-03T09:39:27.000Z",
          lastTerminationReason: "manual"
        }
      },
      documentList: {
        ...createDocumentListResponse([]),
        directoryStatus: {
          path: "folder",
          state: "running",
          source: "stale_fallback",
          lastRequestedAt: "2026-06-03T09:39:28.000Z",
          lastCompletedAt: "2026-06-03T09:39:29.000Z",
          lastFailedAt: "2026-06-03T09:39:30.000Z",
          runningTaskId: "directory-task",
          errorSummary: "directory error",
          generatedAt: "2026-06-03T09:39:31.000Z",
          filesystemObservedAt: "2026-06-03T09:39:32.000Z",
          staleReason: "index_running"
        }
      }
    }));

    renderWorkbench();

    const indicator = await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusFresh") })
    });

    await userEvent.hover(indicator);
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryStatusTechnicalToggle") }));

    const popover = document.querySelector(".affairs-index-status-popover") as HTMLDivElement | null;
    const scrollRegion = document.querySelector(".affairs-index-status-technical .affairs-index-status-section-list") as HTMLDivElement | null;
    const technicalPanel = document.querySelector(".affairs-index-status-technical") as HTMLDivElement | null;

    expect(popover).not.toBeNull();
    expect(scrollRegion).not.toBeNull();
    expect(technicalPanel).not.toBeNull();
    expect(popover?.style.maxHeight).not.toBe("");
    expect(technicalPanel?.contains(scrollRegion)).toBe(true);

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
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

  it("返回上级后会保留来源文件夹高亮", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: [
        {
          path: "临时文件",
          name: "临时文件",
          parentPath: null,
          depth: 0,
          directDocumentCount: 1,
          documentCount: 1,
          createdAt: "2026-05-30T08:00:00.000Z",
          updatedAt: "2026-05-31T08:00:00.000Z"
        },
        {
          path: "临时文件/子目录",
          name: "子目录",
          parentPath: "临时文件",
          depth: 1,
          directDocumentCount: 1,
          documentCount: 1,
          createdAt: "2026-05-30T08:00:00.000Z",
          updatedAt: "2026-05-31T08:00:00.000Z"
        }
      ]
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.listAffairsLibraryDocuments
      .mockResolvedValueOnce(createDocumentListResponse([
        {
          documentId: "doc-root",
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
          documentId: "doc-parent",
          path: "临时文件/账号总表.txt",
          title: "账号总表.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]))
      .mockResolvedValueOnce(createDocumentListResponse([
        {
          documentId: "doc-child",
          path: "临时文件/子目录/账号.txt",
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
          documentId: "doc-parent",
          path: "临时文件/账号总表.txt",
          title: "账号总表.txt",
          summary: "",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]));

    renderWorkbench();
    const user = userEvent.setup();

    await user.dblClick(await screen.findByRole("button", { name: /临时文件.*1 个对象/ }));
    await user.dblClick(await screen.findByRole("button", { name: /子目录.*1 个对象/ }));
    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({
          browseMode: "folder",
          selectedFolderPath: "临时文件/子目录"
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "临时文件" }));

    const childFolderRow = await screen.findByRole("button", { name: /子目录.*1 个对象/ });
    expect(childFolderRow.className).toContain("active");
    expect(await screen.findByText("账号总表.txt")).toBeInTheDocument();
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

  it("网格视图虚拟滚动高度按总条数估算，不再只按已加载条数计算", async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-doc-grid-scroll")) {
          return 300;
        }
        return originalClientWidth?.get ? originalClientWidth.get.call(this) : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-doc-grid-scroll")) {
          return 400;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-doc-grid-scroll")) {
          return 20000;
        }
        return originalScrollHeight?.get ? originalScrollHeight.get.call(this) : 0;
      }
    });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: []
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValueOnce({
      total: 240,
      offset: 0,
      limit: 120,
      tagFacetCounts: {},
      items: Array.from({ length: 120 }, (_, index) => ({
        documentId: `doc-${index + 1}`,
        path: `文档${String(index + 1).padStart(3, "0")}.txt`,
        title: `文档${String(index + 1).padStart(3, "0")}`,
        summary: "事务文档摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }))
    });

    try {
      renderWorkbench();

      await waitFor(() => {
        const spacer = document.querySelector(".affairs-doc-grid-spacer") as HTMLDivElement | null;
        expect(spacer).not.toBeNull();
        expect(spacer?.style.height).toBe("13908px");
      });
    } finally {
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("列表视图虚拟滚动优先使用后端返回的当前目录可见总条数", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 400;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 50000;
        }
        return originalScrollHeight?.get ? originalScrollHeight.get.call(this) : 0;
      }
    });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: [
        {
          path: "子目录A",
          name: "子目录A",
          parentPath: null,
          depth: 0,
          directDocumentCount: 0,
          documentCount: 0,
          createdAt: "2026-05-30T08:00:00.000Z",
          updatedAt: "2026-05-31T08:00:00.000Z"
        },
        {
          path: "子目录B",
          name: "子目录B",
          parentPath: null,
          depth: 0,
          directDocumentCount: 0,
          documentCount: 0,
          createdAt: "2026-05-30T08:00:00.000Z",
          updatedAt: "2026-05-31T08:00:00.000Z"
        }
      ]
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 2,
      visibleEntryTotal: 4,
      offset: 0,
      limit: 120,
      tagFacetCounts: {},
      items: [
        {
          documentId: "doc-1",
          path: "说明1.md",
          title: "说明1",
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 2048,
          tags: [],
          derivedTags: [],
          isFavorite: false
        },
        {
          documentId: "doc-2",
          path: "说明2.md",
          title: "说明2",
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 2048,
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]
    });

    try {
      renderWorkbench();
      await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

      await waitFor(() => {
        const spacer = document.querySelector('.affairs-finder-spacer') as HTMLDivElement | null;
        expect(spacer).not.toBeNull();
        expect(spacer?.style.height).toBe('160px');
      });

      const virtual = document.querySelector(".affairs-finder-virtual") as HTMLDivElement | null;
      expect(virtual).not.toBeNull();
      expect(virtual?.style.top).toBe("0px");
      expect(virtual?.style.transform).toBe("");
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("列表视图接近已加载尾部时会按总条数提前继续加载", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 400;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 50000;
        }
        return originalScrollHeight?.get ? originalScrollHeight.get.call(this) : 0;
      }
    });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: []
    }));
    conversationApiMock.listAffairsLibraryDocuments
      .mockResolvedValueOnce({
        total: 240,
        offset: 0,
        limit: 120,
        tagFacetCounts: {},
        items: Array.from({ length: 120 }, (_, index) => ({
          documentId: `doc-${index + 1}`,
          path: `文档${String(index + 1).padStart(3, "0")}.txt`,
          title: `文档${String(index + 1).padStart(3, "0")}`,
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 2048,
          tags: [],
          derivedTags: [],
          isFavorite: false
        }))
      })
      .mockResolvedValueOnce({
        total: 240,
        offset: 120,
        limit: 120,
        tagFacetCounts: {},
        items: Array.from({ length: 120 }, (_, index) => ({
          documentId: `doc-${index + 121}`,
          path: `文档${String(index + 121).padStart(3, "0")}.txt`,
          title: `文档${String(index + 121).padStart(3, "0")}`,
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          createdAt: "2026-05-30T08:00:00.000Z",
          sizeBytes: 2048,
          tags: [],
          derivedTags: [],
          isFavorite: false
        }))
      });

    try {
      renderWorkbench();
      await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

      const listViewport = await waitFor(() => {
        const element = document.querySelector(".affairs-finder-list");
        if (!(element instanceof HTMLDivElement)) {
          throw new Error("未找到事务文档列表视口");
        }
        return element;
      });

      act(() => {
        listViewport.scrollTop = 3840;
        fireEvent.scroll(listViewport);
      });

      await waitFor(() => {
        expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
          offset: 120,
          limit: 120
        }));
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("列表视图虚拟内容用 top 定位，避免滚动时把 scrollHeight 越撑越大", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 400;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      }
    });

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      folders: []
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 240,
      visibleEntryTotal: 240,
      offset: 0,
      limit: 120,
      tagFacetCounts: {},
      items: Array.from({ length: 120 }, (_, index) => ({
        documentId: `doc-${index + 1}`,
        path: `文档${String(index + 1).padStart(3, "0")}.txt`,
        title: `文档${String(index + 1).padStart(3, "0")}`,
        summary: "事务文档摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: [],
        derivedTags: [],
        isFavorite: false
      }))
    });

    try {
      renderWorkbench();
      await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

      const listViewport = await waitFor(() => {
        const element = document.querySelector(".affairs-finder-list");
        if (!(element instanceof HTMLDivElement)) {
          throw new Error("未找到事务文档列表视口");
        }
        return element;
      });

      act(() => {
        listViewport.scrollTop = 1600;
        fireEvent.scroll(listViewport);
      });

      await waitFor(() => {
        const virtual = document.querySelector(".affairs-finder-virtual") as HTMLDivElement | null;
        expect(virtual).not.toBeNull();
        expect(virtual?.style.top).toBe("1520px");
        expect(virtual?.style.transform).toBe("");
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
    }
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

  it("标签筛选在列表视图可以切到目录视图，按文件实际路径分组显示", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("affairs-finder-list")) {
          return 520;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      }
    });

    conversationApiMock.listAffairsLibraryDocuments
      .mockResolvedValueOnce(createDocumentListResponse([]))
      .mockResolvedValueOnce({
        total: 3,
        offset: 0,
        limit: 120,
        tagFacetCounts: {
          "类型": 3,
          "类型/文本": 3
        },
        items: [
          {
            documentId: "doc-trip-list",
            path: "000-临时文档/202502-旅行社AI解决方案/文旅大模型平台建设清单.xlsx",
            title: "文旅大模型平台建设清单.xlsx",
            summary: "摘要",
            updatedAt: "2025-02-17T14:14:00.000Z",
            createdAt: "2025-02-17T14:14:00.000Z",
            sizeBytes: 117 * 1024,
            tags: ["类型/文本"],
            derivedTags: [],
            isFavorite: false
          },
          {
            documentId: "doc-test-pdf",
            path: "000-临时文档/202508-深信服设备测试/样机借用协议-嘉略盖章.pdf",
            title: "样机借用协议-嘉略盖章.pdf",
            summary: "摘要",
            updatedAt: "2025-08-21T10:52:00.000Z",
            createdAt: "2025-08-21T10:52:00.000Z",
            sizeBytes: 809 * 1024,
            tags: ["类型/文本"],
            derivedTags: [],
            isFavorite: false
          },
          {
            documentId: "doc-desktop-list",
            path: "昌乐客户云桌面项目/云桌面清单 V3.xlsx",
            title: "云桌面清单 V3.xlsx",
            summary: "摘要",
            updatedAt: "2024-01-11T14:14:00.000Z",
            createdAt: "2024-01-11T14:14:00.000Z",
            sizeBytes: 35 * 1024,
            tags: ["类型/文本"],
            derivedTags: [],
            isFavorite: false
          }
        ]
      });

    try {
      renderWorkbench();
      const user = userEvent.setup();

      await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
      const typeLabel = (await screen.findAllByText("类型")).find((node) => node.classList.contains("affairs-sidebar-item-title"));
      expect(typeLabel).toBeTruthy();
      const typeNode = typeLabel.closest(".affairs-tag-tree-node");
      const expandButton = typeNode?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle");
      expect(expandButton).not.toBeNull();
      await user.click(expandButton!);
      const expandedTypeNode = findTagTreeNode("类型");
      expect(expandedTypeNode).not.toBeNull();
      await user.click(within(expandedTypeNode!).getByRole("button", { name: /文本/ }));

      await user.click(await screen.findByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

      const directoryModeButton = await screen.findByRole("button", { name: t("shell.affairsLibraryTagResultDirectoryMode") });
      expect(screen.getByRole("button", { name: t("shell.affairsLibraryTagResultFileMode") })).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector(".affairs-finder-directory-row")).toBeNull();

      await user.click(directoryModeButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: t("shell.affairsLibraryTagResultDirectoryMode") })).toHaveAttribute("aria-pressed", "true");
        const directoryRows = Array.from(document.querySelectorAll(".affairs-finder-directory-row"));
        expect(directoryRows.map((row) => row.textContent ?? "")).toEqual(expect.arrayContaining([
          expect.stringContaining("000-临时文档"),
          expect.stringContaining("202502-旅行社AI解决方案"),
          expect.stringContaining("202508-深信服设备测试"),
          expect.stringContaining("昌乐客户云桌面项目")
        ]));
      });

      expect(screen.getByText("文旅大模型平台建设清单.xlsx")).toBeInTheDocument();
      expect(screen.getByText("样机借用协议-嘉略盖章.pdf")).toBeInTheDocument();
      expect(screen.getByText("云桌面清单 V3.xlsx")).toBeInTheDocument();

      const rootDirectoryRow = Array.from(document.querySelectorAll<HTMLButtonElement>(".affairs-finder-directory-row"))
        .find((row) => row.textContent?.includes("000-临时文档"));
      expect(rootDirectoryRow).toBeTruthy();
      expect(rootDirectoryRow).toHaveAttribute("aria-expanded", "true");

      await user.click(rootDirectoryRow!);

      await waitFor(() => {
        expect(rootDirectoryRow).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("202502-旅行社AI解决方案")).toBeNull();
        expect(screen.queryByText("202508-深信服设备测试")).toBeNull();
        expect(screen.queryByText("文旅大模型平台建设清单.xlsx")).toBeNull();
        expect(screen.queryByText("样机借用协议-嘉略盖章.pdf")).toBeNull();
        expect(screen.getByText("昌乐客户云桌面项目")).toBeInTheDocument();
        expect(screen.getByText("云桌面清单 V3.xlsx")).toBeInTheDocument();
      });

      await user.click(rootDirectoryRow!);

      await waitFor(() => {
        expect(rootDirectoryRow).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("202502-旅行社AI解决方案")).toBeInTheDocument();
        expect(screen.getByText("文旅大模型平台建设清单.xlsx")).toBeInTheDocument();
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
    }
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

  it("列表视图下标签筛选后的文档点击只更新选中态，不会重新请求列表", async () => {
    const filteredResponse = createDocumentListResponse([
      {
        documentId: "doc-filtered-1",
        path: "客户/投标文件.docx",
        title: "投标文件",
        summary: "筛选结果摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: ["类型/文本"],
        derivedTags: [],
        isFavorite: false
      }
    ]);
    conversationApiMock.listAffairsLibraryDocuments.mockImplementation((_workspaceId, options) => {
      if (options?.browseMode === "tag" && Array.isArray(options.selectedTagPaths) && options.selectedTagPaths.length > 0) {
        return Promise.resolve(filteredResponse);
      }
      return Promise.resolve(createDocumentListResponse());
    });

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    await user.click(findTagTreeNode("类型")?.querySelector<HTMLButtonElement>(".affairs-tag-tree-toggle")!);
    await user.click(within(findTagTreeNode("类型")!).getByRole("button", { name: /文本/ }));
    await user.click(screen.getByRole("button", { name: t("shell.affairsLibraryViewModeList") }));

    const row = await screen.findByRole("button", { name: /投标文件\.docx/i });
    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenLastCalledWith("workspace-1", {
        browseMode: "tag",
        selectedFolderPath: null,
        selectedTagPath: "类型/文本",
        selectedTagPaths: ["类型/文本"],
        selectedFavoriteId: null,
        offset: 0,
        limit: 120
      });
    });
    const requestCountBeforeClick = conversationApiMock.listAffairsLibraryDocuments.mock.calls.length;

    await user.click(row);

    await waitFor(() => {
      expect(row.className).toContain("active");
    });
    await waitFor(() => {
      const detailPanel = document.querySelector(".affairs-detail-block");
      expect(detailPanel).not.toBeNull();
      expect(within(detailPanel as HTMLElement).getByRole("heading", { name: "投标文件.docx" })).toBeInTheDocument();
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(conversationApiMock.listAffairsLibraryDocuments.mock.calls.length).toBe(requestCountBeforeClick);
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

  it("标签树可以用拼音快速查找并定位标签", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      tags: [
        { path: "项目文档", name: "项目文档", parentPath: null, depth: 0, rootType: "项目文档", documentCount: 3 },
        { path: "项目文档/售前文档", name: "售前文档", parentPath: "项目文档", depth: 1, rootType: "项目文档", documentCount: 2 },
        { path: "项目文档/售前文档/合同", name: "合同", parentPath: "项目文档/售前文档", depth: 2, rootType: "项目文档", documentCount: 1 }
      ],
      folders: []
    }));
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse());

    renderWorkbench();
    const user = userEvent.setup();

    await screen.findByRole("tree", { name: t("shell.affairsLibraryTagTreeTitle") });
    expect(findTagTreeNode("售前文档")).toBeNull();

    await user.click(screen.getByRole("button", { name: t("shell.affairsLibraryTagSearchAction") }));
    const searchInput = screen.getByRole("textbox", { name: t("shell.affairsLibraryTagSearchInputLabel") });
    await user.type(searchInput, "shouqian");

    const resultList = await screen.findByRole("listbox", { name: t("shell.affairsLibraryTagSearchResultsLabel") });
    const firstResult = within(resultList).getAllByRole("option")[0];
    expect(firstResult).toHaveTextContent("项目文档/售前文档");
    await user.click(firstResult);

    await waitFor(() => {
      expect(findTagTreeNode("项目文档")).toHaveAttribute("aria-expanded", "true");
      expect(findTagTreeNode("售前文档")).not.toBeNull();
    });
    expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenLastCalledWith("workspace-1", {
      browseMode: "tag",
      selectedFolderPath: null,
      selectedTagPath: "项目文档/售前文档",
      selectedTagPaths: ["项目文档/售前文档"],
      selectedFavoriteId: null,
      offset: 0,
      limit: 120
    });
    expect(screen.queryByRole("textbox", { name: t("shell.affairsLibraryTagSearchInputLabel") })).not.toBeInTheDocument();
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

  it("标签筛选浏览时，状态刷新不会因为 lastCompletedAt 变化而自动重拉当前列表", async () => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.getAffairsLibrarySnapshot
      .mockResolvedValueOnce(createLibrarySnapshot({
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
      }))
      .mockResolvedValue(createLibrarySnapshot({
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
        }
      }));
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue(createDocumentListResponse([
      {
        documentId: "doc-filtered-1",
        path: "客户/投标文件.docx",
        title: "投标文件",
        summary: "筛选结果摘要",
        updatedAt: "2026-05-31T08:00:00.000Z",
        createdAt: "2026-05-30T08:00:00.000Z",
        sizeBytes: 2048,
        tags: ["类型/文本"],
        derivedTags: [],
        isFavorite: false
      }
    ]));

    renderWorkbenchWithState({
      ...createState(),
      browseMode: "tag",
      selectedNodeId: "library:tag:类型/文本",
      selectedTagPath: "类型/文本",
      selectedTagPaths: ["类型/文本"]
    });

    await screen.findByText("投标文件.docx");
    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledTimes(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 3_300));

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibrarySnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByRole("button", {
      name: t("shell.affairsLibraryStatusIndicatorAction", { status: t("shell.affairsLibraryStatusFresh") })
    })).toBeInTheDocument();
    expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledTimes(1);
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
    await userEvent.dblClick(screen.getByRole("button", { name: /临时文件.*2 个对象/ }));

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
      folderOpenBehavior: "double_click",
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
      folderOpenBehavior: "double_click",
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
        includedHiddenPaths: [],
        folderOpenBehavior: "double_click"
      });
    });
  });

  it("文档库设置可以切换文件夹单击/双击打开方式", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));
    await userEvent.click(screen.getByRole("switch", { name: t("shell.affairsLibraryFolderOpenBehaviorSwitchLabel") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsLibraryConfig).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        folderOpenBehavior: "single_click"
      }));
    });
  });

  it("切到单击打开后，单击文件夹会直接进入目录", async () => {
    conversationApiMock.getAffairsLibraryConfig.mockResolvedValueOnce({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        enabled: true,
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [".docx", ".md", ".pdf"],
        includedHiddenPaths: [],
        folderOpenBehavior: "single_click",
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      includedHiddenPaths: [],
      folderOpenBehavior: "single_click",
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    renderWorkbench();

    const folderCard = await screen.findByRole("button", { name: /临时文件.*2 个对象/ });
    await userEvent.click(folderCard);

    await waitFor(() => {
      expect(conversationApiMock.listAffairsLibraryDocuments).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
        browseMode: "folder",
        selectedFolderPath: "临时文件"
      }));
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
      folderOpenBehavior: "double_click",
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
      ],
      recommendedTags: []
    });
    conversationApiMock.getAffairsFolderTagDetails.mockResolvedValue({
      folderPath: ".",
      exists: true,
      bindingTagIds: [],
      bindings: [],
      recommendedTags: []
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

  it("文档详情推荐标签收进标签推荐悬浮层，并排除已分配标签", async () => {
    conversationApiMock.listAffairsTags.mockResolvedValue({
      items: [
        {
          id: "tag-inherited",
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
          id: "tag-recommended",
          path: "项目/报价",
          name: "报价",
          rootType: "项目",
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
      effectiveFolderBindings: [{
        id: "folder-binding-1",
        folderPath: "客户资料",
        tagId: "tag-inherited",
        tagPath: "客户/合同"
      }],
      resolvedTags: [{ path: "客户/合同", sourceType: "folder_binding", sourceRef: null, evidence: "文件夹继承", confidence: 1, priority: 1 }],
      recommendedTags: [
        {
          tagId: "tag-inherited",
          path: "客户/合同",
          name: "合同",
          score: 99,
          reason: "name_match",
          evidence: "已分配标签不应该展示到推荐区"
        },
        {
          tagId: "tag-recommended",
          path: "项目/报价",
          name: "报价",
          score: 91,
          reason: "folder_context",
          evidence: "同级文件夹已经配置过这个标签"
        }
      ]
    });

    renderWorkbench();

    await userEvent.click(await screen.findByText("Exchange 分层通讯簿.txt"));
    expect(await screen.findByText("客户/合同")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "项目/报价" }) })).not.toBeInTheDocument();

    const recommendationTrigger = await screen.findByRole("button", { name: t("shell.affairsTagRecommendationsAction") });
    expect(recommendationTrigger).toHaveClass("has-recommendations");
    await userEvent.click(recommendationTrigger);

    const recommendedButton = await screen.findByRole("button", { name: /项目\/报价/ });
    expect(recommendedButton.querySelector(".affairs-color-tag.recommended")).not.toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.affairsTagRecommendationAssignAction", { tag: "客户/合同" }) })).not.toBeInTheDocument();
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
      bindings: [],
      recommendedTags: []
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
      bindings: [],
      recommendedTags: []
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
      bindings: [],
      recommendedTags: []
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
      bindings: [],
      recommendedTags: []
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
        includedHiddenPaths: [".obsidian", "notes/.draft.md"],
        folderOpenBehavior: "double_click"
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

  it("添加 HTML 块时会按所选来源工作区走校验和预览链路", async () => {
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    const boundLibraryBinding = {
      ...baseLibrarySnapshot().binding,
      workspaceId: "workspace-2",
      rootDir: "/Users/jackson/SynologyDrive"
    };
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      binding: boundLibraryBinding,
      folders: [
        {
          path: "Obsidian",
          name: "Obsidian",
          parentPath: null,
          depth: 0,
          directDocumentCount: 0,
          documentCount: 1,
          createdAt: "2026-06-04T09:00:00.000Z",
          updatedAt: "2026-06-04T09:30:00.000Z"
        },
        {
          path: "Obsidian/Tools",
          name: "Tools",
          parentPath: "Obsidian",
          depth: 1,
          directDocumentCount: 1,
          documentCount: 1,
          createdAt: "2026-06-04T09:00:00.000Z",
          updatedAt: "2026-06-04T09:30:00.000Z"
        }
      ]
    }));
    conversationApiMock.getGlobalAffairsLibraryBinding.mockResolvedValue(boundLibraryBinding);
    conversationApiMock.listAffairsLibraryFiles.mockImplementation(async (_workspaceId: string, query?: { path?: string | null }) => {
      const selectedPath = query?.path?.trim() ?? "";
      if (!selectedPath) {
        return {
          items: [
            {
              path: "Obsidian",
              name: "Obsidian",
              kind: "directory",
              size: null,
              updatedAt: "2026-06-04T09:30:00.000Z"
            }
          ]
        };
      }
      if (selectedPath === "Obsidian") {
        return {
          items: [
            {
              path: "Obsidian/Tools",
              name: "Tools",
              kind: "directory",
              size: null,
              updatedAt: "2026-06-04T09:30:00.000Z"
            }
          ]
        };
      }
      if (selectedPath === "Obsidian/Tools") {
        return {
          items: [
            {
              path: "Obsidian/Tools/会员管理.html",
              name: "会员管理.html",
              kind: "file",
              size: 4096,
              updatedAt: "2026-06-04T09:30:00.000Z"
            }
          ]
        };
      }
      return { items: [] };
    });
    conversationApiMock.getAffairsLibraryPreview.mockResolvedValue({
      workspaceId: "workspace-2",
      path: "Obsidian/Tools/会员管理.html",
      supported: true,
      kind: "html",
      reason: null,
      content: "<html><body><h1>会员管理</h1></body></html>",
      version: "preview-1",
      size: 4096,
      updatedAt: "2026-06-04T09:30:00.000Z",
      previewPath: "/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html",
      previewUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html",
      onlyOffice: null,
      capabilities: {
        canEdit: true,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });

    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:30:00.000Z");
    dashboardState.layoutLocked = false;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchAddWidgetAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchWidgetTypeHtml") }));
    const currentLibraryOption = screen.getByRole("option", { name: t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrentLibraryOption") });
    expect(currentLibraryOption).toBeInTheDocument();
    expect(currentLibraryOption).toHaveValue("__affairs_current_library__");
    expect(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField"))).toHaveValue("__affairs_current_library__");
    expect(screen.getByText("当前文档库路径：/Users/jackson/SynologyDrive。下面的文件列表直接来自这份全局文档库配置。")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceSelectField")));
    await userEvent.click(await screen.findByRole("button", { name: "Obsidian" }));
    await userEvent.click(await screen.findByRole("button", { name: "Tools" }));
    await userEvent.click(await screen.findByRole("button", { name: "会员管理.html" }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailSourcePickerConfirmAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchConfirmAddWidgetAction") }));

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryPreview).toHaveBeenCalledWith("workspace-2", "Obsidian/Tools/会员管理.html");
    });
    expect(document.querySelector(".affairs-dashboard-html-meta")).toBeNull();
    expect(screen.queryByText("Obsidian/Tools/会员管理.html")).not.toBeInTheDocument();

    const openHtmlButton = screen.getByRole("button", { name: t("shell.affairsWorkbenchOpenHtmlAction") });
    expect(openHtmlButton.closest(".affairs-dashboard-widget-header")).not.toBeNull();
    conversationApiMock.getAffairsLibraryPreview.mockClear();
    await userEvent.click(openHtmlButton);
    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith(
        expect.stringContaining("/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html"),
        "_blank",
        "noopener,noreferrer"
      );
    });
    expect(conversationApiMock.getAffairsLibraryPreview).toHaveBeenCalledWith("workspace-2", "Obsidian/Tools/会员管理.html");

    const htmlFrame = await screen.findByTestId("file-viewer-html-preview") as HTMLIFrameElement;
    expect(htmlFrame).not.toBeNull();
    expect(htmlFrame?.src).toContain("/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html");
    expect(htmlFrame?.src).toContain("_preview=0");
    expect(htmlFrame?.src).toContain("_cns_parent_origin=");
    const frameShell = htmlFrame.closest(".file-viewer-html-frame-shell");
    expect(frameShell).not.toBeNull();
    expect(frameShell?.closest(".affairs-dashboard-widget-body > .file-viewer-inline-panel")).not.toBeNull();
    expect(document.querySelector(".file-viewer-inline-panel")).not.toBeNull();
    expect(document.querySelector(".affairs-dashboard-html-frame")).toBeNull();
    await waitFor(() => {
      expect(htmlPreviewBridgeMock.createHtmlPreviewWorkspaceBridge).toHaveBeenCalledWith(expect.objectContaining({
        iframe: htmlFrame,
        workspaceId: "workspace-2"
      }));
    });
    expect(fileContextApiMock.getFilePreview).not.toHaveBeenCalled();
    expect(conversationApiMock.getAffairsLibraryPreviewWithOptions).toHaveBeenCalledWith("workspace-2", "Obsidian/Tools/会员管理.html", expect.objectContaining({
      officeDisplayMode: "default"
    }));
    expect(conversationApiMock.listAffairsLibraryFiles).toHaveBeenCalledWith("workspace-2", expect.objectContaining({
      path: "Obsidian/Tools"
    }));
  });

  it("当前文档库来源选项直接读取全局 rootDir，不再映射成某个工作区名", async () => {
    const libraryBindingWithoutWorkspace = {
      ...baseLibrarySnapshot().binding,
      workspaceId: "workspace-2",
      rootDir: "/Users/jackson/SynologyDrive"
    };
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      binding: libraryBindingWithoutWorkspace
    }));
    conversationApiMock.getGlobalAffairsLibraryBinding.mockResolvedValue(libraryBindingWithoutWorkspace);

    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:30:00.000Z");
    dashboardState.layoutLocked = false;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchAddWidgetAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchWidgetTypeHtml") }));

    expect(screen.getByRole("option", {
      name: t("shell.affairsWorkbenchHtmlSourceWorkspaceCurrentLibraryOption")
    })).toHaveValue("__affairs_current_library__");
    expect(screen.queryByRole("option", { name: /Jackson-Obsi/ })).not.toBeInTheDocument();
  });

  it("添加快捷应用时默认选中当前文档库来源", async () => {
    const boundLibraryBinding = {
      ...baseLibrarySnapshot().binding,
      workspaceId: "workspace-2",
      rootDir: "/Users/jackson/SynologyDrive"
    };
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      binding: boundLibraryBinding
    }));
    conversationApiMock.getGlobalAffairsLibraryBinding.mockResolvedValue(boundLibraryBinding);

    renderWorkbenchWithCustomNavigationGroups(createState(), navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailExpandAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));

    expect(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField"))).toHaveValue("__affairs_current_library__");
  });

  it("当前文档库文件选择器会按真实目录列出非 HTML 文件", async () => {
    const boundLibraryBinding = {
      ...baseLibrarySnapshot().binding,
      workspaceId: "workspace-2",
      rootDir: "/Users/jackson/SynologyDrive"
    };
    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue(createLibrarySnapshot({
      binding: boundLibraryBinding
    }));
    conversationApiMock.getGlobalAffairsLibraryBinding.mockResolvedValue(boundLibraryBinding);
    conversationApiMock.listAffairsLibraryFiles.mockImplementation(async (_workspaceId: string, query?: { path?: string | null }) => {
      const selectedPath = query?.path?.trim() ?? "";
      if (!selectedPath) {
        return {
          items: [
            {
              path: "Apps",
              name: "Apps",
              kind: "directory",
              size: null,
              updatedAt: "2026-06-04T10:00:00.000Z"
            }
          ]
        };
      }
      if (selectedPath === "Apps") {
        return {
          items: [
            {
              path: "Apps/logo.png",
              name: "logo.png",
              kind: "file",
              size: 2048,
              updatedAt: "2026-06-04T10:00:00.000Z"
            },
            {
              path: "Apps/index.html",
              name: "index.html",
              kind: "file",
              size: 1024,
              updatedAt: "2026-06-04T10:00:00.000Z"
            }
          ]
        };
      }
      return { items: [] };
    });

    renderWorkbenchWithCustomNavigationGroups(createState(), navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailExpandAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));
    await userEvent.click(screen.getByLabelText(t("shell.affairsShortcutRailSourceSelectField")));
    await userEvent.click(await screen.findByRole("button", { name: "Apps" }));

    expect(await screen.findByRole("button", { name: "logo.png" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "index.html" })).toBeInTheDocument();
    expect(conversationApiMock.listAffairsLibraryFiles).toHaveBeenCalledWith("workspace-2", expect.objectContaining({
      path: "Apps"
    }));
  });

  it("打开快捷应用时会继承快捷应用自己的来源工作区权限", async () => {
    renderWorkbenchWithCustomNavigationGroups(createState(), navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailExpandAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField")), "workspace-2");
    await chooseShortcutSource("tools/report/index.html");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailConfirmAddAction") }));

    await waitFor(() => {
      expect(fileContextApiMock.getFilePreview).toHaveBeenCalledWith("workspace-2", "tools/report/index.html");
    });

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailDoneAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailLaunchAction", { title: "index.html" }) }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "index.html" })).toBeInTheDocument();
    });
    expect(fileContextApiMock.getFilePreviewLink).not.toHaveBeenCalled();
  });

  it("文档和对话分区默认折叠快捷应用，点展开后才显示内容", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T10:10:00.000Z");
    dashboardState.shortcutApps = [
      createAffairsShortcutAppState({
        title: "会员管理",
        workspaceId: "workspace-2",
        entryPath: "tools/member/index.html"
      }, "2026-06-04T10:10:00.000Z")
    ];
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    const { rerender } = renderWorkbenchWithCustomNavigationGroups(createState(), navigationGroupsWithBoundLibraryWorkspace);

    expect(screen.queryByText("会员管理")).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.affairsShortcutRailAddAction") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailExpandAction") }));
    expect(await screen.findByText("会员管理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailEditAction") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsShortcutRailRemoveAction") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailAddAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailRemoveAction") })).toBeInTheDocument();

    rerender(
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={navigationGroupsWithBoundLibraryWorkspace}
        state={{
          ...createState(),
          primarySection: "conversation"
        }}
        onStateChange={() => undefined}
      >
        <div style={{ display: "flex", gap: 12 }}>
          <AffairsSectionMenu />
          <AffairsSidebarPanel />
          <AffairsWorkbenchView workspaceId="workspace-1" />
          <AffairsAuxiliaryPanel workspaceId="workspace-1" />
        </div>
      </AffairsWorkbenchProvider>
    );

    expect(screen.queryByText("会员管理")).toBeNull();
    expect(screen.queryByRole("button", { name: t("shell.affairsShortcutRailAddAction") })).toBeNull();
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailExpandAction") })).toBeInTheDocument();
  });

  it("快捷应用会用名称生成图标，并通过全屏 HTML 预览打开", async () => {
    clearViewSnapshot("workbench.affairs.dashboard.workspace-1");
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailEditAction") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsShortcutRailAddAction") })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField")), "workspace-2");
    await chooseShortcutSource("tools/report/index.html");
    await userEvent.clear(screen.getByLabelText(t("shell.affairsShortcutRailTitleField")));
    await userEvent.type(screen.getByLabelText(t("shell.affairsShortcutRailTitleField")), "会员管理");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailConfirmAddAction") }));

    const launcher = await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditEntryAction", { title: "会员管理" }) });
    expect(within(launcher).getByText("会员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailRemoveAction") })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailDoneAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailLaunchAction", { title: "会员管理" }) }));

    const dialog = await screen.findByRole("dialog", { name: "会员管理" });
    expect(dialog).toBeInTheDocument();
    expect(document.querySelector('.workbench-modal-card.file-viewer-modal[data-size=\"full\"]')).not.toBeNull();
  });

  it("编辑模式下点击快捷应用会进入编辑表单而不是打开应用", async () => {
    clearViewSnapshot("workbench.affairs.dashboard.workspace-1");
    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField")), "workspace-2");
    await chooseShortcutSource("tools/report/index.html");
    await userEvent.clear(screen.getByLabelText(t("shell.affairsShortcutRailTitleField")));
    await userEvent.type(screen.getByLabelText(t("shell.affairsShortcutRailTitleField")), "会员管理");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailConfirmAddAction") }));

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailEditEntryAction", { title: "会员管理" }) }));

    expect(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField"))).toHaveValue("workspace-2");
    expect(screen.getByLabelText(t("shell.affairsShortcutRailSourceSelectField"))).toHaveTextContent("tools/report/index.html");
    expect(screen.getByLabelText(t("shell.affairsShortcutRailTitleField"))).toHaveValue("会员管理");
    expect(screen.getByRole("button", { name: t("shell.affairsShortcutRailConfirmEditAction") })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "会员管理" })).toBeNull();
  });

  it("快捷应用支持添加非 HTML 文件，并通过预览打开", async () => {
    clearViewSnapshot("workbench.affairs.dashboard.workspace-1");
    fileContextApiMock.getFilePreview.mockImplementation(async (workspaceId: string, path: string) => ({
      workspaceId,
      path,
      supported: true,
      kind: "text",
      reason: null,
      content: null,
      version: null,
      size: 1024,
      updatedAt: null,
      previewPath: `/preview/files/token/${path}`,
      previewUrl: `http://127.0.0.1:3002/preview/files/token/${path}`,
      onlyOffice: null,
      capabilities: {
        canEdit: false,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    }));

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailEditAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailAddAction") }));
    await userEvent.selectOptions(screen.getByLabelText(t("shell.affairsWorkbenchHtmlSourceWorkspaceField")), "workspace-2");
    await chooseShortcutSource("Exchange 分层通讯簿.txt");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailConfirmAddAction") }));

    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsShortcutRailDoneAction") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailLaunchAction", { title: "Exchange 分层通讯簿.txt" }) }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Exchange 分层通讯簿.txt" })).toBeInTheDocument();
    });
    expect(fileContextApiMock.getFilePreview).toHaveBeenCalledWith("workspace-2", "Exchange 分层通讯簿.txt");
  });

  it("文档库来源的快捷应用预览编辑后会走文档库写回接口保存", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T10:30:00.000Z");
    dashboardState.shortcutApps = [
      createAffairsShortcutAppState({
        title: "会员管理",
        sourceKind: "affairs_library",
        workspaceId: "workspace-2",
        entryPath: "Obsidian/Tools/会员管理.html"
      }, "2026-06-04T10:30:00.000Z")
    ];
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    conversationApiMock.getAffairsLibraryPreview.mockResolvedValue({
      workspaceId: "workspace-2",
      path: "Obsidian/Tools/会员管理.html",
      supported: true,
      kind: "html",
      reason: null,
      content: "<html><body><h1>会员管理</h1></body></html>",
      version: "shortcut-affairs-v1",
      size: 4096,
      updatedAt: "2026-06-04T10:30:00.000Z",
      previewPath: "/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html",
      previewUrl: "http://127.0.0.1:3002/preview/affairs-files/mock/Obsidian/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html",
      onlyOffice: null,
      capabilities: {
        canEdit: true,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsShortcutRailLaunchAction", { title: "会员管理" }) }));
    await userEvent.click(await screen.findByRole("tab", { name: t("conversation.fileViewerEdit") }));
    const editor = await screen.findByTestId("file-viewer-editor");
    await userEvent.clear(editor);
    await userEvent.type(editor, "<html><body><h1>会员管理-已更新</h1></body></html>");
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(conversationApiMock.operateAffairsLibraryFile).toHaveBeenCalledWith("workspace-2", {
        opType: "write",
        srcPath: "Obsidian/Tools/会员管理.html",
        content: "<html><body><h1>会员管理-已更新</h1></body></html>",
        expectedVersion: "shortcut-affairs-v1"
      });
    });
    expect(fileContextApiMock.saveFileContent).not.toHaveBeenCalled();
  });

  it("锁定状态下会隐藏标签页添加按钮", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:40:00.000Z");
    dashboardState.layoutLocked = true;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    expect(screen.queryByRole("button", { name: t("shell.affairsWorkbenchAddTabAction") })).toBeNull();
  });

  it("解锁状态下支持新增、重命名和删除标签页", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:45:00.000Z");
    dashboardState.layoutLocked = false;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchAddTabAction") }));
    expect(await screen.findByRole("tab", { name: /工作台 2/i })).toBeInTheDocument();

    const renameButtons = screen.getAllByRole("button", { name: t("shell.affairsWorkbenchRenameTabAction") });
    await userEvent.click(renameButtons[1]);
    const input = screen.getByRole("textbox", { name: t("shell.affairsWorkbenchRenameTabAction") });
    await userEvent.clear(input);
    await userEvent.type(input, "项目看板");
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole("tab", { name: /项目看板/i })).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole("button", { name: t("shell.affairsWorkbenchDeleteTabAction") });
    await userEvent.click(deleteButtons[1]);
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /项目看板/i })).toBeNull();
    });
  });

  it("解锁按钮会显示在中间工作台标签栏最右侧，而不是右侧边栏顶部", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-05T09:45:00.000Z");
    dashboardState.layoutLocked = true;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    const unlockButton = await screen.findByRole("button", { name: t("shell.affairsWorkbenchUnlockLayoutAction") });
    const tabbarActions = document.querySelector(".affairs-dashboard-tabbar-actions");
    const auxiliaryHeader = document.querySelector(".workbench-auxiliary-header");

    expect(tabbarActions).not.toBeNull();
    expect(tabbarActions?.firstElementChild).toBe(unlockButton);
    expect(auxiliaryHeader?.contains(unlockButton)).toBe(false);
  });

  it("远端工作台布局会优先覆盖本地快照", async () => {
    const localDashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T10:00:00.000Z");
    localDashboardState.layoutLocked = true;
    localDashboardState.tabs = [
      ...localDashboardState.tabs,
      {
        id: "local-tab-1",
        title: "本地看板",
        widgets: [],
        layout: [],
        createdAt: "2026-06-04T10:01:00.000Z",
        updatedAt: "2026-06-04T10:01:00.000Z"
      }
    ];
    localDashboardState.activeTabId = "local-tab-1";
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", localDashboardState);

    const remoteDashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T10:10:00.000Z");
    remoteDashboardState.layoutLocked = false;
    remoteDashboardState.tabs = [
      ...remoteDashboardState.tabs,
      {
        id: "remote-tab-1",
        title: "远端看板",
        widgets: [],
        layout: [],
        createdAt: "2026-06-04T10:11:00.000Z",
        updatedAt: "2026-06-04T10:11:00.000Z"
      }
    ];
    remoteDashboardState.activeTabId = "remote-tab-1";
    conversationApiMock.getGlobalAffairsDashboardState.mockResolvedValueOnce({
      dashboardState: remoteDashboardState
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    expect(await screen.findByRole("tab", { name: /远端看板/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /本地看板/i })).toBeNull();
    expect(screen.getByRole("button", { name: t("shell.affairsWorkbenchAddTabAction") })).toBeInTheDocument();
  });

  it("全局事务配置缺失时会把旧本地工作台快照迁到全局接口", async () => {
    const localDashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T10:20:00.000Z");
    localDashboardState.layoutLocked = false;
    localDashboardState.tabs = [
      ...localDashboardState.tabs,
      {
        id: "local-migrate-tab-1",
        title: "本地迁移看板",
        widgets: [],
        layout: [],
        createdAt: "2026-06-04T10:21:00.000Z",
        updatedAt: "2026-06-04T10:21:00.000Z"
      }
    ];
    localDashboardState.activeTabId = "local-migrate-tab-1";
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", localDashboardState);
    conversationApiMock.getGlobalAffairsDashboardState.mockResolvedValueOnce({
      dashboardState: {}
    });

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview",
      auxiliaryTab: "detail"
    }, navigationGroupsWithBoundLibraryWorkspace);

    expect(await screen.findByRole("tab", { name: /本地迁移看板/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(conversationApiMock.updateGlobalAffairsDashboardState).toHaveBeenCalledWith({
        dashboardState: expect.objectContaining({
          workspaceId: "affairs-global",
          layoutLocked: false,
          activeTabId: "local-migrate-tab-1"
        })
      });
    });
  });

  it("Teable 块会选择表和视图，并用自定义表格渲染记录", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:30:00.000Z");
    dashboardState.layoutLocked = false;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchAddWidgetAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchWidgetTypeTeable") }));

    expect(await screen.findByLabelText(t("shell.teableRuntimeTableField"))).toHaveValue("tbl-1");
    expect(await screen.findByLabelText(t("shell.teableRuntimeViewField"))).toHaveValue("viw-1");
    expect(await screen.findByLabelText(t("shell.teableRuntimeCreateFormViewField"))).toHaveValue("frm-create");
    expect(await screen.findByLabelText(t("shell.teableRuntimeEditFormViewField"))).toHaveValue("frm-create");
    await userEvent.selectOptions(screen.getByLabelText(t("shell.teableRuntimeEditFormViewField")), "frm-edit");
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchConfirmAddWidgetAction") }));

    expect(await screen.findByText("张三跟进")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.queryByText("Teable 隐藏字段")).toBeNull();
    expect(screen.queryByText("不该显示")).toBeNull();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers.slice(0, 2)).toEqual(["得分", "标题"]);
    expect(teableRuntimeApiMock.listTeableRuntimeTables).toHaveBeenCalledTimes(1);
    expect(teableRuntimeApiMock.listTeableRuntimeViews).toHaveBeenCalledWith("tbl-1");
    expect(teableRuntimeApiMock.listTeableRuntimeRecords).toHaveBeenCalledWith("tbl-1", expect.objectContaining({
      viewId: "viw-1"
    }));

    await userEvent.click(screen.getByRole("button", { name: t("shell.teableRuntimeRefreshAction") }));
    await waitFor(() => {
      expect(teableRuntimeApiMock.listTeableRuntimeViews).toHaveBeenCalledTimes(3);
    });

    await userEvent.click(screen.getByText("张三跟进"));
    const dialog = await screen.findByRole("dialog", { name: t("shell.teableRuntimeRecordDrawerTitle") });
    expect(within(dialog).getByText("维护标题 *")).toBeInTheDocument();
    expect(within(dialog).queryByText("Teable 隐藏字段")).toBeNull();
    expect(within(dialog).queryByText("得分")).toBeNull();
  });

  it("Teable 块新建记录会打开独立模态框", async () => {
    const dashboardState = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T09:40:00.000Z");
    dashboardState.layoutLocked = false;
    writeViewSnapshot("workbench.affairs.dashboard.workspace-1", dashboardState);

    renderWorkbenchWithCustomNavigationGroups({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    }, navigationGroupsWithBoundLibraryWorkspace);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchAddWidgetAction") }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsWorkbenchWidgetTypeTeable") }));
    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsWorkbenchConfirmAddWidgetAction") }));

    expect(await screen.findByText("张三跟进")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("shell.teableRuntimeCreateRecordAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("shell.teableRuntimeCreateRecordModalTitle") });
    expect(within(dialog).getByText(t("shell.teableRuntimeCreateRecordFieldsTitle"))).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("客户标题 *"), "李四跟进");
    await userEvent.click(within(dialog).getByRole("button", { name: t("shell.teableRuntimeCreateRecordAction") }));

    await waitFor(() => {
      expect(teableRuntimeApiMock.createTeableRuntimeRecord).toHaveBeenCalledWith("tbl-1", {
        fld_title: "李四跟进"
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.teableRuntimeCreateRecordModalTitle") })).toBeNull();
    });
  });


});
