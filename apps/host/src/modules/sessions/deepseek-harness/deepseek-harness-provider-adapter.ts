import {
  DeepSeekHarnessAdapter,
  type DeepSeekHarnessEnvelope,
  type DeepSeekHarnessTransport,
  type ProviderAdapter,
  type ProviderSubscription
} from "@codingns/session-sync-core";

import { DeepSeekHarnessApiClient } from "./deepseek-harness-api-client.js";
import { DeepSeekHarnessSidecarManager } from "./deepseek-harness-sidecar-manager.js";

/** ProviderAdapter 的 Host 外壳：只有真正访问 Harness 时才拉起 sidecar。 */
export class DeepSeekHarnessProviderAdapter extends DeepSeekHarnessAdapter implements ProviderAdapter {
  constructor(private readonly sidecarManager: DeepSeekHarnessSidecarManager) {
    super({
      transport: new LazyHarnessTransport(sidecarManager),
      harnessVersion: "0.1.0-rc.5"
    });
  }
}

class LazyHarnessTransport implements DeepSeekHarnessTransport {
  constructor(private readonly manager: DeepSeekHarnessSidecarManager) {}

  async call<T>(method: string, payload: unknown): Promise<T> {
    const client = await this.manager.createClient();
    return client.call<T>(method, payload);
  }

  subscribe(channel: "mux" | "host", onEnvelope: (envelope: DeepSeekHarnessEnvelope) => void): ProviderSubscription {
    let closed = false;
    let close: (() => void) | null = null;
    void this.manager.createClient().then((client: DeepSeekHarnessApiClient) => client.subscribe(channel === "mux" ? "/api/events.mux" : "/api/events.host", onEnvelope, undefined).then((closeFn) => {
      if (closed) closeFn();
      else close = closeFn;
    })).catch(() => undefined);
    return { close: () => { closed = true; close?.(); } };
  }
}
