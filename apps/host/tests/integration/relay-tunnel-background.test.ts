import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RelayTunnelService,
  type RelayTunnelRuntimeAdapter
} from "../../src/modules/relay-tunnel/relay-tunnel-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import type {
  InstanceRelayTunnelConfig,
  InstanceRelayTunnelStatus
} from "../../src/types/domain.js";
import { BootstrapStateRepository } from "../../src/storage/repositories/bootstrap-state-repository.js";
import { InstanceRelayTunnelIdentityRepository } from "../../src/storage/repositories/instance-relay-tunnel-identity-repository.js";
import { InstanceRelayTunnelRepository } from "../../src/storage/repositories/instance-relay-tunnel-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("RelayTunnelService 后台任务", () => {
  it("启动恢复只入队后台连接，不阻塞调用方", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () => await createDeferred<InstanceRelayTunnelStatus>().promise)
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true
    });

    await context.service.restoreOnStartup();

    expect(context.connectMock).toHaveBeenCalledTimes(1);
    expect(context.taskManager.peek(HOST_TASK_TYPES.relayTunnelConnect, "default")?.status).toBe(
      "running"
    );

    const status = await context.service.getStatus();
    expect(status.phase).toBe("connecting");
    expect(status.connected).toBe(false);

    context.close();
  });

  it("重复请求重连会按固定 key 去重", async () => {
    const connectDeferred = createDeferred<InstanceRelayTunnelStatus>();
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () => await connectDeferred.promise)
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true
    });

    const first = context.service.requestReconnect("relay_tunnel.test_first");
    const second = context.service.requestReconnect("relay_tunnel.test_second");

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(context.connectMock).toHaveBeenCalledTimes(1);

    connectDeferred.resolve(
      buildRunningStatus({
        bindingId: "binding_demo",
        tunnelDomain: "demo.codingns.example",
        hostFingerprint: "SHA256:demo"
      })
    );

    await expect(first.promise).resolves.toMatchObject({
      phase: "running",
      connected: true
    });
    await expect(second.promise).resolves.toMatchObject({
      phase: "running",
      connected: true
    });

    context.close();
  });

  it("后台连接成功后会把状态推进到 running", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () =>
          buildRunningStatus({
            bindingId: "binding_demo",
            tunnelDomain: "demo.codingns.example",
            hostFingerprint: "SHA256:demo"
          })
        )
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true
    });

    const result = await context.service.requestReconnect("relay_tunnel.test_success").promise;
    const persisted = context.repository.findStatus();

    expect(result).toMatchObject({
      enabled: true,
      phase: "running",
      connected: true,
      hostFingerprint: "SHA256:demo"
    });
    expect(persisted).toEqual({
      phase: "running",
      connected: true,
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostFingerprint: "SHA256:demo",
      trafficUsedBytes: "1024",
      trafficRemainingBytes: "2048",
      quotaResetAt: "2026-04-20T00:00:00.000Z",
      lastError: null,
      observedAt: "2026-04-19T12:10:00.000Z"
    });

    context.close();
  });

  it("后台连接失败后会写入 error 和最后错误信息", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () => {
          throw new Error("relay connect failed");
        })
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true
    });

    const result = await context.service.requestReconnect("relay_tunnel.test_failure").promise;
    const persisted = context.repository.findStatus();

    expect(result.phase).toBe("error");
    expect(result.lastError).toBe("relay connect failed");
    expect(persisted?.phase).toBe("error");
    expect(persisted?.lastError).toBe("relay connect failed");
    expect(persisted?.connected).toBe(false);

    context.close();
  });

  it("未初始化实例启用公共隧道时会进入 blocked_uninitialized，且不会启动后台连接", async () => {
    const context = createRelayTunnelTestContext({
      initialized: false,
      runtimeAdapter: {
        connect: vi.fn(async () => buildRunningStatus())
      }
    });

    seedBoundConfig(context.repository);

    const result = await context.service.enable();
    const persisted = context.repository.findStatus();

    expect(result).toMatchObject({
      enabled: true,
      phase: "blocked_uninitialized",
      connected: false,
      lastError: null
    });
    expect(persisted?.phase).toBe("blocked_uninitialized");
    expect(context.connectMock).not.toHaveBeenCalled();
    expect(context.taskManager.peek(HOST_TASK_TYPES.relayTunnelConnect, "default")).toBeNull();

    context.close();
  });

  it("实例初始化完成后启用公共隧道会进入 connecting，并启动后台连接", async () => {
    const connectDeferred = createDeferred<InstanceRelayTunnelStatus>();
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () => await connectDeferred.promise)
      }
    });

    seedBoundConfig(context.repository);

    const result = await context.service.enable();

    expect(result).toMatchObject({
      enabled: true,
      phase: "connecting",
      connected: false
    });
    expect(context.connectMock).toHaveBeenCalledTimes(1);
    expect(context.taskManager.peek(HOST_TASK_TYPES.relayTunnelConnect, "default")?.status).toBe(
      "running"
    );

    connectDeferred.resolve(buildRunningStatus());
    await flushMicrotasks();

    context.close();
  });

  it("未初始化实例启动恢复时不会偷偷连公网，而是写回 blocked_uninitialized", async () => {
    const context = createRelayTunnelTestContext({
      initialized: false,
      runtimeAdapter: {
        connect: vi.fn(async () => buildRunningStatus())
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true
    });

    await context.service.restoreOnStartup();

    const persisted = context.repository.findStatus();
    expect(persisted?.phase).toBe("blocked_uninitialized");
    expect(context.connectMock).not.toHaveBeenCalled();
    expect(context.taskManager.peek(HOST_TASK_TYPES.relayTunnelConnect, "default")).toBeNull();

    context.close();
  });
});

