#!/usr/bin/env bash
#
# CodingNS 打包测试脚本
# 目标：
# 1. 统一测试 Android / iOS / macOS / NPM 打包入口
# 2. 支持交互式数字选择，也支持命令行直接传数字
# 3. 每个平台都在现有正式脚本上做“执行 + 验证”
# 4. 测试结束后清理本次生成的构建产物，并恢复测试前已有文件
#
# 用法：
#   bash scripts/test-package-builds.sh
#   bash scripts/test-package-builds.sh 1
#   bash scripts/test-package-builds.sh 5
#   bash scripts/test-package-builds.sh 1,4
#   bash scripts/test-package-builds.sh all
#

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CURRENT_BACKUP_ROOT=""
CURRENT_BACKUP_RECORDS=()
RESULT_TARGETS=()
RESULT_STATUS=()
RESULT_MESSAGES=()
SELECTED_TARGETS=()
OVERALL_EXIT_CODE=0
LAST_VERIFY_MESSAGE=""

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
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║      CodingNS 打包测试脚本 v1.0             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
}

print_help() {
  cat <<'EOF'
用法：

  bash scripts/test-package-builds.sh
  bash scripts/test-package-builds.sh 1
  bash scripts/test-package-builds.sh 5
  bash scripts/test-package-builds.sh 1,4
  bash scripts/test-package-builds.sh all

编号说明：

  1  Android
  2  iOS
  3  macOS
  4  NPM
  5  全部

说明：

  1. 不直接写新的打包逻辑，只复用仓库现有正式脚本。
  2. 每个平台测试完成后，会验证关键产物是否存在。
  3. 测试结束后会清理本次生成的构建目录，并恢复测试前已有内容。
EOF
}

contains_target() {
  local needle="$1"
  local item

  for item in "${SELECTED_TARGETS[@]}"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

append_target_once() {
  local target="$1"

  if ! contains_target "$target"; then
    SELECTED_TARGETS+=("$target")
  fi
}

target_label() {
  case "$1" in
    android) echo "Android" ;;
    ios) echo "iOS" ;;
    macos) echo "macOS" ;;
    npm) echo "NPM" ;;
    *) echo "$1" ;;
  esac
}

prepare_backup_root() {
  CURRENT_BACKUP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codingns-package-test.XXXXXX")"
  CURRENT_BACKUP_RECORDS=()
}

register_move_backup() {
  local target_path="$1"
  local backup_path=""
  local index="${#CURRENT_BACKUP_RECORDS[@]}"

  if [[ -e "$target_path" || -L "$target_path" ]]; then
    backup_path="$CURRENT_BACKUP_ROOT/move-$index"
    mkdir -p "$(dirname "$backup_path")"
    mv "$target_path" "$backup_path"
    CURRENT_BACKUP_RECORDS+=("move|$target_path|$backup_path")
    return 0
  fi

  CURRENT_BACKUP_RECORDS+=("missing|$target_path|")
}

register_copy_backup() {
  local target_path="$1"
  local backup_path=""
  local index="${#CURRENT_BACKUP_RECORDS[@]}"

  if [[ -e "$target_path" || -L "$target_path" ]]; then
    backup_path="$CURRENT_BACKUP_ROOT/copy-$index"
    mkdir -p "$(dirname "$backup_path")"
    cp -R "$target_path" "$backup_path"
    CURRENT_BACKUP_RECORDS+=("copy|$target_path|$backup_path")
    return 0
  fi

  CURRENT_BACKUP_RECORDS+=("missing|$target_path|")
}

