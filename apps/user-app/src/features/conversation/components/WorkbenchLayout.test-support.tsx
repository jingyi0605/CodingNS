import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clientConfigStore } from "../../../config/client-config-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  createButlerInboxItem,
  deleteButlerInboxItem,
  getButlerOverview,
  getButlerProfile,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerNotificationArchives,
  listButlerProjects,
  updateButlerNotificationArchive,
  updateButlerInboxItem
} from "../../butler/api/butler-api";
import {
  WorkbenchLayout,
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups,
  useWorkbenchShell
} from "./WorkbenchLayout";

export {
  authStore,
  clientConfigStore,
  localUiPreferenceStore,
  clearViewSnapshot,
  writeViewSnapshot,
  ToastProvider,
  t,
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups,
  mockedGetButlerProfile,
  mockedGetButlerOverview,
  mockedListButlerFollowUpTasks,
  mockedListButlerInboxItems,
  mockedListButlerNotificationArchives,
  mockedListButlerProjects
};

const hoistedWindowMocks = vi.hoisted(() => ({
  openAffairsExternalWindowMock: vi.fn(),
  openCodeExternalWindowMock: vi.fn(),
  openFilesExternalWindowMock: vi.fn(),
  openGitExternalWindowMock: vi.fn(),
  openProcessesExternalWindowMock: vi.fn(),
  showDesktopContextMenuMock: vi.fn()
}));

export const openAffairsExternalWindowMock = hoistedWindowMocks.openAffairsExternalWindowMock;
export const openCodeExternalWindowMock = hoistedWindowMocks.openCodeExternalWindowMock;
export const openFilesExternalWindowMock = hoistedWindowMocks.openFilesExternalWindowMock;
export const openGitExternalWindowMock = hoistedWindowMocks.openGitExternalWindowMock;
export const openProcessesExternalWindowMock = hoistedWindowMocks.openProcessesExternalWindowMock;
export const showDesktopContextMenuMock = hoistedWindowMocks.showDesktopContextMenuMock;

vi.mock("../../../platform/desktop/window-openers", () => ({
  openAffairsExternalWindow: hoistedWindowMocks.openAffairsExternalWindowMock,
  openCodeExternalWindow: hoistedWindowMocks.openCodeExternalWindowMock,
  openFilesExternalWindow: hoistedWindowMocks.openFilesExternalWindowMock,
  openGitExternalWindow: hoistedWindowMocks.openGitExternalWindowMock,
  openProcessesExternalWindow: hoistedWindowMocks.openProcessesExternalWindowMock
}));

vi.mock("../../../platform/desktop/desktop-context-menu", () => ({
  showDesktopContextMenu: hoistedWindowMocks.showDesktopContextMenuMock
}));

vi.mock("../../butler/api/butler-api", () => ({
  listAssistantAutomations: vi.fn().mockResolvedValue({ items: [] }),
  createButlerInboxItem: vi.fn(),
  deleteButlerInboxItem: vi.fn(),
  getButlerProfile: vi.fn(),
  getButlerOverview: vi.fn(),
  listButlerFollowUpTasks: vi.fn(),
  listButlerInboxItems: vi.fn(),
  listButlerNotificationArchives: vi.fn(),
  listButlerProjects: vi.fn(),
  listRecentAssistantAutomationRuns: vi.fn().mockResolvedValue({ items: [] }),
  updateButlerNotificationArchive: vi.fn(),
  updateButlerInboxItem: vi.fn()
}));

const mockedCreateButlerInboxItem = vi.mocked(createButlerInboxItem);
const mockedDeleteButlerInboxItem = vi.mocked(deleteButlerInboxItem);
const mockedGetButlerProfile = vi.mocked(getButlerProfile);
const mockedGetButlerOverview = vi.mocked(getButlerOverview);
const mockedListButlerFollowUpTasks = vi.mocked(listButlerFollowUpTasks);
const mockedListButlerInboxItems = vi.mocked(listButlerInboxItems);
const mockedListButlerNotificationArchives = vi.mocked(listButlerNotificationArchives);
const mockedListButlerProjects = vi.mocked(listButlerProjects);
const mockedUpdateButlerNotificationArchive = vi.mocked(updateButlerNotificationArchive);
const mockedUpdateButlerInboxItem = vi.mocked(updateButlerInboxItem);

