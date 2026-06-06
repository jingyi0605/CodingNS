import fs from "node:fs";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileAccessGuard } from "./file-access-guard.js";

const WATCH_FLUSH_DEBOUNCE_MS = 250;
const MAX_EVENTS_PER_POLL = 200;

interface WorkspaceBridgeWatchLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
}

export interface WorkspaceFileBridgeWatchDirOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  kind?: "file" | "directory" | "any";
}

export interface WorkspaceFileBridgeWatchEvent {
  seq: number;
  type: "created" | "changed" | "deleted";
  path: string;
  kind: "file" | "directory" | "unknown";
  mtime: number | null;
}

interface WatchSubscription {
  watchId: string;
  watcherKey: string;
  workspaceId: string;
  basePath: string;
  cursor: number;
  events: WorkspaceFileBridgeWatchEvent[];
}

interface SharedWatcherEntry {
  watcherKey: string;
  watcher: FSWatcher;
  readyPromise: Promise<void>;
  workspaceId: string;
  basePath: string;
  absolutePath: string;
  recursive: boolean;
  includeHidden: boolean;
  kind: "file" | "directory" | "any";
  subscriptions: Set<string>;
  pendingEvents: Map<string, WorkspaceFileBridgeWatchEvent | null>;
  flushTimer: NodeJS.Timeout | null;
}

export class WorkspaceFileBridgeWatchService {
  private readonly subscriptions = new Map<string, WatchSubscription>();
  private readonly sharedWatchers = new Map<string, SharedWatcherEntry>();
  private watchSeq = 0;

  constructor(
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly logger: WorkspaceBridgeWatchLogger
  ) {}

