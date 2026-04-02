#!/bin/bash
#
# user-app macOS 打包脚本
# 目标：
# 1. 保留 Tauri 对 .app 的正式构建流程
# 2. 跳过 create-dmg 里不稳定的 Finder AppleScript 美化步骤
# 3. 用无交互的 hdiutil 直接生成可分发的 .dmg
#
# 用法：
#   bash scripts/build-user-app-macos.sh
#   bash scripts/build-user-app-macos.sh --target universal-apple-darwin
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_APP_DIR="$REPO_DIR/apps/user-app"
USER_APP_TAURI_DIR="$USER_APP_DIR/src-tauri"
TAURI_CONFIG_PATH="$USER_APP_TAURI_DIR/tauri.conf.json"

log_info() {
  echo "[INFO] $1"
}

log_success() {
  echo "[SUCCESS] $1"
}

log_error() {
  echo "[ERROR] $1" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log_error "该脚本只能在 macOS 上运行。"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log_error "pnpm 未安装。"
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  log_error "hdiutil 不存在，无法生成 .dmg。"
  exit 1
fi

read_config_value() {
  local key_path="$1"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const keyPath = process.argv[2].split(".");
    const json = JSON.parse(fs.readFileSync(path, "utf8"));
    let current = json;
    for (const key of keyPath) {
      current = current?.[key];
    }
    if (current == null) {
      process.exit(1);
    }
    process.stdout.write(String(current));
  ' "$TAURI_CONFIG_PATH" "$key_path"
}

resolve_arch_suffix() {
  local app_path="$1"

  if [[ "$app_path" == *"/universal-apple-darwin/"* ]]; then
    echo "universal"
    return
  fi

  if [[ "$app_path" == *"/x86_64-apple-darwin/"* ]]; then
    echo "x86_64"
    return
  fi

  if [[ "$app_path" == *"/aarch64-apple-darwin/"* ]]; then
    echo "aarch64"
    return
  fi

  case "$(uname -m)" in
    arm64|aarch64) echo "aarch64" ;;
    x86_64) echo "x86_64" ;;
    *) uname -m ;;
  esac
}

find_latest_app_bundle() {
  find "$USER_APP_TAURI_DIR/target" -path '*/release/bundle/macos/*.app' -type d -print0 \
    | xargs -0 ls -td \
    | head -n 1
}

build_app_bundle() {
  log_info "开始构建 user-app macOS .app ..."
  (
    cd "$USER_APP_DIR"
    # 只让 Tauri 产出 .app，避免进入它自带的 create-dmg AppleScript 流程。
    pnpm exec tauri build --bundles app --ci "$@"
  )
}

create_dmg_from_app() {
  local app_path="$1"
  local product_name="$2"
  local version="$3"
  local arch_suffix="$4"
  local bundle_macos_dir
  local bundle_root_dir
  local dmg_dir
  local dmg_name
  local dmg_path
  local staging_dir

  bundle_macos_dir="$(dirname "$app_path")"
  bundle_root_dir="$(dirname "$bundle_macos_dir")"
  dmg_dir="$bundle_root_dir/dmg"
  dmg_name="${product_name}_${version}_${arch_suffix}.dmg"
  dmg_path="$dmg_dir/$dmg_name"

  mkdir -p "$dmg_dir"
  rm -f "$dmg_path"

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/codingns-dmg.XXXXXX")"
  trap 'rm -rf "$staging_dir"' EXIT

  # 用 staging 目录而不是直接拿 .app 当 srcfolder，这样挂载后会看到 .app 和 Applications 两个入口。
  ditto "$app_path" "$staging_dir/$(basename "$app_path")"
  ln -s /Applications "$staging_dir/Applications"

  log_info "开始生成 .dmg ..."
  hdiutil create \
    -volname "$product_name" \
    -srcfolder "$staging_dir" \
    -ov \
    -format UDZO \
    "$dmg_path"

  rm -rf "$staging_dir"
  trap - EXIT

  log_success ".dmg 已生成：$dmg_path"
}

PRODUCT_NAME="$(read_config_value "productName")"
VERSION="$(read_config_value "version")"

build_app_bundle "$@"

APP_PATH="$(find_latest_app_bundle || true)"
if [[ -z "${APP_PATH:-}" || ! -d "$APP_PATH" ]]; then
  log_error "未找到构建后的 .app 产物。"
  exit 1
fi

ARCH_SUFFIX="$(resolve_arch_suffix "$APP_PATH")"

log_success ".app 已生成：$APP_PATH"
create_dmg_from_app "$APP_PATH" "$PRODUCT_NAME" "$VERSION" "$ARCH_SUFFIX"
