import type { FastifyInstance } from "fastify";

import type { WechatClawRuntimeAccountConfig, WechatClawRuntimeThreadPayload } from "../modules/types.js";
import type { WechatClawLoginService } from "../modules/login-service.js";
import type { WechatClawPollService } from "../modules/poll-service.js";
import type { WechatClawSendService } from "../modules/send-service.js";

interface AccountParams {
  accountId: string;
}

interface AccountConfigBody {
  config?: WechatClawRuntimeAccountConfig;
}

interface SendBody extends AccountConfigBody {
  thread: WechatClawRuntimeThreadPayload;
  text: string;
}

export async function registerWechatClawRuntimeRoutes(
  app: FastifyInstance,
  services: {
    loginService: WechatClawLoginService;
    pollService: WechatClawPollService;
    sendService: WechatClawSendService;
  }
): Promise<void> {
  app.post<{ Params: AccountParams; Body: AccountConfigBody }>(
    "/accounts/:accountId/start-login",
    async (request, reply) => {
      reply.send(await services.loginService.startLogin(request.params.accountId, request.body?.config ?? {}));
    }
  );

  app.get<{ Params: AccountParams }>(
    "/accounts/:accountId/login-status",
    async (request, reply) => {
      reply.send(await services.loginService.refreshLoginStatus(request.params.accountId));
    }
  );

  app.post<{ Params: AccountParams; Body: AccountConfigBody }>(
    "/accounts/:accountId/probe",
    async (request, reply) => {
      reply.send(await services.pollService.probe(request.params.accountId, request.body?.config ?? {}));
    }
  );

  app.post<{ Params: AccountParams; Body: AccountConfigBody }>(
    "/accounts/:accountId/poll",
    async (request, reply) => {
      reply.send(await services.pollService.poll(request.params.accountId, request.body?.config ?? {}));
    }
  );

  app.post<{ Params: AccountParams; Body: SendBody }>(
    "/accounts/:accountId/send",
    async (request, reply) => {
      reply.send(
        await services.sendService.sendText(
          request.params.accountId,
          request.body?.config ?? {},
          request.body.thread,
          request.body.text
        )
      );
    }
  );

  app.post<{ Params: AccountParams }>(
    "/accounts/:accountId/logout",
    async (request, reply) => {
      reply.send(services.loginService.logout(request.params.accountId));
    }
  );

  app.post<{ Params: AccountParams }>(
    "/accounts/:accountId/purge-runtime-state",
    async (request, reply) => {
      reply.send(services.loginService.logout(request.params.accountId));
    }
  );
}
