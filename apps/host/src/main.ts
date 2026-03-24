import { resolveHostConfig } from "./config/env.js";
import { createServer } from "./server/create-server.js";

const config = resolveHostConfig();
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
    process.exit(0);
  } catch (error) {
    console.error("[host] 关闭服务失败", error);
    process.exit(1);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await hosted.app.listen({
  host: config.host,
  port: config.port
});

hosted.startWs();
console.info(`[host] 监听中 http://${config.host}:${config.port}`);
