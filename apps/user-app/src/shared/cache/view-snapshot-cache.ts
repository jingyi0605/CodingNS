interface SnapshotEnvelope<T> {
  savedAt: number;
  value: T;
}

const memorySnapshotCache = new Map<string, SnapshotEnvelope<unknown>>();

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isSnapshotExpired(savedAt: number, maxAgeMs: number) {
  return !Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs;
}

export function readViewSnapshot<T>(cacheKey: string, maxAgeMs: number): T | null {
  const memorySnapshot = memorySnapshotCache.get(cacheKey) as SnapshotEnvelope<T> | undefined;

  if (memorySnapshot && !isSnapshotExpired(memorySnapshot.savedAt, maxAgeMs)) {
    return memorySnapshot.value;
  }

  if (!canUseSessionStorage()) {
    return null;
  }

  const rawSnapshot = window.sessionStorage.getItem(cacheKey);

  if (!rawSnapshot) {
    return null;
  }

  try {
    const parsedSnapshot = JSON.parse(rawSnapshot) as SnapshotEnvelope<T>;

    if (!parsedSnapshot || isSnapshotExpired(parsedSnapshot.savedAt, maxAgeMs)) {
      window.sessionStorage.removeItem(cacheKey);
      memorySnapshotCache.delete(cacheKey);
      return null;
    }

    memorySnapshotCache.set(cacheKey, parsedSnapshot as SnapshotEnvelope<unknown>);
    return parsedSnapshot.value;
  } catch {
    window.sessionStorage.removeItem(cacheKey);
    memorySnapshotCache.delete(cacheKey);
    return null;
  }
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
    window.sessionStorage.setItem(cacheKey, JSON.stringify(snapshot));
  } catch {
    // 忽略缓存写入失败，不能为了快照把正常流程搞挂。
  }
}

export function clearViewSnapshot(cacheKey: string) {
  memorySnapshotCache.delete(cacheKey);

  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.removeItem(cacheKey);
}