cleanup_current_target() {
  local index=""
  local record=""
  local mode=""
  local target_path=""
  local backup_path=""
  local cleanup_failed=0

  if [[ -z "$CURRENT_BACKUP_ROOT" ]]; then
    return 0
  fi

  for (( index=${#CURRENT_BACKUP_RECORDS[@]}-1; index>=0; index-- )); do
    record="${CURRENT_BACKUP_RECORDS[$index]}"
    mode="${record%%|*}"
    record="${record#*|}"
    target_path="${record%%|*}"
    backup_path="${record#*|}"

    if [[ -e "$target_path" || -L "$target_path" ]]; then
      if ! rm -rf "$target_path"; then
        log_error "清理失败：$target_path"
        cleanup_failed=1
      fi
    fi

    case "$mode" in
      move)
        if ! mkdir -p "$(dirname "$target_path")"; then
          log_error "无法恢复目录：$(dirname "$target_path")"
          cleanup_failed=1
          continue
        fi
        if ! mv "$backup_path" "$target_path"; then
          log_error "恢复失败：$target_path"
          cleanup_failed=1
        fi
        ;;
      copy)
        if ! mkdir -p "$(dirname "$target_path")"; then
          log_error "无法恢复目录：$(dirname "$target_path")"
          cleanup_failed=1
          continue
        fi
        if ! cp -R "$backup_path" "$target_path"; then
          log_error "恢复失败：$target_path"
          cleanup_failed=1
        fi
        ;;
      missing)
        ;;
    esac
  done

  if ! rm -rf "$CURRENT_BACKUP_ROOT"; then
    log_error "无法删除临时备份目录：$CURRENT_BACKUP_ROOT"
    cleanup_failed=1
  fi
  CURRENT_BACKUP_ROOT=""
  CURRENT_BACKUP_RECORDS=()
  return "$cleanup_failed"
}

handle_exit() {
  local exit_code=$?
  cleanup_current_target
  exit "$exit_code"
}

trap handle_exit EXIT
trap 'exit 130' INT TERM

record_result() {
  RESULT_TARGETS+=("$1")
  RESULT_STATUS+=("$2")
  RESULT_MESSAGES+=("$3")
}

prepare_android_context() {
  register_move_backup "$REPO_DIR/apps/user-app/dist"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/gen/android/build"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/gen/android/app/build"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libapp_lib.so"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/aarch64-linux-android"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/codingns-release.jks"
}

prepare_ios_context() {
  register_copy_backup "$REPO_DIR/apps/user-app/src-tauri/gen/apple"
  register_move_backup "$REPO_DIR/apps/user-app/dist"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/ios-derived-data"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/ios-archive"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/ios-export"
}

prepare_macos_context() {
  register_move_backup "$REPO_DIR/apps/user-app/dist"
  register_move_backup "$REPO_DIR/apps/user-app/src-tauri/target/release"
}

prepare_npm_context() {
  local tgz_file=""

  register_move_backup "$REPO_DIR/packages/codingns/dist"
  register_move_backup "$REPO_DIR/packages/session-sync-core/dist"
  register_move_backup "$REPO_DIR/apps/host/.build"
  register_move_backup "$REPO_DIR/apps/user-app/dist"
  register_move_backup "$REPO_DIR/packages/codingns/node_modules/@codingns/session-sync-core"
  register_move_backup "$REPO_DIR/packages/codingns/node_modules/@openai"

  while IFS= read -r tgz_file; do
    [[ -n "$tgz_file" ]] || continue
    register_move_backup "$tgz_file"
  done < <(find "$REPO_DIR/packages/codingns" -maxdepth 1 -type f -name '*.tgz' | sort)
}

run_android_test() {
  bash "$SCRIPT_DIR/build-android.sh" release
}

run_ios_test() {
  bash "$SCRIPT_DIR/build-ios.sh" --no-open-xcode
}

run_macos_test() {
  bash "$SCRIPT_DIR/build-user-app-macos.sh"
}

run_npm_test() {
  bash "$SCRIPT_DIR/publish-npm-package.sh" --mode pack
}

verify_android_result() {
  local apk_path="$REPO_DIR/apps/user-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"

  if [[ ! -f "$apk_path" ]]; then
    LAST_VERIFY_MESSAGE="未找到 Android release APK：$apk_path"
    return 1
  fi

  LAST_VERIFY_MESSAGE="已验证 Android APK：$apk_path"
  return 0
}