  async watchDir(
    workspaceId: string,
    requestedPath: string | undefined,
    options: WorkspaceFileBridgeWatchDirOptions = {}
  ): Promise<{ watchId: string }> {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      allowRoot: true,
      mustExist: true,
      kind: "directory"
    });
    const normalizedOptions = normalizeWatchOptions(options);
    const watcherKey = buildWatcherKey(workspaceId, resolved.relativePath, normalizedOptions);
    let shared = this.sharedWatchers.get(watcherKey);

    if (!shared) {
      shared = this.createSharedWatcher(
        watcherKey,
        workspaceId,
        resolved.relativePath,
        resolved.absolutePath,
        normalizedOptions
      );
      this.sharedWatchers.set(watcherKey, shared);
    }

    await shared.readyPromise;

    const watchId = createWatchId(++this.watchSeq);
    shared.subscriptions.add(watchId);
    this.subscriptions.set(watchId, {
      watchId,
      watcherKey,
      workspaceId,
      basePath: resolved.relativePath,
      cursor: 0,
      events: []
    });

    this.logger.info(
      {
        workspaceId,
        path: resolved.relativePath,
        watchId,
        recursive: normalizedOptions.recursive
      },
      "静态 HTML 预览开始监听工作区目录"
    );

    return { watchId };
  }

  async watchResolvedDir(input: {
    scopeId: string;
    displayWorkspaceId: string;
    basePath: string;
    absolutePath: string;
    options?: WorkspaceFileBridgeWatchDirOptions;
  }): Promise<{ watchId: string }> {
    const normalizedOptions = normalizeWatchOptions(input.options ?? {});
    const watcherKey = buildWatcherKey(input.scopeId, input.basePath, normalizedOptions);
    let shared = this.sharedWatchers.get(watcherKey);

    if (!shared) {
      shared = this.createSharedWatcher(
        watcherKey,
        input.displayWorkspaceId,
        input.basePath,
        input.absolutePath,
        normalizedOptions
      );
      this.sharedWatchers.set(watcherKey, shared);
    }

    await shared.readyPromise;

    const watchId = createWatchId(++this.watchSeq);
    shared.subscriptions.add(watchId);
    this.subscriptions.set(watchId, {
      watchId,
      watcherKey,
      workspaceId: input.displayWorkspaceId,
      basePath: input.basePath,
      cursor: 0,
      events: []
    });

    this.logger.info(
      {
        workspaceId: input.displayWorkspaceId,
        scopeId: input.scopeId,
        path: input.basePath,
        watchId,
        recursive: normalizedOptions.recursive
      },
      "静态 HTML 预览开始监听已解析目录"
    );

    return { watchId };
  }

  unwatch(watchId: string): { ok: true; watchId: string } {
    const subscription = this.subscriptions.get(watchId);
    if (!subscription) {
      return {
        ok: true,
        watchId
      };
    }

    this.subscriptions.delete(watchId);
    const shared = this.sharedWatchers.get(subscription.watcherKey);

    if (shared) {
      shared.subscriptions.delete(watchId);
      if (shared.subscriptions.size === 0) {
        if (shared.flushTimer) {
          clearTimeout(shared.flushTimer);
          shared.flushTimer = null;
        }
        void shared.watcher.close();
        this.sharedWatchers.delete(subscription.watcherKey);
      }
    }

    return {
      ok: true,
      watchId
    };
  }

  pollEvents(
    watchId: string,
    cursor: number | undefined
  ): { watchId: string; events: WorkspaceFileBridgeWatchEvent[]; nextCursor: number } {
    const subscription = this.subscriptions.get(watchId);
    if (!subscription) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WATCH_NOT_FOUND",
        detail: "监听不存在或已失效"
      });
    }

    const normalizedCursor = typeof cursor === "number" && Number.isFinite(cursor)
      ? Math.max(0, Math.floor(cursor))
      : 0;

    const events = subscription.events
      .filter((event) => event.seq > normalizedCursor)
      .slice(0, MAX_EVENTS_PER_POLL);
    const nextCursor = events.length > 0
      ? events[events.length - 1].seq
      : Math.max(subscription.cursor, normalizedCursor);

    if (events.length > 0) {
      subscription.events = subscription.events.filter((event) => event.seq > nextCursor);
    }

    return {
      watchId,
      events,
      nextCursor
    };
  }

  dispose(): void {
    for (const shared of this.sharedWatchers.values()) {
      if (shared.flushTimer) {
        clearTimeout(shared.flushTimer);
      }
      void shared.watcher.close();
    }

    this.sharedWatchers.clear();
    this.subscriptions.clear();
  }

  private createSharedWatcher(
    watcherKey: string,
    workspaceId: string,
    basePath: string,
    absolutePath: string,
    options: Required<WorkspaceFileBridgeWatchDirOptions>
  ): SharedWatcherEntry {
    const watcher = chokidar.watch(absolutePath, {
        ignoreInitial: true,
        ignorePermissionErrors: true,
        persistent: true,
        depth: options.recursive ? undefined : 0,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        }
      });
    const shared: SharedWatcherEntry = {
      watcher,
      readyPromise: new Promise((resolve) => {
        watcher.on("ready", () => {
          resolve();
        });
      }),
      watcherKey,
      workspaceId,
      basePath,
      absolutePath,
      recursive: options.recursive,
      includeHidden: options.includeHidden,
      kind: options.kind,
      subscriptions: new Set<string>(),
      pendingEvents: new Map<string, WorkspaceFileBridgeWatchEvent | null>(),
      flushTimer: null
    };

    watcher.on("all", (rawEvent, changedAbsolutePath) => {
      try {
        const nextEvent = this.toWatchEvent(shared, rawEvent, changedAbsolutePath);
        if (!nextEvent) {
          return;
        }

        const mergeKey = nextEvent.path;
        const previousEvent = shared.pendingEvents.get(mergeKey) ?? null;
        const mergedEvent = mergeWatchEvents(previousEvent, nextEvent);

        if (mergedEvent) {
          shared.pendingEvents.set(mergeKey, mergedEvent);
        } else {
          shared.pendingEvents.delete(mergeKey);
        }

        this.scheduleFlush(shared);
      } catch (error) {
        this.logger.warn(
          {
            workspaceId,
            path: changedAbsolutePath,
            error: error instanceof Error ? error.message : String(error)
          },
          "静态 HTML 预览目录监听处理事件失败"
        );
      }
    });

    return shared;
  }

  private scheduleFlush(shared: SharedWatcherEntry): void {
    if (shared.flushTimer) {
      clearTimeout(shared.flushTimer);
    }

    shared.flushTimer = setTimeout(() => {
      shared.flushTimer = null;
      const events = [...shared.pendingEvents.values()]
        .filter((event): event is WorkspaceFileBridgeWatchEvent => Boolean(event))
        .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
      shared.pendingEvents.clear();

      if (events.length === 0) {
        return;
      }

      for (const watchId of shared.subscriptions) {
        const subscription = this.subscriptions.get(watchId);
        if (!subscription) {
          continue;
        }

        for (const event of events) {
          const nextSeq = subscription.cursor + 1;
          const queuedEvent = {
            ...event,
            seq: nextSeq
          } satisfies WorkspaceFileBridgeWatchEvent;

          subscription.cursor = nextSeq;
          subscription.events.push(queuedEvent);
        }

        if (subscription.events.length > MAX_EVENTS_PER_POLL * 4) {
          subscription.events = subscription.events.slice(-MAX_EVENTS_PER_POLL * 4);
        }
      }
    }, WATCH_FLUSH_DEBOUNCE_MS);
  }

  private toWatchEvent(
    shared: SharedWatcherEntry,
    rawEvent: string,
    changedAbsolutePath: string
  ): WorkspaceFileBridgeWatchEvent | null {
    const relativePath = path.relative(shared.absolutePath, changedAbsolutePath).replace(/\\/g, "/");

    if (!relativePath || relativePath === "." || relativePath.startsWith("..")) {
      return null;
    }

    const normalizedPath = shared.basePath
      ? `${shared.basePath}/${relativePath}`.replace(/\\/g, "/")
      : relativePath;

    if (!shared.includeHidden && normalizedPath.split("/").some((segment) => segment.startsWith("."))) {
      return null;
    }

    if (isTemporaryBridgeFile(normalizedPath)) {
      return null;
    }

    const eventType = mapWatchEventType(rawEvent);
    if (!eventType) {
      return null;
    }

    const stat = safeStat(changedAbsolutePath);
    const kind = stat
      ? stat.isDirectory()
        ? "directory"
        : "file"
      : rawEvent === "unlinkDir"
        ? "directory"
        : rawEvent === "unlink"
          ? "file"
          : "unknown";

    if (shared.kind !== "any" && kind !== shared.kind) {
      return null;
    }

    return {
      seq: 0,
      type: eventType,
      path: normalizedPath,
      kind,
      mtime: stat ? Math.floor(stat.mtimeMs) : null
    };
  }
}

