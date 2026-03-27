import type { WebSocket } from "ws";

import { AppError } from "../shared/errors/app-error.js";
import type { AuthContext } from "../modules/auth/auth-service.js";
import type { WorkbenchService, WorkbenchSnapshot } from "../modules/workbench/workbench-service.js";
import type {
  FileTreeSnapshot,
  GitPanelSnapshot,
  TerminalManagerSnapshot,
  WorkspaceManagementSnapshot,
  WorkspacePanelSnapshotService
} from "../modules/workbench/workspace-panel-snapshot-service.js";

const WORKBENCH_REFRESH_INTERVAL_MS = 60_000;
const SIDEBAR_REFRESH_INTERVAL_MS = 5_000;
const GIT_SUBSCRIPTION_MIN_REFRESH_INTERVAL_MS = 15_000;

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
  sidebarTimer: NodeJS.Timeout | null;
  refreshTask: Promise<void> | null;
  titleSyncTask: Promise<void> | null;
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
}

interface TerminalManagerClientSubscription {
  workspaceId: string;
  lastPayload: string | null;
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
    private readonly workspacePanelSnapshotService: WorkspacePanelSnapshotService
  ) {}

  handleMessage(client: WebSocket, payload: unknown, authContext: AuthContext): boolean {
    const message = parseWorkbenchMessage(payload);

    if (!message) {
      return false;
    }

    const userId = authContext.user.userId;
    const channel = this.getOrCreateChannel(userId);

    this.attachClient(client, userId, channel);

    switch (message.type) {
      case "workbench.subscribe":
        void this.sendWorkbenchSnapshotToClient(client, userId, channel);
        return true;
      case "workbench.refresh":
        void this.refreshAndBroadcast(userId, true);
        return true;
      case "fileTree.subscribe":
        this.clientFileTreeSubscriptions.set(client, {
          workspaceId: message.workspaceId.trim(),
          paths: normalizePanelPaths(message.paths),
          lastPayloadByPath: new Map<string, string>()
        });
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
        this.clientGitSubscriptions.set(client, {
          workspaceId: message.workspaceId.trim(),
          lastPayload: null,
          lastRequestedAt: 0,
          refreshTask: null
        });
        void this.refreshGitSubscription(client);
        return true;
      case "git.refresh":
        this.workspacePanelSnapshotService.invalidateGit(message.workspaceId.trim());
        this.clientGitSubscriptions.set(client, {
          workspaceId: message.workspaceId.trim(),
          lastPayload: null,
          lastRequestedAt: 0,
          refreshTask: null
        });
        void this.refreshGitSubscription(client, true);
        return true;
      case "terminalManager.subscribe":
        this.clientTerminalManagerSubscriptions.set(client, {
          workspaceId: message.workspaceId.trim(),
          lastPayload: null
        });
        void this.refreshTerminalManagerSubscription(client);
        return true;
      case "terminalManager.refresh":
        this.workspacePanelSnapshotService.invalidateTerminalManager(message.workspaceId.trim());
        this.clientTerminalManagerSubscriptions.set(client, {
          workspaceId: message.workspaceId.trim(),
          lastPayload: null
        });
        void this.refreshTerminalManagerSubscription(client, true);
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

    if (channel.sidebarTimer) {
      clearInterval(channel.sidebarTimer);
    }

    this.userChannels.delete(userId);
  }

  async broadcastSnapshot(userId: string): Promise<void> {
    try {
      const channel = this.userChannels.get(userId);

      if (!channel) {
        return;
      }

      const payload = buildWorkbenchPayload(this.workbenchService.getSnapshot(userId));

      if (payload === channel.lastWorkbenchPayload) {
        return;
      }

      channel.lastWorkbenchPayload = payload;

      for (const client of channel.clients) {
        client.send(payload);
      }
    } catch (error) {
      this.reportAsyncError("broadcastSnapshot", error, { userId });
    }
  }

  private attachClient(client: WebSocket, userId: string, channel: UserChannelState): void {
    channel.clients.add(client);
    this.clientUsers.set(client, userId);
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
      sidebarTimer: null,
      refreshTask: null,
      titleSyncTask: null
    };
    channel.workbenchTimer = setInterval(() => {
      if (!this.workbenchService.shouldRefreshSnapshot()) {
        return;
      }

      void this.refreshAndBroadcast(userId).catch((error) => {
        this.reportAsyncError("workbenchTimer", error, { userId });
      });
    }, WORKBENCH_REFRESH_INTERVAL_MS);
    channel.sidebarTimer = setInterval(() => {
      void Promise.all([
        this.syncTitlesAndBroadcast(userId),
        this.refreshSidebarSubscriptions(userId)
      ]).catch((error) => {
        this.reportAsyncError("sidebarTimer", error, { userId });
      });
    }, SIDEBAR_REFRESH_INTERVAL_MS);
    this.userChannels.set(userId, channel);
    return channel;
  }

  private async syncTitlesAndBroadcast(userId: string): Promise<void> {
    const channel = this.getOrCreateChannel(userId);

    if (channel.titleSyncTask) {
      return channel.titleSyncTask;
    }

    channel.titleSyncTask = (async () => {
      try {
        const payload = buildWorkbenchPayload(await this.workbenchService.syncSessionTitles(userId));

        if (payload === channel.lastWorkbenchPayload) {
          return;
        }

        channel.lastWorkbenchPayload = payload;

        for (const client of channel.clients) {
          client.send(payload);
        }
      } catch (error) {
        this.reportAsyncError("syncTitlesAndBroadcast", error, { userId });
      }
    })().finally(() => {
      channel.titleSyncTask = null;
    });

    return channel.titleSyncTask;
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
      } catch (error) {
        this.reportAsyncError("refreshAndBroadcast", error, { userId });
      }
    })().finally(() => {
      channel.refreshTask = null;
    });

    return channel.refreshTask;
  }

  private async refreshSidebarSubscriptions(userId: string): Promise<void> {
    const channel = this.userChannels.get(userId);

    if (!channel) {
      return;
    }

    await Promise.all(
      [...channel.clients].map(async (client) => {
        await Promise.allSettled([
          this.refreshFileTreeSubscriptions(client),
          this.refreshGitSubscription(client),
          this.refreshTerminalManagerSubscription(client),
          this.refreshWorkspaceManagementSubscription(client)
        ]);
      })
    );
  }

  private ensureFileTreeSubscription(
    client: WebSocket,
    workspaceId: string,
    paths?: string[]
  ): FileTreeClientSubscription {
    const current = this.clientFileTreeSubscriptions.get(client);
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedPaths = normalizePanelPaths(paths);

    if (!current || current.workspaceId !== normalizedWorkspaceId) {
      const next: FileTreeClientSubscription = {
        workspaceId: normalizedWorkspaceId,
        paths: normalizedPaths,
        lastPayloadByPath: new Map<string, string>()
      };

      this.clientFileTreeSubscriptions.set(client, next);
      return next;
    }

    if (normalizedPaths.length > 0) {
      current.paths = normalizedPaths;
    }

    if (current.paths.length === 0) {
      current.paths = [""];
    }

    return current;
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

  private async refreshGitSubscription(client: WebSocket, force = false): Promise<void> {
    const subscription = this.clientGitSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    if (subscription.refreshTask) {
      if (!force) {
        return subscription.refreshTask;
      }

      await subscription.refreshTask;
    }

    const now = Date.now();

    if (
      !force
      && now - subscription.lastRequestedAt < GIT_SUBSCRIPTION_MIN_REFRESH_INTERVAL_MS
    ) {
      return;
    }

    subscription.lastRequestedAt = now;
    subscription.refreshTask = (async () => {
      try {
        const snapshot = await this.workspacePanelSnapshotService.getGitPanelSnapshot(
          subscription.workspaceId,
          { force }
        );
        const payload = buildGitPayload(snapshot);

        if (payload === subscription.lastPayload) {
          return;
        }

        subscription.lastPayload = payload;
        client.send(payload);
      } catch (error) {
        this.reportAsyncError("refreshGitSubscription", error, {
          workspaceId: subscription.workspaceId
        });
      }
    })().finally(() => {
      subscription.refreshTask = null;
    });

    return subscription.refreshTask;
  }

  private async refreshTerminalManagerSubscription(
    client: WebSocket,
    force = false
  ): Promise<void> {
    const subscription = this.clientTerminalManagerSubscriptions.get(client);

    if (!subscription) {
      return;
    }

    try {
      const snapshot = await this.workspacePanelSnapshotService.getTerminalManagerSnapshot(
        subscription.workspaceId,
        { force }
      );
      const payload = buildTerminalManagerPayload(snapshot);

      if (payload === subscription.lastPayload) {
        return;
      }

      subscription.lastPayload = payload;
      client.send(payload);
    } catch (error) {
      this.reportAsyncError("refreshTerminalManagerSubscription", error, {
        workspaceId: subscription.workspaceId
      });
    }
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

function normalizePanelPaths(paths: string[] | undefined): string[] {
  const uniquePaths = new Set<string>();

  for (const value of paths ?? [""]) {
    const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    uniquePaths.add(normalized);
  }

  return [...uniquePaths];
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
