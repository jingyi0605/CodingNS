import { AppError } from "../../shared/errors/app-error.js";
import type { ProviderMessagePage, SessionIndex } from "../../types/domain.js";

export interface ProviderHistoryReader {
  readHistory(input: {
    session: SessionIndex;
    cursor: string | null;
    limit: number;
  }): Promise<ProviderMessagePage>;
}

export type ProviderReaderRegistry = Record<string, ProviderHistoryReader>;

export class ProviderMessageGateway {
  constructor(private readonly providerReaders: ProviderReaderRegistry = {}) {}

  async readHistory(
    session: SessionIndex,
    cursor: string | null,
    limit: number
  ): Promise<ProviderMessagePage> {
    const reader = this.providerReaders[session.provider];

    // 这里故意只认 provider reader。没有 reader，就不允许偷偷改成本地读库。
    if (!reader) {
      throw new AppError({
        statusCode: 501,
        errorCode: "PROVIDER_NOT_READY",
        detail: `provider ${session.provider} 还没有接入原始消息读取`
      });
    }

    return await reader.readHistory({
      session,
      cursor,
      limit
    });
  }
}
