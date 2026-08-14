# GitHub Actions 桌面端自动打包说明

## 目的

这份说明只说一件事：让 GitHub Actions 自动打出可分发的桌面端安装包。

如果你的目标是正式发布，不要只单独触发桌面工作流。发布前默认入口已经改成：

```bash
bash scripts/verify-release-ci.sh
```

这个脚本会一起完成本地 npm 打包测试、桌面端验包和 Windows 安装回放。

当前已经固化到工作流：

[`desktop-release.yml`](/Users/jackson/Documents/Code/CodingNS/.github/workflows/desktop-release.yml)

## 当前工作流行为

### macOS

- 在 `macos-latest` 上构建
- 使用 `universal-apple-darwin`
- 生成同时支持 `Intel + Apple Silicon` 的 `.app`
- 对 `.app` 做签名
- 对 `.app` 做 notarization 并 stapler
- 生成发布版 `.dmg`
- 对 `.dmg` 做签名、notarization、stapler
- 上传产物到 GitHub Actions artifact

### Windows

- 在 `windows-latest` 上构建
- 生成 `.msi` 和 `.exe`
- 上传产物到 GitHub Actions artifact

### Git tag 发布

当你 push `v*` 标签时：

- 先跑 macOS / Windows 构建
- 再自动创建或更新 GitHub Release
- 上传 `.dmg`、`.msi`、`.exe` 到 Release

## 触发方式

### 手动触发

GitHub Actions 页面里手动运行：

如果只是排查单条桌面 workflow，可以手工触发；如果是发版前验收，优先直接运行：

```bash
bash scripts/verify-release-ci.sh
```

```text
desktop-build-and-release
```

### 标签触发

推送 tag：

```bash
git tag v0.1.2
git push origin v0.1.2
```

## 必要 Secrets

你必须在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 里配置下面这些 secrets。

### macOS 签名证书

#### `APPLE_CERTIFICATE_P12_BASE64`

内容是你的 Developer ID Application 证书 `.p12` 文件做 base64 之后的结果。

本地生成方式：

```bash
base64 < apple-developer-id-application.p12 | pbcopy
```

如果你想写到文件里再复制：

```bash
base64 < apple-developer-id-application.p12 > certificate-base64.txt
```

#### `APPLE_CERTIFICATE_PASSWORD`

这个是 `.p12` 的导出密码，不是 Apple ID 密码。

#### `APPLE_KEYCHAIN_PASSWORD`

GitHub Actions 临时 keychain 的密码。

随便生成一串高强度字符串就行，它只在 CI 里用。

### macOS 签名身份

#### `APPLE_SIGN_IDENTITY`

例如：

```text
Developer ID Application: Liyan Guan (828JR8JA8V)
```

### notarization 凭据

#### `APPLE_ID`

你的 Apple ID 邮箱。

#### `APPLE_APP_SPECIFIC_PASSWORD`

Apple ID 的 app-specific password，不是登录密码。

#### `APPLE_TEAM_ID`

你的 Apple Developer Team ID。

当前项目里是：

```text
828JR8JA8V
```

## 产物位置

### CI Artifact

macOS artifact 名称：

```text
desktop-macos-universal
```

包含：

- `CodingNS.dmg`
- `CodingNS.app`
- `CodingNS.zip`

Windows artifact 名称：

```text
desktop-windows
```

### GitHub Release

当 tag 触发时，Release 里会上传：

- `.dmg`
- `.msi`
- `.exe`

## 本地脚本与 CI 的关系

当前 CI 不是另起一套逻辑，而是直接复用本地脚本：

- [`build-desktop.sh`](/Users/jackson/Documents/Code/CodingNS/scripts/build-desktop.sh)

也就是说：

- 本地能跑通
- CI 才有资格跑通

这比在 CI 里再复制一堆分叉逻辑干净得多。

## 常见问题

### 1. 为什么 CI 里用 `.p12`，本地用 `.cer + 私钥`？

因为 CI 不适合现场组证书链。最实际的方式就是把已经可用的 `.p12` 当作 secret 注入。

### 2. 为什么 macOS 不再直接依赖 Tauri 自带的 DMG bundler？

因为这个项目现在的稳定链路是：

1. `build macos` 只负责生成 `.app`
2. `release-macos` 自己生成发布版 `.dmg`

这样职责清楚，签名和 notarization 也更可控。

### 3. 为什么构建目标固定成 universal？

因为只打 `arm64` 会让 Intel Mac 直接没法用。那不是“优化”，那是发布事故。

## 维护建议

- 修改版本号时，记得同步 `Cargo.toml`、`tauri.conf.json` 和发布 tag
- 如果更新了证书，记得重新导出 `.p12` 并更新 GitHub Secrets
- 如果 notarization 凭据失效，重新生成 app-specific password 后更新 `APPLE_APP_SPECIFIC_PASSWORD`
