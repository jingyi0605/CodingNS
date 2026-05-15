#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGE_STAGE_DIR="${1:?缺少 staging 包目录参数}"
DATA_DIR="${2:?缺少安装数据目录参数}"
OUTPUT_LOG_PATH="${3:-$DATA_DIR/install-output.log}"
SERVICE_PORT="${CODINGNS_WINDOWS_REPLAY_PORT:-3102}"

log_info() {
  printf '[windows-replay] %s\n' "$1"
}

require_path() {
  local target_path="$1"
  local label="$2"

  if [[ ! -e "$target_path" ]]; then
    printf '[windows-replay] 缺少 %s：%s\n' "$label" "$target_path" >&2
    exit 1
  fi
}

main() {
  require_path "$PACKAGE_STAGE_DIR" "staging 包目录"

  rm -rf "$DATA_DIR"
  mkdir -p "$(dirname "$OUTPUT_LOG_PATH")"

  log_info "使用系统 Node 诊断后，回放 install.sh 的 Windows 私有运行时安装链"

  {
    printf '1\n'
    printf '%s\n' "$SERVICE_PORT"
    printf '%s\n' "$DATA_DIR"
    printf 'n\n'
    printf 'y\n'
    printf 'y\n'
    printf 'y\n'
  } | env \
    CODINGNS_INSTALL_INPUT_FD="0" \
    CODINGNS_PACKAGE_SPEC="$PACKAGE_STAGE_DIR" \
    CODINGNS_REGISTRY_PROBE_SPEC="@openai/codex-sdk" \
    bash "$REPO_DIR/install.sh" 2>&1 | tee "$OUTPUT_LOG_PATH"

  log_info "校验 Windows 安装回放结果"
  node "$REPO_DIR/scripts/verify-windows-install-replay.mjs" "$DATA_DIR" "$OUTPUT_LOG_PATH"
}

main "$@"
