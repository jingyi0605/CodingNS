import type { FastifyInstance } from "fastify";

import { resolveHostConfig, type HostConfig } from "../config/env.js";
import { createServer } from "./create-server.js";

export interface StartedHost {
  readonly app: FastifyInstance;
  readonly config: HostConfig;
  close: () => Promise<void>;
}

export async function startHost(overrides: Partial<HostConfig> = {}): Promise<StartedHost> {
  const config = resolveHostConfig(overrides);
  const hosted = createServer(config);
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.info(`[host] 收到 ${signal}，开始关闭服务`);

    try {
      await hosted.app.close();
      console.info("[host] 服务已关闭");
    } catch (error) {
      console.error("[host] 关闭服务失败", error);
      throw error;
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT").then(
      () => process.exit(0),
      () => process.exit(1)
    );
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").then(
      () => process.exit(0),
      () => process.exit(1)
    );
  });

  await hosted.app.listen({
    host: config.host,
    port: config.port
  });

  hosted.startWs();
  console.info(`[host] 监听中 http://${config.host}:${config.port}`);

  return {
    app: hosted.app,
    config,
    close: () => shutdown("manual")
  };
}