export const WORKBENCH_NAVIGATION_SNAPSHOT_KEY = "workbench.navigation.snapshot";

export class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static workbenchSnapshot: Record<string, unknown> = { items: [] };

  readyState = 1;
  sentPayloads: string[] = [];

  constructor(public readonly url: string) {
    super();
    MockWebSocket.instances.push(this);

    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      this.dispatchMessage({ type: "system.connected" });
    });
  }

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.workbenchSnapshot = { items: [] };
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
    const parsed = JSON.parse(payload) as { type: string; sessionId?: string };

    if (parsed.type === "workbench.subscribe" || parsed.type === "workbench.refresh") {
      this.dispatchMessage({
        type: "workbench.snapshot",
        snapshot: MockWebSocket.workbenchSnapshot
      });
      return;
    }

    if (parsed.type === "session.subscribe" && parsed.sessionId) {
      this.dispatchMessage({
        type: "session.subscribed",
        sessionId: parsed.sessionId
      });
    }
  }

  close() {
    this.dispatchEvent(new Event("close"));
  }

  dispatchMessage(payload: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(payload)
      })
    );
  }
}

export class NoSnapshotWebSocket extends EventTarget {
  readyState = 1;

  constructor(public readonly url: string) {
    super();

    queueMicrotask(() => {
      this.dispatchEvent(new Event("open"));
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "system.connected" })
        })
      );
    });
  }

  send() {}

  close() {
    this.dispatchEvent(new Event("close"));
  }
}

const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;
const originalInnerWidth = window.innerWidth;
const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");

export function mockNavigator({
  userAgent,
  platform,
  maxTouchPoints = 0
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints
  });
}


export function registerWorkbenchLayoutTestHooks() {
    const snapshotKeysToClear = [
      WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
      "workspace-management.summary.workspace-1",
      "workspace-management.summary.workspace-1-child",
      "workspace-management.summary.isolated-1",
      "git-sidebar.snapshot.workspace-1",
      "git-sidebar.snapshot.workspace-1-child",
      "git-sidebar.snapshot.isolated-1"
    ];

    beforeEach(() => {
      openAffairsExternalWindowMock.mockReset();
      openCodeExternalWindowMock.mockReset();
      openFilesExternalWindowMock.mockReset();
      openGitExternalWindowMock.mockReset();
      openProcessesExternalWindowMock.mockReset();
      showDesktopContextMenuMock.mockReset();
      mockedCreateButlerInboxItem.mockReset();
      mockedDeleteButlerInboxItem.mockReset();
      mockedGetButlerProfile.mockReset();
      mockedGetButlerOverview.mockReset();
      mockedListButlerFollowUpTasks.mockReset();
      mockedListButlerInboxItems.mockReset();
      mockedListButlerNotificationArchives.mockReset();
      mockedListButlerProjects.mockReset();
      mockedUpdateButlerNotificationArchive.mockReset();
      mockedUpdateButlerInboxItem.mockReset();
      openAffairsExternalWindowMock.mockResolvedValue({
        ok: true,
        value: {
          windowId: "affairs-workspace-1"
        }
      });
      openCodeExternalWindowMock.mockResolvedValue({
        ok: true,
        value: {
          windowId: "code-workspace-1"
        }
      });
      openFilesExternalWindowMock.mockResolvedValue({
        ok: true,
        value: {
          windowId: "files-workspace-1"
        }
      });
      openGitExternalWindowMock.mockResolvedValue({
        ok: true,
        value: {
          windowId: "git-workspace-1"
        }
      });
      openProcessesExternalWindowMock.mockResolvedValue({
        ok: true,
        value: {
          windowId: "processes-workspace-1"
        }
      });
      window.localStorage.clear();
      window.sessionStorage.clear();
      localUiPreferenceStore.setSessionDisplaySortMode("createdAt");
      localUiPreferenceStore.setNotificationPreferences({
        notifyOnPermissionRequest: true,
        notifyOnSessionCompleted: true,
        notifyOnSessionFailed: true
      });
      mockedGetButlerProfile.mockResolvedValue({
        initialized: false,
        profile: null
      } as never);
      mockedGetButlerOverview.mockResolvedValue({
        overview: {
          version: "v1",
          generatedAt: "2026-04-07T00:00:00.000Z",
          global: {
            projectCount: 0,
            activeProjectCount: 0,
            blockedProjectCount: 0,
            highRiskProjectCount: 0,
            topRisks: [],
            nextActions: []
          },
          projects: [],
          sessions: [],
          patrols: [],
          verifications: []
        }
      } as never);
      mockedListButlerFollowUpTasks.mockResolvedValue({ items: [] } as never);
      mockedListButlerInboxItems.mockResolvedValue({ items: [] } as never);
      mockedListButlerNotificationArchives.mockResolvedValue({ items: [] } as never);
      mockedListButlerProjects.mockResolvedValue({ items: [] } as never);
      mockedUpdateButlerNotificationArchive.mockResolvedValue({ item: null } as never);
      for (const key of snapshotKeysToClear) {
        clearViewSnapshot(key);
      }
      authStore.clear();
      MockWebSocket.reset();
      global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

      authStore.hydrate({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
        user: {
          userId: "user-1",
          username: "admin",
          role: "admin"
        }
      });
    });

    afterEach(() => {
      cleanup();
      vi.clearAllTimers();
      vi.restoreAllMocks();
      vi.useRealTimers();
      for (const key of snapshotKeysToClear) {
        clearViewSnapshot(key);
      }
      global.fetch = originalFetch;
      global.WebSocket = originalWebSocket;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: originalInnerWidth
      });

      if (userAgentDescriptor) {
        Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
      }

      if (platformDescriptor) {
        Object.defineProperty(window.navigator, "platform", platformDescriptor);
      }

      if (maxTouchPointsDescriptor) {
        Object.defineProperty(window.navigator, "maxTouchPoints", maxTouchPointsDescriptor);
      }

      if (originalTauriInternals) {
        window.__TAURI_INTERNALS__ = originalTauriInternals;
        return;
      }

      delete window.__TAURI_INTERNALS__;
    });
}

