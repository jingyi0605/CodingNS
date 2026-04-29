import Fastify from "fastify";

import { setErrorHandler } from "../../shared/http/error-handler.js";
import { wechatClawAuthError } from "./modules/errors.js";
import { WechatClawLoginService } from "./modules/login-service.js";
import { WechatClawPollService } from "./modules/poll-service.js";
import { WechatClawRuntimeStateStore } from "./modules/runtime-state-store.js";
import { WechatClawSendService } from "./modules/send-service.js";
import { WechatClawApiClient } from "./modules/wechat-api-client.js";
import { registerWechatClawRuntimeRoutes } from "./routes/accounts.js";

export async function createWechatClawRuntimeServer(input: {
  runtimeRootDir: string;
  authToken: string;
}) {
  const app = Fastify({
    logger: false
  });
  const stateStore = new WechatClawRuntimeStateStore(input.runtimeRootDir);
  const apiClient = new WechatClawApiClient();
  const loginService = new WechatClawLoginService(stateStore, apiClient);
  const pollService = new WechatClawPollService(stateStore, apiClient);
  const sendService = new WechatClawSendService(stateStore, apiClient);

  app.addHook("onRequest", async (request) => {
    const token = request.headers["x-codingns-helper-token"];
    if (token !== input.authToken) {
      throw wechatClawAuthError("无效的 helper token");
    }
  });
  app.setErrorHandler(setErrorHandler);
  await registerWechatClawRuntimeRoutes(app, {
    loginService,
    pollService,
    sendService
  });

  app.addHook("onClose", async () => {
    stateStore.dispose();
  });

  return app;
}
