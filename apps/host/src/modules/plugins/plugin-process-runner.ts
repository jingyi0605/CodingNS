import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

export interface PluginProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunPluginNodeScriptInput {
  entryAbsolutePath: string;
  installRoot: string;
  payload: {
    pluginId: string;
    actionId: string;
    workspaceId: string;
    input: unknown;
  };
  timeoutMs: number;
  signal?: AbortSignal;
}

const RUNNER_FILENAME = ".codingns-plugin-runner.mjs";

export class PluginProcessRunner {
  async runNodeScript(input: RunPluginNodeScriptInput): Promise<PluginProcessRunResult> {
    if (!fs.existsSync(input.entryAbsolutePath) || !fs.statSync(input.entryAbsolutePath).isFile()) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_ACTION_ENTRY_NOT_FOUND",
        detail: "插件动作入口脚本不存在"
      });
    }

    const bootstrapScript = path.join(input.installRoot, RUNNER_FILENAME);
    if (!fs.existsSync(bootstrapScript) || fs.readFileSync(bootstrapScript, "utf8") !== buildRunnerScript()) {
      fs.writeFileSync(bootstrapScript, buildRunnerScript(), "utf8");
    }

    return await new Promise<PluginProcessRunResult>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [bootstrapScript, input.entryAbsolutePath, JSON.stringify(input.payload)],
        {
          cwd: input.installRoot,
          env: buildWhitelistedEnv(),
          stdio: ["ignore", "pipe", "pipe"]
        }
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      const cleanupAbortListener = bindAbortSignal(input.signal, () => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          reject(new AppError({
            statusCode: 499,
            errorCode: "PLUGIN_ACTION_CANCELLED",
            detail: "插件动作执行已取消"
          }));
        }
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          reject(new AppError({
            statusCode: 504,
            errorCode: "PLUGIN_ACTION_TIMEOUT",
            detail: "插件动作执行超时"
          }));
        }
      }, input.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        cleanupAbortListener();
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        cleanupAbortListener();
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  }
}

function buildWhitelistedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    NODE_ENV: "production"
  };

  Object.keys(env).forEach((key) => {
    if (env[key] === undefined) {
      delete env[key];
    }
  });

  return env;
}

function bindAbortSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) {
    return () => undefined;
  }

  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }

  const listener = () => onAbort();
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

function buildRunnerScript(): string {
  return `
import { pathToFileURL } from "node:url";

const [, , entryPath, payloadText] = process.argv;
const mod = await import(pathToFileURL(entryPath).href);
const handler = typeof mod.default === "function" ? mod.default : mod.run;

if (typeof handler !== "function") {
  throw new Error("PLUGIN_ACTION_HANDLER_MISSING: 插件动作入口必须导出 default 或 run 函数");
}

const payload = JSON.parse(payloadText);
const result = await handler(payload);
process.stdout.write(JSON.stringify(result ?? null));
`;
}
