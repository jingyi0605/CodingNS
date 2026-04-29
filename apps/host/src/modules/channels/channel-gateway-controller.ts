import type { FastifyReply, FastifyRequest } from "fastify";

import type { ChannelGatewayService } from "./channel-gateway-service.js";

interface ChannelGatewayParams {
  accountId: string;
}

export class ChannelGatewayController {
  constructor(private readonly channelGatewayService: ChannelGatewayService) {}

  readonly handleWebhook = async (
    request: FastifyRequest<{ Params: ChannelGatewayParams; Querystring: Record<string, unknown>; Body: unknown }>,
    reply: FastifyReply
  ): Promise<void> => {
    const result = await this.channelGatewayService.handlePublicWebhook(request.params.accountId, {
      method: request.method,
      headers: request.headers,
      query: request.query ?? {},
      body: request.body ?? request.query ?? {}
    });

    reply.status(result.statusCode).send(result.body);
  };
}
