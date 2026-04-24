import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearViewSnapshot,
  readViewSnapshot,
  writeViewSnapshot
} from "./view-snapshot-cache";

interface MockStorageController {
  storage: Storage;
  setQuotaBytes: (value: number) => void;
  listEntries: () => Array<[string, string]>;
}

function createMockStorageController(initialQuotaBytes = Number.POSITIVE_INFINITY): MockStorageController {
  const entryMap = new Map<string, string>();
  let quotaBytes = initialQuotaBytes;

  const storage = {
    clear: vi.fn(() => {
      entryMap.clear();
    }),
    getItem: vi.fn((key: string) => entryMap.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entryMap.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      entryMap.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      const nextMap = new Map(entryMap);
      nextMap.set(key, value);
      const nextSize = Array.from(nextMap.entries()).reduce(
        (total, [entryKey, entryValue]) => total + entryKey.length + entryValue.length,
        0
      );

      if (nextSize > quotaBytes) {
        throw new DOMException("Setting the value exceeded the quota.", "QuotaExceededError");
      }

      entryMap.set(key, value);
    })
  } as Storage;

  Object.defineProperty(storage, "length", {
    configurable: true,
    enumerable: true,
    get() {
      return entryMap.size;
    }
  });

  return {
    storage,
    setQuotaBytes(value: number) {
      quotaBytes = value;
    },
    listEntries() {
      return Array.from(entryMap.entries());
    }
  };
}

describe("view-snapshot-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T07:00:00.000Z"));
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("会读取并返回未过期的快照", () => {
    writeViewSnapshot("snapshot-1", {
      value: "ok"
    });

    expect(readViewSnapshot<{ value: string }>("snapshot-1", 1_000)).toEqual({
      value: "ok"
    });
  });

  it("会把最老的快照裁剪到上限以内，避免 sessionStorage 无限堆积", () => {
    for (let index = 0; index < 60; index += 1) {
      writeViewSnapshot(`snapshot-${index}`, {
        index,
        payload: "x".repeat(16)
      });
      vi.advanceTimersByTime(1);
    }

    const persistedSnapshotKeys = Array.from({ length: window.sessionStorage.length }, (_, index) =>
      window.sessionStorage.key(index)
    ).filter((key): key is string => typeof key === "string");

    expect(persistedSnapshotKeys).toHaveLength(48);
    expect(window.sessionStorage.getItem("snapshot-0")).toBeNull();
    expect(window.sessionStorage.getItem("snapshot-11")).toBeNull();
    expect(window.sessionStorage.getItem("snapshot-12")).not.toBeNull();
    expect(window.sessionStorage.getItem("snapshot-59")).not.toBeNull();
  });

  it("超配额时会先清理旧快照再重试写入", () => {
    const originalSessionStorage = window.sessionStorage;
    const storageController = createMockStorageController(700);

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: storageController.storage
    });

    try {
      writeViewSnapshot("snapshot-old-1", {
        payload: "a".repeat(180)
      });
      vi.advanceTimersByTime(1);
      writeViewSnapshot("snapshot-old-2", {
        payload: "b".repeat(180)
      });
      vi.advanceTimersByTime(1);

      storageController.setQuotaBytes(520);
      writeViewSnapshot("snapshot-new", {
        payload: "c".repeat(180)
      });

      const persistedKeys = storageController.listEntries().map(([key]) => key).sort();
      expect(persistedKeys).toContain("snapshot-new");
      expect(persistedKeys.length).toBeLessThan(3);
      expect(readViewSnapshot<{ payload: string }>("snapshot-new", 1_000)?.payload).toBe("c".repeat(180));
    } finally {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        value: originalSessionStorage
      });
    }
  });

  it("清理快照时会同步删掉持久化副本", () => {
    writeViewSnapshot("snapshot-clear", {
      value: 1
    });

    clearViewSnapshot("snapshot-clear");

    expect(readViewSnapshot("snapshot-clear", 1_000)).toBeNull();
    expect(window.sessionStorage.getItem("snapshot-clear")).toBeNull();
  });
});
