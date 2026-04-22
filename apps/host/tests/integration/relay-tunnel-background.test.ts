import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RelayTunnelService,
  type RelayTunnelRuntimeAdapter
} from "../../src/modules/relay-tunnel/relay-tunnel-service.js";
import { RelayTunnelRuntimeHttpError } from "../../src/modules/relay-tunnel/relay-tunnel-runtime-adapter.js";
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
import { encryptSecret } from "../../src/shared/utils/secret-box.js";

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
  it("控制站地址不可达时会返回带 URL 的连接错误", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      fetchFn: async () => {
        const error = new TypeError("fetch failed") as TypeError & {
          cause?: { code?: string };
        };
        error.cause = {
          code: "ECONNREFUSED"
        };
        throw error;
      }
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: "https://channel.jacksonz.cn:14441"
    });

    await expect(
      context.service.loginControl({
        email: "demo@example.com",
        password: "password123"
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "RELAY_TUNNEL_CONTROL_UNREACHABLE",
      message:
        "控制站登录失败：无法连接到控制站 https://channel.jacksonz.cn:14441。 请确认服务地址、端口和网络连接是否正确。 详情：连接被目标服务器拒绝。"
    });

    context.close();
  });

  it("控制站拒绝访问时会返回带 URL 的权限错误", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            detail: "invalid email or password"
          }),
          {
            status: 403,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: "https://channel.jacksonz.cn:1443"
    });

    await expect(
      context.service.loginControl({
        email: "demo@example.com",
        password: "password123"
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "RELAY_TUNNEL_CONTROL_ACCESS_DENIED",
      message:
        "控制站登录失败：控制站 https://channel.jacksonz.cn:1443 拒绝了这次请求（HTTP 403）。 请确认这是正确的控制站地址，并检查账号、密码或访问权限。 详情：invalid email or password"
    });

    context.close();
  });

  it("控制站请求超时时会返回明确的超时错误，而不是一直卡住", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      controlRequestTimeoutMs: 10,
      fetchFn: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        })
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: "https://channel.codingns.com:1443"
    });

    await expect(
      context.service.loginControl({
        email: "demo@example.com",
        password: "password123"
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "RELAY_TUNNEL_CONTROL_UNREACHABLE",
      message:
        "控制站登录失败：无法连接到控制站 https://channel.codingns.com:1443。 请确认服务地址、端口和网络连接是否正确。 详情：请求超时。"
    });

    context.close();
  });

  it("调用控制站时会把请求地址转成字符串，避免 URL 对象触发底层连接异常", async () => {
    const capturedInputs: unknown[] = [];
    const context = createRelayTunnelTestContext({
      initialized: true,
      fetchFn: async (input) => {
        capturedInputs.push(input);
        return new Response(
          JSON.stringify({
            account: {
              accountId: "acct_demo",
              email: "demo@example.com"
            },
            accessToken: "token_demo",
            expiresAt: "2026-04-21T00:00:00.000Z"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: "https://channel.codingns.com:1443"
    });

    await context.service.loginControl({
      email: "demo@example.com",
      password: "password123"
    });

    expect(capturedInputs).toHaveLength(1);
    expect(typeof capturedInputs[0]).toBe("string");
    expect(capturedInputs[0]).toBe("https://channel.codingns.com:1443/api/public/auth/login");

    context.close();
  });

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
      activated: true,
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

  it("控制站重新绑定后会覆盖本地旧 binding，而不是继续死守陈旧配置", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        created: true,
        binding: {
          bindingId: "binding_next",
          tunnelDomain: "macmini-v2.channel.codingns.com",
          hostPublicKey: "relay_public_key",
          hostFingerprint: "SHA256:relay",
          relayBaseUrl: "wss://control.codingns.example/relay",
          controlBaseUrl: "https://control.codingns.example",
          status: "active"
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }));
    const context = createRelayTunnelTestContext({
      initialized: true,
      fetchFn: fetchMock
    });

    seedBoundConfig(context.repository, {
      enabled: true,
      controlAccessTokenCiphertext: encryptSecret("relay-control-secret", "relay_access_token"),
      controlAccountEmail: "demo@example.com",
      controlSessionExpiresAt: "2026-04-21T00:00:00.000Z",
      bindingId: "binding_stale",
      tunnelDomain: "stale.channel.codingns.com"
    });

    const status = await context.service.bindControlHost("MacMini");

    expect(status.bindingId).toBe("binding_next");
    expect(status.tunnelDomain).toBe("macmini-v2.channel.codingns.com");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://control.codingns.example/api/v1/hosts/bind",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer relay_access_token"
        })
      })
    );
    expect(context.repository.findConfig()).toMatchObject({
      bindingId: "binding_next",
      tunnelDomain: "macmini-v2.channel.codingns.com"
    });

    context.close();
  });

  it("上游 challenge 明确返回绑定不存在时，会自动清掉本地旧 binding", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      runtimeAdapter: {
        connect: vi.fn(async () => {
          throw new RelayTunnelRuntimeHttpError(
            404,
            "TUNNEL_NOT_FOUND",
            "没有找到对应的隧道绑定",
            "申请 Host 上游接入挑战失败"
          );
        })
      }
    });

    seedBoundConfig(context.repository, {
      enabled: true,
      controlAccessTokenCiphertext: encryptSecret("relay-control-secret", "relay_access_token"),
      controlAccountEmail: "demo@example.com",
      controlSessionExpiresAt: "2026-04-21T00:00:00.000Z"
    });

    const status = await context.service.requestReconnect("relay_tunnel.binding_missing").promise;
    const persistedConfig = context.repository.findConfig();
    const persistedStatus = context.repository.findStatus();

    expect(status.phase).toBe("unbound");
    expect(status.bindingId).toBeNull();
    expect(status.tunnelDomain).toBeNull();
    expect(status.enabled).toBe(true);
    expect(status.lastError).toBe("申请 Host 上游接入挑战失败：没有找到对应的隧道绑定");
    expect(persistedConfig).toMatchObject({
      accountId: "acct_demo",
      bindingId: null,
      tunnelDomain: null,
      enabled: true
    });
    expect(persistedStatus).toMatchObject({
      phase: "unbound",
      bindingId: null,
      tunnelDomain: null,
      lastError: "申请 Host 上游接入挑战失败：没有找到对应的隧道绑定"
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
      activated: true,
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
      activated: true,
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

  it("读取状态时会把历史默认的 Host API 端口迁移到前端入口端口", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      defaultLocalTargetBaseUrl: "http://127.0.0.1:4174",
      legacyLocalTargetBaseUrl: "http://127.0.0.1:4312"
    });

    seedBoundConfig(context.repository, {
      localTargetBaseUrl: "http://127.0.0.1:4312"
    });

    const status = await context.service.getStatus();
    const persisted = context.repository.findConfig();

    expect(status.localTargetBaseUrl).toBe("http://127.0.0.1:4174");
    expect(persisted?.localTargetBaseUrl).toBe("http://127.0.0.1:4174");

    context.close();
  });

  it("读取状态时会把 default 源的旧前端入口收敛到当前默认值", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true,
      defaultLocalTargetBaseUrl: "http://127.0.0.1:3002",
      legacyLocalTargetBaseUrl: null
    });

    seedBoundConfig(context.repository, {
      localTargetBaseUrl: "http://127.0.0.1:4174",
      localTargetBaseUrlSource: "default"
    });

    const status = await context.service.getStatus();
    const persisted = context.repository.findConfig();

    expect(status.localTargetBaseUrl).toBe("http://127.0.0.1:3002");
    expect(persisted?.localTargetBaseUrl).toBe("http://127.0.0.1:3002");
    expect(persisted?.localTargetBaseUrlSource).toBe("default");

    context.close();
  });

  it("读取状态时会把历史空控制站地址收敛到官方默认地址", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: null
    });

    const status = await context.service.getStatus();
    const persisted = context.repository.findConfig();

    expect(status.controlBaseUrl).toBe("https://channel.codingns.com:1443");
    expect(persisted?.controlBaseUrl).toBe("https://channel.codingns.com:1443");
    expect(status.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");
    expect(persisted?.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");

    context.close();
  });

  it("读取状态时会把历史旧官方控制站地址迁移到新端口", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true
    });

    seedBoundConfig(context.repository, {
      controlBaseUrl: "https://channel.codingns.com:10247",
      relayBaseUrl: "wss://channel.codingns.com:10247/relay"
    });

    const status = await context.service.getStatus();
    const persisted = context.repository.findConfig();

    expect(status.controlBaseUrl).toBe("https://channel.codingns.com:1443");
    expect(persisted?.controlBaseUrl).toBe("https://channel.codingns.com:1443");
    expect(status.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");
    expect(persisted?.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");

    context.close();
  });

  it("读取状态时会把旧的独立 relay 地址收敛到控制站同源 relay 路径", async () => {
    const context = createRelayTunnelTestContext({
      initialized: true
    });

    seedBoundConfig(context.repository, {
      relayBaseUrl: "wss://channel.codingns.com:10247/relay",
      controlBaseUrl: "https://channel.codingns.com:1443"
    });

    const status = await context.service.getStatus();
    const persisted = context.repository.findConfig();

    expect(status.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");
    expect(persisted?.relayBaseUrl).toBe("wss://channel.codingns.com:1443/relay");

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
  defaultLocalTargetBaseUrl?: string;
  legacyLocalTargetBaseUrl?: string | null;
  controlRequestTimeoutMs?: number;
  fetchFn?: typeof fetch;
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
      defaultLocalTargetBaseUrl:
        options?.defaultLocalTargetBaseUrl ?? "http://127.0.0.1:4312",
      legacyLocalTargetBaseUrl: options?.legacyLocalTargetBaseUrl ?? null,
      controlSessionSecret: "relay-control-secret",
      controlRequestTimeoutMs: options?.controlRequestTimeoutMs,
      fetchFn: options?.fetchFn
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
    activated: true,
    enabled: false,
    provider: "codingns_relay",
    relayBaseUrl: "wss://control.codingns.example/relay",
    controlBaseUrl: "https://control.codingns.example",
    controlAccessTokenCiphertext: null,
    controlAccountEmail: null,
    controlSessionExpiresAt: null,
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
