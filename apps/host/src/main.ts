import { resolveHostConfig } from "./config/env.js";
import { createServer } from "./server/create-server.js";

const config = resolveHostConfig();
const hosted = createServer(config);

await hosted.app.listen({
  host: config.host,
  port: config.port
});

hosted.startWs();
