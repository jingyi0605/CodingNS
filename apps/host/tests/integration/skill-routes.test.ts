import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeSkillDirectoryHash } from "../../src/modules/skills/skill-manager-service.js";
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
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("skills routes", () => {
  it("overview、import 和 sync 接口会走真实 SkillManager 链路", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const codexSkillsRoot = path.join(fixture.codexHomeDir, "skills");
    const geminiSkillsRoot = path.join(fixture.geminiHomeDir, "skills");
    const ssotRootDir = path.join(fixture.rootDir, "skills");
    activeFixtures.push(fixture);

    mkdirSync(codexSkillsRoot, { recursive: true });
    mkdirSync(geminiSkillsRoot, { recursive: true });

    const legacySkillPath = createSkillDirectory(codexSkillsRoot, "legacy-route-skill", {
      "SKILL.md": "# Legacy Route Skill\n\n这是导入前的旧 skill。"
    });

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const overviewResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/skills/overview",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json()).toMatchObject({
      summary: {
        managedSkillCount: 0,
        unmanagedEntryCount: 1
      },
      unmanagedEntries: [
        {
          targetCli: "codex",
          directoryName: "legacy-route-skill",
          managementState: "unmanaged"
        }
      ]
    });

    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/skills/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        targetCli: "codex",
        directoryPath: legacySkillPath,
        expectedContentHash: computeSkillDirectoryHash(legacySkillPath)
      }
    });

    expect(importResponse.statusCode).toBe(200);
    const imported = importResponse.json();
    expect(imported.skill.directoryName).toBe("legacy-route-skill");
    expect(existsSync(path.join(ssotRootDir, "legacy-route-skill", "SKILL.md"))).toBe(true);

    const syncResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/skills/sync",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        skillId: imported.skill.id,
        targetCli: ["gemini"]
      }
    });

    expect(syncResponse.statusCode).toBe(200);
    expect(syncResponse.json()).toMatchObject({
      targetResults: [
        {
          targetCli: "gemini",
          syncStatus: "synced"
        }
      ]
    });
    expect(readFileSync(path.join(geminiSkillsRoot, "legacy-route-skill", "SKILL.md"), "utf8")).toContain(
      "Legacy Route Skill"
    );
  });

  it("add 接口要求登录，并且只会写入指定目标", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const localSkillRoot = path.join(fixture.rootDir, "local-skills");
    const codexSkillsRoot = path.join(fixture.codexHomeDir, "skills");
    const geminiSkillsRoot = path.join(fixture.geminiHomeDir, "skills");
    activeFixtures.push(fixture);

    mkdirSync(localSkillRoot, { recursive: true });
    mkdirSync(codexSkillsRoot, { recursive: true });
    mkdirSync(geminiSkillsRoot, { recursive: true });

    const sourcePath = createSkillDirectory(localSkillRoot, "api-added-skill", {
      "SKILL.md": "# Api Added Skill\n\n通过 API 添加的新 skill。"
    });
    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const unauthorized = await hosted.app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        sourcePath,
        targetCli: ["codex"],
        sourceType: "local-import"
      }
    });

    expect(unauthorized.statusCode).toBe(401);

    const accessToken = await login(hosted);
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/skills",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourcePath,
        targetCli: ["codex"],
        sourceType: "local-import"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      skill: {
        scope: "workspace",
        directoryName: "api-added-skill",
        sourceType: "local-import"
      },
      targetResults: [
        {
          targetCli: "codex",
          syncStatus: "synced"
        }
      ]
    });
    expect(existsSync(path.join(codexSkillsRoot, "api-added-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(geminiSkillsRoot, "api-added-skill"))).toBe(false);
  });

  it("add 接口支持直接上传 markdown 内容并纳管", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const codexSkillsRoot = path.join(fixture.codexHomeDir, "skills");
    const ssotRootDir = path.join(fixture.rootDir, "skills");
    activeFixtures.push(fixture);

    mkdirSync(codexSkillsRoot, { recursive: true });

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/skills",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        markdownContent: "这是通过 API 上传的 skill 内容。",
        scope: "workspace",
        fileName: "markdown-uploaded-skill.md",
        targetCli: ["codex"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      skill: {
        scope: "workspace",
        directoryName: "markdown-uploaded-skill",
        sourceType: "local-import",
        sourcePath: null
      },
      targetResults: [
        {
          targetCli: "codex",
          syncStatus: "synced"
        }
      ]
    });
    expect(readFileSync(path.join(ssotRootDir, "markdown-uploaded-skill", "SKILL.md"), "utf8")).toContain(
      "# Markdown Uploaded Skill"
    );
    expect(readFileSync(path.join(codexSkillsRoot, "markdown-uploaded-skill", "SKILL.md"), "utf8")).toContain(
      "# Markdown Uploaded Skill"
    );
  });

  it("add 接口支持把 markdown 上传为助手专用 skill", async () => {
    const fixture = createEmptyFixture();
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const assistantSsotRoot = path.join(fixture.rootDir, "skills", ".assistant-runtime");
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      databasePath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/skills",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        markdownContent: "# Butler Inbox Helper\n\n给助手运行时用。",
        scope: "assistant",
        fileName: "butler-inbox-helper.md",
        targetCli: ["codex", "claude-code"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      skill: {
        scope: "assistant",
        directoryName: "butler-inbox-helper",
        sourceType: "local-import",
        sourcePath: null
      },
      targetResults: [
        {
          targetCli: "codex",
          syncStatus: "synced"
        },
        {
          targetCli: "claude-code",
          syncStatus: "synced"
        }
      ]
    });
    expect(
      readFileSync(path.join(assistantSsotRoot, "butler-inbox-helper", "SKILL.md"), "utf8")
    ).toContain("# Butler Inbox Helper");
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return loginResponse.json().accessToken as string;
}

async function login(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return loginResponse.json().accessToken as string;
}

function createSkillDirectory(
  rootDir: string,
  directoryName: string,
  files: Record<string, string>
): string {
  const directoryPath = path.join(rootDir, directoryName);

  mkdirSync(directoryPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(directoryPath, relativePath);

    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }

  return directoryPath;
}
