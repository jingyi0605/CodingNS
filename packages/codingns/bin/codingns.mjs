#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(packageRoot, "dist");

const [command, ...argv] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp(0);
}

if (command !== "start") {
  console.error(`[codingns] 不支持的命令：${command}`);
  printHelp(1);
}

const options = parseArgs(argv);

if (options.help) {
  printHelp(0);
}

const host = readStringOption(
  options.values.host,
  process.env.HOST,
  process.env.CODINGNS_HOST,
  "0.0.0.0"
);
const port = parsePort(
  readStringOption(options.values.port, process.env.PORT, process.env.CODINGNS_PORT, "3002")
);
const dataDir = resolveDataDir(
  readStringOption(
    options.values["data-dir"],
    process.env.CODINGNS_DATA_DIR,
    path.join(os.homedir(), ".codingns")
  )
);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "releases"), { recursive: true });

const { startHost } = await import("../dist/server/server/start-host.js");

await startHost({
  host,
  port,
  webUiDir: path.join(distRoot, "public"),
  databasePath: path.join(dataDir, "host.sqlite"),
  releaseManifestRoot: path.join(dataDir, "releases"),
  serverUpdatePackageName: "@jingyi0605/codingns"
});

function parseArgs(argv) {
  const values = {};
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      return {
        help: true,
        values
      };
    }

    if (!token.startsWith("--")) {
      fail(`无效参数：${token}`);
    }

    const [rawName, inlineValue] = token.slice(2).split("=", 2);

    if (!rawName || !isSupportedOption(rawName)) {
      fail(`不支持的参数：${token}`);
    }

    if (inlineValue !== undefined) {
      values[rawName] = inlineValue;
      index += 1;
      continue;
    }

    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      fail(`参数 ${token} 缺少取值`);
    }

    values[rawName] = nextValue;
    index += 2;
  }

  return {
    help: false,
    values
  };
}

function isSupportedOption(name) {
  return name === "host" || name === "port" || name === "data-dir";
}

function readStringOption(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function parsePort(input) {
  const port = Number.parseInt(input, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`端口非法：${input}，允许范围为 1-65535`);
  }

  return port;
}

function resolveDataDir(input) {
  const normalized = input.trim();

  if (!normalized) {
    fail("数据目录不能为空");
  }

  if (normalized === "~") {
    return os.homedir();
  }

  if (normalized.startsWith(`~${path.sep}`) || normalized.startsWith("~/")) {
    return path.join(os.homedir(), normalized.slice(2));
  }

  return path.resolve(process.cwd(), normalized);
}

function printHelp(exitCode) {
  const output = `
codingns 用法：

  codingns start [--host 0.0.0.0] [--port 3002] [--data-dir ~/.codingns]

说明：

  --host      服务监听地址，默认 0.0.0.0
  --port      服务监听端口，默认 3002
  --data-dir  数据目录，默认 ~/.codingns
  --help      显示帮助
`.trim();

  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }

  process.exit(exitCode);
}

function fail(message) {
  console.error(`[codingns] ${message}`);
  process.exit(1);
}
