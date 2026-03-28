#!/bin/bash
#
# CodingNS 多平台打包脚本
# 目标：
# 1. 默认进入交互菜单，方便手动选择打包目标
# 2. 也支持命令行参数，方便后续自动化调用
# 3. user-app 负责 macOS / Android 包
# 4. desktop 继续复用现有 build-desktop.sh
#
# 用法示例：
#   ./scripts/build-packages.sh
#   ./scripts/build-packages.sh user-macos
#   ./scripts/build-packages.sh user-android-apk
#   ./scripts/build-packages.sh user-android-aab
#   ./scripts/build-packages.sh user-android
#   ./scripts/build-packages.sh user-all
#   ./scripts/build-packages.sh desktop-macos
#   ./scripts/build-packages.sh desktop-current
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_APP_DIR="$REPO_DIR/apps/user-app"
USER_APP_TAURI_DIR="$USER_APP_DIR/src-tauri"
DESKTOP_SCRIPT="$SCRIPT_DIR/build-desktop.sh"

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

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "$1 未安装"
    return 1
  fi
  return 0
}

detect_platform() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║      CodingNS 多平台程序包打包脚本 v1.0      ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
}

ensure_common_deps() {
  local missing=0

  check_command node || missing=1
  check_command pnpm || missing=1
  check_command cargo || missing=1
  check_command rustc || missing=1

  if [[ "$missing" -ne 0 ]]; then
    log_error "通用依赖不完整，请先安装 Node.js / pnpm / Rust。"
    exit 1
  fi
}

setup_android_env() {
  # 优先尊重用户已有环境变量；没有时再回退到常见 Homebrew 路径。
  if [[ -z "${JAVA_HOME:-}" && -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  fi

  if [[ -n "${JAVA_HOME:-}" ]]; then
    export PATH="$JAVA_HOME/bin:$PATH"
  fi

  if [[ -z "${ANDROID_HOME:-}" && -d "/opt/homebrew/share/android-commandlinetools" ]]; then
    export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
  fi

  if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
  fi

  if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
    if [[ -d "${ANDROID_HOME:-}/ndk/29.0.0" ]]; then
      export ANDROID_NDK_HOME="${ANDROID_HOME}/ndk/29.0.0"
    elif [[ -d "/opt/homebrew/share/android-ndk" ]]; then
      export ANDROID_NDK_HOME="/opt/homebrew/share/android-ndk"
    fi
  fi

  if [[ -z "${NDK_HOME:-}" && -n "${ANDROID_NDK_HOME:-}" ]]; then
    export NDK_HOME="$ANDROID_NDK_HOME"
  fi
}

ensure_android_project() {
  setup_android_env

  if ! check_command java; then
    log_error "Android 打包需要 Java。"
    return 1
  fi

  if ! check_command adb; then
    log_warn "adb 不存在，继续构建可能仍然可行，但建议安装 android-platform-tools。"
  fi

  if ! check_command sdkmanager; then
    log_error "Android 打包需要 sdkmanager。"
    return 1
  fi

  if [[ -z "${ANDROID_HOME:-}" || ! -d "${ANDROID_HOME}" ]]; then
    log_error "ANDROID_HOME 未设置，或路径不存在。"
    return 1
  fi

  if [[ -z "${ANDROID_NDK_HOME:-}" || ! -d "${ANDROID_NDK_HOME}" ]]; then
    log_error "ANDROID_NDK_HOME 未设置，或路径不存在。"
    return 1
  fi

  if [[ ! -d "$USER_APP_TAURI_DIR/gen/android" ]]; then
    log_info "Android 原生工程不存在，先初始化..."
    (
      cd "$USER_APP_DIR"
      pnpm exec tauri android init --ci
    )
  fi
}

print_user_app_macos_outputs() {
  local app_path="$USER_APP_TAURI_DIR/target/release/bundle/macos/CodingNS.app"
  local dmg_path
  dmg_path="$(find "$USER_APP_TAURI_DIR/target/release/bundle/dmg" -maxdepth 1 -type f -name '*.dmg' 2>/dev/null | head -n 1 || true)"

  echo ""
  log_info "user-app macOS 产物："
  [[ -d "$app_path" ]] && log_success "  .app: $app_path"
  [[ -n "$dmg_path" ]] && log_success "  .dmg: $dmg_path"
}

print_user_app_android_outputs() {
  local apk_path="$USER_APP_TAURI_DIR/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
  local aab_path="$USER_APP_TAURI_DIR/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"

  echo ""
  log_info "user-app Android 产物："
  [[ -f "$apk_path" ]] && log_success "  .apk: $apk_path"
  [[ -f "$aab_path" ]] && log_success "  .aab: $aab_path"
}

build_user_app_macos() {
  log_info "开始打包 user-app macOS 客户端..."

  if [[ "$(detect_platform)" != "macos" ]]; then
    log_error "macOS 客户端必须在 macOS 上打包。"
    return 1
  fi

  (
    cd "$USER_APP_DIR"
    pnpm tauri:build
  )

  log_success "user-app macOS 打包完成。"
  print_user_app_macos_outputs
}

build_user_app_android() {
  local android_target="${1:-both}"

  log_info "开始打包 user-app Android 客户端..."
  ensure_android_project

  local build_args=()
  case "$android_target" in
    apk)
      build_args+=(--apk)
      ;;
    aab)
      build_args+=(--aab)
      ;;
    both)
      build_args+=(--apk --aab)
      ;;
    *)
      log_error "不支持的 Android 打包目标: $android_target"
      return 1
      ;;
  esac

  (
    cd "$USER_APP_DIR"
    setup_android_env
    pnpm exec tauri android build "${build_args[@]}" --ci
  )

  log_success "user-app Android 打包完成。"
  print_user_app_android_outputs
}

