import type { ProviderAdapter } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    for (const adapter of adapters) {
      this.providers.set(adapter.providerId, adapter);
    }

    const supported = Array.from(this.providers.keys()).sort();

    if (supported.join(",") !== "claude-code,codex") {
      throw new Error("PROVIDER_NOT_SUPPORTED");
    }
  }

  list(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  get(providerId: string): ProviderAdapter {
    if (providerId !== "claude-code" && providerId !== "codex") {
      throw new Error("PROVIDER_NOT_SUPPORTED");
    }

    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error("PROVIDER_NOT_SUPPORTED");
    }

    return provider;
  }
}
