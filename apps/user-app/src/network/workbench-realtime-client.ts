import { getHostWebSocketUrl } from "../config/env";
import { authStore } from "../features/auth/store/auth-store";
import { ConnectionManager } from "./connection-manager";

import type { WorkbenchSnapshotDto } from "../features/conversation/api/conversation-api";
import type { FileNodeDto } from "../features/conversation/api/file-context-api";
import type {
  GitBranchSnapshotDto,
  GitChangeItemDto,
  GitHistoryItemDto,
  GitRepoSnapshotDto
} from "../features/conversation/api/git-api";
import type {
  TerminalDto,
  TerminalTemplateDto,
  TerminalTemplateRuntimeStatusDto
} from "../features/terminal/api/terminal-api";

type WorkbenchConnectionState = "connected" | "reconnecting" | "reconnect_failed" | "closed";

interface SystemConnectedEvent {
  type: "system.connected";
}

interface WorkbenchSnapshotEvent {
  type: "workbench.snapshot";
  snapshot: WorkbenchSnapshotDto;
}

export interface FileTreeRealtimeSnapshotDto {
  workspaceId: string;
  path: string;
  items: FileNodeDto[];
}

interface FileTreeSnapshotEvent {
  type: "fileTree.snapshot";
  snapshot: FileTreeRealtimeSnapshotDto;
}

export interface GitRealtimeSnapshotDto {
  workspaceId: string;
  status: {
    snapshot: GitRepoSnapshotDto;
    changes: GitChangeItemDto[];
  };
  history: GitHistoryItemDto[];
  historyTotalCount: number;
  historyNextCursor: string | null;
  branches: GitBranchSnapshotDto;
}

interface GitSnapshotEvent {
  type: "git.snapshot";
  snapshot: GitRealtimeSnapshotDto;
}

export interface TerminalManagerRealtimeSnapshotDto {
  workspaceId: string;
  terminals: TerminalDto[];
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
}

interface TerminalManagerSnapshotEvent {
  type: "terminalManager.snapshot";
  snapshot: TerminalManagerRealtimeSnapshotDto;
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
  | SystemConnectedEvent
  | SessionErrorEvent;

export interface WorkbenchRealtimeClientOptions {
  onConnectionChange: (state: WorkbenchConnectionState) => void;
  onSnapshot: (snapshot: WorkbenchSnapshotDto) => void;
  onFileTreeSnapshot?: (snapshot: FileTreeRealtimeSnapshotDto) => void;
  onGitSnapshot?: (snapshot: GitRealtimeSnapshotDto) => void;
  onTerminalManagerSnapshot?: (snapshot: TerminalManagerRealtimeSnapshotDto) => void;
  onUnauthorized: () => void;
}

export class WorkbenchRealtimeClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private pendingRefresh = false;
  private fileTreeSubscription: { workspaceId: string; paths: string[] } | null = null;
  private gitWorkspaceId: string | null = null;
  private terminalManagerWorkspaceId: string | null = null;
  private pendingFileTreeRefresh: { workspaceId: string; paths: string[] } | null = null;
  private pendingGitRefreshWorkspaceId: string | null = null;
  private pendingTerminalManagerRefreshWorkspaceId: string | null = null;
  private readonly fileTreeListeners = new Set<(snapshot: FileTreeRealtimeSnapshotDto) => void>();
  private readonly gitListeners = new Set<(snapshot: GitRealtimeSnapshotDto) => void>();
  private readonly terminalManagerListeners = new Set<
    (snapshot: TerminalManagerRealtimeSnapshotDto) => void
  >();
  private readonly connectionManager: ConnectionManager;

  constructor(private readonly options: WorkbenchRealtimeClientOptions) {
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

    socket.send(
      JSON.stringify({
        type: "workbench.refresh"
      })
    );
    this.pendingRefresh = false;
  }

  subscribeFileTree(workspaceId: string, paths: string[]): void {
    this.fileTreeSubscription = {
      workspaceId,
      paths: normalizePaths(paths)
    };
    this.sendWhenReady({
      type: "fileTree.subscribe",
      workspaceId,
      paths: this.fileTreeSubscription.paths
    });
  }

