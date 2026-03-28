# CodingNS

一个现代化的代码会话同步系统。

## 快速开始

**重要**: 本项目需要 Node.js >= 22.0.0

```bash
# 1. 安装 Node.js 22 (使用 nvm)
nvm install 22
nvm use 22

# 2. 启用 pnpm
corepack enable

# 3. 安装依赖
pnpm install

# 4. 重新编译原生模块（如果之前用其他 Node.js 版本）
pnpm rebuild:native

# 5. 运行开发服务器
pnpm dev
```

📖 **详细设置指南**: 请查看 [DEVELOPMENT.md](./DEVELOPMENT.md) 了解完整的开发环境配置说明。

## 常用命令

```bash
pnpm dev:backend    # 启动后端服务
pnpm dev:frontend   # 启动前端应用
pnpm dev:desktop    # 启动桌面应用
pnpm build:host     # 构建 host
pnpm build:standalone # 构建可发布的统一服务包
pnpm test:host      # 测试 host
```

## 独立服务包

如果你要交付一个前后端合并后的统一服务包，使用：

```bash
pnpm build:standalone
cd packages/codingns
npm pack
```

打包后会生成 `codingns-0.1.0.tgz`，可以直接用下面的方式启动：

```bash
npm exec --yes --package ./codingns-0.1.0.tgz codingns -- start --port 3002
```

PM2 托管示例请查看：

- [spec011 PM2 部署示例](./specs/spec011-单包安装与统一服务发布/docs/20260328-PM2部署示例.md)

## 系统要求

- Node.js >= 22.0.0 (因为使用了 `node:sqlite` 模块)
- pnpm >= 9.0.0

## 问题排查

### 错误 1: `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`

这说明你的 Node.js 版本过低。请升级到 Node.js 22 或更高版本：

```bash
# 使用 nvm
nvm install 22
nvm use 22

# 或使用 fnm
fnm install 22
fnm use 22
```

### 错误 2: `NODE_MODULE_VERSION` 不匹配

```
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.
```

这说明原生模块是用旧版本的 Node.js 编译的。解决方法：

```bash
# 确保使用 Node.js 22
node --version  # 应该显示 v22.x.x

# 方法 1: 使用项目的重新编译脚本（推荐）
pnpm rebuild:native

# 方法 2: 完全重装（最可靠）
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 文档

- [开发环境设置指南](./DEVELOPMENT.md)

## 许可证

私有项目
