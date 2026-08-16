import {
  DEFAULT_PROVIDER_PRICE_BOOK,
  type ProviderPriceBook,
  type ProviderPriceBookEntry
} from "@codingns/session-sync-core";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import { type TaskManager } from "../tasks/task-manager.js";
import type { TaskHandle } from "../tasks/task-types.js";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_RETENTION_COUNT = 104;
const SOURCE_PROVIDER_BY_INTERNAL_PROVIDER: Readonly<Record<string, string>> = {
  codex: "openai",
  "claude-code": "anthropic",
  "legna-code": "anthropic",
  gemini: "google",
  "deepseek-harness": "deepseek"
};

interface ModelsDevModel {
  id?: unknown;
  cost?: {
    input?: unknown;
    output?: unknown;
    cache_read?: unknown;
    cache_write?: unknown;
  };
}

interface StoredPriceBookSnapshot {
  version: string;
  source: "models.dev";
  fetchedAt: string;
  entries: ProviderPriceBookEntry[];
}

export interface ProviderPriceBookServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * 管理价格表的本地快照。会话统计只读内存/本地快照，不在请求中访问网络。
 * models.dev 只作为受控同步输入，无法访问时继续使用最近快照或内置价格表。
 */
export class ProviderPriceBookService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly taskManager: TaskManager | null;
  private current: ProviderPriceBook | null = null;

  constructor(
    private readonly snapshotDir: string,
    taskManager: TaskManager | null = null,
    options: ProviderPriceBookServiceOptions = {}
  ) {
    this.taskManager = taskManager;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());

    if (taskManager && !taskManager.has(HOST_TASK_TYPES.providerPriceBookRefresh)) {
      taskManager.register<
        { force?: boolean },
        ProviderPriceBook
      >({
        taskType: HOST_TASK_TYPES.providerPriceBookRefresh,
        executionLane: "host_background",
        timeoutMs: 30_000,
        run: ({ force }, context) => this.refresh({ force, signal: context.signal })
      });
    }
  }

  getCurrentPriceBook(): ProviderPriceBook {
    if (this.current) {
      return this.current;
    }

    this.current = this.readLatestSnapshot() ?? DEFAULT_PROVIDER_PRICE_BOOK;
    return this.current;
  }

  getPriceBook(version: string): ProviderPriceBook | null {
    const normalizedVersion = version.trim();

    if (!normalizedVersion) {
      return null;
    }

    const current = this.getCurrentPriceBook();

    if (current.version === normalizedVersion) {
      return current;
    }

    if (normalizedVersion === DEFAULT_PROVIDER_PRICE_BOOK.version) {
      return DEFAULT_PROVIDER_PRICE_BOOK;
    }

    const filePath = this.getSnapshotPath(normalizedVersion);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      return parseStoredSnapshot(parsed);
    } catch {
      return null;
    }
  }

  requestRefreshIfStale(
    source = "provider_price_book.startup"
  ): TaskHandle<ProviderPriceBook> | null {
    if (process.env.VITEST || !this.taskManager || !this.isStale()) {
      return null;
    }

    const handle = this.taskManager.enqueue<{ force?: boolean }, ProviderPriceBook>(
      HOST_TASK_TYPES.providerPriceBookRefresh,
      {
        key: "global",
        input: { force: false },
        source
      }
    );
    void handle.promise.catch(() => undefined);
    return handle;
  }

  async refresh(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ProviderPriceBook> {
    if (!options.force && !this.isStale()) {
      return this.getCurrentPriceBook();
    }

    const weeklyVersion = buildWeeklyVersion(this.now());
    const current = this.getCurrentPriceBook();

    // 同一周只保留第一份快照，避免已经绑定该版本的历史会话金额漂移。
    if (current.source === "models.dev" && current.version === weeklyVersion) {
      return current;
    }

    const response = await this.fetchImpl(MODELS_DEV_API_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: options.signal
    });

    if (!response.ok) {
      throw new Error(`价格表同步失败: HTTP ${response.status}`);
    }

    const payload = await response.json() as unknown;
    const fetchedAt = this.now().toISOString();
    const entries = buildEntriesFromModelsDev(payload, DEFAULT_PROVIDER_PRICE_BOOK.entries);

    if (entries.length === 0) {
      throw new Error("价格表同步失败: 没有匹配到受支持模型");
    }

    const snapshot: StoredPriceBookSnapshot = {
      version: weeklyVersion,
      source: "models.dev",
      fetchedAt,
      entries
    };
    const priceBook: ProviderPriceBook = snapshot;

    await this.persistSnapshot(snapshot);
    this.current = priceBook;
    return priceBook;
  }

  isStale(): boolean {
    const current = this.getCurrentPriceBook();

    if (current.source !== "models.dev" || !current.fetchedAt) {
      return true;
    }

    if (current.version === buildWeeklyVersion(this.now())) {
      return false;
    }

    const fetchedAt = Date.parse(current.fetchedAt);
    return !Number.isFinite(fetchedAt) || this.now().getTime() - fetchedAt >= REFRESH_INTERVAL_MS;
  }

  private readLatestSnapshot(): ProviderPriceBook | null {
    if (!existsSync(this.snapshotDir)) {
      return null;
    }

    try {
      const names = readdirSyncSafe(this.snapshotDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .reverse();

      for (const name of names) {
        try {
          const parsed = JSON.parse(readFileSync(path.join(this.snapshotDir, name), "utf8")) as unknown;
          const snapshot = parseStoredSnapshot(parsed);

          if (snapshot) {
            return snapshot;
          }
        } catch {
          // 单个损坏快照不应阻断其他版本的读取。
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async persistSnapshot(snapshot: StoredPriceBookSnapshot): Promise<void> {
    await mkdir(this.snapshotDir, { recursive: true });
    const targetPath = this.getSnapshotPath(snapshot.version);
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, targetPath);

    const names = (await readdir(this.snapshotDir))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();

    for (const name of names.slice(SNAPSHOT_RETENTION_COUNT)) {
      await unlink(path.join(this.snapshotDir, name)).catch(() => undefined);
    }
  }

  private getSnapshotPath(version: string): string {
    return path.join(this.snapshotDir, `${version.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  }
}

function buildEntriesFromModelsDev(
  payload: unknown,
  baselineEntries: readonly ProviderPriceBookEntry[]
): ProviderPriceBookEntry[] {
  const payloadRecord = asRecord(payload);

  if (!payloadRecord) {
    return [];
  }

  const entries: ProviderPriceBookEntry[] = [];

  for (const baseline of baselineEntries) {
    const sourceProvider = SOURCE_PROVIDER_BY_INTERNAL_PROVIDER[baseline.provider];
    const provider = sourceProvider ? asRecord(payloadRecord[sourceProvider]) : null;
    const models = provider ? asRecord(provider.models) : null;
    const model = models ? findModel(models, baseline.model) : null;
    const cost = model ? asRecord(model.cost) : null;
    const input = readFiniteNumber(cost?.input);
    const output = readFiniteNumber(cost?.output);

    if (input === null || output === null) {
      continue;
    }

    const cacheRead = readFiniteNumber(cost?.cache_read);
    const cacheWrite = readFiniteNumber(cost?.cache_write);
    entries.push({
      provider: baseline.provider,
      model: baseline.model,
      inputUsdPerToken: input / 1_000_000,
      outputUsdPerToken: output / 1_000_000,
      ...(cacheRead === null ? {} : { cacheReadUsdPerToken: cacheRead / 1_000_000 }),
      ...(cacheWrite === null ? {} : { cacheWriteUsdPerToken: cacheWrite / 1_000_000 })
    });
  }

  return entries;
}

function findModel(models: Record<string, unknown>, modelId: string): ModelsDevModel | null {
  const exact = asRecord(models[modelId]);

  if (exact) {
    return exact as ModelsDevModel;
  }

  const match = Object.entries(models).find(([key, value]) => {
    const record = asRecord(value);
    return key === modelId || record?.id === modelId;
  });
  return match ? (asRecord(match[1]) as ModelsDevModel | null) : null;
}

function parseStoredSnapshot(value: unknown): ProviderPriceBook | null {
  const record = asRecord(value);

  if (!record || record.source !== "models.dev" || typeof record.version !== "string" || typeof record.fetchedAt !== "string") {
    return null;
  }

  if (!Array.isArray(record.entries)) {
    return null;
  }

  const entries = record.entries.filter(isPriceBookEntry);
  return entries.length > 0
    ? {
        version: record.version,
        source: "models.dev",
        fetchedAt: record.fetchedAt,
        entries
      }
    : null;
}

function isPriceBookEntry(value: unknown): value is ProviderPriceBookEntry {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.provider === "string"
    && typeof record.model === "string"
    && readFiniteNumber(record.inputUsdPerToken) !== null
    && readFiniteNumber(record.outputUsdPerToken) !== null
  );
}

function buildWeeklyVersion(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `models.dev-${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readdirSyncSafe(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
