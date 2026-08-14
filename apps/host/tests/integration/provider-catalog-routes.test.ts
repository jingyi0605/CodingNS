import path from "node:path";
import { chmodSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const hosted = activeServers.pop();

    if (hosted) {
      hosted.app.server.closeAllConnections?.();
      await hosted.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("provider catalog routes", () => {
  it("会返回 provider catalog，并支持切换启用态", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const fakeCodexPath = path.join(fixture.rootDir, "codex-version");
    const fakeDeepSeekHarnessPath = path.join(fixture.rootDir, "deepseek-harness-version");
    writeFileSync(
      fakeCodexPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"codex 1.8.0\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);
    writeFileSync(
      fakeDeepSeekHarnessPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"deepseek-harness 0.1.0-rc.5\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeDeepSeekHarnessPath, 0o755);

    const hosted = createTestApp(fixture, {
      codexCliPath: fakeCodexPath,
      geminiCliPath: path.join(fixture.rootDir, "missing-gemini"),
      kimiCliPath: path.join(fixture.rootDir, "missing-kimi"),
      legnaCodeCliPath: path.join(fixture.rootDir, "missing-legna"),
      opencodeCliPath: path.join(fixture.rootDir, "missing-opencode"),
      deepseekHarnessCliPath: fakeDeepSeekHarnessPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);

    const initialCatalogResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/catalog",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(initialCatalogResponse.statusCode).toBe(200);
    const initialCatalog = initialCatalogResponse.json() as {
      items: Array<{
        provider: string;
        displayName: string;
        enabled: boolean;
        installState: string;
        version: string | null;
        commandPath: string | null;
        capabilities: {
          canStartSession: boolean;
          supportsStructuredToolCalls: boolean;
        };
        productCapabilities: {
          streamingOutput: boolean;
          toolCalls: boolean;
          assistantService: boolean;
          sessionFork: boolean;
          skillUsage: boolean;
        };
      }>;
    };

    expect(initialCatalog.items.map((item) => item.provider)).toEqual([
      "claude-code",
      "legna-code",
      "codex",
      "gemini",
      "kimi",
      "opencode",
      "deepseek-harness"
    ]);

    const codexEntry = initialCatalog.items.find((item) => item.provider === "codex");
    expect(codexEntry).toMatchObject({
      provider: "codex",
      displayName: "Codex",
      enabled: true,
      installState: "ready",
      version: "1.8.0",
      commandPath: fakeCodexPath,
      capabilities: {
        canStartSession: true,
        supportsStructuredToolCalls: true
      },
      productCapabilities: {
        streamingOutput: true,
        toolCalls: true,
        assistantService: true,
        sessionFork: true,
        skillUsage: true
      }
    });

    const deepSeekHarnessEntry = initialCatalog.items.find(
      (item) => item.provider === "deepseek-harness"
    );
    expect(deepSeekHarnessEntry).toMatchObject({
      provider: "deepseek-harness",
      installState: "ready",
      version: "0.1.0-rc.5",
      commandPath: fakeDeepSeekHarnessPath
    });

    const disableResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/providers/catalog/codex",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        enabled: false
      }
    });

    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json().item).toMatchObject({
      provider: "codex",
      enabled: false,
      productCapabilities: {
        assistantService: false,
        skillUsage: false
      }
    });

    const updatedCatalogResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/catalog",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(updatedCatalogResponse.statusCode).toBe(200);
    const updatedCodexEntry = (updatedCatalogResponse.json() as {
      items: Array<{ provider: string; enabled: boolean }>;
    }).items.find((item) => item.provider === "codex");
    expect(updatedCodexEntry).toMatchObject({
      provider: "codex",
      enabled: false
    });

    const disabledCapabilitiesResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/codex/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(disabledCapabilitiesResponse.statusCode).toBe(200);
    expect(disabledCapabilitiesResponse.json()).toMatchObject({
      provider: "codex",
      canStartSession: false,
      canResumeSession: false,
      canSendMessage: false
    });
    expect(disabledCapabilitiesResponse.json().limitations[0]).toBe("当前 provider 已被禁用");
  });

  it("catalog 会直接读取启动时缓存的 provider 运行状态", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const fakeCodexPath = path.join(fixture.rootDir, "codex-version");
    writeFileSync(
      fakeCodexPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"codex 9.9.9\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    const hosted = createTestApp(fixture, {
      codexCliPath: fakeCodexPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    writeFileSync(
      fakeCodexPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"codex 1.0.0\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/providers/catalog",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    const codexEntry = (response.json() as {
      items: Array<{ provider: string; version: string | null }>;
    }).items.find((item) => item.provider === "codex");
    expect(codexEntry?.version).toBe("9.9.9");
  });

  it("更新启用态时会校验 enabled 字段", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "PUT",
      url: "/api/providers/catalog/codex",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        enabled: "false"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "INVALID_INPUT",
      field: "enabled"
    });
  });

  it("显式刷新 catalog 会重新探测 provider 运行状态", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const fakeCodexPath = path.join(fixture.rootDir, "codex-version");
    const fakeClaudePath = path.join(fixture.rootDir, "claude-version");
    const fakeLegnaPath = path.join(fixture.rootDir, "legna-version");
    const fakeGeminiPath = path.join(fixture.rootDir, "gemini-version");
    const fakeKimiPath = path.join(fixture.rootDir, "kimi-version");
    const fakeOpenCodePath = path.join(fixture.rootDir, "opencode-version");
    writeFileSync(
      fakeCodexPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"codex 2.0.0\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);
    writeFileSync(fakeClaudePath, "#!/bin/sh\nexit 1\n", "utf8");
    writeFileSync(fakeLegnaPath, "#!/bin/sh\nexit 1\n", "utf8");
    writeFileSync(fakeGeminiPath, "#!/bin/sh\nexit 1\n", "utf8");
    writeFileSync(fakeKimiPath, "#!/bin/sh\nexit 1\n", "utf8");
    writeFileSync(fakeOpenCodePath, "#!/bin/sh\nexit 1\n", "utf8");
    chmodSync(fakeClaudePath, 0o755);
    chmodSync(fakeLegnaPath, 0o755);
    chmodSync(fakeGeminiPath, 0o755);
    chmodSync(fakeKimiPath, 0o755);
    chmodSync(fakeOpenCodePath, 0o755);

    const hosted = createTestApp(fixture, {
      codexCliPath: fakeCodexPath,
      claudeCodeHomeDir: path.join(fixture.rootDir, "missing-claude-home"),
      legnaCodeCliPath: fakeLegnaPath,
      geminiCliPath: fakeGeminiPath,
      kimiCliPath: fakeKimiPath,
      opencodeCliPath: fakeOpenCodePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    writeFileSync(
      fakeCodexPath,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"codex 2.1.0\"\n  exit 0\nfi\nexit 1\n",
      "utf8"
    );
    chmodSync(fakeCodexPath, 0o755);

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/providers/catalog/refresh",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    const codexEntry = (response.json() as {
      items: Array<{ provider: string; version: string | null }>;
    }).items.find((item) => item.provider === "codex");
    expect(codexEntry?.version).toBe("2.1.0");
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  return loginResponse.json().accessToken as string;
}
