#!/usr/bin/env node

/**
 * 安装前环境检查脚本
 * 目标：
 * 1. 强制使用 pnpm 安装依赖
 * 2. 检查 Node.js 主版本是否满足要求
 */

const { readDesiredNodeVersion } = require("./node22-runtime.cjs");

const desiredNodeVersion = readDesiredNodeVersion(process.cwd());
const requiredMajorVersion = 22;
const currentNodeVersion = process.versions.node;
const currentMajorVersion = parseInt(currentNodeVersion.split(".")[0], 10);
const userAgent = process.env.npm_config_user_agent ?? "";
const execPath = process.env.npm_execpath ?? "";

if (currentMajorVersion !== requiredMajorVersion) {
  console.error("Node.js 主版本不符合要求。");
  console.error(`项目要求 Node.js ${desiredNodeVersion}（主版本 ${requiredMajorVersion}）`);
  console.error(`当前版本: v${currentNodeVersion}`);
  console.error("建议执行：nvm install 22 && nvm use 22");
  process.exit(1);
}

const isPnpm =
  userAgent.startsWith("pnpm/") ||
  execPath.includes("\\pnpm") ||
  execPath.includes("/pnpm");

if (isPnpm) {
  process.exit(0);
}

console.error("依赖安装必须使用 pnpm，不要运行 npm install。");
console.error("正确命令：corepack pnpm install");
console.error("安装完成后，你仍然可以继续使用 npm run dev:frontend / npm run dev:backend。");
process.exit(1);
