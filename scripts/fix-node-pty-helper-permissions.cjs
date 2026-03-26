#!/usr/bin/env node

/**
 * 修复 macOS 下 node-pty 的 spawn-helper 执行权限。
 * 有些安装链路会把预编译 helper 的可执行位抹掉，最终导致 posix_spawnp failed。
 */

const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const pnpmPath = path.join(__dirname, '..', 'node_modules', '.pnpm');

if (!fs.existsSync(pnpmPath)) {
  process.exit(0);
}

const helperPaths = findSpawnHelpers();

if (helperPaths.length === 0) {
  process.exit(0);
}

let fixedCount = 0;

for (const helperPath of helperPaths) {
  try {
    fs.accessSync(helperPath, fs.constants.X_OK);
    continue;
  } catch {
    // 当前 helper 不可执行，继续修复。
  }

  fs.chmodSync(helperPath, 0o755);
  fixedCount += 1;
  console.log(`🔧 已修复 node-pty helper 权限: ${helperPath}`);
}

if (fixedCount > 0) {
  console.log(`✅ node-pty helper 权限修复完成，共处理 ${fixedCount} 个文件`);
}

function findSpawnHelpers() {
  const helpers = [];
  const entries = fs.readdirSync(pnpmPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('node-pty@')) {
      continue;
    }

    const modulePath = path.join(pnpmPath, entry.name, 'node_modules', 'node-pty', 'prebuilds');

    if (!fs.existsSync(modulePath)) {
      continue;
    }

    const platformDirs = fs.readdirSync(modulePath, { withFileTypes: true });

    for (const platformDir of platformDirs) {
      if (!platformDir.isDirectory() || !platformDir.name.startsWith('darwin-')) {
        continue;
      }

      const helperPath = path.join(modulePath, platformDir.name, 'spawn-helper');

      if (fs.existsSync(helperPath)) {
        helpers.push(helperPath);
      }
    }
  }

  return helpers;
}