export function renderWorkbenchRoute(
  initialEntry = "/workspaces/workspace-1/sessions/session-1",
  options?: {
    shellMode?: "desktop" | "mobile";
    showLocationProbe?: boolean;
  }
) {
  const shellMode = options?.shellMode ?? "desktop";

  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        {options?.showLocationProbe ? <CurrentLocationProbe /> : null}
        <Routes>
          <Route element={<WorkbenchLayout shellMode={shellMode} />}>
            <Route index element={<CurrentLocationProbe />} />
            <Route path="/landing" element={<CurrentLocationProbe />} />
            <Route path="/workspaces" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/sessions" element={<CurrentLocationProbe />} />
            <Route
              path="/workspaces/:workspaceId/sessions/:sessionId"
              element={<CurrentLocationProbe />}
            />
            <Route path="/workspaces/:workspaceId/chats" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/chats/new" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/chats/:chatId" element={<CurrentLocationProbe />} />
            <Route path="/documents" element={<CurrentLocationProbe />} />
            <Route path="/workbench" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/terminals" element={<CurrentLocationProbe />} />
            <Route path="/workspaces/:workspaceId/butler" element={<CurrentLocationProbe />} />
            <Route path="/settings" element={<CurrentLocationProbe />} />
            <Route path="/sessions/:sessionId" element={<CurrentLocationProbe />} />
            <Route path="/terminals" element={<CurrentLocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

export function ButlerAuxiliaryProbe() {
  const { setAuxiliaryPanel } = useWorkbenchShell();

  useEffect(() => {
    setAuxiliaryPanel(
      <div data-testid="butler-right-panel">
        Butler Right Panel
      </div>
    );

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [setAuxiliaryPanel]);

  return <CurrentLocationProbe />;
}

export function StartDraftSessionProbe({
  workspaceId,
  provider
}: {
  workspaceId: string;
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi";
}) {
  const { startDraftSession } = useWorkbenchShell();

  return (
    <div>
      <button type="button" onClick={() => startDraftSession(workspaceId, provider)}>
        触发草稿会话
      </button>
      <CurrentLocationProbe />
    </div>
  );
}

export async function findSessionCardByTitle(title: string) {
  const titleElements = await screen.findAllByText(title);
  const card = titleElements.find((element) => element.closest(".workbench-session-card"))?.closest(
    ".workbench-session-card"
  );

  if (!(card instanceof HTMLElement)) {
    throw new Error(`未找到会话卡片: ${title}`);
  }

  return card;
}

export function getSessionCardByTitle(title: string) {
  const card = screen
    .queryAllByText(title)
    .find((element) => element.closest(".workbench-session-card"))
    ?.closest(".workbench-session-card");

  if (!(card instanceof HTMLElement)) {
    throw new Error(`未找到会话卡片: ${title}`);
  }

  return card;
}

export function querySessionCardsByTitle(title: string) {
  return screen
    .queryAllByText(title)
    .map((element) => element.closest(".workbench-session-card"))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

export function openSessionCardContextMenu(card: HTMLElement, position: { x: number; y: number } = { x: 220, y: 220 }) {
  fireEvent.contextMenu(card, {
    clientX: position.x,
    clientY: position.y
  });
}

export async function findWorkspaceGroupByName(name: string) {
  const matches = await screen.findAllByText(name);
  const group = matches.find((element) => element.closest(".workbench-workspace-group"))?.closest(
    ".workbench-workspace-group"
  );

  if (!(group instanceof HTMLElement)) {
    throw new Error(`未找到工作区分组: ${name}`);
  }

  return group;
}

export function readWorkspaceGroupOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".workbench-workspace-group .workbench-workspace-toggle strong"))
    .map((element) => element.textContent?.trim() ?? "")
    .filter((value) => value.length > 0);
}

export function createDragDataTransfer() {
  const store = new Map<string, string>();

  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    }
  };
}

