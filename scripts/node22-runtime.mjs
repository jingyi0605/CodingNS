import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtime = require("./node22-runtime.cjs");

export const buildNode22Env = runtime.buildNode22Env;
export const ensureNode22ForCurrentScript = runtime.ensureNode22ForCurrentScript;
export const resolveNode22Runtime = runtime.resolveNode22Runtime;
export const readDesiredNodeVersion = runtime.readDesiredNodeVersion;

export function resolveWorkspaceRoot(fromUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), "..");
}
