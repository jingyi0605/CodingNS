import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  ChannelService,
  CreateChannelAccountInput,
  UpdateChannelAccountInput
} from "./channel-service.js";

interface ChannelAccountParams {
  accountId: string;
}

interface ChannelListQuery {
  limit?: string;
}

export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  readonly listPlatforms = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(this.channelService.listPlatforms());
  };

  readonly listAccounts = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(this.channelService.listAccounts(requireUserId(request)));
  };

  readonly createAccount = async (
    request: FastifyRequest<{ Body: CreateChannelAccountInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.code(201).send(this.channelService.createAccount(requireUserId(request), request.body ?? {}));
  };

  readonly updateAccount = async (
    request: FastifyRequest<{ Params: ChannelAccountParams; Body: UpdateChannelAccountInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.channelService.updateAccount(
        requireUserId(request),
        request.params.accountId,
        request.body ?? {}
      )
    );
  };

  readonly removeAccount = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.channelService.removeAccount(requireUserId(request), request.params.accountId)
    );
  };

  readonly probeAccount = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.channelService.probeAccount(requireUserId(request), request.params.accountId));
  };

  readonly pollAccount = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.channelService.requestPoll(requireUserId(request), request.params.accountId));
  };

  readonly startWechatClawLogin = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.channelService.startWechatClawLogin(requireUserId(request), request.params.accountId));
  };

  readonly refreshWechatClawLogin = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.channelService.refreshWechatClawLogin(requireUserId(request), request.params.accountId));
  };

  readonly logoutWechatClaw = async (
    request: FastifyRequest<{ Params: ChannelAccountParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.channelService.logoutWechatClaw(requireUserId(request), request.params.accountId));
  };

  readonly listThreads = async (
    request: FastifyRequest<{ Params: ChannelAccountParams; Querystring: ChannelListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.channelService.listThreads(
        requireUserId(request),
        request.params.accountId,
        parseLimit(request.query.limit)
      )
    );
  };

  readonly listEvents = async (
    request: FastifyRequest<{ Params: ChannelAccountParams; Querystring: ChannelListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.channelService.listInboundEvents(
        requireUserId(request),
        request.params.accountId,
        parseLimit(request.query.limit)
      )
    );
  };

  readonly listDeliveries = async (
    request: FastifyRequest<{ Params: ChannelAccountParams; Querystring: ChannelListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.channelService.listDeliveries(
        requireUserId(request),
        request.params.accountId,
        parseLimit(request.query.limit)
      )
    );
  };
}

function parseLimit(value: string | undefined): number {
  if (!value) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 50;
}
