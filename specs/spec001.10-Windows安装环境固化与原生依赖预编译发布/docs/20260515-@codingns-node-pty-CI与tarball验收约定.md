# 20260515 `@codingns/node-pty` CI 与 tarball 验收约定

## 这份文档回答什么

前一份文档已经把包边界说清楚了，但还差最关键的一层：

- CI 到底编什么
- 编完后怎么验
- 什么情况必须阻断发布

如果这里不写死，最后很容易退化成：

- 某台 Windows 机器手工编一下
- `npm publish` 一把梭
- 用户安装时再帮我们验包

这种流程不叫发布流程，这叫把 QA 外包给用户。

## 一、CI 的唯一目标

第一版 CI 只服务一个目标：

- 产出一个对 `Windows x64 + Node 22` 可直接运行的 `@codingns/node-pty` npm tarball。

不是产出“看起来像成功”的 workflow 日志。

## 二、第一版建议流水线阶段

建议最小流水线拆成 6 段：

1. 获取源码
2. 安装 Node 22 构建环境
3. 安装依赖并编译原生产物
4. 校验 `build/Release` 必需文件
5. `npm pack`
6. 校验 tarball 内容并做一次安装验证

少一步都容易留坑。

## 三、建议 Runner 与环境约束

第一版建议写死：

- Runner：`windows-latest` 或明确固定到可复现的 Windows Server 版本
- Node：22.x
- 架构：x64

不要在第一版里把矩阵铺太开。

矩阵一多，维护成本立刻翻倍，而且现在根本没这个必要。

## 四、构建阶段必须产出的东西

在 CI 构建结束后，workspace 里至少应存在：

- `build/Release/*.node`
- `build/Release/*.dll` 或其他运行必需文件
- JS 入口文件
- 类型入口文件

如果构建结束后只剩一个“编译成功”的日志，那不算产物。

## 五、tarball 验收目标

tarball 验收只看一个结果：

- 解包后，这个包是不是已经具备运行条件。

这意味着验收不能只做：

- `npm pack` 成功

还必须做：

- 内容检查
- 安装检查
- 最小运行检查

## 六、建议 tarball 必查清单

`npm pack` 后，建议至少检查下面这些内容：

1. `package/package.json`
2. `package/lib/...`
3. `package/build/Release/...`
4. `package/README.md`
5. `package/LICENSE`

其中最关键的是：

- `build/Release` 下的运行必需文件必须都在

如果 tarball 里没有这些文件，这包就是废的。

## 七、建议的 CI 校验脚本职责

第一版建议至少准备两个脚本：

### 7.1 `verify-runtime`

职责：

- 校验 workspace 里的 `build/Release` 必需文件是否存在
- 校验关键入口文件是否存在

它解决的是“构建产物齐不齐”。

### 7.2 `verify-tarball`

职责：

- 解包 `npm pack` 产物
- 校验 tarball 里是否包含预期文件
- 校验 `package.json` 的关键字段

它解决的是“发布包齐不齐”。

这两个校验别混成一个大杂烩。分开以后排错更清楚。

## 八、安装验证建议

tarball 内容检查还不够，第一版至少要再做一个最小安装验证。

建议流程：

1. 新建临时目录
2. `npm install <tarball>`
3. 确认安装阶段没有触发 `node-gyp rebuild`
4. 用 Node 22 执行一个最小 `require/import` 验证

这里的关键不是跑完整终端集成测试，而是先确认：

- 用户拿到 tarball 后，安装就能过

## 九、阻断发布的条件

只要出现下面任一情况，CI 就应该直接 fail：

1. `build/Release` 必需文件缺失
2. `npm pack` 失败
3. tarball 中缺少必需文件
4. 安装验证触发本机编译
5. 安装验证后入口无法加载

不要让“发布了再说”变成流程默认值。

## 十、建议的发布顺序

第一版建议顺序：

1. build
2. verify-runtime
3. npm pack
4. verify-tarball
5. install smoke test
6. publish

也就是说：

- 验完再发

不是：

- 发完让用户验

## 十一、建议保留的 CI 产物

为了后续排障，建议保留这些 artifact：

- `npm pack` 生成的 tarball
- `build/Release` 目录快照
- 校验脚本输出日志

这样一旦线上有人反馈“包不对”，至少能回看当时到底发了什么。

## 十二、最小 smoke test 建议

第一版建议 smoke test 只做最小闭环：

1. 安装 tarball
2. `require("@codingns/node-pty")` 或等价入口加载成功
3. 校验导出里至少能拿到 `spawn`

不要一上来就把完整 ConPTY 集成测试塞进发布 CI。那会把第三阶段做成无限延期。

完整运行验证留到主仓集成验收去做更合理。

## 十三、发布失败信息应该长什么样

建议日志风格直接一点，例如：

```text
[codingns-node-pty] tarball 校验失败：缺少 build/Release/conpty.node，当前包不能作为 Windows 预编译发布物。
```

```text
[codingns-node-pty] 安装验证失败：npm install 过程中触发了 node-gyp rebuild，说明当前包仍依赖本机编译。
```

失败原因越具体，后面越不容易反复猜。

## 十四、明确不做什么

第一版 CI 先不做这些事：

- 不做跨平台并行发布矩阵
- 不做自动生成所有 release note
- 不做复杂 benchmark
- 不把完整 Host E2E 塞进 fork 包发布流水线

fork 包 CI 的职责是产包和验包，不是替整个主仓做全集成。

## 十五、结论

第三阶段真正该守住的不是“能编出来”，而是“发出去的包就是可运行包”。

所以 CI 和 tarball 验收必须回答三个问题：

1. 编出来了吗
2. 打进包了吗
3. 安装时还会不会偷偷走本机编译

这三个问题都答对了，`@codingns/node-pty` 才算真的接近可用。
