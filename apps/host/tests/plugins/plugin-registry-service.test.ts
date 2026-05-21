import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hashPassword } from "../../src/shared/utils/hash.js";
import { createId } from "../../src/shared/utils/id.js";
import { PluginAuditEventRepository } from "../../src/storage/repositories/plugin-audit-event-repository.js";
import { PluginDefinitionRepository } from "../../src/storage/repositories/plugin-definition-repository.js";
import { PluginEnablementRepository } from "../../src/storage/repositories/plugin-enablement-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { PluginRegistryService } from "../../src/modules/plugins/plugin-registry-service.js";

function createTempDatabase() {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-registry-db-"));
  return createDatabaseClient(path.join(dbDir, "host.sqlite"));
}

function createPluginRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-root-"));
}

function createPlugin(rootDir: string, directoryName: string, manifest: Record<string, unknown>, files: Record<string, string>) {
  const installRoot = path.join(rootDir, directoryName);
  fs.mkdirSync(installRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(installRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  }

  fs.writeFileSync(path.join(installRoot, "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
  return installRoot;
}

describe("plugin-registry-service", () => {
  it("能扫描、注册并启用/禁用插件", () => {
    const database = createTempDatabase();
    const pluginRootDir = createPluginRoot();
    const userId = createId();
    const now = new Date().toISOString();
    database.db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?)`
    ).run(userId, "admin", hashPassword("password123"), now, now);
    createPlugin(pluginRootDir, "demo-plugin", {
      id: "demo.plugin",
      name: "演示插件",
      version: "1.0.0",
      frontend: {
        entry: "index.html"
      },
      permissions: {}
    }, {
      "index.html": "<html>demo</html>"
    });

    const service = new PluginRegistryService(
      new PluginDefinitionRepository(database.db),
      new PluginEnablementRepository(database.db),
      new PluginAuditEventRepository(database.db),
      pluginRootDir,
      {
        warn: () => undefined
      }
    );

    service.syncPluginsFromDisk();
    const listed = service.listPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.enabled).toBe(false);

    const enabled = service.enablePlugin("demo.plugin", userId);
    expect(enabled.enabled).toBe(true);
    const disabled = service.disablePlugin("demo.plugin", userId, "测试停用");
    expect(disabled.enabled).toBe(false);

    const detail = service.getPlugin("demo.plugin");
    expect(detail.definition.id).toBe("demo.plugin");
    expect(detail.auditEvents.some((item) => item.eventType === "plugin.enabled")).toBe(true);

    database.close();
  });

  it("注册失败会写审计记录", () => {
    const database = createTempDatabase();
    const pluginRootDir = createPluginRoot();
    createPlugin(pluginRootDir, "bad-plugin", {
      id: "bad.plugin",
      name: "坏插件",
      version: "1.0.0",
      frontend: {
        entry: "../escape.html"
      },
      permissions: {}
    }, {
      "index.html": "<html>bad</html>"
    });

    const auditRepository = new PluginAuditEventRepository(database.db);
    const service = new PluginRegistryService(
      new PluginDefinitionRepository(database.db),
      new PluginEnablementRepository(database.db),
      auditRepository,
      pluginRootDir,
      {
        warn: () => undefined
      }
    );

    service.syncPluginsFromDisk();
    const events = auditRepository.listByPluginId("bad.plugin", 20);
    expect(events.some((item) => item.eventType === "plugin.registration_failed")).toBe(true);

    database.close();
  });
});
