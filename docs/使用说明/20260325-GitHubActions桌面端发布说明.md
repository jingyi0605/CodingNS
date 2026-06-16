# GitHub Actions 桌面端发布说明

## 这份说明是干什么的

这份说明写的是仓库里桌面端 GitHub Actions 工作流怎么用、会产出什么，以及现在有哪些边界。

如果你的目标是“准备正式发布”，不要只单独看这条桌面工作流。发布前默认入口已经改成：

```bash
bash scripts/verify-release-ci.sh
```

这个统一脚本会先做本地 npm 打包测试，再触发桌面端验包和 Windows 安装回放。

对应工作流文件：

- [desktop-release.yml](C:/Code/CodingNS/.github/workflows/desktop-release.yml)

## 现在能自动产出什么

这套工作流现在会自动构建下面这些产物：

- macOS Apple Silicon：`.dmg`
- macOS Intel：`.dmg`
- Windows：`.msi` 和 `NSIS .exe`
- 桌面 updater：`latest.json`、macOS `.app.tar.gz + .sig`、Windows `NSIS .exe + .sig`

说明：

- macOS 构建阶段也会生成 `.app` 目录，并作为 Actions artifact 保存
- GitHub Release 只上传真正适合发布的文件，不会把 `.app` 目录内部文件拆开上传

## 怎么触发

现在支持两种触发方式：

发布前建议先跑统一入口：

```bash
bash scripts/verify-release-ci.sh
```

统一入口会自动触发这条桌面工作流，不需要手工再点一次。

1. 手动触发
2. 推送 tag 触发

当前 tag 规则：

```text
v*
```

也就是说，像 `v0.1.0`、`v0.2.3` 这种 tag 会触发整套桌面端构建与发布流程。

开发版 tag（如 `v0.9.8-beta.1`、`v0.9.8-beta.2`）同样匹配 `v*` 规则，会触发同样的桌面端构建和 Release 发布流程。开发版 tag 的命名规范详见 [开发版 tag 与版本号规则](../../specs/spec001.12-更新通道与预览版本更新体验/docs/20260612-开发版tag与版本号规则.md)。

## 触发后会发生什么

### 1. 手动触发 `workflow_dispatch`

会执行多平台构建，并把产物上传到 Actions artifacts。

适合场景：

- 验证 CI 能不能过
- 先看构建产物是否齐全
- 不想直接创建 GitHub Release

### 2. 推送 tag

会执行多平台构建，并且在构建完成后：

- 创建或更新同名 GitHub Release
- 把 `.dmg`、`.msi`、`.exe`、updater 签名资产和 `latest.json` 一起上传到 Release assets

## 产物对应关系

### macOS

构建命令会显式指定：

```text
--bundles app,dmg
```

主要看这些路径：

- `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg`
- `apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg`

### Windows

构建命令会显式指定：

```text
--bundles msi,nsis
```

主要看这些路径：

- `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`

## 当前签名状态

现在这套工作流的目标是“稳定出包”，不是“完整签名发布”。

当前状态：

- 可以自动产出 macOS `.dmg`
- 可以自动产出 Windows 安装包
- 还没有接入 macOS 签名 / notarization
- 还没有接入 Windows 代码签名

也就是说：

- 现在产出的是可构建、可下载的安装包
- 不是一套已经做完苹果 notarization 和 Windows 证书签名的商业发布链路

## 目前保留的签名相关能力

工作流里保留了 Tauri updater 签名需要的这两个 secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

现在还需要再补一个：

- `TAURI_SIGNING_PUBLIC_KEY`

用途要说清楚：

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 用来给 updater 产物签名
- `TAURI_SIGNING_PUBLIC_KEY` 会在构建时写进桌面客户端，客户端检查更新时用它验签
- 这些都不等于 macOS notarization 或 Windows 代码签名证书

如果缺 `TAURI_SIGNING_PUBLIC_KEY`，客户端虽然还能构建，但官方 updater 安装链路不会工作。这不是小问题，这是半套实现。

## 后续如果要补完整签名

后面如果要把这条发布链路做完整，下一步应该分开做两件事：

1. macOS：补证书导入、keychain 配置、签名、notarization
2. Windows：补代码签名证书导入和签名步骤

不要把这两件事和“先稳定出包”混在一起做。混在一起通常只会把 CI 搞成一团垃圾。
