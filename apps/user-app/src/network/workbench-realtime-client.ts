import { getHostBaseUrl, getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";
import { logPerfDebug } from "../shared/debug/perf-debug";
import { ConnectionManager } from "./connection-manager";
import type { HostTransportSocket } from "./host-transport";
import { resolveHostTransportTarget } from "./host-transport-registry";

import type {
  WorkbenchSnapshotDto,
  WorkspaceManagementSummaryDto
} from "../features/conversation/api/conversation-api";
import type { FileNodeDto } from "../features/conversation/api/file-context-api";
import type {
  GitBranchSnapshotDto,
  GitHistoryItemDto,
  GitStatusDto
} from "../features/conversation/api/git-api";
import type {
  TerminalDto,
  TerminalShellOptionDto,
  TerminalTemplateDto,
  TerminalTemplateRuntimeStatusDto
} from "../features/terminal/api/terminal-api";

type WorkbenchConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface SystemConnectedEvent {
  type: "system.connected";
}

interface WorkbenchSnapshotEvent {
  type: "workbench.snapshot";
  revision: string;
  unchanged: boolean;
  snapshot: WorkbenchSnapshotDto | null;
}

export interface FileTreeRealtimeSnapshotDto {
  revision?: string;
  workspaceId: string;
  path: string;
  items: FileNodeDto[];
}

interface FileTreeSnapshotEvent {
  type: "fileTree.snapshot";
  revision: string;
  unchanged: boolean;
  snapshot: FileTreeRealtimeSnapshotDto | null;
}

export interface GitRealtimeSnapshotDto {
  revision?: string;
  workspaceId: string;
  status: GitStatusDto | null;
  history: GitHistoryItemDto[];
  historyTotalCount: number;
  historyNextCursor: string | null;
  branches: GitBranchSnapshotDto | null;
}

interface GitSnapshotEvent {
  type: "git.snapshot";
  revision: string;
  unchanged: boolean;
  snapshot: GitRealtimeSnapshotDto | null;
}

export interface TerminalManagerRealtimeSnapshotDto {
  revision?: string;
  workspaceId: string;
  terminals: TerminalDto[];
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
  shellOptions: TerminalShellOptionDto[];
}

interface TerminalManagerSnapshotEvent {
  type: "terminalManager.snapshot";
  revision: string;
  unchanged: boolean;
  snapshot: TerminalManagerRealtimeSnapshotDto | null;
}

export type WorkspaceManagementRealtimeSnapshotDto = WorkspaceManagementSummaryDto;

interface WorkspaceManagementSnapshotEvent {
  type: "workspaceManagement.snapshot";
  revision: string;
  unchanged: boolean;
  snapshot: WorkspaceManagementRealtimeSnapshotDto | null;
}

interface SessionErrorEvent {
  type: "session.error";
  error_code: string;
  detail: string;
}

type IncomingEvent =
  | WorkbenchSnapshotEvent
  | FileTreeSnapshotEvent
  | GitSnapshotEvent
  | TerminalManagerSnapshotEvent
  | WorkspaceManagementSnapshotEvent
  | SystemConnectedEvent
  | SessionErrorEvent;

export interface WorkbenchRealtimeClientOptions {
  onConnectionChange: (state: WorkbenchConnectionState) => void;
  onSnapshot: (snapshot: WorkbenchSnapshotDto) => void;
  onFileTreeSnapshot?: (snapshot: FileTreeRealtimeSnapshotDto) => void;
  onGitSnapshot?: (snapshot: GitRealtimeSnapshotDto) => void;
  onTerminalManagerSnapshot?: (snapshot: TerminalManagerRealtimeSnapshotDto) => void;
  onWorkspaceManagementSnapshot?: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void;
  onUnauthorized: () => void;
}

export class WorkbenchRealtimeClient {
  private socket: HostTransportSocket | null = null;
  private disposed = false;
  private authRecoveryInFlight = false;
  private pendingRefresh = false;
  private workbenchKnownRevision: string | null;
  private fileTreeSubscription: {
    workspaceId: string;
    paths: string[];
    knownRevisionByPath: Record<string, string>;
  } | null = null;
  private gitSubscription: { workspaceId: string; knownRevision: string | null } | null = null;
  private terminalManagerSubscription: { workspaceId: string; knownRevision: string | null } | null = null;
  private workspaceManagementSubscription: { workspaceId: string; knownRevision: string | null } | null = null;
  private pendingFileTreeRefresh: {
    workspaceId: string;
    paths: string[];
    knownRevisionByPath: Record<string, string>;
  } | null = null;
  private pendingGitRefresh: { workspaceId: string; knownRevision: string | null } | null = null;
  private pendingTerminalManagerRefresh: { workspaceId: string; knownRevision: string | null } | null = null;
  private pendingWorkspaceManagementRefresh: { workspaceId: string; knownRevision: string | null } | null = null;
  private readonly fileTreeRevisionByPath = new Map<string, string>();
  private readonly gitRevisionByWorkspaceId = new Map<string, string>();
  private readonly terminalManagerRevisionByWorkspaceId = new Map<string, string>();
  private readonly workspaceManagementRevisionByWorkspaceId = new Map<string, string>();
  private readonly fileTreeListeners = new Set<(snapshot: FileTreeRealtimeSnapshotDto) => void>();
  private readonly gitListeners = new Set<(snapshot: GitRealtimeSnapshotDto) => void>();
  private readonly terminalManagerListeners = new Set<
    (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  >();
  private readonly workspaceManagementListeners = new Set<
    (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void
  >();
  private workbenchSubscribeStartedAtMs: number | null = null;
  private workbenchRefreshStartedAtMs: number | null = null;
  private readonly connectionManager: ConnectionManager;

  constructor(private readonly options: WorkbenchRealtimeClientOptions) {
    this.workbenchKnownRevision = null;
    this.connectionManager = new ConnectionManager({
      onReconnect: (forceReset) => {
        this.connect(forceReset);
      },
      onStateChange: options.onConnectionChange
    });
  }

  start(): void {
    this.connectionManager.start();
  }

  requestRefresh(): void {
    const socket = this.socket;

    if (!isSocketOpen(socket)) {
      this.pendingRefresh = true;
      return;
    }

    this.workbenchRefreshStartedAtMs = performance.now();
    socket.send(
      JSON.stringify({
        type: "workbench.refresh",
        knownRevision: this.workbenchKnownRevision ?? undefined
      })
    );
    logPerfDebug("workbench.refresh.sent", {
      knownRevision: this.workbenchKnownRevision
    });
    this.pendingRefresh = false;
  }

  setWorkbenchKnownRevision(revision: string | null | undefined): void {
    this.workbenchKnownRevision = normalizeKnownRevision(revision);
  }

  subscribeFileTree(
    workspaceId: string,
    paths: string[],
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ): void {
    this.fileTreeSubscription = {
      workspaceId,
      paths: normalizePaths(paths),
      knownRevisionByPath: normalizeKnownRevisionRecord(options?.knownRevisionByPath)
    };
    this.sendWhenReady({
      type: "fileTree.subscribe",
      workspaceId,
      paths: this.fileTreeSubscription.paths,
      knownRevisions: resolveFileTreeKnownRevisions(
        workspaceId,
        this.fileTreeSubscription.paths,
        this.fileTreeSubscription.knownRevisionByPath,
        this.fileTreeRevisionByPath
      )
    });
  }

  requestFileTreeRefresh(
    workspaceId: string,
    paths?: string[],
    options?: { knownRevisionByPath?: Record<string, string | null | undefined> }
  ): void {
    const normalizedPaths = normalizePaths(paths);
    const payload = {
      type: "fileTree.refresh",
      workspaceId,
      paths: normalizedPaths,
      knownRevisions: resolveFileTreeKnownRevisions(
        workspaceId,
        normalizedPaths,
        normalizeKnownRevisionRecord(options?.knownRevisionByPath),
        this.fileTreeRevisionByPath
      )
    };

    if (!this.sendWhenReady(payload)) {
      this.pendingFileTreeRefresh = {
        workspaceId,
        paths: normalizedPaths,
        knownRevisionByPath: normalizeKnownRevisionRecord(options?.knownRevisionByPath)
      };
    } else {
      this.pendingFileTreeRefresh = null;
    }
  }

  subscribeGit(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    this.gitSubscription = {
      workspaceId,
      knownRevision: normalizeKnownRevision(options?.knownRevision)
    };
    this.sendWhenReady({
      type: "git.subscribe",
      workspaceId,
      knownRevision: this.gitSubscription.knownRevision ?? this.gitRevisionByWorkspaceId.get(workspaceId)
    });
  }

  requestGitRefresh(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    const payload = {
      type: "git.refresh",
      workspaceId,
      knownRevision:
        normalizeKnownRevision(options?.knownRevision) ?? this.gitRevisionByWorkspaceId.get(workspaceId)
    };

    if (!this.sendWhenReady(payload)) {
      this.pendingGitRefresh = {
        workspaceId,
        knownRevision: normalizeKnownRevision(options?.knownRevision)
      };
    } else {
      this.pendingGitRefresh = null;
    }
  }

  subscribeTerminalManager(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    this.terminalManagerSubscription = {
      workspaceId,
      knownRevision: normalizeKnownRevision(options?.knownRevision)
    };
    this.sendWhenReady({
      type: "terminalManager.subscribe",
      workspaceId,
      knownRevision:
        this.terminalManagerSubscription.knownRevision
        ?? this.terminalManagerRevisionByWorkspaceId.get(workspaceId)
    });
  }

  requestTerminalManagerRefresh(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    const payload = {
      type: "terminalManager.refresh",
      workspaceId,
      knownRevision:
        normalizeKnownRevision(options?.knownRevision)
        ?? this.terminalManagerRevisionByWorkspaceId.get(workspaceId)
    };

    if (!this.sendWhenReady(payload)) {
      this.pendingTerminalManagerRefresh = {
        workspaceId,
        knownRevision: normalizeKnownRevision(options?.knownRevision)
      };
    } else {
      this.pendingTerminalManagerRefresh = null;
    }
  }

  subscribeWorkspaceManagement(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    this.workspaceManagementSubscription = {
      workspaceId,
      knownRevision: normalizeKnownRevision(options?.knownRevision)
    };
    this.sendWhenReady({
      type: "workspaceManagement.subscribe",
      workspaceId,
      knownRevision:
        this.workspaceManagementSubscription.knownRevision
        ?? this.workspaceManagementRevisionByWorkspaceId.get(workspaceId)
    });
  }

  requestWorkspaceManagementRefresh(
    workspaceId: string,
    options?: { knownRevision?: string | null | undefined }
  ): void {
    const payload = {
      type: "workspaceManagement.refresh",
      workspaceId,
      knownRevision:
        normalizeKnownRevision(options?.knownRevision)
        ?? this.workspaceManagementRevisionByWorkspaceId.get(workspaceId)
    };

    if (!this.sendWhenReady(payload)) {
      this.pendingWorkspaceManagementRefresh = {
        workspaceId,
        knownRevision: normalizeKnownRevision(options?.knownRevision)
      };
    } else {
      this.pendingWorkspaceManagementRefresh = null;
    }
  }

  addFileTreeSnapshotListener(
    listener: (snapshot: FileTreeRealtimeSnapshotDto) => void
  ): () => void {
    this.fileTreeListeners.add(listener);
    return () => {
      this.fileTreeListeners.delete(listener);
    };
  }

  addGitSnapshotListener(listener: (snapshot: GitRealtimeSnapshotDto) => void): () => void {
    this.gitListeners.add(listener);
    return () => {
      this.gitListeners.delete(listener);
    };
  }

  addTerminalManagerSnapshotListener(
    listener: (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  ): () => void {
    this.terminalManagerListeners.add(listener);
    return () => {
      this.terminalManagerListeners.delete(listener);
    };
  }

  addWorkspaceManagementSnapshotListener(
    listener: (snapshot: WorkspaceManagementRealtimeSnapshotDto) => void
  ): () => void {
    this.workspaceManagementListeners.add(listener);
    return () => {
      this.workspaceManagementListeners.delete(listener);
    };
  }

  close(): void {
    this.disposed = true;
    this.connectionManager.close();
    this.socket?.close();
    this.socket = null;
  }

  private connect(forceReset: boolean): void {
    if (this.disposed) {
      return;
    }

    if (forceReset && this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const accessToken = authStore.getState().session?.accessToken;

    if (!accessToken) {
      this.options.onUnauthorized();
      return;
    }

    const requestedBaseUrl = getHostBaseUrl();
    const transportTarget = resolveHostTransportTarget(requestedBaseUrl);
    const baseUrl = transportTarget.baseUrl;
    const socketUrl = `${getHostWebSocketUrl("/ws", baseUrl)}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = transportTarget.transport.createWebSocket({
      path: "/ws",
      baseUrl,
      url: socketUrl
    });

    this.socket = socket;

    socket.addEventListener("open", () => {
      this.workbenchSubscribeStartedAtMs = performance.now();
      socket.send(JSON.stringify({
        type: "workbench.subscribe",
        knownRevision: this.workbenchKnownRevision ?? undefined
      }));
      logPerfDebug("workbench.subscribe.sent", {
        knownRevision: this.workbenchKnownRevision,
        baseUrl
      });

      if (this.pendingRefresh) {
        this.requestRefresh();
      }

      if (this.fileTreeSubscription) {
        socket.send(
          JSON.stringify({
            type: "fileTree.subscribe",
            workspaceId: this.fileTreeSubscription.workspaceId,
            paths: this.fileTreeSubscription.paths,
            knownRevisions: resolveFileTreeKnownRevisions(
              this.fileTreeSubscription.workspaceId,
              this.fileTreeSubscription.paths,
              this.fileTreeSubscription.knownRevisionByPath,
              this.fileTreeRevisionByPath
            )
          })
        );
      }

      if (this.pendingFileTreeRefresh) {
        this.requestFileTreeRefresh(
          this.pendingFileTreeRefresh.workspaceId,
          this.pendingFileTreeRefresh.paths,
          {
            knownRevisionByPath: this.pendingFileTreeRefresh.knownRevisionByPath
          }
        );
      }

      if (this.gitSubscription) {
        socket.send(
          JSON.stringify({
            type: "git.subscribe",
            workspaceId: this.gitSubscription.workspaceId,
            knownRevision:
              this.gitSubscription.knownRevision
              ?? this.gitRevisionByWorkspaceId.get(this.gitSubscription.workspaceId)
          })
        );
      }

      if (this.pendingGitRefresh) {
        this.requestGitRefresh(this.pendingGitRefresh.workspaceId, {
          knownRevision: this.pendingGitRefresh.knownRevision
        });
      }

      if (this.terminalManagerSubscription) {
        socket.send(
          JSON.stringify({
            type: "terminalManager.subscribe",
            workspaceId: this.terminalManagerSubscription.workspaceId,
            knownRevision:
              this.terminalManagerSubscription.knownRevision
              ?? this.terminalManagerRevisionByWorkspaceId.get(this.terminalManagerSubscription.workspaceId)
          })
        );
      }

      if (this.pendingTerminalManagerRefresh) {
        this.requestTerminalManagerRefresh(this.pendingTerminalManagerRefresh.workspaceId, {
          knownRevision: this.pendingTerminalManagerRefresh.knownRevision
        });
      }

      if (this.workspaceManagementSubscription) {
        socket.send(
          JSON.stringify({
            type: "workspaceManagement.subscribe",
            workspaceId: this.workspaceManagementSubscription.workspaceId,
            knownRevision:
              this.workspaceManagementSubscription.knownRevision
              ?? this.workspaceManagementRevisionByWorkspaceId.get(this.workspaceManagementSubscription.workspaceId)
          })
        );
      }

      if (this.pendingWorkspaceManagementRefresh) {
        this.requestWorkspaceManagementRefresh(this.pendingWorkspaceManagementRefresh.workspaceId, {
          knownRevision: this.pendingWorkspaceManagementRefresh.knownRevision
        });
      }
    });

    socket.addEventListener("message", (raw) => {
      if (!(raw instanceof MessageEvent) || typeof raw.data !== "string") {
        return;
      }

      const payload = JSON.parse(raw.data) as IncomingEvent;

      if (payload.type === "system.connected") {
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "session.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.handleUnauthorized();
        }

        return;
      }

      if (payload.type === "workbench.snapshot") {
        logPerfDebug("workbench.snapshot.received", {
          unchanged: payload.unchanged,
          revision: payload.revision,
          workspaceCount: payload.snapshot?.items.length ?? 0,
          sessionCount: payload.snapshot ? countWorkbenchSnapshotSessions(payload.snapshot) : 0,
          subscribeDurationMs: measureElapsedMs(this.workbenchSubscribeStartedAtMs),
          refreshDurationMs: measureElapsedMs(this.workbenchRefreshStartedAtMs)
        });
        this.workbenchRefreshStartedAtMs = null;
      }

      if (payload.type === "fileTree.snapshot") {
        const snapshot = payload.snapshot;

        if (snapshot) {
          snapshot.revision = payload.revision;
          this.fileTreeRevisionByPath.set(
            buildFileTreeRevisionKey(snapshot.workspaceId, snapshot.path),
            payload.revision
          );
        } else if (payload.unchanged && this.fileTreeSubscription) {
          for (const path of this.fileTreeSubscription.paths) {
            this.fileTreeRevisionByPath.set(
              buildFileTreeRevisionKey(this.fileTreeSubscription.workspaceId, path),
              payload.revision
            );
          }
        }

        if (!snapshot) {
          return;
        }

        this.options.onFileTreeSnapshot?.(snapshot);
        this.fileTreeListeners.forEach((listener) => listener(snapshot));
        return;
      }

      if (payload.type === "git.snapshot") {
        const snapshot = payload.snapshot;

        if (snapshot) {
          snapshot.revision = payload.revision;
          this.gitRevisionByWorkspaceId.set(snapshot.workspaceId, payload.revision);
        } else if (payload.unchanged && this.gitSubscription) {
          this.gitRevisionByWorkspaceId.set(this.gitSubscription.workspaceId, payload.revision);
        }

        if (!snapshot) {
          return;
        }

        this.options.onGitSnapshot?.(snapshot);
        this.gitListeners.forEach((listener) => listener(snapshot));
        return;
      }

      if (payload.type === "terminalManager.snapshot") {
        const snapshot = payload.snapshot;

        if (snapshot) {
          snapshot.revision = payload.revision;
          this.terminalManagerRevisionByWorkspaceId.set(snapshot.workspaceId, payload.revision);
        } else if (payload.unchanged && this.terminalManagerSubscription) {
          this.terminalManagerRevisionByWorkspaceId.set(
            this.terminalManagerSubscription.workspaceId,
            payload.revision
          );
        }

        if (!snapshot) {
          return;
        }

        this.options.onTerminalManagerSnapshot?.(snapshot);
        this.terminalManagerListeners.forEach((listener) => listener(snapshot));
        return;
      }

      if (payload.type === "workspaceManagement.snapshot") {
        const snapshot = payload.snapshot;

        if (snapshot) {
          snapshot.revision = payload.revision;
          this.workspaceManagementRevisionByWorkspaceId.set(snapshot.workspaceId, payload.revision);
        } else if (payload.unchanged && this.workspaceManagementSubscription) {
          this.workspaceManagementRevisionByWorkspaceId.set(
            this.workspaceManagementSubscription.workspaceId,
            payload.revision
          );
        }

        if (!snapshot) {
          return;
        }

        this.options.onWorkspaceManagementSnapshot?.(snapshot);
        this.workspaceManagementListeners.forEach((listener) => listener(snapshot));
        return;
      }

      if (payload.type === "workbench.snapshot" && payload.snapshot && isWorkbenchSnapshot(payload.snapshot)) {
        payload.snapshot.revision = payload.revision;
        this.workbenchKnownRevision = payload.revision;
        this.options.onSnapshot(payload.snapshot);
      } else if (payload.type === "workbench.snapshot" && payload.unchanged) {
        this.workbenchKnownRevision = payload.revision;
      }
    });

    socket.addEventListener("close", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

      this.connectionManager.markDisconnected();
    });

    socket.addEventListener("error", () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }

      this.connectionManager.markTransientFailure();
    });
  }

  private handleUnauthorized(): void {
    if (this.authRecoveryInFlight || this.disposed) {
      return;
    }

    this.authRecoveryInFlight = true;
    const socket = this.socket;
    this.socket = null;
    socket?.close();

    void authStore.refresh().then((result) => {
      this.authRecoveryInFlight = false;

      if (this.disposed) {
        return;
      }

      if (result.status === "refreshed") {
        this.connectionManager.reconnectNow();
        return;
      }

      if (result.status === "deferred") {
        this.connectionManager.markDisconnected();
        return;
      }

      this.options.onUnauthorized();
    });
  }

  private sendWhenReady(payload: Record<string, unknown>): boolean {
    const socket = this.socket;

    if (!isSocketOpen(socket)) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }
}

function isSocketOpen(socket: HostTransportSocket | null): socket is HostTransportSocket {
  return socket !== null && socket.readyState === 1;
}

function isWorkbenchSnapshot(payload: unknown): payload is WorkbenchSnapshotDto {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  return Array.isArray((payload as WorkbenchSnapshotDto).items);
}

function normalizePaths(paths: string[] | undefined): string[] {
  const uniquePaths = new Set<string>();

  for (const value of paths ?? [""]) {
    uniquePaths.add(value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  }

  return [...uniquePaths];
}

function normalizeKnownRevision(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeKnownRevisionRecord(
  value: Record<string, string | null | undefined> | null | undefined
): Record<string, string> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([path, revision]) => [path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""), normalizeKnownRevision(revision)] as const)
      .filter((entry): entry is [string, string] => entry[1] !== null)
  );
}

function resolveFileTreeKnownRevisions(
  workspaceId: string,
  paths: string[],
  preferredKnownRevisionByPath: Record<string, string>,
  revisionByPath: Map<string, string>
): Record<string, string> | undefined {
  const entries = paths
    .map((path) => {
      const normalizedPath = path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      return [
        normalizedPath,
        preferredKnownRevisionByPath[normalizedPath]
        ?? revisionByPath.get(buildFileTreeRevisionKey(workspaceId, normalizedPath))
        ?? null
      ] as const;
    })
    .filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function buildFileTreeRevisionKey(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

function countWorkbenchSnapshotSessions(snapshot: WorkbenchSnapshotDto): number {
  return snapshot.items.reduce<number>((total, item) => {
    return total + item.sessions.length + countWorkbenchChildSessions(item.childWorktrees ?? []);
  }, 0);
}

function countWorkbenchChildSessions(childWorktrees: unknown[]): number {
  return childWorktrees.reduce<number>((total, node) => {
    if (typeof node !== "object" || node === null) {
      return total;
    }

    const candidate = node as {
      sessions?: unknown[];
      children?: unknown[];
    };

    const currentSessions = Array.isArray(candidate.sessions) ? candidate.sessions.length : 0;
    const nestedSessions = Array.isArray(candidate.children)
      ? countWorkbenchChildSessions(candidate.children)
      : 0;

    return total + currentSessions + nestedSessions;
  }, 0);
}

function measureElapsedMs(startedAtMs: number | null): number | null {
  if (startedAtMs === null || typeof performance === "undefined") {
    return null;
  }

  return Math.round(performance.now() - startedAtMs);
}
