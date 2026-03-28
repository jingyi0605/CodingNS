#!/bin/bash
#
# CodingNS iOS 手动编译脚本
#
# 用法:
#   ./scripts/build-ios.sh
#   ./scripts/build-ios.sh --run
#   ./scripts/build-ios.sh --no-open-xcode
#   ./scripts/build-ios.sh --release
#   ./scripts/build-ios.sh --debug
#   ./scripts/build-ios.sh --simulator "iPhone 17 Pro"
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_APP_DIR="$REPO_DIR/apps/user-app"
TAURI_DIR="$USER_APP_DIR/src-tauri"
IOS_PROJECT_DIR="$TAURI_DIR/gen/apple"
IOS_PROJECT_PATH="$IOS_PROJECT_DIR/app.xcodeproj"
IOS_PROJECT_SPEC_PATH="$SCRIPT_DIR/user-app-ios-project.yml"
DERIVED_DATA_DIR="$TAURI_DIR/target/ios-derived-data"
APP_NAME="CodingNS"
BUNDLE_ID="com.codingns.userapp"
IOS_ASSETS_DIR="$IOS_PROJECT_DIR/assets"
SIMULATOR_NAME="iPhone 17"
BUILD_CONFIGURATION="release"
OPEN_XCODE=1
RUN_AFTER_BUILD=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
  sed -n '1,12p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      RUN_AFTER_BUILD=1
      shift
      ;;
    --open-xcode)
      OPEN_XCODE=1
      shift
      ;;
    --no-open-xcode)
      OPEN_XCODE=0
      shift
      ;;
    --release)
      BUILD_CONFIGURATION="release"
      shift
      ;;
    --debug)
      BUILD_CONFIGURATION="debug"
      shift
      ;;
    --simulator)
      SIMULATOR_NAME="${2:-}"
      if [[ -z "$SIMULATOR_NAME" ]]; then
        log_error "--simulator 需要传入模拟器名称"
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "未知参数: $1"
      usage
      exit 1
      ;;
  esac
done

export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "缺少命令: $1"
    return 1
  fi
}

check_environment() {
  log_info "检查 iOS 编译环境..."

  check_command node
  check_command pnpm
  check_command cargo
  check_command rustup
  check_command xcodebuild
  check_command xcrun
  check_command pod
  check_command xcodegen

  if [[ ! -d /Applications/Xcode.app ]]; then
    log_error "未找到 /Applications/Xcode.app"
    exit 1
  fi

  xcodebuild -version >/dev/null

  if ! rustup target list --installed | grep -q '^aarch64-apple-ios-sim$'; then
    log_info "安装 Rust iOS Simulator target..."
    rustup target add aarch64-apple-ios-sim
  fi

  if [[ ! -d "$IOS_PROJECT_DIR" ]]; then
    log_warn "未找到 iOS 工程，开始初始化..."
    pnpm --dir "$USER_APP_DIR" exec tauri ios init --ci
  fi

  if [[ ! -d "$IOS_PROJECT_PATH" ]]; then
    log_error "未找到 iOS 工程文件: $IOS_PROJECT_PATH"
    exit 1
  fi
}

sync_ios_project() {
  if [[ ! -f "$IOS_PROJECT_SPEC_PATH" ]]; then
    log_warn "未找到外部 iOS 工程模板，将继续使用生成目录内的 project.yml"
    return
  fi

  log_info "同步 iOS 工程模板，避免生成目录变更丢失..."
  cp "$IOS_PROJECT_SPEC_PATH" "$IOS_PROJECT_DIR/project.yml"
  xcodegen generate --spec "$IOS_PROJECT_DIR/project.yml" --project "$IOS_PROJECT_DIR" >/dev/null
}

build_frontend() {
  log_info "构建前端资源，确保使用当前最新本地代码..."
  pnpm --dir "$USER_APP_DIR" build
}

sync_frontend_assets() {
  local dist_dir="$USER_APP_DIR/dist"

  if [[ ! -f "$dist_dir/index.html" ]]; then
    log_error "前端构建产物缺少 index.html: $dist_dir"
    exit 1
  fi

  log_info "同步前端静态资源到 iOS bundle..."
  mkdir -p "$IOS_ASSETS_DIR"
  rsync -a --delete "$dist_dir/" "$IOS_ASSETS_DIR/"
}

build_ios() {
  local destination="platform=iOS Simulator,name=$SIMULATOR_NAME"

  log_info "开始编译 iOS 工程..."
  log_info "Scheme: app_iOS"
  log_info "Configuration: $BUILD_CONFIGURATION"
  log_info "Simulator: $SIMULATOR_NAME"
  if [[ "$BUILD_CONFIGURATION" == "release" ]]; then
    log_info "本次将直接使用应用内静态前端资源，不依赖 Vite 开发服务器。"
  else
    log_warn "Debug 配置仍可能依赖 Tauri devUrl；如果前端开发服务器没启动，应用可能白屏。"
  fi

  mkdir -p "$DERIVED_DATA_DIR"

  xcodebuild \
    -project "$IOS_PROJECT_PATH" \
    -scheme app_iOS \
    -configuration "$BUILD_CONFIGURATION" \
    -destination "$destination" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    build
}

open_xcode() {
  log_info "打开 Xcode 工程..."
  open -a Xcode "$IOS_PROJECT_PATH"
}

run_in_simulator() {
  local app_path="$DERIVED_DATA_DIR/Build/Products/${BUILD_CONFIGURATION}-iphonesimulator/${APP_NAME}.app"

  if [[ ! -d "$app_path" ]]; then
    log_error "未找到编译产物: $app_path"
    exit 1
  fi

  log_info "启动模拟器..."
  xcrun simctl boot "$SIMULATOR_NAME" >/dev/null 2>&1 || true
  open -a Simulator

  log_info "安装应用到模拟器..."
  xcrun simctl install booted "$app_path"

  log_info "启动应用..."
  xcrun simctl launch booted "$BUNDLE_ID"
}

print_summary() {
  local app_path="$DERIVED_DATA_DIR/Build/Products/${BUILD_CONFIGURATION}-iphonesimulator/${APP_NAME}.app"

  log_success "iOS 编译完成"
  echo
  echo "工程路径: $IOS_PROJECT_PATH"
  echo "构建产物: $app_path"
  echo "DerivedData: $DERIVED_DATA_DIR"
  echo
  echo "说明:"
  echo "1. 这个脚本读取的是您当前磁盘上的本地代码。"
  echo "2. 它会先重新构建前端，再由 Xcode 在编译时重新构建 Rust 部分。"
  echo "3. 它不会自动帮您 git pull，远端最新代码需要您自己先同步。"
  echo "4. 默认使用 release 编译，运行时直接加载应用内静态前端资源。"
  echo "5. 编译成功后默认会自动打开 Xcode 工程，可用 --no-open-xcode 关闭。"
}

main() {
  check_environment
  sync_ios_project
  build_frontend
  sync_frontend_assets
  build_ios

  if [[ "$OPEN_XCODE" -eq 1 ]]; then
    open_xcode
  fi

  if [[ "$RUN_AFTER_BUILD" -eq 1 ]]; then
    run_in_simulator
  fi

  print_summary
}

main "$@"