build_user_app_all() {
  build_user_app_macos
  build_user_app_android both
}

build_desktop_target() {
  local target="${1:-current}"

  if [[ ! -x "$DESKTOP_SCRIPT" ]]; then
    log_error "找不到可执行的桌面端打包脚本: $DESKTOP_SCRIPT"
    return 1
  fi

  case "$target" in
    current)
      "$DESKTOP_SCRIPT"
      ;;
    macos|windows|linux|all)
      "$DESKTOP_SCRIPT" "$target"
      ;;
    *)
      log_error "不支持的 desktop 打包目标: $target"
      return 1
      ;;
  esac
}

print_menu() {
  echo "请选择要执行的打包任务："
  echo "  1) user-app macOS (.app + .dmg)"
  echo "  2) user-app Android APK"
  echo "  3) user-app Android AAB"
  echo "  4) user-app Android APK + AAB"
  echo "  5) user-app macOS + Android"
  echo "  6) desktop 当前平台"
  echo "  7) desktop macOS"
  echo "  8) desktop Windows"
  echo "  9) desktop Linux"
  echo " 10) desktop 全平台"
  echo "  0) 退出"
  echo ""
}

run_menu() {
  local choice
  print_menu
  read -r -p "请输入序号: " choice

  case "$choice" in
    1) run_target "user-macos" ;;
    2) run_target "user-android-apk" ;;
    3) run_target "user-android-aab" ;;
    4) run_target "user-android" ;;
    5) run_target "user-all" ;;
    6) run_target "desktop-current" ;;
    7) run_target "desktop-macos" ;;
    8) run_target "desktop-windows" ;;
    9) run_target "desktop-linux" ;;
    10) run_target "desktop-all" ;;
    0)
      log_info "已退出。"
      exit 0
      ;;
    *)
      log_error "无效选项: $choice"
      exit 1
      ;;
  esac
}

print_usage() {
  cat <<'EOF'
用法：
  bash scripts/build-packages.sh
  bash scripts/build-packages.sh user-macos
  bash scripts/build-packages.sh user-android-apk
  bash scripts/build-packages.sh user-android-aab
  bash scripts/build-packages.sh user-android
  bash scripts/build-packages.sh user-all
  bash scripts/build-packages.sh desktop-current
  bash scripts/build-packages.sh desktop-macos
  bash scripts/build-packages.sh desktop-windows
  bash scripts/build-packages.sh desktop-linux
  bash scripts/build-packages.sh desktop-all
EOF
}

run_target() {
  local target="$1"

  ensure_common_deps

  case "$target" in
    user-macos)
      build_user_app_macos
      ;;
    user-android-apk)
      build_user_app_android apk
      ;;
    user-android-aab)
      build_user_app_android aab
      ;;
    user-android)
      build_user_app_android both
      ;;
    user-all)
      build_user_app_all
      ;;
    desktop-current)
      build_desktop_target current
      ;;
    desktop-macos)
      build_desktop_target macos
      ;;
    desktop-windows)
      build_desktop_target windows
      ;;
    desktop-linux)
      build_desktop_target linux
      ;;
    desktop-all)
      build_desktop_target all
      ;;
    help|--help|-h)
      print_usage
      ;;
    *)
      log_error "未知打包目标: $target"
      print_usage
      exit 1
      ;;
  esac
}

main() {
  print_banner

  if [[ $# -eq 0 ]]; then
    run_menu
    return
  fi

  run_target "$1"
}

main "$@"
