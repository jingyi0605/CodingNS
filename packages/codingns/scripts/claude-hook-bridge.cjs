#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");

function parseArgs(argv) {
  const args = {
    url: "",
    token: "",
    debugLog: ""
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--url" && typeof next === "string") {
      args.url = next.trim();
      index += 1;
      continue;
    }

    if (current === "--token" && typeof next === "string") {
      args.token = next.trim();
      index += 1;
      continue;
    }

    if (current === "--debug-log" && typeof next === "string") {
      args.debugLog = next.trim();
      index += 1;
    }
  }

  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];

    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", reject);
  });
}

function appendDebugLog(debugLogPath, message) {
  if (!debugLogPath) {
    return;
  }

  try {
    fs.appendFileSync(debugLogPath, `[bridge] ${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // ignore debug logging failure
  }
}

function resolveRequestTimeoutMs(body) {
  try {
    const parsed = JSON.parse(body);
    const hookEventName =
      parsed && typeof parsed === "object" && typeof parsed.hook_event_name === "string"
        ? parsed.hook_event_name.trim()
        : "";
    const toolName =
      parsed && typeof parsed === "object" && typeof parsed.tool_name === "string"
        ? parsed.tool_name.trim()
        : "";

    if (hookEventName === "Elicitation") {
      return 605_000;
    }

    if (
      (hookEventName === "PreToolUse" && (toolName === "AskUserQuestion" || toolName === "ExitPlanMode"))
    ) {
      return 605_000;
    }

    if (hookEventName === "PreToolUse" || hookEventName === "PermissionRequest") {
      return 95_000;
    }

    return 5_000;
  } catch {
    return 5_000;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  appendDebugLog(args.debugLog, `start pid=${process.pid} argv=${JSON.stringify(process.argv.slice(2))}`);

  if (!args.url || !args.token) {
    appendDebugLog(args.debugLog, "missing url or token");
    process.exit(0);
    return;
  }

  const body = (await readStdin()).trim();
  appendDebugLog(
    args.debugLog,
    `stdin.length=${body.length} stdin=${body.length > 2000 ? `${body.slice(0, 2000)}...` : body}`
  );

  if (!body) {
    appendDebugLog(args.debugLog, "empty stdin body");
    process.exit(0);
    return;
  }

  let targetUrl;

  try {
    targetUrl = new URL(args.url);
  } catch {
    appendDebugLog(args.debugLog, `invalid url=${args.url}`);
    process.exit(0);
    return;
  }

  const transport = targetUrl.protocol === "https:" ? https : http;
  const timeoutMs = resolveRequestTimeoutMs(body);
  const request = transport.request(
    targetUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-codingns-hook-token": args.token
      }
    },
    (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8").trim();
        appendDebugLog(
          args.debugLog,
          `response.status=${response.statusCode ?? 0} body=${responseBody.length > 2000 ? `${responseBody.slice(0, 2000)}...` : responseBody}`
        );

        if (responseBody) {
          process.stdout.write(responseBody);
        }

        process.exit(0);
      });
    }
  );

  request.setTimeout(timeoutMs, () => {
    appendDebugLog(args.debugLog, `request.timeout timeoutMs=${timeoutMs}`);
    request.destroy();
    process.exit(0);
  });
  request.on("error", (error) => {
    appendDebugLog(
      args.debugLog,
      `request.error message=${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(0);
  });
  request.write(body);
  request.end();
}

void main().catch(() => {
  process.exit(0);
});
