import { AppError } from "../../shared/errors/app-error.js";
import type { ChannelAccount } from "../../types/domain.js";
import type { ChannelBridgeService } from "./channel-bridge-service.js";
import type {
  ChannelPlatformAdapterRegistry,
  ChannelWebhookRequestContext
} from "./channel-platform-adapters.js";
import type { ChannelDeliveryService } from "./channel-delivery-service.js";

interface ChannelAccountRepository {
  findById(id: string): ChannelAccount | null;
}

interface LoggerLike {
  error(message: string, detail?: unknown): void;
}

export class ChannelGatewayService {
  constructor(
    private readonly channelAccountRepository: ChannelAccountRepository,
    private readonly adapterRegistry: ChannelPlatformAdapterRegistry,
    private readonly channelBridgeService: Pick<ChannelBridgeService, "dispatchInboundText">,
    private readonly channelDeliveryService: Pick<ChannelDeliveryService, "deliverAssistantReply">,
    private readonly logger: LoggerLike = console
  ) {}

  async handlePublicWebhook(
    channelAccountId: string,
    request: ChannelWebhookRequestContext
  ): Promise<{
    statusCode: number;
    body: Record<string, unknown> | string;
  }> {
    const account = this.requireWebhookAccount(channelAccountId);
    const adapter = this.adapterRegistry.require(account.platformCode);
    const parsed = await adapter.parseWebhook(account, request);

    for (const inboundMessage of parsed.inboundMessages) {
      const dispatch = await this.channelBridgeService.dispatchInboundText(account.id, inboundMessage);
      if (dispatch.dispatch.mode === "duplicate") {
        continue;
      }

      void this.channelDeliveryService.deliverAssistantReply(dispatch).catch((error) => {
        this.logger.error("[channel-gateway] async delivery failed", {
          accountId: account.id,
          externalEventId: inboundMessage.externalEventId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    return {
      statusCode: parsed.statusCode,
      body: parsed.body
    };
  }

  private requireWebhookAccount(channelAccountId: string): ChannelAccount {
    const account = this.channelAccountRepository.findById(channelAccountId.trim());

    if (!account) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CHANNEL_ACCOUNT_NOT_FOUND",
        detail: "目标通讯平台账号不存在"
      });
    }

    if (account.connectionMode !== "webhook") {
      throw new AppError({
        statusCode: 400,
        errorCode: "CHANNEL_WEBHOOK_UNSUPPORTED",
        detail: "当前账号不是 webhook 模式"
      });
    }

    return account;
  }
}