verify_ios_result() {
  local app_path="$REPO_DIR/apps/user-app/src-tauri/target/ios-derived-data/Build/Products/release-iphonesimulator/CodingNS.app"

  if [[ ! -d "$app_path" ]]; then
    LAST_VERIFY_MESSAGE="未找到 iOS 模拟器 .app：$app_path"
    return 1
  fi

  LAST_VERIFY_MESSAGE="已验证 iOS 模拟器产物：$app_path"
  return 0
}

verify_macos_result() {
  local app_path="$REPO_DIR/apps/user-app/src-tauri/target/release/bundle/macos/CodingNS.app"
  local dmg_path=""

  if [[ ! -d "$app_path" ]]; then
    LAST_VERIFY_MESSAGE="未找到 macOS .app：$app_path"
    return 1
  fi

  dmg_path="$(find "$REPO_DIR/apps/user-app/src-tauri/target/release/bundle/dmg" -maxdepth 1 -type f -name '*.dmg' | head -n 1)"
  if [[ -z "$dmg_path" || ! -f "$dmg_path" ]]; then
    LAST_VERIFY_MESSAGE="未找到 macOS .dmg：$REPO_DIR/apps/user-app/src-tauri/target/release/bundle/dmg"
    return 1
  fi

  LAST_VERIFY_MESSAGE="已验证 macOS 产物：$app_path 和 $dmg_path"
  return 0
}

verify_npm_result() {
  local tgz_path=""

  tgz_path="$(find "$REPO_DIR/packages/codingns" -maxdepth 1 -type f -name '*.tgz' | head -n 1)"
  if [[ -z "$tgz_path" || ! -f "$tgz_path" ]]; then
    LAST_VERIFY_MESSAGE="未找到 NPM pack 产物：$REPO_DIR/packages/codingns/*.tgz"
    return 1
  fi

  LAST_VERIFY_MESSAGE="已验证 NPM 打包产物：$tgz_path"
  return 0
}

prepare_target_context() {
  case "$1" in
    android) prepare_android_context ;;
    ios) prepare_ios_context ;;
    macos) prepare_macos_context ;;
    npm) prepare_npm_context ;;
    *)
      log_error "未知测试目标：$1"
      return 1
      ;;
  esac
}

run_target_build() {
  case "$1" in
    android) run_android_test ;;
    ios) run_ios_test ;;
    macos) run_macos_test ;;
    npm) run_npm_test ;;
    *)
      log_error "未知测试目标：$1"
      return 1
      ;;
  esac
}

verify_target_result() {
  LAST_VERIFY_MESSAGE=""

  case "$1" in
    android) verify_android_result ;;
    ios) verify_ios_result ;;
    macos) verify_macos_result ;;
    npm) verify_npm_result ;;
    *)
      LAST_VERIFY_MESSAGE="未知测试目标：$1"
      return 1
      ;;
  esac
}

