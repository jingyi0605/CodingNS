# `@codingns/node-pty`

CodingNS 自维护的 `node-pty` fork。

第一版目标很窄，不装大蒜：

- 只支持 `win32 + x64 + Node 22`
- 只解决 CodingNS 在 Windows 上的免本机编译安装链
- 不伪装成官方 `node-pty`

## 当前边界

- 上游基线：`node-pty@1.0.0`
- fork 版本：`1.0.0-cns.1`
- npm 包名：`@codingns/node-pty`
- 正式目标：发布时随包带上 `build/Release` 下的 Windows Node 22 运行必需文件

这不是一个“通用跨平台 fork”。

第一版只对下面这个矩阵负责：

- 平台：Windows
- 架构：x64
- Node：22.x

不在这个矩阵里，就直接视为不支持。

## 仓库内容

- `vendor/upstream/`：上游 `node-pty@1.0.0` tarball 解包结果
- `scripts/fetch-upstream.mjs`：下载上游 tarball
- `scripts/sync-upstream.mjs`：把上游源码同步到 fork 工作目录
- `scripts/verify-runtime.cjs`：检查 workspace 是否已经具备可运行的 Windows 预编译产物
- `scripts/verify-tarball.cjs`：检查打包前后的关键文件
- `scripts/smoke-load.cjs`：最小加载验证

## 同步上游

```bash
npm run fetch:upstream
npm run sync:upstream
```

同步策略是：

- 保留 fork 自己的 `README.md`
- 保留 fork 自己的 `package.json`
- 只同步上游源码、类型、`binding.gyp`、许可证和依赖目录

别把 fork 自己的发布边界说明再覆盖回官方 README，那种做法非常蠢。

## 构建与验收

Windows Node 22 Runner 上的最小闭环：

```bash
npm install --ignore-scripts
npm run build:native
npm run verify:runtime
npm pack
npm run verify:tarball
npm run smoke:install
```

其中：

- `verify:tarball` 会把最新的 `.tgz` 解包到临时目录，直接检查发布包内容
- `smoke:install` 会在临时目录里安装 tarball，并阻断任何 `node-gyp rebuild`
- workspace 源码目录执行 `pnpm install` / `npm install` 时，`install` 脚本会主动跳过；因为源码目录默认不是正式发布包，真正的 Windows 运行时验收要显式执行 `npm run verify:runtime`

## 发布阻断条件

只要出现下面任一情况，就不能发包：

- `build/Release` 缺少 `conpty.node`
- `build/Release` 缺少 `conpty_console_list.node`
- `build/Release` 缺少 `pty.node`
- `build/Release` 缺少 `winpty-agent.exe` 或 `winpty.dll`
- `npm pack` 后 tarball 里没有这些文件
- 安装后 `require("@codingns/node-pty")` 无法加载

## 当前状态

现在这个目录已经是 fork 骨架，不再是空目录。

但它还不是正式可发布成品，因为：

- 还没有真实的 Windows CI 构建产物提交到 tarball
- 主仓依赖还没有切到 `@codingns/node-pty`
- 还没做 Windows Runner 的完整安装 smoke test

所以别急着改主仓依赖。先把包本身做对。
