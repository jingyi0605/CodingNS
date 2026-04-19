import type { WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import { logTerminalDebug, terminalDebugNowMs } from "../shared/utils/terminal-debug-log.js";
import type { AuthContext } from "../modules/auth/auth-service.js";
import type { TerminalService } from "../modules/terminal/terminal-service.js";
import type { WorkbenchService, WorkbenchSnapshot } from "../modules/workbench/workbench-service.js";
import type {
  FileTreeSnapshot,
  GitPanelSnapshot,
  TerminalManagerSnapshot,
  WorkspaceManagementSnapshot,
  WorkspacePanelSnapshotService
} from "../modules/workbench/workspace-panel-snapshot-service.js";
import type { WorkspaceFileWatcher, WorkspaceWatcherEvent } from "../modules/workbench/workspace-file-watcher.js";

const WORKBENCH_REFRESH_INTERVAL_MS = 60_000;
const GIT_SUBSCRIPTION_MIN_REFRESH_INTERVAL_MS = 15_000;
const GIT_REFRESH_QUIET_WINDOW_MS = 800;
const TERMINAL_MANAGER_REFRESH_QUIET_WINDOW_MS = 300;
const WORKSPACE_MANAGEMENT_REFRESH_INTERVAL_MS = 5_000;
const WORKBENCH_REALTIME_BROADCAST_DEBOUNCE_MS = 120;
const WORKSPACE_MANAGEMENT_TIMER_REFRESH_ENABLED = readBooleanEnv(
  process.env.CODINGNS_WORKSPACE_MANAGEMENT_AUTO_REFRESH,
  false
);

interface WorkbenchSubscribeMessage {
  type: "workbench.subscribe";
}

interface WorkbenchRefreshMessage {
  type: "workbench.refresh";
}

interface FileTreeSubscribeMessage {
  type: "fileTree.subscribe";
  workspaceId: string;
  paths?: string[];
}

interface FileTreeRefreshMessage {
  type: "fileTree.refresh";
  workspaceId: string;
  paths?: string[];
}

interface GitSubscribeMessage {
  type: "git.subscribe";
  workspaceId: string;
}

interface GitRefreshMessage {
  type: "git.refresh";
  workspaceId: string;
}

interface TerminalManagerSubscribeMessage {
  type: "terminalManager.subscribe";
  workspaceId: string;
}

interface TerminalManagerRefreshMessage {
  type: "terminalManager.refresh";
  workspaceId: string;
}

interface WorkspaceManagementSubscribeMessage {
  type: "workspaceManagement.subscribe";
  workspaceId: string;
}

interface WorkspaceManagementRefreshMessage {
  type: "workspaceManagement.refresh";
  workspaceId: string;
}

type WorkbenchMessage =
  | WorkbenchSubscribeMessage
  | WorkbenchRefreshMessage
  | FileTreeSubscribeMessage
  | FileTreeRefreshMessage
  | GitSubscribeMessage
  | GitRefreshMessage
  | TerminalManagerSubscribeMessage
  | TerminalManagerRefreshMessage
  | WorkspaceManagementSubscribeMessage
  | WorkspaceManagementRefreshMessage;

interface UserChannelState {
  clients: Set<WebSocket>;
  lastWorkbenchPayload: string | null;
  workbenchTimer: NodeJS.Timeout | null;
  workspaceManagementTimer: NodeJS.Timeout | null;
  realtimeBroadcastTimer: NodeJS.Timeout | null;
  realtimeBroadcastQueued: boolean;
  realtimeBroadcastTask: Promise<void> | null;
  refreshTask: Promise<void> | null;
}

interface FileTreeClientSubscription {
  workspaceId: string;
  paths: string[];
  lastPayloadByPath: Map<string, string>;
}

interface GitClientSubscription {
  workspaceId: string;
  lastPayload: string | null;
  lastRequestedAt: number;
  refreshTask: Promise<void> | null;
  refreshController: AbortController | null;
  refreshTimer: NodeJS.Timeout | null;
  queuedRefresh: boolean;
  queuedForce: boolean;
}

interface TerminalManagerClientSubscription {
  workspaceId: string;
  lastPayload: string | null;
  refreshTask: Promise<void> | null;
  refreshTimer: NodeJS.Timeout | null;
  queuedRefresh: boolean;
  queuedForce: boolean;
}

interface WorkspaceManagementClientSubscription {
  workspaceId: string;
  lastPayload: string | null;
}

export class WorkbenchWsHub {
  private readonly clientUsers = new WeakMap<WebSocket, string>();
  private readonly userChannels = new Map<string, UserChannelState>();
  private readonly clientFileTreeSubscriptions = new WeakMap<WebSocket, FileTreeClientSubscription>();
  private readonly clientGitSubscriptions = new WeakMap<WebSocket, GitClientSubscription>();
  private readonly clientTerminalManagerSubscriptions = new WeakMap<
    WebSocket,
    TerminalManagerClientSubscription
  >();
  private readonly clientWorkspaceManagementSubscriptions = new WeakMap<
    WebSocket,
    WorkspaceManagementClientSubscription
  >();

  constructor(
    private readonly workbenchService: WorkbenchService,
    private readonly workspacePanelSnapshotService: WorkspacePanelSnapshotService,
    private readonly fileWatcher: WorkspaceFileWatcher,
    terminalService?: Pick<TerminalService, "on">
  ) {
    this.fileWatcher.setOnChange((event) => {
      this.handleWorkspaceWatcherChange(event);
    });

    terminalService?.on("status", (terminal) => {
      this.handleTerminalManagerChange(terminal.workspaceId);
    });
    terminalService?.on("exit", ({ terminal }) => {
      this.handleTerminalManagerChange(terminal.workspaceId);
    });
  }

  handleMessage(client: WebSocket, payload: unknown, authContext: AuthContext): boolean {
    const message = parseWorkbenchMessage(payload);

    if (!message) {
      return false;
    }

    const userId = authContext.user.userId;
    const channel = this.getOrCreateChannel(userId);

    this.attachClient(client, userId, channel);

    try {
      switch (message.type) {
        case "workbench.subscribe":
          void this.sendWorkbenchSnapshotToClient(client, userId, channel);
          if (this.workbenchService.shouldRefreshSnapshot()) {
            this.workbenchService.scheduleSnapshotRefresh(userId);
          }
          return true;
        case "workbench.refresh":
          void this.refreshAndBroadcast(userId, true);
          return true;
        case "fileTree.subscribe":
          this.replaceFileTreeSubscription(client, message.workspaceId, message.paths);
          void this.refreshFileTreeSubscriptions(client);
          return true;
        case "fileTree.refresh":
          for (const path of normalizePanelPaths(message.paths)) {
            this.workspacePanelSnapshotService.invalidateFileTree(message.workspaceId.trim(), path);
          }
          this.ensureFileTreeSubscription(client, message.workspaceId, message.paths);
          void this.refreshFileTreeSubscriptions(client, true);
          return true;
        case "git.subscribe":
          this.ensureGitSubscription(client, message.workspaceId);
          void this.refreshGitSubscription(client, false, {
            deliverIfUnchanged: true,
            ignoreMinInterval: true
          });
          return true;
        case "git.refresh":
          this.workspacePanelSnapshotService.invalidateGit(message.workspaceId.trim());
          this.ensureGitSubscription(client, message.workspaceId);
          this.scheduleGitRefresh(client, {
            force: true
          });
          return true;
        case "terminalManager.subscribe":
          this.ensureTerminalManagerSubscription(client, message.workspaceId);
          this.scheduleTerminalManagerRefresh(client);
          return true;
        case "terminalManager.refresh":
          this.workspacePanelSnapshotService.invalidateTerminalManager(message.workspaceId.trim());
          this.ensureTerminalManagerSubscription(client, message.workspaceId);
          this.scheduleTerminalManagerRefresh(client, {
            force: true
          });
          return true;
        case "workspaceManagement.subscribe":
          this.clientWorkspaceManagementSubscriptions.set(client, {
            workspaceId: message.workspaceId.trim(),
            lastPayload: null
          });
          void this.refreshWorkspaceManagementSubscription(client);
          return true;
        case "workspaceManagement.refresh":
          this.workspacePanelSnapshotService.invalidateWorkspaceManagement(message.workspaceId.trim());
          this.clientWorkspaceManagementSubscriptions.set(client, {
            workspaceId: message.workspaceId.trim(),
            lastPayload: null
          });
          void this.refreshWorkspaceManagementSubscription(client, true);
          return true;
        default:
          return false;
      }
    } catch (error) {
      this.reportAsyncError("handleMessage", error, {
        userId,
        workspaceId: extractWorkspaceIdFromWorkbenchMessage(message)
      });
      return true;
    }
  }

  cleanupClient(client: WebSocket): void {
    const userId = this.clientUsers.get(client);

    if (!userId) {
      return;
    }

    const channel = this.userChannels.get(userId);

    if (!channel) {
      this.clientUsers.delete(client);
      return;
    }

    channel.clients.delete(client);
    this.clientUsers.delete(client);

    // 文件监听器引用计数递减
    const fileTreeSub = this.clientFileTreeSubscriptions.get(client);
    if (fileTreeSub) {
      this.fileWatcher.unsubscribeFileTree(fileTreeSub.workspaceId, fileTreeSub.paths);
    }
    const gitSub = this.clientGitSubscriptions.get(client);
    if (gitSub) {
      gitSub.refreshController?.abort(new Error("git subscription closed"));
      if (gitSub.refreshTimer) {
        clearTimeout(gitSub.refreshTimer);
      }
      this.fileWatcher.unsubscribeGit(gitSub.workspaceId);
    }
    const terminalManagerSub = this.clientTerminalManagerSubscriptions.get(client);
    if (terminalManagerSub?.refreshTimer) {
      clearTimeout(terminalManagerSub.refreshTimer);
    }

    this.clientFileTreeSubscriptions.delete(client);
    this.clientGitSubscriptions.delete(client);
    this.clientTerminalManagerSubscriptions.delete(client);
    this.clientWorkspaceManagementSubscriptions.delete(client);

    if (channel.clients.size > 0) {
      return;
    }

    if (channel.workbenchTimer) {
      clearInterval(channel.workbenchTimer);
    }

    if (channel.workspaceManagementTimer) {
      clearInterval(channel.workspaceManagementTimer);
    }

    if (channel.realtimeBroadcastTimer) {
      clearTimeout(channel.realtimeBroadcastTimer);
    }

    this.userChannels.delete(userId);
  }

  async broadcastSnapshot(userId: string): Promise<void> {
    const channel = this.userChannels.get(userId);

    if (!channel) {
      return;
    }

    channel.realtimeBroadcastQueued = true;
    this.scheduleRealtimeBroadcast(userId, channel);
  }

  private scheduleRealtimeBroadcast(userId: string, channel: UserChannelState): void {
    if (
      channel.realtimeBroadcastTimer ||
      channel.realtimeBroadcastTask ||
      channel.clients.size === 0
    ) {
      return;
    }

    channel.realtimeBroadcastTimer = setTimeout(() => {
      channel.realtimeBroadcastTimer = null;
      void this.flushRealtimeBroadcast(userId, channel);
    }, WORKBENCH_REALTIME_BROADCAST_DEBOUNCE_MS);
  }

  private async flushRealtimeBroadcast(
    userId: string,
    channel: UserChannelState
  ): Promise<void> {
    if (channel.realtimeBroadcastTask || !channel.realtimeBroadcastQueued || channel.clients.size === 0) {
      return;
    }

    channel.realtimeBroadcastQueued = false;
    channel.realtimeBroadcastTask = (async () => {
      const startedAtMs = terminalDebugNowMs();

      try {
        const payload = buildWorkbenchPayload(this.workbenchService.getSnapshot(userId));

        if (payload === channel.lastWorkbenchPayload) {
          return;
        }

        channel.lastWorkbenchPayload = payload;

        for (const client of channel.clients) {
          client.send(payload);
        }

        logTerminalDebug("workbench.realtime_broadcast.completed", {
          userId,
          clientCount: channel.clients.size,
          durationMs: terminalDebugNowMs() - startedAtMs
        });
      } catch (error) {
        this.reportAsyncError("broadcastSnapshot", error, { userId });
      }
    })().finally(() => {
      channel.realtimeBroadcastTask = null;

      if (channel.realtimeBroadcastQueued && channel.clients.size > 0) {
        this.scheduleRealtimeBroadcast(userId, channel);
      }
    });

    return channel.realtimeBroadcastTask;
  }

  private attachClient(client: WebSocket, userId: string, channel: UserChannelState): void {
    channel.clients.add(client);
    this.clientUsers.set(client, userId);
  }

  private handleWorkspaceWatcherChange(event: WorkspaceWatcherEvent): void {
    if (event.scope === "fileTree") {
      this.workspacePanelSnapshotService.invalidateFileTree(event.workspaceId);
      this.workspacePanelSnapshotService.invalidateGit(event.workspaceId);
    } else {
      this.workspacePanelSnapshotService.invalidateGit(event.workspaceId);
    }

    for (const [, channel] of this.userChannels) {
      for (const client of channel.clients) {
        const fileTreeSub = this.clientFileTreeSubscriptions.get(client);
        if (
          event.scope === "fileTree" &&
          fileTreeSub &&
          fileTreeSub.workspaceId === event.workspaceId
        ) {
          void this.refreshFileTreeSubscriptions(client, true);
        }

        const gitSub = this.clientGitSubscriptions.get(client);

        if (gitSub && gitSub.workspaceId === event.workspaceId) {
          this.scheduleGitRefresh(client, {
            quietWindowMs: GIT_REFRESH_QUIET_WINDOW_MS
          });
        }
      }
    }
  }

  private handleTerminalManagerChange(workspaceId: string): void {
    this.workspacePanelSnapshotService.invalidateTerminalManager(workspaceId);

    for (const [, channel] of this.userChannels) {
      for (const client of channel.clients) {
        const subscription = this.clientTerminalManagerSubscriptions.get(client);

        if (!subscription || subscription.workspaceId !== workspaceId) {
          continue;
        }

        this.scheduleTerminalManagerRefresh(client, {
          quietWindowMs: TERMINAL_MANAGER_REFRESH_QUIET_WINDOW_MS
        });
      }
    }
  }

  private getOrCreateChannel(userId: string): UserChannelState {
    let channel = this.userChannels.get(userId);

    if (channel) {
      return channel;
    }

    channel = {
      clients: new Set<WebSocket>(),
      lastWorkbenchPayload: null,
      workbenchTimer: null,
      workspaceManagementTimer: null,
      realtimeBroadcastTimer: null,
      realtimeBroadcastQueued: false,
      realtimeBroadcastTask: null,
      refreshTask: null
    };
    channel.workbenchTimer = setInterval(() => {
      if (!this.workbenchService.shouldRefreshSnapshot()) {
        return;
      }

      void this.refreshAndBroadcast(userId).catch((error) => {
        this.reportAsyncError("workbenchTimer", error, { userId });
      });
    }, WORKBENCH_REFRESH_INTERVAL_MS);

    if (WORKSPACE_MANAGEMENT_TIMER_REFRESH_ENABLED) {
      channel.workspaceManagementTimer = setInterval(() => {
        void this.refreshWorkspaceManagementSubscriptions(userId).catch((error) => {
          this.reportAsyncError("workspaceManagementTimer", error, { userId });
        });
      }, WORKSPACE_MANAGEMENT_REFRESH_INTERVAL_MS);
    }

    this.userChannels.set(userId, channel);
    return channel;
  }

  private async sendWorkbenchSnapshotToClient(
    client: WebSocket,
    userId: string,
    channel: UserChannelState
  ): Promise<void> {
    try {
      const payload = buildWorkbenchPayload(this.workbenchService.getSnapshot(userId));
      channel.lastWorkbenchPayload = payload;
      client.send(payload);
    } catch (error) {
      this.reportAsyncError("sendWorkbenchSnapshotToClient", error, { userId });
    }
  }

  private async refreshAndBroadcast(userId: string, force = false): Promise<void> {
    const channel = this.getOrCreateChannel(userId);

    if (channel.refreshTask) {
      if (!force) {
        return channel.refreshTask;
      }

      await channel.refreshTask;
    }

    channel.refreshTask = (async () => {
      const startedAtMs = terminalDebugNowMs();
      try {
        const snapshot = await this.workbenchService.refreshSnapshot(userId);
        const payload = buildWorkbenchPayload(snapshot);

        if (payload === channel.lastWorkbenchPayload) {
          return;
        }

        channel.lastWorkbenchPayload = payload;

        for (const client of channel.clients) {
          client.send(payload);
        }
        logTerminalDebug("workbench.refresh.completed", {
          userId,
          force,
          clientCount: channel.clients.size,
          workspaceCount: snapshot.items.length,
          durationMs: terminalDebugNowMs() - startedAtMs
        });
      } catch (error) {
        this.reportAsyncError("refreshAndBroadcast", error, { userId });
      }
    })().finally(() => {
      channel.refreshTask = null;
    });

    return channel.refreshTask;
  }

  private ensureFileTreeSubscription(
    client: WebSocket,
    workspaceId: string,
    paths?: string[]
  ): FileTreeClientSubscription {
    const current = this.clientFileTreeSubscriptions.get(client);
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedPaths = normalizePanelPaths(paths);
    const nextPaths = normalizedPaths.length > 0 ? normalizedPaths : [""];

    if (
      current &&
      current.workspaceId === normalizedWorkspaceId &&
      areStringArraysEqual(current.paths, nextPaths)
    ) {
      return current;
    }

    const next: FileTreeClientSubscription = {
      workspaceId: normalizedWorkspaceId,
      paths: nextPaths,
      lastPayloadByPath: new Map<string, string>()
    };

    this.fileWatcher.subscribeFileTree(normalizedWorkspaceId, nextPaths);
    this.clientFileTreeSubscriptions.set(client, next);

    if (current) {
      this.fileWatcher.unsubscribeFileTree(current.workspaceId, current.paths);
    }

    return next;
  }

  private replaceFileTreeSubscription(
    client: WebSocket,
    workspaceId: string,
    paths?: string[]
  ): FileTreeClientSubscription {
    return this.ensureFileTreeSubscription(client, workspaceId, paths);
  }

  private async refreshFileTreeSubscriptions(client: WebSocket, force = false): Promise<void> {
    const subscription = this.clientFileTreeSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    try {
      const uniquePaths = normalizePanelPaths(subscription.paths);

      for (const path of uniquePaths) {
        const snapshot = await this.workspacePanelSnapshotService.getFileTreeSnapshot(
          subscription.workspaceId,
          path,
          { force }
        );
        const payload = buildFileTreePayload(snapshot);
        const lastPayload = subscription.lastPayloadByPath.get(path) ?? null;

        if (payload === lastPayload) {
          continue;
        }

        subscription.lastPayloadByPath.set(path, payload);
        client.send(payload);
      }
    } catch (error) {
      this.reportAsyncError("refreshFileTreeSubscriptions", error, {
        workspaceId: subscription.workspaceId
      });
    }
  }

  private async refreshGitSubscription(
    client: WebSocket,
    force = false,
    options?: {
      deliverIfUnchanged?: boolean;
      ignoreMinInterval?: boolean;
    }
  ): Promise<void> {
    const subscription = this.clientGitSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    if (subscription.refreshTask) {
      subscription.queuedRefresh = true;
      subscription.queuedForce = subscription.queuedForce || force;
      if (!options?.deliverIfUnchanged) {
        return subscription.refreshTask;
      }

      return await subscription.refreshTask.finally(() => {
        if (subscription.lastPayload) {
          client.send(subscription.lastPayload);
        }
      });
    }

    const now = Date.now();

    if (
      !options?.ignoreMinInterval &&
      !force
      && now - subscription.lastRequestedAt < GIT_SUBSCRIPTION_MIN_REFRESH_INTERVAL_MS
    ) {
      subscription.queuedRefresh = true;
      subscription.queuedForce = subscription.queuedForce || force;
      this.deferQueuedGitRefresh(
        client,
        GIT_SUBSCRIPTION_MIN_REFRESH_INTERVAL_MS - (now - subscription.lastRequestedAt)
      );
      return;
    }

    subscription.lastRequestedAt = now;
    const controller = new AbortController();
    subscription.refreshController = controller;
    subscription.refreshTask = (async () => {
      const startedAtMs = terminalDebugNowMs();
      try {
        const snapshot = await this.workspacePanelSnapshotService.getGitPanelSnapshot(
          subscription.workspaceId,
          {
            force,
            signal: controller.signal
          }
        );

        if (controller.signal.aborted) {
          return;
        }

        const payload = buildGitPayload(snapshot);

        if (payload === subscription.lastPayload && !options?.deliverIfUnchanged) {
          return;
        }

        subscription.lastPayload = payload;
        client.send(payload);
        logTerminalDebug("workbench.git_refresh.completed", {
          workspaceId: subscription.workspaceId,
          force,
          changeCount: snapshot.status.changes.length,
          historyCount: snapshot.history.length,
          durationMs: terminalDebugNowMs() - startedAtMs
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        this.reportAsyncError("refreshGitSubscription", error, {
          workspaceId: subscription.workspaceId
        });
      }
    })().finally(() => {
      subscription.refreshTask = null;
      if (subscription.refreshController === controller) {
        subscription.refreshController = null;
      }

      if (subscription.queuedRefresh && !subscription.refreshTimer) {
        this.flushQueuedGitRefresh(client);
      }
    });

    return subscription.refreshTask;
  }

  private ensureGitSubscription(client: WebSocket, workspaceId: string): GitClientSubscription {
    const normalizedWorkspaceId = workspaceId.trim();
    const current = this.clientGitSubscriptions.get(client);

    if (current && current.workspaceId === normalizedWorkspaceId) {
      return current;
    }

    const next: GitClientSubscription = {
      workspaceId: normalizedWorkspaceId,
      lastPayload: null,
      lastRequestedAt: 0,
      refreshTask: null,
      refreshController: null,
      refreshTimer: null,
      queuedRefresh: false,
      queuedForce: false
    };

    this.fileWatcher.subscribeGit(normalizedWorkspaceId);
    this.clientGitSubscriptions.set(client, next);

    if (current) {
      current.refreshController?.abort(new Error("git subscription replaced"));
      if (current.refreshTimer) {
        clearTimeout(current.refreshTimer);
      }
      this.fileWatcher.unsubscribeGit(current.workspaceId);
    }

    return next;
  }

  private scheduleGitRefresh(
    client: WebSocket,
    options?: {
      force?: boolean;
      quietWindowMs?: number;
    }
  ): void {
    const subscription = this.clientGitSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    subscription.queuedRefresh = true;
    subscription.queuedForce = subscription.queuedForce || (options?.force ?? false);

    if (subscription.refreshTimer) {
      clearTimeout(subscription.refreshTimer);
      subscription.refreshTimer = null;
    }

    const quietWindowMs = options?.quietWindowMs ?? 0;

    if (quietWindowMs > 0) {
      this.deferQueuedGitRefresh(client, quietWindowMs);
      return;
    }

    this.flushQueuedGitRefresh(client);
  }

  private flushQueuedGitRefresh(client: WebSocket): void {
    const subscription = this.clientGitSubscriptions.get(client);

    if (!subscription || subscription.refreshTimer || subscription.refreshTask || !subscription.queuedRefresh) {
      return;
    }

    const force = subscription.queuedForce;
    subscription.queuedRefresh = false;
    subscription.queuedForce = false;
    void this.refreshGitSubscription(client, force);
  }

  private deferQueuedGitRefresh(client: WebSocket, delayMs: number): void {
    const subscription = this.clientGitSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    if (subscription.refreshTimer) {
      clearTimeout(subscription.refreshTimer);
    }

    subscription.refreshTimer = setTimeout(() => {
      subscription.refreshTimer = null;
      this.flushQueuedGitRefresh(client);
    }, Math.max(0, delayMs));
  }

  private ensureTerminalManagerSubscription(
    client: WebSocket,
    workspaceId: string
  ): TerminalManagerClientSubscription {
    const normalizedWorkspaceId = workspaceId.trim();
    const current = this.clientTerminalManagerSubscriptions.get(client);

    if (current && current.workspaceId === normalizedWorkspaceId) {
      return current;
    }

    if (current?.refreshTimer) {
      clearTimeout(current.refreshTimer);
    }

    const next: TerminalManagerClientSubscription = {
      workspaceId: normalizedWorkspaceId,
      lastPayload: null,
      refreshTask: null,
      refreshTimer: null,
      queuedRefresh: false,
      queuedForce: false
    };

    this.clientTerminalManagerSubscriptions.set(client, next);
    return next;
  }

  private scheduleTerminalManagerRefresh(
    client: WebSocket,
    options?: {
      force?: boolean;
      quietWindowMs?: number;
    }
  ): void {
    const subscription = this.clientTerminalManagerSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    subscription.queuedRefresh = true;
    subscription.queuedForce = subscription.queuedForce || (options?.force ?? false);

    if (subscription.refreshTimer) {
      clearTimeout(subscription.refreshTimer);
      subscription.refreshTimer = null;
    }

    const quietWindowMs = options?.quietWindowMs ?? 0;

    if (quietWindowMs > 0) {
      this.deferQueuedTerminalManagerRefresh(client, quietWindowMs);
      return;
    }

    this.flushQueuedTerminalManagerRefresh(client);
  }

  private flushQueuedTerminalManagerRefresh(client: WebSocket): void {
    const subscription = this.clientTerminalManagerSubscriptions.get(client);

    if (!subscription || subscription.refreshTimer || !subscription.queuedRefresh) {
      return;
    }

    if (subscription.refreshTask) {
      return;
    }

    const force = subscription.queuedForce;
    subscription.queuedRefresh = false;
    subscription.queuedForce = false;
    void this.refreshTerminalManagerSubscription(client, force);
  }

  private deferQueuedTerminalManagerRefresh(client: WebSocket, delayMs: number): void {
    const subscription = this.clientTerminalManagerSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    if (subscription.refreshTimer) {
      clearTimeout(subscription.refreshTimer);
    }

    subscription.refreshTimer = setTimeout(() => {
      subscription.refreshTimer = null;
      this.flushQueuedTerminalManagerRefresh(client);
    }, Math.max(0, delayMs));
  }

  private async refreshTerminalManagerSubscription(
    client: WebSocket,
    force = false
  ): Promise<void> {
    const subscription = this.clientTerminalManagerSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    if (subscription.refreshTask) {
      subscription.queuedRefresh = true;
      subscription.queuedForce = subscription.queuedForce || force;
      return subscription.refreshTask;
    }

    subscription.refreshTask = (async () => {
      try {
        const startedAtMs = terminalDebugNowMs();
        const snapshot = await this.workspacePanelSnapshotService.getTerminalManagerSnapshot(
          subscription.workspaceId,
          { force }
        );
        const payloadStartedAtMs = terminalDebugNowMs();
        const payload = buildTerminalManagerPayload(snapshot);
        const payloadBuildMs = terminalDebugNowMs() - payloadStartedAtMs;

        if (payload === subscription.lastPayload) {
          return;
        }

        subscription.lastPayload = payload;
        const sendStartedAtMs = terminalDebugNowMs();
        client.send(payload);
        logTerminalDebug("workbench.terminal_manager_refresh.completed", {
          workspaceId: subscription.workspaceId,
          force,
          terminalCount: snapshot.terminals.length,
          templateCount: snapshot.templates.length,
          templateStatusCount: snapshot.templateStatuses.length,
          payloadBuildMs,
          sendMs: terminalDebugNowMs() - sendStartedAtMs,
          durationMs: terminalDebugNowMs() - startedAtMs
        });
      } catch (error) {
        this.reportAsyncError("refreshTerminalManagerSubscription", error, {
          workspaceId: subscription.workspaceId
        });
      }
    })().finally(() => {
      subscription.refreshTask = null;

      if (subscription.queuedRefresh && !subscription.refreshTimer) {
        this.flushQueuedTerminalManagerRefresh(client);
      }
    });

    return subscription.refreshTask;
  }

  private async refreshWorkspaceManagementSubscription(
    client: WebSocket,
    force = false
  ): Promise<void> {
    const subscription = this.clientWorkspaceManagementSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    try {
      const snapshot = await this.workspacePanelSnapshotService.getWorkspaceManagementSnapshot(
        subscription.workspaceId,
        { force }
      );
      const payload = buildWorkspaceManagementPayload(snapshot);

      if (payload === subscription.lastPayload) {
        return;
      }

      subscription.lastPayload = payload;
      client.send(payload);
    } catch (error) {
      this.reportAsyncError("refreshWorkspaceManagementSubscription", error, {
        workspaceId: subscription.workspaceId
      });
    }
  }

  private async refreshWorkspaceManagementSubscriptions(userId: string): Promise<void> {
    const channel = this.userChannels.get(userId);

    if (!channel) {
      return;
    }

    await Promise.allSettled(
      [...channel.clients].map((client) => this.refreshWorkspaceManagementSubscription(client))
    );
  }

  private reportAsyncError(
    scope: string,
    error: unknown,
    context: { userId?: string; workspaceId?: string } = {}
  ): void {
    const appError =
      error instanceof AppError
        ? error
        : new AppError({
            statusCode: 500,
            errorCode: "INTERNAL_ERROR",
            detail: error instanceof Error ? error.message : "未知错误"
          });

    console.error("[workbench-ws-error]", {
      scope,
      userId: context.userId,
      workspaceId: context.workspaceId,
      errorCode: appError.errorCode,
      detail: appError.message
    });
  }
}

function readBooleanEnv(rawValue: string | undefined, fallback: boolean): boolean {
  const normalized = rawValue?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseWorkbenchMessage(payload: unknown): WorkbenchMessage | null {
  const candidate = payload as Record<string, unknown> | null;

  if (typeof payload !== "object" || payload === null || typeof candidate?.type !== "string") {
    return null;
  }

  switch (candidate.type) {
    case "workbench.subscribe":
    case "workbench.refresh":
      return {
        type: candidate.type
      };
    case "fileTree.subscribe":
    case "fileTree.refresh":
      return typeof candidate.workspaceId === "string"
        ? {
            type: candidate.type,
            workspaceId: candidate.workspaceId,
            paths: Array.isArray(candidate.paths)
              ? candidate.paths.filter((value): value is string => typeof value === "string")
              : undefined
          }
        : null;
    case "git.subscribe":
    case "git.refresh":
      return typeof candidate.workspaceId === "string"
        ? {
            type: candidate.type,
            workspaceId: candidate.workspaceId
          }
        : null;
    case "terminalManager.subscribe":
    case "terminalManager.refresh":
    case "workspaceManagement.subscribe":
    case "workspaceManagement.refresh":
      return typeof candidate.workspaceId === "string"
        ? {
            type: candidate.type,
            workspaceId: candidate.workspaceId
          }
        : null;
    default:
      return null;
  }
}

function extractWorkspaceIdFromWorkbenchMessage(message: WorkbenchMessage): string | undefined {
  switch (message.type) {
    case "fileTree.subscribe":
    case "fileTree.refresh":
    case "git.subscribe":
    case "git.refresh":
    case "terminalManager.subscribe":
    case "terminalManager.refresh":
    case "workspaceManagement.subscribe":
    case "workspaceManagement.refresh":
      return message.workspaceId.trim();
    default:
      return undefined;
  }
}

function normalizePanelPaths(paths: string[] | undefined): string[] {
  const uniquePaths = new Set<string>();

  for (const value of paths ?? [""]) {
    const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    uniquePaths.add(normalized);
  }

  return [...uniquePaths];
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function buildWorkbenchPayload(snapshot: WorkbenchSnapshot): string {
  return JSON.stringify({
    type: "workbench.snapshot",
    snapshot
  });
}

function buildFileTreePayload(snapshot: FileTreeSnapshot): string {
  return JSON.stringify({
    type: "fileTree.snapshot",
    snapshot
  });
}

function buildGitPayload(snapshot: GitPanelSnapshot): string {
  return JSON.stringify({
    type: "git.snapshot",
    snapshot
  });
}

function buildTerminalManagerPayload(snapshot: TerminalManagerSnapshot): string {
  return JSON.stringify({
    type: "terminalManager.snapshot",
    snapshot
  });
}

function buildWorkspaceManagementPayload(snapshot: WorkspaceManagementSnapshot): string {
  return JSON.stringify({
    type: "workspaceManagement.snapshot",
    snapshot
  });
}