run_single_target() {
  local target="$1"
  local label=""
  local message=""
  local build_exit_code=0
  local cleanup_exit_code=0

  label="$(target_label "$target")"

  echo ""
  log_info "============================================"
  log_info "开始测试 ${label} 打包"
  log_info "============================================"

  prepare_backup_root

  if ! prepare_target_context "$target"; then
    message="${label} 预处理失败"
    log_error "$message"
    record_result "$target" "failed" "$message"
    OVERALL_EXIT_CODE=1
    cleanup_current_target
    return 1
  fi

  run_target_build "$target"
  build_exit_code=$?
  if [[ "$build_exit_code" -ne 0 ]]; then
    message="${label} 构建命令执行失败，退出码：$build_exit_code"
    log_error "$message"
    record_result "$target" "failed" "$message"
    OVERALL_EXIT_CODE=1
    cleanup_current_target
    return 1
  fi

  if ! verify_target_result "$target"; then
    message="$LAST_VERIFY_MESSAGE"
    log_error "$message"
    record_result "$target" "failed" "$message"
    OVERALL_EXIT_CODE=1
    cleanup_current_target
    return 1
  fi

  message="$LAST_VERIFY_MESSAGE"
  log_success "$message"
  record_result "$target" "passed" "$message"
  cleanup_current_target
  cleanup_exit_code=$?
  if [[ "$cleanup_exit_code" -ne 0 ]]; then
    message="${label} 测试通过，但清理或恢复失败"
    log_error "$message"
    RESULT_STATUS[$((${#RESULT_STATUS[@]} - 1))]="failed"
    RESULT_MESSAGES[$((${#RESULT_MESSAGES[@]} - 1))]="$message"
    OVERALL_EXIT_CODE=1
    return 1
  fi
  log_success "${label} 测试结束，已清理本次生成的构建产物并恢复现场。"
  return 0
}

parse_target_token() {
  case "$1" in
    1|android|Android|ANDROID)
      append_target_once "android"
      ;;
    2|ios|iOS|IOS)
      append_target_once "ios"
      ;;
    3|macos|macOS|MACOS)
      append_target_once "macos"
      ;;
    4|npm|NPM)
      append_target_once "npm"
      ;;
    5|all|ALL)
      SELECTED_TARGETS=("android" "ios" "macos" "npm")
      ;;
    *)
      log_error "无效选择：$1"
      return 1
      ;;
  esac

  return 0
}

parse_selection_input() {
  local raw_input="$1"
  local normalized_input=""
  local token=""

  SELECTED_TARGETS=()
  normalized_input="${raw_input//,/ }"

  for token in $normalized_input; do
    parse_target_token "$token" || return 1
    if [[ "${#SELECTED_TARGETS[@]}" -eq 4 ]]; then
      return 0
    fi
  done

  if [[ "${#SELECTED_TARGETS[@]}" -eq 0 ]]; then
    log_error "未选择任何测试目标"
    return 1
  fi

  return 0
}

select_targets_interactively() {
  local raw_choice=""

  echo "请选择要测试的打包目标："
  echo "  [1] Android"
  echo "  [2] iOS"
  echo "  [3] macOS"
  echo "  [4] NPM"
  echo "  [5] 全部"
  echo ""
  echo "支持输入单个数字，或多个数字用逗号分隔，例如：1,4"
  echo ""

  read -rp "请输入编号: " raw_choice
  parse_selection_input "$raw_choice"
}

summarize_results() {
  local index=""
  local label=""
  local passed_count=0
  local failed_count=0

  echo ""
  log_info "============================================"
  log_info "测试汇总"
  log_info "============================================"

  for (( index=0; index<${#RESULT_TARGETS[@]}; index++ )); do
    label="$(target_label "${RESULT_TARGETS[$index]}")"
    if [[ "${RESULT_STATUS[$index]}" == "passed" ]]; then
      passed_count=$((passed_count + 1))
      log_success "${label}: 成功"
    else
      failed_count=$((failed_count + 1))
      log_error "${label}: 失败"
    fi

    echo "        ${RESULT_MESSAGES[$index]}"
  done

  echo ""
  if [[ "$failed_count" -eq 0 ]]; then
    log_success "全部测试通过，共 ${passed_count} 项。"
  else
    log_error "测试结束：成功 ${passed_count} 项，失败 ${failed_count} 项。"
  fi
}

main() {
  local target=""
  local raw_args=""

  print_banner

  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    print_help
    exit 0
  fi

  if [[ "$#" -gt 0 ]]; then
    raw_args="$*"
    parse_selection_input "$raw_args"
  else
    select_targets_interactively
  fi

  echo ""
  log_info "本次测试目标："
  for target in "${SELECTED_TARGETS[@]}"; do
    echo "  - $(target_label "$target")"
  done

  for target in "${SELECTED_TARGETS[@]}"; do
    run_single_target "$target"
  done

  summarize_results
  exit "$OVERALL_EXIT_CODE"
}

main "$@"
