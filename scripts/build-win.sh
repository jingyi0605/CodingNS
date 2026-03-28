#!/usr/bin/env bash

# 一键打包 Windows 桌面端。
# 这个脚本不重新发明构建逻辑，直接复用当前 apps/desktop 的 Tauri 壳。
# Tauri 会根据 tauri.conf.json 中的 beforeBuildCommand 先构建 user-app，
# 然后再打出 Windows 安装包。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${REPO_DIR}/apps/desktop"
BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle"
WINDOWS_TARGET="x86_64-pc-windows-msvc"

log_info() {
  printf '\033[34m[INFO]\033[0m %s\n' "$1"
}

log_success() {
  printf '\033[32m[SUCCESS]\033[0m %s\n' "$1"
}

log_warn() {
  printf '\033[33m[WARN]\033[0m %s\n' "$1"
}

log_error() {
  printf '\033[31m[ERROR]\033[0m %s\n' "$1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "缺少命令: $1"
    exit 1
  fi
}

is_windows_shell() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_rust_target() {
  if rustup target list --installed | grep -qx "${WINDOWS_TARGET}"; then
    log_info "Rust target 已存在: ${WINDOWS_TARGET}"
    return
  fi

  log_info "安装 Rust target: ${WINDOWS_TARGET}"
  rustup target add "${WINDOWS_TARGET}"
}

print_artifacts() {
  local found=0

  if compgen -G "${BUNDLE_DIR}/msi/*.msi" >/dev/null; then
    found=1
    log_success "MSI 安装包："
    for file in "${BUNDLE_DIR}"/msi/*.msi; do
      printf '  %s\n' "$file"
    done
  fi

  if compgen -G "${BUNDLE_DIR}/nsis/*.exe" >/dev/null; then
    found=1
    log_success "NSIS 安装包："
    for file in "${BUNDLE_DIR}"/nsis/*.exe; do
      printf '  %s\n' "$file"
    done
  fi

  if [[ "${found}" -eq 0 ]]; then
    log_warn "构建已执行，但没有在默认 bundle 目录找到 Windows 产物。"
    log_warn "请检查: ${BUNDLE_DIR}"
  fi
}

main() {
  log_info "开始构建 Windows 桌面端"
  log_info "仓库目录: ${REPO_DIR}"
  log_info "桌面端目录: ${DESKTOP_DIR}"

  if ! is_windows_shell; then
    log_error "这个脚本只能在 Windows 环境下执行。请使用 Git Bash、MSYS2 或 Cygwin。"
    exit 1
  fi

  require_command node
  require_command pnpm
  require_command rustup
  require_command cargo

  ensure_rust_target

  cd "${REPO_DIR}"

  log_info "安装依赖"
  if pnpm install --frozen-lockfile; then
    log_info "依赖安装完成（frozen-lockfile）"
  else
    log_warn "检测到 lockfile 与 package.json 不一致，降级为 --no-frozen-lockfile 继续安装"
    pnpm install --no-frozen-lockfile
  fi

  log_info "调用当前 desktop 壳执行 Tauri 打包"
  pnpm --dir "${DESKTOP_DIR}" build -- --target "${WINDOWS_TARGET}"

  log_success "Windows 桌面端打包完成"
  print_artifacts
}

main "$@"
