#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");

function parseArgs(argv) {
  const args = {
    url: "",
    token: ""
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

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url || !args.token) {
    process.exit(0);
    return;
  }

  const body = (await readStdin()).trim();

  if (!body) {
    process.exit(0);
    return;
  }

  let targetUrl;

  try {
    targetUrl = new URL(args.url);
  } catch {
    process.exit(0);
    return;
  }

  const transport = targetUrl.protocol === "https:" ? https : http;
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
      response.resume();
      response.on("end", () => {
        process.exit(0);
      });
    }
  );

  request.setTimeout(1500, () => {
    request.destroy();
    process.exit(0);
  });
  request.on("error", () => {
    process.exit(0);
  });
  request.write(body);
  request.end();
}

void main().catch(() => {
  process.exit(0);
});
