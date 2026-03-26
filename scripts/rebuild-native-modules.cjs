#!/usr/bin/env node

/**
 * 原生模块重新编译脚本
 * 用于在切换 Node.js 版本后重新编译原生模块
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const fixNodePtyHelperScript = path.join(__dirname, 'fix-node-pty-helper-permissions.cjs');

console.log('\n🔧 重新编译原生模块...\n');

// 原生模块列表
const nativeModules = ['better-sqlite3', 'node-pty'];

let hasErrors = false;

nativeModules.forEach(moduleName => {
  try {
    // 查找模块路径
    const modulePaths = findModulePaths(moduleName);

    if (modulePaths.length === 0) {
      console.log(`⏭️  跳过 ${moduleName} (未安装)`);
      return;
    }

    console.log(`🔨 重新编译 ${moduleName}...`);

    // 删除构建目录
    modulePaths.forEach(modulePath => {
      const buildPath = path.join(modulePath, 'build');
      if (fs.existsSync(buildPath)) {
        console.log(`   删除构建目录: ${buildPath}`);
        fs.rmSync(buildPath, { recursive: true, force: true });
      }
    });

    // 重新编译
    execSync(`pnpm rebuild ${moduleName}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    if (moduleName === 'node-pty' && fs.existsSync(fixNodePtyHelperScript)) {
      execSync(`node "${fixNodePtyHelperScript}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
    }

    console.log(`✅ ${moduleName} 重新编译成功\n`);
  } catch (error) {
    console.error(`❌ ${moduleName} 重新编译失败:`);
    console.error(error.message);
    hasErrors = true;
  }
});

if (hasErrors) {
  console.error('\n❌ 部分模块重新编译失败');
  console.error('💡 建议: 删除 node_modules 并重新安装:');
  console.error('   rm -rf node_modules pnpm-lock.yaml');
  console.error('   pnpm install\n');
  process.exit(1);
}

console.log('✅ 所有原生模块重新编译完成!\n');
process.exit(0);

/**
 * 查找模块的所有路径
 */
function findModulePaths(moduleName) {
  const pnpmPath = path.join(__dirname, '..', 'node_modules', '.pnpm');

  if (!fs.existsSync(pnpmPath)) {
    return [];
  }

  const paths = [];
  const entries = fs.readdirSync(pnpmPath, { withFileTypes: true });

  entries.forEach(entry => {
    if (!entry.isDirectory()) return;

    // 匹配模块名称（pnpm 的目录名格式：module@version）
    if (entry.name.startsWith(moduleName + '@')) {
      const modulePath = path.join(pnpmPath, entry.name, 'node_modules', moduleName);
      if (fs.existsSync(modulePath)) {
        paths.push(modulePath);
      }
    }
  });

  return paths;
}
