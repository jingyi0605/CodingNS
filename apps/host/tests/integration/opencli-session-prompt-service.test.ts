import { describe, expect, it } from "vitest";

import { OpenCliSessionPromptService } from "../../src/modules/opencli/opencli-session-prompt-service.js";
import { OpenCliCatalogEntryRepository } from "../../src/storage/repositories/opencli-catalog-entry-repository.js";
import { OpenCliProviderRepository } from "../../src/storage/repositories/opencli-provider-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("OpenCliSessionPromptService", () => {
  it("只在当前会话真的注入 OpenCLI runtime 时生成提示，并且只列出启用命令", () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const service = new OpenCliSessionPromptService(providerRepository, catalogRepository);

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "bridge_missing",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T11:00:00.000Z",
      activeRuntimeId: "opencli-runtime-1",
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T11:00:00.000Z",
      catalogSource: "manifest"
    });
    catalogRepository.replaceAll("opencli", [
      {
        providerId: "opencli",
        commandId: "hackernews/top",
        site: "hackernews",
        name: "top",
        description: "热门",
        strategy: "public",
        browser: false,
        modulePath: "clis/hackernews/top.js",
        sourceFile: "clis/hackernews/top.js",
        enabled: true,
        sortOrder: 1
      },
      {
        providerId: "opencli",
        commandId: "twitter/trending",
        site: "twitter",
        name: "trending",
        description: "趋势",
        strategy: "cookie",
        browser: true,
        modulePath: "clis/twitter/trending.js",
        sourceFile: "clis/twitter/trending.js",
        enabled: true,
        sortOrder: 2
      },
      {
        providerId: "opencli",
        commandId: "reddit/hot",
        site: "reddit",
        name: "hot",
        description: "热帖",
        strategy: "public",
        browser: false,
        modulePath: "clis/reddit/hot.js",
        sourceFile: "clis/reddit/hot.js",
        enabled: false,
        sortOrder: 3
      }
    ]);

    const prompt = service.buildPrompt({
      provider: "codex",
      runtimeEnv: {
        CODINGNS_OPENCLI_RUNTIME_ROOT: "/tmp/codingns/opencli-runtime-1"
      }
    });

    expect(prompt).toContain("裁剪版 OpenCLI 运行时");
    expect(prompt).toContain("hackernews（1 个，可直接运行）");
    expect(prompt).toContain("twitter（1 个，其中 1 个依赖浏览器）");
    expect(prompt).toContain("hackernews/top、twitter/trending");
    expect(prompt).not.toContain("reddit/hot");

    database.close();
  });

  it("没有启用命令时会明确告知当前会话不要调用 opencli", () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const service = new OpenCliSessionPromptService(providerRepository, catalogRepository);

    providerRepository.upsert({
      providerId: "opencli",
      enabled: true,
      installState: "installed",
      healthState: "binary_ready",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T11:00:00.000Z",
      activeRuntimeId: "opencli-runtime-1",
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T11:00:00.000Z",
      catalogSource: "manifest"
    });

    const prompt = service.buildPrompt({
      provider: "claude-code",
      runtimeEnv: {
        CODINGNS_OPENCLI_RUNTIME_ROOT: "/tmp/codingns/opencli-runtime-1"
      }
    });

    expect(prompt).toContain("当前没有启用任何 CLI技能");
    expect(prompt).toContain("不要调用 `opencli`");

    database.close();
  });
});
