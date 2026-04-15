import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BootstrapStateRepository } from "../../src/storage/repositories/bootstrap-state-repository.js";
import { InstanceTailscaleRepository } from "../../src/storage/repositories/instance-tailscale-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { TailscaleManager } from "../../src/modules/tailscale/tailscale-manager.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import type {
  TailscaleHelperClient,
  TailscaleHelperSnapshot
} from "../../src/modules/tailscale/tailscale-helper-client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("TailscaleManager 状态机", () => {
  it("已初始化实例启用后会按状态机进入 needs_login", () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => createHelperSnapshot("needs_login")
    });
    const config = createConfig(true);

    return manager.enable(config).then((status) => {
      const persistedStatus = repository.findStatus();

      client.close();

      expect(status.phase).toBe("needs_login");
      expect(status.connected).toBe(false);
      expect(persistedStatus?.phase).toBe("needs_login");
    });
  });

  it("未初始化实例启用时会停在 blocked_uninitialized", () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    const manager = createManager(bootstrapStateRepository, repository);

    return manager.enable(createConfig(true)).then((status) => {
      client.close();

      expect(status.phase).toBe("blocked_uninitialized");
      expect(status.connected).toBe(false);
    });
  });

  it("只有从 needs_login 或 starting 才允许切到 running", () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => createHelperSnapshot("needs_login")
    });

    expect(() => manager.recordRunning(createConfig(false))).toThrowError(AppError);

    return manager.enable(createConfig(true)).then(() => {
      const running = manager.recordRunning(createConfig(true), {
        accountName: "user@example.com",
        tailnetFqdn: "codingns-host.tailnet.ts.net",
        tailnetIpv4: "100.64.0.10",
        reachableBaseUrl: "https://codingns-host.tailnet.ts.net"
      });

      client.close();

      expect(running).toEqual({
        phase: "running",
        connected: true,
        loginUrl: null,
        controlServerUrl: null,
        hostname: null,
        accountName: "user@example.com",
        tailnetFqdn: "codingns-host.tailnet.ts.net",
        tailnetIpv4: "100.64.0.10",
        tailnetIpv6: null,
        reachableBaseUrl: "https://codingns-host.tailnet.ts.net",
        lastError: null,
        observedAt: expect.any(String)
      });
    });
  });

  it("running 进入 error 后允许重新回到 needs_login", () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => createHelperSnapshot("needs_login"),
      login: async () => createHelperSnapshot("needs_login")
    });
    const config = createConfig(true);

    return manager.enable(config).then(async () => {
      manager.recordRunning(config, {
        tailnetFqdn: "codingns-host.tailnet.ts.net"
      });
      const errored = manager.recordError(config, "tailscaled exited unexpectedly");
      const relogin = await manager.requestLogin(config);

      client.close();

      expect(errored.phase).toBe("error");
      expect(errored.lastError).toBe("tailscaled exited unexpectedly");
      expect(relogin.phase).toBe("needs_login");
    });
  });

  it("running 状态重复 enable 时保持幂等，不会先崩在非法迁移上", async () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => createHelperSnapshot("running")
    });
    const config = createConfig(true);

    repository.upsertStatus({
      phase: "running",
      connected: true,
      loginUrl: null,
      controlServerUrl: null,
      hostname: null,
      accountName: "user@example.com",
      tailnetFqdn: "codingns-host.tailnet.ts.net",
      tailnetIpv4: "100.64.0.10",
      tailnetIpv6: "fd7a:115c:a1e0::10",
      reachableBaseUrl: "http://codingns-host.tailnet.ts.net:4174",
      lastError: null,
      observedAt: "2026-04-14T09:00:00.000Z"
    });

    const status = await manager.enable(config);
    client.close();

    expect(status.phase).toBe("running");
    expect(status.connected).toBe(true);
    expect(status.accountName).toBe("user@example.com");
  });

  it("running 状态会把外部访问地址绑定到前端端口，而不是 Host API 端口", async () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => createHelperSnapshot("running")
    });

    const status = await manager.enable(createConfig(true));
    client.close();

    expect(status.phase).toBe("running");
    expect(status.reachableBaseUrl).toBe("http://codingns-host.tailnet.ts.net:4174");
  });

  it("CLI 不可用时会回写可读错误，而不是内部错误码", async () => {
    const { client, bootstrapStateRepository, repository } = createHarness();
    bootstrapStateRepository.markInitialized("2026-04-14T09:00:00.000Z", "user-1");
    const manager = createManager(bootstrapStateRepository, repository, {
      enable: async () => {
        throw new Error("TAILSCALE_CLI_UNAVAILABLE");
      }
    });

    const status = await manager.enable(createConfig(true));
    client.close();

    expect(status.phase).toBe("error");
    expect(status.lastError).toBe(
      "未发现 Tailscale CLI。请先安装 Tailscale，或通过 CODINGNS_TAILSCALE_COMMAND 指定命令路径。"
    );
  });
});

function createHarness(): {
  client: ReturnType<typeof createDatabaseClient>;
  bootstrapStateRepository: BootstrapStateRepository;
  repository: InstanceTailscaleRepository;
} {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-manager-"));
  tempDirs.push(tempDir);
  const client = createDatabaseClient(path.join(tempDir, "host.sqlite"));

  return {
    client,
    bootstrapStateRepository: new BootstrapStateRepository(client.db),
    repository: new InstanceTailscaleRepository(client.db)
  };
}

function createConfig(enabled: boolean) {
  return {
    enabled,
    controlServerUrl: null,
    hostname: null,
    stateDir: "/tmp/tailscale-state",
    updatedAt: "2026-04-14T09:00:00.000Z"
  } as const;
}

function createManager(
  bootstrapStateRepository: BootstrapStateRepository,
  repository: InstanceTailscaleRepository,
  overrides: Partial<{
    inspectStatus: () => Promise<TailscaleHelperSnapshot>;
    enable: () => Promise<TailscaleHelperSnapshot>;
    login: () => Promise<TailscaleHelperSnapshot>;
    disable: () => Promise<TailscaleHelperSnapshot>;
    logout: () => Promise<TailscaleHelperSnapshot>;
  }> = {}
): TailscaleManager {
  const helperClient = {
    inspectStatus: overrides.inspectStatus ?? (async () => createHelperSnapshot("needs_login")),
    enable: overrides.enable ?? (async () => createHelperSnapshot("needs_login")),
    login: overrides.login ?? (async () => createHelperSnapshot("needs_login")),
    disable: overrides.disable ?? (async () => createHelperSnapshot("stopped")),
    logout: overrides.logout ?? (async () => createHelperSnapshot("needs_login"))
  } as unknown as TailscaleHelperClient;

  return new TailscaleManager(
    bootstrapStateRepository,
    repository,
    helperClient,
    {
      commandPath: "tailscale",
      webUiPort: 4174
    }
  );
}

function createHelperSnapshot(
  backendState: TailscaleHelperSnapshot["backendState"]
): TailscaleHelperSnapshot {
  return {
    backendState,
    loginUrl:
      backendState === "needs_login" ? "https://login.tailscale.test/device/abc123" : null,
    hostname: "codingns-host",
    accountName:
      backendState === "running" ? "user@example.com" : null,
    tailnetFqdn:
      backendState === "running" ? "codingns-host.tailnet.ts.net" : null,
    tailnetIpv4:
      backendState === "running" ? "100.64.0.10" : null,
    tailnetIpv6:
      backendState === "running" ? "fd7a:115c:a1e0::10" : null,
    lastError: null
  };
}
