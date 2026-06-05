import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAffairsIndexerCommand } from "../../src/modules/affairs-indexer/internal-command-runner.js";

describe("affairs indexer tag filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-18T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("索引后只保留类型和时间标签，不再生成来源、主题、状态标签", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-tag-filter-"));
    const documentDir = path.join(rootDir, "客户资料");
    const documentPath = path.join(documentDir, "Exchange 分层通讯簿.txt");
    fs.mkdirSync(documentDir, { recursive: true });
    fs.writeFileSync(documentPath, "Exchange 邮件系统 说明文档\n", "utf8");
    const modifiedAt = new Date("2026-05-16T08:00:00.000Z");
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
      expect(tagPaths).toContain("时间/最近3天");
      expect(tagPaths).toContain("时间/最近7天");
      expect(tagPaths).toContain("时间/最近30天");
      expect(tagPaths.some((item) => item.startsWith("来源/"))).toBe(false);
      expect(tagPaths.some((item) => item.startsWith("主题/"))).toBe(false);
      expect(tagPaths.some((item) => item.startsWith("状态/"))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("最近3天和最近7天只会命中对应窗口内的文档", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-tag-window-"));
    const recent3Path = path.join(rootDir, "recent-3.txt");
    const recent7Path = path.join(rootDir, "recent-7.txt");
    const recent30Path = path.join(rootDir, "recent-30.txt");
    fs.writeFileSync(recent3Path, "recent-3\n", "utf8");
    fs.writeFileSync(recent7Path, "recent-7\n", "utf8");
    fs.writeFileSync(recent30Path, "recent-30\n", "utf8");
    fs.utimesSync(recent3Path, new Date("2026-05-16T08:00:00.000Z"), new Date("2026-05-16T08:00:00.000Z"));
    fs.utimesSync(recent7Path, new Date("2026-05-12T08:00:00.000Z"), new Date("2026-05-12T08:00:00.000Z"));
    fs.utimesSync(recent30Path, new Date("2026-04-25T08:00:00.000Z"), new Date("2026-04-25T08:00:00.000Z"));

    try {
      await runAffairsIndexerCommand(rootDir, "index");

      const exportDir = path.join(rootDir, ".ai-index", "exports");
      const manifest = JSON.parse(fs.readFileSync(path.join(exportDir, "manifest.json"), "utf8")) as {
        meta_shards?: Array<{ path?: string }>;
      };
      const documents = (manifest.meta_shards ?? []).flatMap((item) => {
        const shardPath = item.path?.trim();
        if (!shardPath) {
          return [];
        }
        const payload = JSON.parse(fs.readFileSync(path.join(exportDir, shardPath), "utf8")) as {
          documents?: Array<{ path?: string; derived_tags?: string[] }>;
        };
        return payload.documents ?? [];
      });
      const byPath = new Map(documents.map((item) => [item.path ?? "", item.derived_tags ?? []]));

      expect(byPath.get("recent-3.txt")).toEqual(expect.arrayContaining(["时间/最近3天", "时间/最近7天", "时间/最近30天"]));
      expect(byPath.get("recent-7.txt")).toEqual(expect.arrayContaining(["时间/最近7天", "时间/最近30天"]));
      expect(byPath.get("recent-7.txt")).not.toContain("时间/最近3天");
      expect(byPath.get("recent-30.txt")).toEqual(expect.arrayContaining(["时间/最近30天"]));
      expect(byPath.get("recent-30.txt")).not.toContain("时间/最近7天");
      expect(byPath.get("recent-30.txt")).not.toContain("时间/最近3天");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
