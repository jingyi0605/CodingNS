interface SnapshotEnvelope<T> {
  savedAt: number;
  value: T;
}

const memorySnapshotCache = new Map<string, SnapshotEnvelope<unknown>>();
const MAX_PERSISTED_SNAPSHOT_COUNT = 48;

type PersistSnapshotResult = "success" | "quota_exceeded" | "failed";

interface PersistedSnapshotEntry {
  key: string;
  savedAt: number;
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isSnapshotExpired(savedAt: number, maxAgeMs: number) {
  return !Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs;
}

function isSnapshotEnvelope(value: unknown): value is SnapshotEnvelope<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (!("savedAt" in value) || !("value" in value)) {
    return false;
  }

  return Number.isFinite((value as SnapshotEnvelope<unknown>).savedAt);
}

function parseSnapshotEnvelope<T>(rawSnapshot: string): SnapshotEnvelope<T> | null {
  try {
    const parsedSnapshot = JSON.parse(rawSnapshot) as unknown;
    return isSnapshotEnvelope(parsedSnapshot) ? (parsedSnapshot as SnapshotEnvelope<T>) : null;
  } catch {
    return null;
  }
}

function listSessionStorageKeys(): string[] {
  if (!canUseSessionStorage()) {
    return [];
  }

  try {
    return Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter(
      (key): key is string => typeof key === "string" && key.length > 0
    );
  } catch {
    return [];
  }
}

function collectPersistedSnapshotEntries(): PersistedSnapshotEntry[] {
  if (!canUseSessionStorage()) {
    return [];
  }

  const entries: PersistedSnapshotEntry[] = [];

  for (const key of listSessionStorageKeys()) {
    let rawSnapshot: string | null = null;

    try {
      rawSnapshot = window.sessionStorage.getItem(key);
    } catch {
      continue;
    }

    if (!rawSnapshot) {
      continue;
    }

    const parsedSnapshot = parseSnapshotEnvelope(rawSnapshot);

    if (!parsedSnapshot) {
      continue;
    }

    entries.push({
      key,
      savedAt: parsedSnapshot.savedAt
    });
  }

  return entries.sort((left, right) => left.savedAt - right.savedAt);
}

function removePersistedSnapshot(cacheKey: string) {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(cacheKey);
  } catch {
    // 快照清理只是降压手段，失败时不能继续放大问题。
  }
}

function trimPersistedSnapshotEntries(options?: {
  preserveKeys?: readonly string[];
  maxCount?: number;
}) {
  const preserveKeys = new Set(options?.preserveKeys ?? []);
  const maxCount = options?.maxCount ?? MAX_PERSISTED_SNAPSHOT_COUNT;
  const candidates = collectPersistedSnapshotEntries().filter((entry) => !preserveKeys.has(entry.key));
  const overflowCount = Math.max(0, preserveKeys.size + candidates.length - maxCount);

  for (let index = 0; index < overflowCount; index += 1) {
    const entry = candidates[index];

    if (!entry) {
      break;
    }

    removePersistedSnapshot(entry.key);
  }
}

function isQuotaExceededError(error: unknown) {
  return (
    error instanceof DOMException
    && (
      error.name === "QuotaExceededError"
      || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || error.code === 22
      || error.code === 1014
    )
  );
}

function tryPersistSnapshot(cacheKey: string, serializedSnapshot: string): PersistSnapshotResult {
  if (!canUseSessionStorage()) {
    return "failed";
  }

  try {
    window.sessionStorage.setItem(cacheKey, serializedSnapshot);
    return "success";
  } catch (error) {
    return isQuotaExceededError(error) ? "quota_exceeded" : "failed";
  }
}

function persistSnapshotWithCleanup(cacheKey: string, serializedSnapshot: string) {
  const initialPersistResult = tryPersistSnapshot(cacheKey, serializedSnapshot);

  if (initialPersistResult === "success") {
    trimPersistedSnapshotEntries({
      preserveKeys: [cacheKey]
    });
    return;
  }

  if (initialPersistResult !== "quota_exceeded") {
    return;
  }

  // 先删掉当前 key 的旧值，再按时间清掉最老快照，最后逐个重试，避免 sessionStorage 无限堆积。
  removePersistedSnapshot(cacheKey);
  trimPersistedSnapshotEntries({
    maxCount: Math.max(0, MAX_PERSISTED_SNAPSHOT_COUNT - 1)
  });

  if (tryPersistSnapshot(cacheKey, serializedSnapshot) === "success") {
    trimPersistedSnapshotEntries({
      preserveKeys: [cacheKey]
    });
    return;
  }

  for (const entry of collectPersistedSnapshotEntries()) {
    if (entry.key === cacheKey) {
      continue;
    }

    removePersistedSnapshot(entry.key);

    if (tryPersistSnapshot(cacheKey, serializedSnapshot) === "success") {
      trimPersistedSnapshotEntries({
        preserveKeys: [cacheKey]
      });
      return;
    }
  }
}

export function readViewSnapshot<T>(cacheKey: string, maxAgeMs: number): T | null {
  const memorySnapshot = memorySnapshotCache.get(cacheKey) as SnapshotEnvelope<T> | undefined;

  if (memorySnapshot) {
    if (!isSnapshotExpired(memorySnapshot.savedAt, maxAgeMs)) {
      return memorySnapshot.value;
    }

    memorySnapshotCache.delete(cacheKey);
  }

  if (!canUseSessionStorage()) {
    return null;
  }

  let rawSnapshot: string | null = null;

  try {
    rawSnapshot = window.sessionStorage.getItem(cacheKey);
  } catch {
    return null;
  }

  if (!rawSnapshot) {
    return null;
  }

  const parsedSnapshot = parseSnapshotEnvelope<T>(rawSnapshot);

  if (!parsedSnapshot || isSnapshotExpired(parsedSnapshot.savedAt, maxAgeMs)) {
    removePersistedSnapshot(cacheKey);
    memorySnapshotCache.delete(cacheKey);
    return null;
  }

  memorySnapshotCache.set(cacheKey, parsedSnapshot as SnapshotEnvelope<unknown>);
  return parsedSnapshot.value;
}

export function writeViewSnapshot<T>(cacheKey: string, value: T) {
  const snapshot: SnapshotEnvelope<T> = {
    savedAt: Date.now(),
    value
  };

  memorySnapshotCache.set(cacheKey, snapshot as SnapshotEnvelope<unknown>);

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    persistSnapshotWithCleanup(cacheKey, JSON.stringify(snapshot));
  } catch {
    // 忽略缓存写入失败，不能为了快照把正常流程搞挂。
  }
}

export function clearViewSnapshot(cacheKey: string) {
  memorySnapshotCache.delete(cacheKey);

  if (!canUseSessionStorage()) {
    return;
  }

  removePersistedSnapshot(cacheKey);
}
