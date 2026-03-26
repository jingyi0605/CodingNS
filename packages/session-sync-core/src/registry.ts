import type { ProviderAdapter } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    for (const adapter of adapters) {
      if (this.providers.has(adapter.providerId)) {
        throw new Error("PROVIDER_ALREADY_REGISTERED");
      }

      this.providers.set(adapter.providerId, adapter);
    }
  }

  list(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  get(providerId: string): ProviderAdapter {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error("PROVIDER_NOT_SUPPORTED");
    }

    return provider;
  }
}