export function CurrentLocationProbe() {
  const location = useLocation();

  return (
    <div>
      <div data-testid="current-path">{location.pathname}</div>
      <div data-testid="current-search">{location.search}</div>
    </div>
  );
}

export function createWorkspace(id: string, name: string, backgroundColor?: string | null) {
  return {
    id,
    name,
    path: `C:/repo/${id}`,
    repoRoot: `C:/repo/${id}`,
    backgroundColor: backgroundColor ?? null
  };
}

export function createSessionSummary(input: {
  sessionId: string;
  title: string;
  workspaceId: string;
  provider?: "codex" | "claude-code" | "opencode";
  isArchived?: boolean;
  parentSessionId?: string | null;
  forkMethod?:
    | "native_session_fork"
    | "native_message_fork"
    | "reconstructed_session_fork"
    | "reconstructed_message_fork"
    | null;
  forkSourceType?: "session" | "message" | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  runningState?: "idle" | "starting" | "running" | "stale" | "unknown" | "completed" | "interrupted" | "failed";
  activitySource?: "none" | "runtime" | "inferred";
  activityResolutionSource?: "authoritative_runtime" | "authoritative_provider_event" | "inferred_log" | "unknown";
  activityState?: "idle" | "running" | "completed_unread";
  isFavorite?: boolean;
  syncStatus?: "idle" | "syncing" | "error";
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  parallelGroup?: {
    groupId: string;
    role: "anchor" | "member";
    memberCount: number;
    sourceType: "fork" | "new";
    sourceSessionId: string | null;
    anchorSessionId: string | null;
    colorToken: string;
  } | null;
  sessionIsolatedWorkspace?: {
    id: string;
    workspaceId: string;
    sourceWorkspaceId: string;
    branchName: string;
    lifecycleStatus: "active" | "promoted" | "removing" | "removed";
    promotedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  displayParentSessionId?: string | null;
}) {
  const provider = input.provider ?? "codex";

  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    provider,
    providerSessionId: `raw-${input.sessionId}`,
    rawStoreRef: `${provider}://${input.sessionId}`,
    isArchived: input.isArchived ?? false,
    isFavorite: input.isFavorite ?? false,
    parentSessionId: input.parentSessionId ?? null,
    forkMethod: input.forkMethod ?? null,
    forkSourceType: input.forkSourceType ?? null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: input.isSubagent ?? false,
    subagentLabel: input.subagentLabel ?? null,
    title: input.title,
    messageCount: 1,
    lastMessageAt: "2026-03-24T10:00:00.000Z",
    createdAt: "2026-03-24T09:00:00.000Z",
    updatedAt: "2026-03-24T10:00:00.000Z",
    syncStatus: input.syncStatus ?? "idle",
    syncCursor: "cursor-1",
    lastSyncAt: "2026-03-24T10:00:00.000Z",
    lastErrorCode: input.lastErrorCode ?? null,
    lastErrorDetail: input.lastErrorDetail ?? null,
    resumedAt: null,
    runningState: input.runningState ?? "idle",
    activitySource: input.activitySource ?? "none",
    activityResolutionSource: input.activityResolutionSource,
    lastEventAt: "2026-03-24T10:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: input.activityState ?? "idle",
    parallelGroup: input.parallelGroup ?? null,
    sessionIsolatedWorkspace: input.sessionIsolatedWorkspace ?? null,
    displayParentSessionId: input.displayParentSessionId ?? null
  };
}

