import type { WebSocket } from "ws";

import type { AuthContext } from "../modules/auth/auth-service.js";
import type { WorkbenchService, WorkbenchSnapshot } from "../modules/workbench/workbench-service.js";

const WORKBENCH_REFRESH_INTERVAL_MS = 15_000;

interface WorkbenchSubscribeMessage {
  type: "workbench.subscribe";
}

interface WorkbenchRefreshMessage {
  type: "workbench.refresh";
}

type WorkbenchMessage = WorkbenchSubscribeMessage | WorkbenchRefreshMessage;

interface UserChannelState {
  clients: Set<WebSocket>;
  lastPayload: string | null;
  timer: NodeJS.Timeout | null;
  refreshTask: Promise<void> | null;
}

export class WorkbenchWsHub {
  private readonly clientUsers = new WeakMap<WebSocket, string>();
  private readonly userChannels = new Map<string, UserChannelState>();

  constructor(private readonly workbenchService: WorkbenchService) {}

  handleMessage(client: WebSocket, payload: unknown, authContext: AuthContext): boolean {
    if (!isWorkbenchMessage(payload)) {
      return false;
    }

    const userId = authContext.user.userId;
    const channel = this.getOrCreateChannel(userId);

    if (payload.type === "workbench.subscribe") {
      this.attachClient(client, userId, channel);
      void this.sendSnapshotToClient(client, userId, channel);
      return true;
    }

    this.attachClient(client, userId, channel);
    void this.refreshAndBroadcast(userId, true);
    return true;
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

    if (channel.clients.size > 0) {
      return;
    }

    if (channel.timer) {
      clearInterval(channel.timer);
    }

    this.userChannels.delete(userId);
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
      lastPayload: null,
      timer: null,
      refreshTask: null
    };
    channel.timer = setInterval(() => {
      void this.refreshAndBroadcast(userId);
    }, WORKBENCH_REFRESH_INTERVAL_MS);
    this.userChannels.set(userId, channel);
    return channel;
  }

  private async sendSnapshotToClient(
    client: WebSocket,
    userId: string,
    channel: UserChannelState
  ): Promise<void> {
    const payload = buildSnapshotPayload(this.workbenchService.getSnapshot(userId));
    channel.lastPayload = payload;
    client.send(payload);
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
      const snapshot = await this.workbenchService.refreshSnapshot(userId);
      const payload = buildSnapshotPayload(snapshot);

      if (payload === channel.lastPayload) {
        return;
      }

      channel.lastPayload = payload;

      for (const client of channel.clients) {
        client.send(payload);
      }
    })()
      .finally(() => {
        channel.refreshTask = null;
      });

    return channel.refreshTask;
  }
}

function isWorkbenchMessage(payload: unknown): payload is WorkbenchMessage {
  const candidate = payload as Record<string, unknown> | null;

  return (
    typeof payload === "object" &&
    payload !== null &&
    (candidate?.type === "workbench.subscribe" || candidate?.type === "workbench.refresh")
  );
}

function buildSnapshotPayload(snapshot: WorkbenchSnapshot): string {
  return JSON.stringify({
    type: "workbench.snapshot",
    snapshot
  });
}