  requestFileTreeRefresh(workspaceId: string, paths?: string[]): void {
    const normalizedPaths = normalizePaths(paths);
    const payload = {
      type: "fileTree.refresh",
      workspaceId,
      paths: normalizedPaths
    };

    if (!this.sendWhenReady(payload)) {
      this.pendingFileTreeRefresh = {
        workspaceId,
        paths: normalizedPaths
      };
    } else {
      this.pendingFileTreeRefresh = null;
    }
  }

  subscribeGit(workspaceId: string): void {
    this.gitWorkspaceId = workspaceId;
    this.sendWhenReady({
      type: "git.subscribe",
      workspaceId
    });
  }

  requestGitRefresh(workspaceId: string): void {
    if (!this.sendWhenReady({
      type: "git.refresh",
      workspaceId
    })) {
      this.pendingGitRefreshWorkspaceId = workspaceId;
    } else {
      this.pendingGitRefreshWorkspaceId = null;
    }
  }

  subscribeTerminalManager(workspaceId: string): void {
    this.terminalManagerWorkspaceId = workspaceId;
    this.sendWhenReady({
      type: "terminalManager.subscribe",
      workspaceId
    });
  }

  requestTerminalManagerRefresh(workspaceId: string): void {
    if (!this.sendWhenReady({
      type: "terminalManager.refresh",
      workspaceId
    })) {
      this.pendingTerminalManagerRefreshWorkspaceId = workspaceId;
    } else {
      this.pendingTerminalManagerRefreshWorkspaceId = null;
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

    const socketUrl = `${getHostWebSocketUrl("/ws")}?access_token=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);

    this.socket = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "workbench.subscribe" }));

      if (this.pendingRefresh) {
        this.requestRefresh();
      }

      if (this.fileTreeSubscription) {
        socket.send(
          JSON.stringify({
            type: "fileTree.subscribe",
            workspaceId: this.fileTreeSubscription.workspaceId,
            paths: this.fileTreeSubscription.paths
          })
        );
      }

      if (this.pendingFileTreeRefresh) {
        this.requestFileTreeRefresh(
          this.pendingFileTreeRefresh.workspaceId,
          this.pendingFileTreeRefresh.paths
        );
      }

      if (this.gitWorkspaceId) {
        socket.send(
          JSON.stringify({
            type: "git.subscribe",
            workspaceId: this.gitWorkspaceId
          })
        );
      }

      if (this.pendingGitRefreshWorkspaceId) {
        this.requestGitRefresh(this.pendingGitRefreshWorkspaceId);
      }

      if (this.terminalManagerWorkspaceId) {
        socket.send(
          JSON.stringify({
            type: "terminalManager.subscribe",
            workspaceId: this.terminalManagerWorkspaceId
          })
        );
      }

      if (this.pendingTerminalManagerRefreshWorkspaceId) {
        this.requestTerminalManagerRefresh(this.pendingTerminalManagerRefreshWorkspaceId);
      }
    });

    socket.addEventListener("message", (raw) => {
      const payload = JSON.parse(raw.data as string) as IncomingEvent;

      if (payload.type === "system.connected") {
        this.connectionManager.markConnected();
        return;
      }

      if (payload.type === "session.error") {
        if (payload.error_code === "UNAUTHORIZED") {
          this.options.onUnauthorized();
        }

        return;
      }

      if (payload.type === "fileTree.snapshot") {
        this.options.onFileTreeSnapshot?.(payload.snapshot);
        this.fileTreeListeners.forEach((listener) => listener(payload.snapshot));
        return;
      }

      if (payload.type === "git.snapshot") {
        this.options.onGitSnapshot?.(payload.snapshot);
        this.gitListeners.forEach((listener) => listener(payload.snapshot));
        return;
      }

      if (payload.type === "terminalManager.snapshot") {
        this.options.onTerminalManagerSnapshot?.(payload.snapshot);
        this.terminalManagerListeners.forEach((listener) => listener(payload.snapshot));
        return;
      }

      if (payload.type === "workbench.snapshot" && isWorkbenchSnapshot(payload.snapshot)) {
        this.options.onSnapshot(payload.snapshot);
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

  private sendWhenReady(payload: Record<string, unknown>): boolean {
    const socket = this.socket;

    if (!isSocketOpen(socket)) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }
}

function isSocketOpen(socket: WebSocket | null): socket is WebSocket {
  const openState = typeof WebSocket.OPEN === "number" ? WebSocket.OPEN : 1;
  return socket !== null && socket.readyState === openState;
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