export function createWorkbenchSnapshot(items: Array<Record<string, unknown>>) {
  return {
    items: items.map((item) => ({
      childWorktrees: [],
      ...item
    }))
  };
}

export function createWorkbenchWorktreeNode(input: {
  workspace: ReturnType<typeof createWorkspace>;
  displayName: string;
  branchName: string;
  sessions: ReturnType<typeof createSessionSummary>[];
  children?: Array<Record<string, unknown>>;
  depth?: number;
  parentWorkspaceId?: string;
  lifecycleStatus?: "active" | "merged" | "abandoned" | "removing" | "removed";
}) {
  return {
    workspace: input.workspace,
    meta: {
      workspaceId: input.workspace.id,
      rootWorkspaceId: "workspace-1",
      parentWorkspaceId: input.parentWorkspaceId ?? "workspace-1",
      sourceWorkspaceId: input.parentWorkspaceId ?? "workspace-1",
      mergeTargetWorkspaceId: input.parentWorkspaceId ?? "workspace-1",
      branchName: input.branchName,
      baseRef: "main",
      baseCommit: "commit-base",
      headCommit: "commit-head",
      displayName: input.displayName,
      depth: input.depth ?? 1,
      lifecycleStatus: input.lifecycleStatus ?? "active",
      mergedAt: null,
      removedAt: null,
      createdAt: "2026-04-12T08:00:00.000Z",
      updatedAt: "2026-04-12T08:00:00.000Z"
    },
    sessions: input.sessions,
    children: (input.children ?? []).map((child) => ({
      children: [],
      ...child
    }))
  };
}

export function createWorkspaceManagementSummary(workspaceId: string, name: string) {
  return {
    workspaceId,
    name,
    path: `C:/repo/${workspaceId}`,
    git: {
      isRepository: true,
      repoRoot: `C:/repo/${workspaceId}`,
      currentBranch: "main",
      commitCount: 12,
      remotes: [
        {
          name: "origin",
          url: `https://example.com/team/${workspaceId}.git`
        }
      ],
      error: null
    },
    codeComposition: {
      scannedFileCount: 4,
      truncated: false,
      items: [
        {
          type: "TypeScript",
          count: 2,
          ratio: 0.5
        },
        {
          type: "Markdown",
          count: 1,
          ratio: 0.25
        },
        {
          type: "JSON",
          count: 1,
          ratio: 0.25
        }
      ],
      error: null
    }
  };
}

async function clickOpenSessionToastActionByTitle(title: string) {
  const titleElement = await screen.findByText(title);
  const toastCard = titleElement.closest(".toast-card");

  if (!(toastCard instanceof HTMLElement)) {
    throw new Error(`未找到 toast 卡片: ${title}`);
  }

  const openSessionAction = within(toastCard).getByRole("button", {
    name: t("shell.contextOpenSession")
  });
  await userEvent.click(openSessionAction);
}

export function createPermissionRequest(input: {
  id: string;
  sessionId: string;
  title: string;
}) {
  return {
    id: input.id,
    sessionId: input.sessionId,
    provider: "codex",
    providerSessionId: `provider-${input.sessionId}`,
    requestKey: `request-${input.id}`,
    kind: "command",
    status: "pending",
    title: input.title,
    summary: input.title,
    detail: null,
    reason: null,
    toolName: null,
    command: "echo test",
    cwd: "/tmp",
    paths: [],
    permissionProfile: null,
    questions: [],
    actions: [],
    rawPayload: null,
    createdAt: "2026-04-01T08:00:00.000Z",
    updatedAt: "2026-04-01T08:00:00.000Z",
    resolvedAt: null
  };
}

