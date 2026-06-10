import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type {
  PeerHostCreateInput,
  PeerHostLoginInput,
  PeerHostService,
  PeerHostUpdateInput,
  PeerHostWorkspaceBindingUpdateInput,
} from "./peer-host-service.js";
import type { HostApiProxyService } from "./host-api-proxy-service.js";

export class PeerHostController {
  constructor(private readonly peerHostService: PeerHostService) {}

  readonly list = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send({ items: this.peerHostService.list(requireUserId(request)) });
  };

  readonly create = async (
    request: FastifyRequest<{ Body: PeerHostCreateInput }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply
      .status(201)
      .send(
        this.peerHostService.create(requireUserId(request), request.body ?? {}),
      );
  };

  readonly listWorkspaceBindings = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send({
      items: this.peerHostService.listWorkspaceBindings(requireUserId(request)),
    });
  };

  readonly saveWorkspaceBinding = async (
    request: FastifyRequest<{
      Params: { workspaceKey: string };
      Body: PeerHostWorkspaceBindingUpdateInput;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      this.peerHostService.saveWorkspaceBinding(
        requireUserId(request),
        request.params.workspaceKey,
        request.body ?? {},
      ),
    );
  };

  readonly get = async (
    request: FastifyRequest<{ Params: { peerHostId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      this.peerHostService.get(
        requireUserId(request),
        request.params.peerHostId,
      ),
    );
  };

  readonly update = async (
    request: FastifyRequest<{
      Params: { peerHostId: string };
      Body: PeerHostUpdateInput;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      this.peerHostService.update(
        requireUserId(request),
        request.params.peerHostId,
        request.body ?? {},
      ),
    );
  };

  readonly delete = async (
    request: FastifyRequest<{ Params: { peerHostId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      this.peerHostService.delete(
        requireUserId(request),
        request.params.peerHostId,
      ),
    );
  };

  readonly check = async (
    request: FastifyRequest<{ Params: { peerHostId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      await this.peerHostService.check(
        requireUserId(request),
        request.params.peerHostId,
      ),
    );
  };

  readonly login = async (
    request: FastifyRequest<{
      Params: { peerHostId: string };
      Body: PeerHostLoginInput;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      await this.peerHostService.login(
        requireUserId(request),
        request.params.peerHostId,
        request.body ?? {},
      ),
    );
  };

  readonly deleteSession = async (
    request: FastifyRequest<{ Params: { peerHostId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(
      this.peerHostService.deleteSession(
        requireUserId(request),
        request.params.peerHostId,
      ),
    );
  };
}

export class HostApiProxyController {
  constructor(private readonly hostApiProxyService: HostApiProxyService) {}

  readonly proxy = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.hostApiProxyService.proxy(request, reply);
  };
}

function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

  if (userId) {
    return userId;
  }

  throw new AppError({
    statusCode: 401,
    errorCode: "UNAUTHORIZED",
    detail: "当前请求缺少有效登录态",
  });
}
