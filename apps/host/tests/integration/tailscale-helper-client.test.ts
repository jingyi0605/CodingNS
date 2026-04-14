import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TailscaleHelperClient } from "../../src/modules/tailscale/tailscale-helper-client.js";
import {
  createFakeTailscaleCli,
  writeFakeTailscaleState
} from "../helpers/fake-tailscale.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("Tailscale helper client", () => {
  it("可以通过 helper 读取 tailscale 状态", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-helper-"));
    tempDirs.push(tempDir);
    const fakeCli = createFakeTailscaleCli(tempDir);
    writeFakeTailscaleState(fakeCli.statePath, {
      backendState: "Running",
      hostname: "codingns-host",
      accountName: "user@example.com",
      fqdn: "codingns-host.tailnet.ts.net",
      ipv4: "100.64.0.10",
      ipv6: "fd7a:115c:a1e0::10",
      loginUrl: "https://login.tailscale.test/device/abc123",
      lastError: null
    });

    const client = new TailscaleHelperClient();
    const snapshot = await client.inspectStatus({
      commandPath: fakeCli.cliPath
    });
    client.dispose();

    expect(snapshot).toEqual({
      backendState: "running",
      loginUrl: null,
      hostname: "codingns-host",
      accountName: "user@example.com",
      tailnetFqdn: "codingns-host.tailnet.ts.net",
      tailnetIpv4: "100.64.0.10",
      tailnetIpv6: "fd7a:115c:a1e0::10",
      lastError: null
    });
  });

  it("未登录时 enable/login 会返回登录链接，disable/logout 会回写状态", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-helper-flow-"));
    tempDirs.push(tempDir);
    const fakeCli = createFakeTailscaleCli(tempDir);
    const client = new TailscaleHelperClient();

    const enableSnapshot = await client.enable({
      commandPath: fakeCli.cliPath,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host"
    });
    const loginSnapshot = await client.login({
      commandPath: fakeCli.cliPath,
      controlServerUrl: "https://headscale.example.com",
      hostname: "codingns-host"
    });

    writeFakeTailscaleState(fakeCli.statePath, {
      backendState: "Running",
      hostname: "codingns-host",
      accountName: "user@example.com",
      fqdn: "codingns-host.tailnet.ts.net",
      ipv4: "100.64.0.10",
      ipv6: "fd7a:115c:a1e0::10",
      loginUrl: "https://login.tailscale.test/device/abc123",
      lastError: null
    });

    const disableSnapshot = await client.disable({
      commandPath: fakeCli.cliPath
    });
    const logoutSnapshot = await client.logout({
      commandPath: fakeCli.cliPath
    });
    client.dispose();

    expect(enableSnapshot.backendState).toBe("needs_login");
    expect(enableSnapshot.loginUrl).toBe("https://login.tailscale.test/device/abc123");
    expect(loginSnapshot.backendState).toBe("needs_login");
    expect(loginSnapshot.loginUrl).toBe("https://login.tailscale.test/device/abc123");
    expect(disableSnapshot.backendState).toBe("stopped");
    expect(logoutSnapshot.backendState).toBe("needs_login");
  });

  it("账号字段缺失时不会错误显示 tailnet 域名", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-tailscale-helper-account-"));
    tempDirs.push(tempDir);
    const fakeCli = createFakeTailscaleCli(tempDir);
    writeFakeTailscaleState(fakeCli.statePath, {
      backendState: "Running",
      hostname: "codingns-host",
      accountName: null,
      tailnetName: "jacksonz.cn",
      fqdn: "codingns-host.tailnet.ts.net",
      ipv4: "100.64.0.10",
      ipv6: "fd7a:115c:a1e0::10",
      loginUrl: "https://login.tailscale.test/device/abc123",
      lastError: null
    });

    const client = new TailscaleHelperClient();
    const snapshot = await client.inspectStatus({
      commandPath: fakeCli.cliPath
    });
    client.dispose();

    expect(snapshot.accountName).toBeNull();
  });
});
