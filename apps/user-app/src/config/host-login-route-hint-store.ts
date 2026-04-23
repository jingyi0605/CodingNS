type Listener = () => void;

export interface HostLoginRouteHint {
  hostId: string;
  baseUrl: string;
  savedAt: number;
}

const HOST_LOGIN_ROUTE_HINT_TTL_MS = 30_000;

class HostLoginRouteHintStore {
  private hints = new Map<string, HostLoginRouteHint>();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  remember(hostId: string, baseUrl: string): void {
    const normalizedHostId = hostId.trim();
    const normalizedBaseUrl = baseUrl.trim();

    if (!normalizedHostId || !normalizedBaseUrl) {
      return;
    }

    this.hints.set(normalizedHostId, {
      hostId: normalizedHostId,
      baseUrl: normalizedBaseUrl,
      savedAt: Date.now()
    });
    this.emit();
  }

  forget(hostId: string | null | undefined): void {
    const normalizedHostId = hostId?.trim();

    if (!normalizedHostId || !this.hints.delete(normalizedHostId)) {
      return;
    }

    this.emit();
  }

  clear(): void {
    if (this.hints.size === 0) {
      return;
    }

    this.hints.clear();
    this.emit();
  }

  get(hostId: string | null | undefined): HostLoginRouteHint | null {
    const normalizedHostId = hostId?.trim();

    if (!normalizedHostId) {
      return null;
    }

    const hint = this.hints.get(normalizedHostId);

    if (!hint) {
      return null;
    }

    if (Date.now() - hint.savedAt > HOST_LOGIN_ROUTE_HINT_TTL_MS) {
      this.hints.delete(normalizedHostId);
      this.emit();
      return null;
    }

    return hint;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const hostLoginRouteHintStore = new HostLoginRouteHintStore();
