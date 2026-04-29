import { createWechatClawRuntimeServer } from "./server.js";

const args = process.argv.slice(2);
const runtimeRootDir = readFlag(args, "--runtime-root-dir");
const authToken = readFlag(args, "--auth-token");

if (!runtimeRootDir) {
  throw new Error("WECHAT_CLAW_RUNTIME_ROOT_DIR_REQUIRED");
}

if (!authToken) {
  throw new Error("WECHAT_CLAW_RUNTIME_AUTH_TOKEN_REQUIRED");
}

const app = await createWechatClawRuntimeServer({
  runtimeRootDir,
  authToken
});
const address = await app.listen({
  host: "127.0.0.1",
  port: 0
});
const port = Number(new URL(address).port);
process.stdout.write(`${JSON.stringify({ type: "ready", port })}\n`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});

function readFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}
