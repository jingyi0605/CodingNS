import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { userPreferenceStore } from "../preferences/user-preference-store";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    }
  };
}

if (typeof window !== "undefined") {
  if (typeof window.localStorage?.getItem !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage()
    });
  }

  if (typeof window.sessionStorage?.getItem !== "function") {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage()
    });
  }

  // React Router 的 data router 会混用 window 和 global 的 Abort 实现；
  // 在 jsdom 下把它们对齐，避免 undici 对 signal 实例校验时报错。
  if (typeof globalThis.AbortController === "function") {
    window.AbortController = globalThis.AbortController;
  }

  if (typeof globalThis.AbortSignal === "function") {
    window.AbortSignal = globalThis.AbortSignal;
  }
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  userPreferenceStore.resetToLocalFallback();
});
