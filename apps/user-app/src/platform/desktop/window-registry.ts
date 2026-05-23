import { useSyncExternalStore } from "react";

import {
  createWindowBounds,
  type WindowBounds,
  type WindowDescriptor
} from "./window-descriptor";

export interface WindowRegistryState {
  descriptors: Record<string, WindowDescriptor>;
  openWindowIds: string[];
  lastActiveWindowId: string | null;
}

export interface WindowRegistryWindowRecord {
  descriptor: WindowDescriptor;
  isOpen: boolean;
}

export type WindowDescriptorPatch = Partial<Omit<WindowDescriptor, "windowId" | "bounds" | "payload">> & {
  bounds?: Partial<WindowBounds>;
  payload?: Partial<WindowDescriptor["payload"]>;
};

type WindowRegistryListener = () => void;

function cloneDescriptor(descriptor: WindowDescriptor): WindowDescriptor {
  // 注册表对外始终返回副本，防止外部直接改写内部状态。
  return {
    ...descriptor,
    bounds: {
      ...descriptor.bounds
    },
    payload: {
      ...descriptor.payload
    }
  };
}

function cloneState(state: WindowRegistryState): WindowRegistryState {
  const descriptors = Object.fromEntries(
    Object.entries(state.descriptors).map(([windowId, descriptor]) => [windowId, cloneDescriptor(descriptor)])
  );

  return {
    descriptors,
    openWindowIds: [...state.openWindowIds],
    lastActiveWindowId: state.lastActiveWindowId
  };
}

function createInitialState(): WindowRegistryState {
  return {
    descriptors: {},
    openWindowIds: [],
    lastActiveWindowId: null
  };
}

function mergeDescriptor(current: WindowDescriptor, patch: WindowDescriptorPatch): WindowDescriptor {
  // patch 允许局部更新 bounds，其余字段按浅合并处理。
  return {
    ...current,
    ...patch,
    windowId: current.windowId,
    bounds: createWindowBounds({
      ...current.bounds,
      ...patch.bounds
    }),
    payload: {
      ...current.payload,
      ...patch.payload
    }
  };
}

class WindowRegistryStore {
  private state: WindowRegistryState = createInitialState();
  private listeners = new Set<WindowRegistryListener>();

  subscribe = (listener: WindowRegistryListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): WindowRegistryState => cloneState(this.state);

  registerDescriptor(descriptor: WindowDescriptor): WindowDescriptor {
    // 注册规则：同 windowId 覆盖，不产生重复 descriptor。
    const normalized = cloneDescriptor(descriptor);
    const alreadyOpened = this.state.openWindowIds.includes(normalized.windowId);

    this.state = {
      ...this.state,
      descriptors: {
        ...this.state.descriptors,
        [normalized.windowId]: normalized
      },
      lastActiveWindowId: alreadyOpened ? normalized.windowId : this.state.lastActiveWindowId
    };
    this.emit();
    return cloneDescriptor(normalized);
  }

  updateDescriptor(windowId: string, patch: WindowDescriptorPatch): WindowDescriptor | null {
    const current = this.state.descriptors[windowId];

    if (!current) {
      return null;
    }

    const nextDescriptor = mergeDescriptor(current, patch);
    this.state = {
      ...this.state,
      descriptors: {
        ...this.state.descriptors,
        [windowId]: nextDescriptor
      }
    };
    this.emit();
    return cloneDescriptor(nextDescriptor);
  }

  getDescriptor(windowId: string): WindowDescriptor | null {
    const descriptor = this.state.descriptors[windowId];
    return descriptor ? cloneDescriptor(descriptor) : null;
  }

  getWindows(): WindowRegistryWindowRecord[] {
    return Object.values(this.state.descriptors).map((descriptor) => ({
      descriptor: cloneDescriptor(descriptor),
      isOpen: this.state.openWindowIds.includes(descriptor.windowId)
    }));
  }

  markWindowOpen(windowId: string): boolean {
    if (!this.state.descriptors[windowId]) {
      return false;
    }

    // 打开规则：同 windowId 去重后再追加，保证 open 列表天然去重。
    const deduped = this.state.openWindowIds.filter((id) => id !== windowId);
    this.state = {
      ...this.state,
      openWindowIds: [...deduped, windowId],
      lastActiveWindowId: windowId
    };
    this.emit();
    return true;
  }

  markWindowClosed(windowId: string): boolean {
    if (!this.state.openWindowIds.includes(windowId)) {
      return false;
    }

    const openWindowIds = this.state.openWindowIds.filter((id) => id !== windowId);
    // 关闭当前激活窗口时，回退到最后一个仍打开的窗口。
    this.state = {
      ...this.state,
      openWindowIds,
      lastActiveWindowId:
        this.state.lastActiveWindowId === windowId ? openWindowIds.at(-1) ?? null : this.state.lastActiveWindowId
    };
    this.emit();
    return true;
  }

  isWindowOpen(windowId: string): boolean {
    return this.state.openWindowIds.includes(windowId);
  }

  removeWindow(windowId: string): boolean {
    if (!this.state.descriptors[windowId]) {
      return false;
    }

    const descriptors = { ...this.state.descriptors };
    delete descriptors[windowId];
    const openWindowIds = this.state.openWindowIds.filter((id) => id !== windowId);

    this.state = {
      descriptors,
      openWindowIds,
      lastActiveWindowId:
        this.state.lastActiveWindowId === windowId ? openWindowIds.at(-1) ?? null : this.state.lastActiveWindowId
    };
    this.emit();
    return true;
  }

  clear(): void {
    const hasAnyState =
      this.state.openWindowIds.length > 0
      || this.state.lastActiveWindowId !== null
      || Object.keys(this.state.descriptors).length > 0;

    this.state = createInitialState();

    if (hasAnyState) {
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export interface WindowRegistryApi {
  subscribe(listener: WindowRegistryListener): () => void;
  getState(): WindowRegistryState;
  registerDescriptor(descriptor: WindowDescriptor): WindowDescriptor;
  updateDescriptor(windowId: string, patch: WindowDescriptorPatch): WindowDescriptor | null;
  getDescriptor(windowId: string): WindowDescriptor | null;
  getWindows(): WindowRegistryWindowRecord[];
  markWindowOpen(windowId: string): boolean;
  markWindowClosed(windowId: string): boolean;
  isWindowOpen(windowId: string): boolean;
  removeWindow(windowId: string): boolean;
  clear(): void;
}

export function createWindowRegistryStore(): WindowRegistryApi {
  return new WindowRegistryStore();
}

const sharedWindowRegistryStore = createWindowRegistryStore();

export function getSharedWindowRegistryStore(): WindowRegistryApi {
  return sharedWindowRegistryStore;
}

export function useWindowRegistrySelector<T>(selector: (state: WindowRegistryState) => T): T {
  // 先提供平台层 hook，后续若接 Provider 可直接复用，不污染业务页。
  return useSyncExternalStore(
    sharedWindowRegistryStore.subscribe,
    () => selector(sharedWindowRegistryStore.getState())
  );
}