function createRelayTunnelTestContext(options?: {
  initialized?: boolean;
  runtimeAdapter?: RelayTunnelRuntimeAdapter;
}) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-tunnel-background-"));
  tempDirs.push(tempDir);

  const databasePath = path.join(tempDir, "host.sqlite");
  const database = createDatabaseClient(databasePath);
  const bootstrapStateRepository = new BootstrapStateRepository(database.db);
  const identityRepository = new InstanceRelayTunnelIdentityRepository(database.db);
  const repository = new InstanceRelayTunnelRepository(database.db);
  const taskManager = createTaskManager();

  if (options?.initialized) {
    bootstrapStateRepository.markInitialized("2026-04-19T12:00:00.000Z", "user-1");
  }

  const runtimeAdapter =
    options?.runtimeAdapter
    ?? {
      connect: async (_config: InstanceRelayTunnelConfig) =>
        buildRunningStatus({
          bindingId: "binding_demo",
          tunnelDomain: "demo.codingns.example",
          hostFingerprint: "SHA256:demo"
        })
    };
  const connectMock = vi.spyOn(runtimeAdapter, "connect");
  const service = new RelayTunnelService(
    database.db,
    bootstrapStateRepository,
    identityRepository,
    repository,
    {
      defaultLocalTargetBaseUrl: "http://127.0.0.1:4312"
    },
    taskManager,
    runtimeAdapter
  );

  return {
    database,
    repository,
    taskManager,
    service,
    connectMock,
    close() {
      database.close();
    }
  };
}

function seedBoundConfig(
  repository: InstanceRelayTunnelRepository,
  overrides?: Partial<InstanceRelayTunnelConfig>
) {
  repository.upsertConfig({
    enabled: false,
    provider: "codingns_relay",
    relayBaseUrl: "wss://relay.codingns.example",
    controlBaseUrl: "https://control.codingns.example",
    accountId: "acct_demo",
    tunnelDomain: "demo.codingns.example",
    bindingId: "binding_demo",
    hostPublicKey: "PUBLIC_KEY_DEMO",
    hostKeyFingerprint: "SHA256:demo",
    localTargetBaseUrl: "http://127.0.0.1:4312",
    updatedAt: "2026-04-19T12:00:00.000Z",
    ...overrides
  });
}

function buildRunningStatus(overrides?: Partial<InstanceRelayTunnelStatus>): InstanceRelayTunnelStatus {
  return {
    phase: "running",
    connected: true,
    bindingId: "binding_demo",
    tunnelDomain: "demo.codingns.example",
    hostFingerprint: "SHA256:demo",
    trafficUsedBytes: "1024",
    trafficRemainingBytes: "2048",
    quotaResetAt: "2026-04-20T00:00:00.000Z",
    lastError: null,
    observedAt: "2026-04-19T12:10:00.000Z",
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
