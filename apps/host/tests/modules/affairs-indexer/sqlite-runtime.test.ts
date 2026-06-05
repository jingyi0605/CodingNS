import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectCatalogSchema } from "../../../src/modules/affairs-indexer/core/src/sqlite/detect-catalog-schema.js";
import { openDatabase } from "../../../src/modules/affairs-indexer/core/src/sqlite/open-database.js";

describe("affairs-indexer SQLite runtime", () => {
  it("使用 better-sqlite3 完成基础读写，不触发 node:sqlite 实验特性警告", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-indexer-sqlite-runtime-"));
    const dbPath = path.join(rootDir, "catalog.db");
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => {
      warnings.push(warning);
    };

    process.on("warning", onWarning);
    try {
      const db = openDatabase(dbPath);
      try {
        db.exec("CREATE TABLE test_items(id TEXT PRIMARY KEY, name TEXT NOT NULL)");
        db.prepare("INSERT INTO test_items(id, name) VALUES(?, ?)").run("1", "测试");
        const row = db.prepare("SELECT name FROM test_items WHERE id = ?").get("1") as { name?: string } | undefined;

        expect(row).toEqual({ name: "测试" });
      } finally {
        db.close();
      }

      expect(warnings.some(warning => String(warning.message).includes("SQLite is an experimental feature"))).toBe(false);
    } finally {
      process.off("warning", onWarning);
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("检测不存在、空库和 node_v3 schema", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-indexer-schema-detect-"));
    const dbPath = path.join(rootDir, "catalog.db");

    try {
      await expect(detectCatalogSchema(dbPath)).resolves.toMatchObject({
        mode: "absent",
        tableCount: 0,
      });

      const emptyDb = openDatabase(dbPath);
      emptyDb.close();
      await expect(detectCatalogSchema(dbPath)).resolves.toMatchObject({
        mode: "empty",
        tableCount: 0,
      });

      const db = openDatabase(dbPath);
      try {
        db.exec(`
          CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          INSERT INTO schema_meta(key, value) VALUES('schema_version', '3');
          INSERT INTO schema_meta(key, value) VALUES('managed_by', 'node');
        `);
      } finally {
        db.close();
      }

      await expect(detectCatalogSchema(dbPath)).resolves.toMatchObject({
        mode: "node_v3",
        schemaVersion: 3,
        managedBy: "node",
      });
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