export function createUnavailableCapabilities(
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi",
  limitation: string
) {
  return {
    provider,
    canStartSession: false,
    canResumeSession: false,
    canSendMessage: false,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsCheckpoint: false,
    limitations: [limitation]
  };
}

export function createAvailableCapabilities(
  provider: "codex" | "claude-code" | "opencode" | "gemini" | "kimi"
) {
  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    limitations: []
  };
}

export function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export function mockAffairsLibraryFetch() {
  global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
    const url = String(rawInput);

    if (url.includes("/api/affairs/library-capability")) {
      return createJsonResponse({
        enabled: true,
        binding: {
          workspaceId: "workspace-1",
          rootDir: "/Users/jackson/WorkFile",
          enabled: true,
          configRelativePath: ".ai-index/doc-semantic-index.config.json",
          exportMode: "v2",
          updatedAt: "2026-05-31T08:00:00.000Z"
        }
      });
    }

    if (url.includes("/api/affairs/library-snapshot")) {
      return createJsonResponse({
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
            path: "客户/重要",
            name: "重要",
            rootType: "manual",
            parentPath: "客户",
            depth: 1,
            documentCount: 3
          },
          {
            path: "客户",
            name: "客户",
            rootType: "manual",
            parentPath: null,
            depth: 0,
            documentCount: 3
          }
        ],
        favorites: [
          {
            kind: "folder",
            path: "客户资料",
            label: "客户资料"
          }
        ],
        folders: [
          {
            path: "客户资料",
            name: "客户资料",
            parentPath: null,
            documentCount: 3,
            directDocumentCount: 1
          }
        ],
        documentCount: 1,
        lastError: null
      });
    }

    if (url.includes("/api/affairs/library-documents")) {
      const parsedUrl = new URL(url, "https://codingns.local");
      const browseMode = parsedUrl.searchParams.get("browseMode");
      const selectedFolderPath = parsedUrl.searchParams.get("selectedFolderPath");
      const shouldReturnNestedDocument =
        browseMode === "tag"
        || selectedFolderPath === "客户资料";

      return createJsonResponse({
        total: shouldReturnNestedDocument ? 1 : 0,
        offset: 0,
        limit: 120,
        items: shouldReturnNestedDocument
          ? [
            {
              documentId: "doc-1",
              path: "客户资料/跟进记录.md",
              title: "跟进记录",
              summary: "事务文档摘要",
              updatedAt: "2026-05-31T08:00:00.000Z",
              tags: ["客户/重要"],
              derivedTags: [],
              isFavorite: false
            }
          ]
          : []
      });
    }

    if (url.includes("/api/affairs/library-config")) {
      return createJsonResponse({
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
    }

    if (url.includes("/api/affairs/lightweight-sessions")) {
      return createJsonResponse({ items: [] });
    }

    if (url.includes("/api/affairs/assistant-sessions")) {
      return createJsonResponse({
        item: {
          projectId: null,
          projectWorkspaceId: null,
          agentWorkspacePath: null,
          sessions: [],
          updatedAt: "2026-06-05T08:00:00.000Z"
        }
      });
    }

    return createJsonResponse({});
  }) as typeof fetch;
}

export function createSkillOverviewResponse() {
  return {
    summary: {
      managedSkillCount: 1,
      managedEntryCount: 1,
      unmanagedEntryCount: 0,
      conflictedEntryCount: 0,
      diagnosticCount: 0
    },
    managedSkills: [
      {
        skill: {
          id: "skill-1",
          name: "team-helper",
          directoryName: "team-helper",
          scope: "workspace",
          sourceType: "imported",
          managedState: "managed",
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T08:00:00.000Z"
        },
        ssotPath: "/tmp/managed-skills/team-helper",
        bindings: [
          {
            targetCli: "codex",
            syncStatus: "synced",
            enabled: true
          }
        ]
      }
    ],
    unmanagedEntries: [],
    conflictedEntries: [],
    diagnostics: [],
    scannedAt: "2026-04-18T08:30:00.000Z",
    assistantRuntimeSkills: [
      {
        name: "codingns-assistant",
        directoryName: "codingns-assistant",
        sourcePath: "/tmp/managed-skills/.assistant-runtime/codingns-assistant",
        usedByTargetCli: ["codex"]
      }
    ]
  };
}
