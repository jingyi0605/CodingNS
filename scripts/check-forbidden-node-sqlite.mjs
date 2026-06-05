#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const scanTargets = [
  "apps/host/src",
  "packages/session-sync-core/src",
  "apps/host/tests",
  "packages/session-sync-core/tests"
];

const forbiddenPatterns = [
  {
    name: "import node:sqlite",
    pattern: /\bimport\s+(?:[^;]*?\s+from\s+)?["']node:sqlite["']/,
  },
  {
    name: "dynamic import node:sqlite",
    pattern: /\bimport\s*\(\s*["']node:sqlite["']\s*\)/,
  },
  {
    name: "require node:sqlite",
    pattern: /\brequire\s*\(\s*["']node:sqlite["']\s*\)/,
  },
];

function listFiles() {
  const output = execFileSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...scanTargets,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(line));
}

const violations = [];

for (const file of listFiles()) {
  const absolutePath = resolve(repoRoot, file);
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const item of forbiddenPatterns) {
      if (!item.pattern.test(line)) {
        continue;
      }

      violations.push({
        file: relative(repoRoot, absolutePath),
        line: index + 1,
        name: item.name,
        text: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error("禁止直接使用 node:sqlite。正式代码和测试必须走 better-sqlite3 封装。");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} ${violation.name}: ${violation.text}`
    );
  }
  process.exit(1);
}

console.log("SQLite runtime 检查通过：没有发现直接使用 node:sqlite。");
