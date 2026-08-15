import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";

const DEFAULT_QUIET_WINDOW_MS = 120;
const DEFAULT_FALLBACK_INTERVAL_MS = 15_000;

type SourceWatcher = Pick<FSWatcher, "close">;

export interface SessionHistorySourceCoordinatorOptions {
  onRefreshRequested(sourceKey: string): void;
  quietWindowMs?: number;
  fallbackIntervalMs?: number;
  watchFile?: (filePath: string, onEvent: (eventType: string) => void) => SourceWatcher;
  readVersion?: (filePath: string) => string | null | Promise<string | null>;
}

interface SourceState {
  sourceKey: string;
  rawStoreRef: string;
  subscriberCount: number;
  watcher: SourceWatcher | null;
  quietTimer: NodeJS.Timeout | null;
  fallbackTimer: NodeJS.Timeout | null;
  lastObservedVersion: string | null;
  dirty: boolean;
  fallbackCheckInFlight: boolean;
}

/**
 * 这里只管理“来源可能变了”的信号和生命周期。
 * 它不持有重读 Promise，也不解析文件；重任务由调用方统一交给 TaskManager。
 */
export class SessionHistorySourceCoordinator {
  private readonly sources = new Map<string, SourceState>();
  private readonly quietWindowMs: number;
  private readonly fallbackIntervalMs: number;
  private readonly watchFile: NonNullable<SessionHistorySourceCoordinatorOptions["watchFile"]>;
  private readonly readVersion: NonNullable<SessionHistorySourceCoordinatorOptions["readVersion"]>;

  constructor(private readonly options: SessionHistorySourceCoordinatorOptions) {
    this.quietWindowMs = Math.max(0, options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS);
    this.fallbackIntervalMs = Math.max(1_000, options.fallbackIntervalMs ?? DEFAULT_FALLBACK_INTERVAL_MS);
    this.watchFile = options.watchFile ?? watchSessionHistoryFile;
    this.readVersion = options.readVersion ?? readSessionHistoryFileVersion;
  }

  subscribe(input: { sourceKey: string; rawStoreRef: string }): { close(): void } {
    const sourceKey = input.sourceKey.trim();
    const rawStoreRef = input.rawStoreRef.trim();

    if (!sourceKey || !rawStoreRef) {
      return { close() {} };
    }

    const source = this.getOrCreateSource(sourceKey, rawStoreRef);
    source.subscriberCount += 1;
    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        source.subscriberCount = Math.max(0, source.subscriberCount - 1);

        if (source.subscriberCount === 0) {
          this.disposeSource(source);
        }
      }
    };
  }

  markDirty(sourceKey: string): void {
    const source = this.sources.get(sourceKey);

    if (!source || source.subscriberCount === 0) {
      return;
    }

    source.dirty = true;

    if (source.quietTimer) {
      clearTimeout(source.quietTimer);
    }

    source.quietTimer = setTimeout(() => {
      source.quietTimer = null;

      if (source.subscriberCount > 0) {
        this.options.onRefreshRequested(source.sourceKey);
      }
    }, this.quietWindowMs);
  }

  markClean(sourceKey: string): void {
    const source = this.sources.get(sourceKey);

    if (source) {
      source.dirty = false;
    }
  }

  dispose(): void {
    for (const source of this.sources.values()) {
      this.disposeSource(source);
    }
  }

  getSourceCount(): number {
    return this.sources.size;
  }

  private getOrCreateSource(sourceKey: string, rawStoreRef: string): SourceState {
    const existing = this.sources.get(sourceKey);

    if (existing) {
      return existing;
    }

    const source: SourceState = {
      sourceKey,
      rawStoreRef,
      subscriberCount: 0,
      watcher: null,
      quietTimer: null,
      fallbackTimer: null,
      lastObservedVersion: null,
      dirty: false,
      fallbackCheckInFlight: false
    };
    this.sources.set(sourceKey, source);
    this.startWatching(source);
    source.fallbackTimer = setInterval(() => {
      void this.checkFallbackVersion(source);
    }, this.fallbackIntervalMs);
    void this.initializeObservedVersion(source);
    return source;
  }

  private async initializeObservedVersion(source: SourceState): Promise<void> {
    try {
      const version = await this.readVersion(source.rawStoreRef);

      if (source.subscriberCount > 0 && this.sources.get(source.sourceKey) === source) {
        source.lastObservedVersion = version;
      }
    } catch {
      // 版本初始化失败时保留 null，后续兜底检查会再次尝试。
    }
  }

  private startWatching(source: SourceState): void {
    if (source.watcher) {
      return;
    }

    try {
      source.watcher = this.watchFile(source.rawStoreRef, (eventType) => {
        this.markDirty(source.sourceKey);

        if (eventType === "rename") {
          source.watcher?.close();
          source.watcher = null;
        }
      });
    } catch {
      // 文件可能刚好被 rotate 或替换；低频版本检查会在文件重新出现后补上。
      source.watcher = null;
    }
  }

  private async checkFallbackVersion(source: SourceState): Promise<void> {
    if (source.subscriberCount === 0 || source.fallbackCheckInFlight) {
      return;
    }

    source.fallbackCheckInFlight = true;

    try {
      const nextVersion = await this.readVersion(source.rawStoreRef);

      if (source.subscriberCount === 0 || this.sources.get(source.sourceKey) !== source) {
        return;
      }

      const versionChanged = nextVersion !== source.lastObservedVersion;

      if (versionChanged) {
        source.lastObservedVersion = nextVersion;
      }

      if (versionChanged || source.dirty) {
        this.markDirty(source.sourceKey);
      }

      this.startWatching(source);
    } catch {
      // 单次 metadata 检查失败不影响现有订阅；下一轮兜底会再次尝试。
    } finally {
      source.fallbackCheckInFlight = false;
    }
  }

  private disposeSource(source: SourceState): void {
    if (source.quietTimer) {
      clearTimeout(source.quietTimer);
      source.quietTimer = null;
    }

    if (source.fallbackTimer) {
      clearInterval(source.fallbackTimer);
      source.fallbackTimer = null;
    }

    source.watcher?.close();
    source.watcher = null;
    this.sources.delete(source.sourceKey);
  }
}

function watchSessionHistoryFile(
  filePath: string,
  onEvent: (eventType: string) => void
): SourceWatcher {
  return watch(filePath, { persistent: false }, (eventType) => {
    onEvent(eventType);
  });
}

async function readSessionHistoryFileVersion(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath);
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}
