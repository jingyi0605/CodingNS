import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAffairsIndexerCommand } from "../../src/modules/affairs-indexer/internal-command-runner.js";

describe("affairs indexer tag filtering", () => {
  it("索引后只保留类型和时间标签，不再生成来源、主题、状态标签", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-tag-filter-"));
    const documentDir = path.join(rootDir, "客户资料");
    const documentPath = path.join(documentDir, "Exchange 分层通讯簿.txt");
    fs.mkdirSync(documentDir, { recursive: true });
    fs.writeFileSync(documentPath, "Exchange 邮件系统 说明文档\n", "utf8");
    const modifiedAt = new Date("2026-05-15T08:00:00.000Z");
    fs.utimesSync(documentPath, modifiedAt, modifiedAt);

    try {
      await runAffairsIndexerCommand(rootDir, "index");

      const taxonomyPath = path.join(rootDir, ".ai-index", "exports", "taxonomy.json");
      const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf8")) as {
        root_types?: string[];
        nodes?: Array<{ path?: string; root_type?: string }>;
      };
      const tagPaths = (taxonomy.nodes ?? []).map((node) => node.path ?? "");

      expect(taxonomy.root_types ?? []).toEqual(["类型", "时间"]);
      expect(tagPaths).toContain("类型/文本/纯文本");
      expect(tagPaths).toContain("时间/2026/05");
      expect(tagPaths).toContain("时间/最近30天");
      expect(tagPaths.some((item) => item.startsWith("来源/"))).toBe(false);
      expect(tagPaths.some((item) => item.startsWith("主题/"))).toBe(false);
      expect(tagPaths.some((item) => item.startsWith("状态/"))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
