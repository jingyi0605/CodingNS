#!/usr/bin/env bash
#
# CodingNS 应用打包统一入口
# 目标：
# 1. 只保留一个交互式打包入口，避免旧脚本继续分叉
# 2. 不重复实现打包逻辑，统一转调现有正式脚本
# 3. 同时支持交互菜单和命令行参数
#
# 用法：
#   bash scripts/package-apps.sh
#   bash scripts/package-apps.sh android
#   bash scripts/package-apps.sh ios
#   bash scripts/package-apps.sh user-macos
#   bash scripts/package-apps.sh desktop-current
#   bash scripts/package-apps.sh desktop-macos
#   bash scripts/package-apps.sh desktop-windows
#   bash scripts/package-apps.sh desktop-linux
#   bash scripts/package-apps.sh desktop-all
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║      CodingNS 应用打包统一入口 v1.0         ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
}

print_usage() {
  cat <<'EOF'
用法：
  bash scripts/package-apps.sh
  bash scripts/package-apps.sh android
  bash scripts/package-apps.sh ios
  bash scripts/package-apps.sh user-macos
  bash scripts/package-apps.sh desktop-current
  bash scripts/package-apps.sh desktop-macos
  bash scripts/package-apps.sh desktop-windows
  bash scripts/package-apps.sh desktop-linux
  bash scripts/package-apps.sh desktop-all

说明：
  1. Android 统一走 scripts/build-android.sh release
  2. iOS 统一走 scripts/build-ios.sh --no-open-xcode
  3. user-app macOS 统一走 scripts/build-user-app-macos.sh
  4. desktop 统一走 scripts/build-desktop.sh
EOF
}

run_android() {
  log_info "转调 Android 正式打包脚本..."
  bash "$SCRIPT_DIR/build-android.sh" release
}

run_ios() {
  log_info "转调 iOS 正式打包脚本..."
  bash "$SCRIPT_DIR/build-ios.sh" --no-open-xcode
}

run_user_macos() {
  log_info "转调 user-app macOS 正式打包脚本..."
  bash "$SCRIPT_DIR/build-user-app-macos.sh"
}

run_desktop() {
  local target="${1:-}"

  log_info "转调 desktop 正式打包脚本..."
  if [[ -n "$target" ]]; then
    bash "$SCRIPT_DIR/build-desktop.sh" build "$target"
    return
  fi

  bash "$SCRIPT_DIR/build-desktop.sh" build
}

run_target() {
  case "${1:-}" in
    android)
      run_android
      ;;
    ios)
      run_ios
      ;;
    user-macos|macos)
      run_user_macos
      ;;
    desktop-current|desktop)
      run_desktop
      ;;
    desktop-macos)
      run_desktop macos
      ;;
    desktop-windows)
      run_desktop windows
      ;;
    desktop-linux)
      run_desktop linux
      ;;
    desktop-all)
      run_desktop all
      ;;
    help|--help|-h)
      print_usage
      return 0
      ;;
    *)
      log_error "未知打包目标: $1"
      print_usage
      exit 1
      ;;
  esac
}

run_menu() {
  local choice=""

  echo "请选择要执行的打包任务："
  echo "  1) Android release"
  echo "  2) iOS release"
  echo "  3) user-app macOS"
  echo "  4) desktop 当前平台"
  echo "  5) desktop macOS"
  echo "  6) desktop Windows"
  echo "  7) desktop Linux"
  echo "  8) desktop 全平台"
  echo "  0) 退出"
  echo ""

  read -r -p "请输入序号: " choice

  case "$choice" in
    1) run_target android ;;
    2) run_target ios ;;
    3) run_target user-macos ;;
    4) run_target desktop-current ;;
    5) run_target desktop-macos ;;
    6) run_target desktop-windows ;;
    7) run_target desktop-linux ;;
    8) run_target desktop-all ;;
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

main() {
  print_banner

  if [[ $# -eq 0 ]]; then
    run_menu
    return
  fi

  run_target "$1"
}

main "$@"
