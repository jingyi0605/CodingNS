#!/usr/bin/env node

/**
 * Node.js 版本检查脚本
 * 确保开发环境使用正确的 Node.js 版本 (>= 22.0.0)
 */

const requiredMajorVersion = 22;
const currentNodeVersion = process.versions.node;
const currentMajorVersion = parseInt(currentNodeVersion.split('.')[0], 10);

console.log(`\n🔍 检查 Node.js 版本...`);
console.log(`   当前版本: v${currentNodeVersion}`);
console.log(`   要求版本: >= v${requiredMajorVersion}.0.0\n`);

if (currentMajorVersion < requiredMajorVersion) {
  console.error('❌ 错误: Node.js 版本过低!');
  console.error(`   项目要求 Node.js >= v${requiredMajorVersion}.0.0`);
  console.error(`   当前使用的是 v${currentNodeVersion}\n`);

  console.error('💡 解决方案:');
  console.error('   1. 使用 nvm (推荐):');
  console.error('      nvm install 22');
  console.error('      nvm use 22');
  console.error('      nvm use (自动使用项目指定的版本)\n');

  console.error('   2. 使用 fnm (更快):');
  console.error('      fnm install 22');
  console.error('      fnm use 22');
  console.error('      fnm use (自动使用项目指定的版本)\n');

  console.error('   3. 或从官网下载安装:');
  console.error('      https://nodejs.org/\n');

  process.exit(1);
}

console.log('✅ Node.js 版本检查通过!\n');

// 提示：如果是新安装或版本升级，提醒用户重新编译原生模块
const path = require('path');
const fs = require('fs');
const nodeModulesPath = path.join(__dirname, '..', 'node_modules', '.pnpm');

if (fs.existsSync(nodeModulesPath)) {
  console.log('💡 提示: 如果这是切换 Node.js 版本后的首次安装，请运行:');
  console.log('   pnpm rebuild');
  console.log('   这将重新编译原生模块（如 better-sqlite3, node-pty）\n');
}

process.exit(0);
