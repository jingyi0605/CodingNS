import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCliBridgeSkillService } from "../../src/modules/opencli/opencli-bridge-skill-service.js";
import { OpenCliCatalogEntryRepository } from "../../src/storage/repositories/opencli-catalog-entry-repository.js";
import { OpenCliProviderRepository } from "../../src/storage/repositories/opencli-provider-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();

    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("OpenCliBridgeSkillService", () => {
  it("会为 Codex 和 Legna runtime 识别 OpenCLI 桥接 Skill 支持", () => {
    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const service = new OpenCliBridgeSkillService(providerRepository, catalogRepository);

    expect(service.supportsProvider("codex")).toBe(true);
    expect(service.supportsProvider("claude-code")).toBe(true);
    expect(service.supportsProvider("legna-code")).toBe(true);
    expect(service.supportsProvider("gemini")).toBe(false);

    database.close();
  });

  it("会为 Codex runtime 生成 OpenCLI 桥接 Skill", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-opencli-bridge-skill-"));
    tempDirs.push(tempDir);

    const database = createDatabaseClient(":memory:");
    const providerRepository = new OpenCliProviderRepository(database.db);
    const catalogRepository = new OpenCliCatalogEntryRepository(database.db);
    const service = new OpenCliBridgeSkillService(providerRepository, catalogRepository);

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
      }
    ]);

    service.syncRuntimeSkill("codex", tempDir);

    const skillMarkdown = readFileSync(
      path.join(tempDir, "skills", "codingns-opencli", "SKILL.md"),
      "utf8"
    );
    const agentPrompt = readFileSync(
      path.join(tempDir, "skills", "codingns-opencli", "agents", "openai.yaml"),
      "utf8"
    );

    expect(skillMarkdown).toContain("codingns-opencli");
    expect(skillMarkdown).toContain("opencli list -f json");
    expect(skillMarkdown).toContain("hackernews/top");
    expect(skillMarkdown).toContain("twitter/trending");
    expect(skillMarkdown).toContain("依赖浏览器");
    expect(agentPrompt).toContain("$codingns-opencli");

    service.removeRuntimeSkill("codex", tempDir);
    expect(() =>
      readFileSync(path.join(tempDir, "skills", "codingns-opencli", "SKILL.md"), "utf8")
    ).toThrow();

    database.close();
  });
});
