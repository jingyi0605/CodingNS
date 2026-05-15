# 20260515 `@codingns/node-pty` 包结构与发布边界

## 这份文档回答什么

“fork 一个 `node-pty`”这句话太空了。

真正要先钉死的是：

- fork 包到底叫什么
- 哪些东西必须和官方兼容
- 哪些东西第一版明确不支持
- npm 包里到底应该带什么，不该带什么

如果这些边界不先写清楚，后面很容易做成一个“看起来像包，实际还是要用户自己编译”的半成品。

## 一、第一版核心目标

第一版只做一件事：

- 让 `Windows x64 + Node 22` 安装 `@codingns/node-pty` 时，不需要本机编译。

别在第一版里假装覆盖：

- Windows arm64
- macOS
- Linux
- Node 20
- Node 24

支持矩阵小一点没关系，假装支持才是大坑。

## 二、包名与版本策略

### 2.1 包名

建议正式包名固定为：

- `@codingns/node-pty`

不要伪装成官方 `node-pty` 原包名。你是 fork，就该让依赖关系一眼看出来。

### 2.2 版本策略

建议基于上游 `1.0.0` 做 fork 版本：

- `1.0.0-cns.1`
- `1.0.0-cns.2`

规则：

- 上游基线变了，再重新评估是否升到新的基线
- CodingNS 自己的修补只在 `-cns.x` 里递增

这比把自己伪装成 `1.0.0` 干净得多。

### 2.3 发布边界

第一版正式边界建议写死：

- 平台：`win32`
- 架构：`x64`
- Node 主版本：`22`
- 安装策略：命中即直接使用随包二进制，未命中即明确失败

不要给第一版留“也许可以试试编译”的暧昧状态。

## 三、兼容性边界

### 3.1 必须兼容的东西

对于 CodingNS 来说，真正必须兼容的是这些公开能力：

- `spawn`
- `write`
- `resize`
- `kill`
- `onData`
- `onExit`

这也是当前 Host 实际依赖的核心接口。

### 3.2 第一版兼容目标

建议第一版兼容目标写成：

- 与当前 `node-pty@1.0.0` 的 JS/TS API 保持尽量一致
- 对 Host 现有 import 和类型使用保持最小改动

这意味着第一版最好做到：

- 导出名不变
- 类型入口不变
- JS 入口行为不变

### 3.3 明确不承诺的东西

第一版不承诺：

- 对所有上游未公开内部文件结构完全兼容
- 对所有第三方项目直接无感替换
- 非支持矩阵平台的安装成功

我们要解决的是 CodingNS 的正式交付问题，不是替全世界维护一个通用 fork。

## 四、建议包结构

建议第一版包结构类似下面这样：

```text
@codingns/node-pty/
  package.json
  README.md
  LICENSE
  lib/
  src/
  typings/
  scripts/
    verify-runtime.cjs
    verify-tarball.cjs
  build/
    Release/
      conpty.node
      winpty-agent.exe
      winpty.dll
      pty.node
```

真正的关键不是目录名，而是要满足两件事：

1. JS/TS 入口还能按上游方式工作
2. 运行必需原生文件就在包里，不要安装时再赌网络

## 五、包里必须包含什么

第一版 tarball 里必须包含：

- JS 运行入口
- 类型声明
- `build/Release` 下的运行必需原生文件
- 用于安装期/发布期校验的最小脚本
- 许可证和基础说明

如果某个文件缺了会导致运行时直接炸，那它就必须进包。

## 六、包里不应该包含什么

第一版 tarball 不应该包含：

- CI 中间产物
- 测试截图、临时日志
- 本地编译缓存
- 无关平台的庞大构建垃圾

目标是“可运行”，不是“把整个 workspace 打包上去”。

## 七、安装策略

### 7.1 第一版安装逻辑

建议安装脚本只做轻校验，不做本机编译。

也就是：

1. 检查 `process.platform`
2. 检查 `process.arch`
3. 检查 Node 主版本
4. 检查 `build/Release` 必需文件是否存在
5. 命中则通过
6. 未命中则明确失败

### 7.2 为什么第一版不保留本机编译兜底

原因很简单：

- 一旦保留兜底，本机编译路径就会继续活着
- 只要这条路还活着，Windows 用户就仍然会掉进 Visual Studio 依赖坑里
- 我们这次做 fork，本来就是为了把这条路砍掉

所以第一版更合理的策略是：

- 明确支持
- 明确失败

不要“表面兼容，实际甩锅”。

## 八、建议 `package.json` 关注点

第一版 `package.json` 至少要明确这些点：

- `name=@codingns/node-pty`
- `version=1.0.0-cns.x`
- `main`
- `types`
- `files`
- `os=["win32"]`
- `cpu=["x64"]`
- `engines.node`
- `scripts.install`

这里最关键的是三个字段：

### 8.1 `files`

必须显式把运行必需文件打进 tarball。

不要指望 npm 默认行为把 `build/Release` 恰好带进去。

### 8.2 `os` / `cpu`

第一版就应该把发布边界写进元数据里。

这样至少 npm 安装阶段就能早点暴露“不支持的平台”，而不是等用户运行时再炸。

### 8.3 `scripts.install`

第一版安装脚本应该偏向：

- 校验包内二进制是否齐全
- 校验当前环境是否命中支持矩阵

不应该再是：

- `node-gyp rebuild`

如果 `install` 里还在默认走 `node-gyp rebuild`，那这个 fork 基本等于白做。

## 九、Host 接入边界

第一版接入时，Host 侧最好只改一件事：

- 依赖名从 `node-pty` 切到 `@codingns/node-pty`

更好的情况是：

- import 语句可以继续写成兼容形式
- 业务逻辑完全不动

如果为了这个 fork 还要顺手重构终端层，那就是把问题搅浑。

## 十、发布前最小检查清单

在真正 publish 前，至少要回答清楚这些问题：

1. tarball 里有没有 `build/Release` 必需文件
2. JS 入口能不能正常 `require/import`
3. 类型入口还在不在
4. `Windows x64 + Node 22` 下安装是否完全跳过本机编译
5. 非支持环境是否会明确失败

只要这五个问题里有一个答不清，包就还不该发。

## 十一、明确不做什么

第一版先不做这些事：

- 不追求多平台统一 tarball
- 不追求兼容所有历史 Node 主版本
- 不追求替代上游所有发布策略
- 不追求把 `better-sqlite3` 也并进同一个 native monorepo

先把最疼的那根刺拔掉，再谈扩展。

## 十二、结论

`@codingns/node-pty` 第一版不是“做一个更灵活的 node-pty”。

它是一个目标非常窄、但非常明确的交付包：

- 只服务 CodingNS
- 只先收 `Windows x64 + Node 22`
- 只解决“不要本机编译”这件现实问题

这个边界越明确，后面越不容易做成垃圾。
