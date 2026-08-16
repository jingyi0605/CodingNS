import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PROVIDER_PRICE_BOOK_VERSION } from "@codingns/session-sync-core";

import { ProviderPriceBookService } from "../../src/modules/provider/provider-price-book-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";

describe("ProviderPriceBookService", () => {
  it("从 models.dev 读取匹配模型并保存每周快照", async () => {
    const root = await mkdtemp(join(tmpdir(), "codingns-price-book-"));
    const now = new Date("2026-08-16T00:00:00.000Z");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      openai: {
        models: {
          "gpt-5.3-codex": {
            id: "gpt-5.3-codex",
            cost: { input: 2, output: 16, cache_read: 0.2 }
          }
        }
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    try {
      const service = new ProviderPriceBookService(join(root, "snapshots"), null, {
        fetchImpl,
        now: () => now
      });

      const snapshot = await service.refresh({ force: true });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(snapshot.source).toBe("models.dev");
      expect(snapshot.version).toMatch(/^models\.dev-2026-W\d{2}$/);
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0]).toMatchObject({
        provider: "codex",
        model: "gpt-5.3-codex",
        inputUsdPerToken: 2e-6,
        outputUsdPerToken: 16e-6,
      });
      expect(snapshot.entries[0]?.cacheReadUsdPerToken).toBeCloseTo(0.2e-6, 15);
      expect(service.getPriceBook(snapshot.version)).toMatchObject({
        version: snapshot.version,
        source: "models.dev",
        fetchedAt: now.toISOString()
      });
      expect(await readFile(join(root, "snapshots", `${snapshot.version}.json`), "utf8")).toContain(
        '"source": "models.dev"'
      );
      expect(service.isStale()).toBe(false);
      expect(service.getPriceBook(DEFAULT_PROVIDER_PRICE_BOOK_VERSION)).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("注册统一后台任务类型，网络失败不会删除旧快照", async () => {
    const root = await mkdtemp(join(tmpdir(), "codingns-price-book-task-"));
    const taskManager = createTaskManager();
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 503 }));

    try {
      const service = new ProviderPriceBookService(join(root, "snapshots"), taskManager, { fetchImpl });

      expect(taskManager.listDefinitions().some((definition) =>
        definition.taskType === HOST_TASK_TYPES.providerPriceBookRefresh
      )).toBe(true);
      await expect(service.refresh({ force: true })).rejects.toThrow("HTTP 503");
      expect(service.getCurrentPriceBook().version).toBe(DEFAULT_PROVIDER_PRICE_BOOK_VERSION);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