function createWatchId(sequence: number): string {
  return `workspace-watch-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function buildWatcherKey(
  workspaceId: string,
  basePath: string,
  options: Required<WorkspaceFileBridgeWatchDirOptions>
): string {
  return [
    workspaceId,
    basePath,
    options.recursive ? "r1" : "r0",
    options.includeHidden ? "h1" : "h0",
    options.kind
  ].join("::");
}

function normalizeWatchOptions(
  options: WorkspaceFileBridgeWatchDirOptions
): Required<WorkspaceFileBridgeWatchDirOptions> {
  return {
    recursive: options.recursive ?? false,
    includeHidden: options.includeHidden ?? false,
    kind: options.kind ?? "any"
  };
}

function mapWatchEventType(rawEvent: string): WorkspaceFileBridgeWatchEvent["type"] | null {
  if (rawEvent === "add" || rawEvent === "addDir") {
    return "created";
  }

  if (rawEvent === "change") {
    return "changed";
  }

  if (rawEvent === "unlink" || rawEvent === "unlinkDir") {
    return "deleted";
  }

  return null;
}

function safeStat(inputPath: string): fs.Stats | null {
  try {
    return fs.statSync(inputPath);
  } catch {
    return null;
  }
}

function mergeWatchEvents(
  previous: WorkspaceFileBridgeWatchEvent | null,
  next: WorkspaceFileBridgeWatchEvent
): WorkspaceFileBridgeWatchEvent | null {
  if (!previous) {
    return next;
  }

  if (previous.type === "created" && next.type === "changed") {
    return {
      ...next,
      type: "created"
    };
  }

  if (previous.type === "created" && next.type === "deleted") {
    return null;
  }

  if (previous.type === "deleted" && next.type === "created") {
    return {
      ...next,
      type: "changed"
    };
  }

  return next;
}

function isTemporaryBridgeFile(relativePath: string): boolean {
  return relativePath.includes(".codingns-tmp-");
}
