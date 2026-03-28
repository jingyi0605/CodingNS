#!/usr/bin/env bash

# 一键打包 Windows 桌面端。
# 目标很简单：只使用当前 apps/desktop 壳，并强制吃最新的 apps/user-app/dist。
# 所以这里不做增量构建，先清掉 Windows 相关旧产物，再重新打包。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
USER_APP_DIR="${REPO_DIR}/apps/user-app"
DESKTOP_DIR="${REPO_DIR}/apps/desktop"
TAURI_TARGET_DIR="${DESKTOP_DIR}/src-tauri/target"
WINDOWS_TARGET="x86_64-pc-windows-msvc"
WINDOWS_RELEASE_DIR="${TAURI_TARGET_DIR}/${WINDOWS_TARGET}/release"
BUNDLE_DIR="${WINDOWS_RELEASE_DIR}/bundle"
APP_EXE_PATH="${WINDOWS_RELEASE_DIR}/codingns-desktop.exe"

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

install_build_dependencies() {
  if [[ -d "${USER_APP_DIR}/node_modules" && -d "${DESKTOP_DIR}/node_modules" ]]; then
    log_info "检测到 desktop 和 user-app 已有 node_modules，跳过依赖安装"
    return
  fi

  log_info "安装桌面端打包依赖"

  if pnpm install --filter "./apps/user-app..." --filter "./apps/desktop..." --frozen-lockfile; then
    log_info "依赖安装完成（frozen-lockfile）"
    return
  fi

  log_warn "检测到 lockfile 与 package.json 不一致，降级为 --no-frozen-lockfile 继续安装"
  if pnpm install --filter "./apps/user-app..." --filter "./apps/desktop..." --no-frozen-lockfile; then
    log_info "依赖安装完成（no-frozen-lockfile）"
    return
  fi

  log_error "依赖安装失败，且当前缺少可复用的 node_modules，无法继续打包"
  exit 1
}

clean_windows_build_artifacts() {
  log_info "清理 Windows 旧构建和旧静态资源引用"

  rm -rf "${USER_APP_DIR}/dist"
  rm -rf "${TAURI_TARGET_DIR}/release"
  rm -rf "${TAURI_TARGET_DIR}/${WINDOWS_TARGET}"
  rm -f "${TAURI_TARGET_DIR}/.rustc_info.json"

  log_success "已清理："
  printf '  %s\n' "${USER_APP_DIR}/dist"
  printf '  %s\n' "${TAURI_TARGET_DIR}/release"
  printf '  %s\n' "${TAURI_TARGET_DIR}/${WINDOWS_TARGET}"
}

print_frontend_dist_summary() {
  local index_file

  index_file="${USER_APP_DIR}/dist/index.html"
  if [[ ! -f "${index_file}" ]]; then
    log_error "前端构建产物缺少 index.html: ${index_file}"
    exit 1
  fi

  log_success "当前前端产物："
  printf '  %s\n' "${index_file}"
  sed -n '1,20p' "${index_file}"
}

build_portable_zip() {
  local version
  local zip_path
  local exe_path_win
  local zip_path_win

  if [[ ! -f "${APP_EXE_PATH}" ]]; then
    log_warn "未找到桌面端 exe，跳过 ZIP 产物生成"
    return
  fi

  version="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
  zip_path="${BUNDLE_DIR}/zip/CodingNS Desktop_${version}_x64_portable.zip"

  mkdir -p "${BUNDLE_DIR}/zip"
  rm -f "${zip_path}"
  exe_path_win="$(cygpath -w "${APP_EXE_PATH}")"
  zip_path_win="$(cygpath -w "${zip_path}")"

  log_info "生成 ZIP 便携包"
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path '${exe_path_win}' -DestinationPath '${zip_path_win}' -Force" \
    >/dev/null

  log_success "ZIP 便携包："
  printf '  %s\n' "${zip_path}"
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

  if compgen -G "${BUNDLE_DIR}/zip/*.zip" >/dev/null; then
    found=1
    log_success "ZIP 便携包："
    for file in "${BUNDLE_DIR}"/zip/*.zip; do
      printf '  %s\n' "$file"
    done
  fi

  if [[ "${found}" -eq 0 ]]; then
    log_warn "构建已执行，但没有在默认 bundle 目录找到 Windows 产物"
    log_warn "请检查: ${BUNDLE_DIR}"
  fi
}

main() {
  log_info "开始构建 Windows 桌面端"
  log_info "仓库目录: ${REPO_DIR}"
  log_info "桌面端目录: ${DESKTOP_DIR}"

  if ! is_windows_shell; then
    log_error "这个脚本只能在 Windows 环境下执行，请使用 Git Bash、MSYS2 或 Cygwin"
    exit 1
  fi

  require_command node
  require_command pnpm
  require_command rustup
  require_command cargo

  ensure_rust_target

  cd "${REPO_DIR}"

  install_build_dependencies
  clean_windows_build_artifacts

  log_info "先构建最新 H5 静态资源"
  pnpm --dir "${USER_APP_DIR}" build
  print_frontend_dist_summary

  log_info "调用当前 desktop 壳执行 Tauri 打包"
  pnpm --dir "${DESKTOP_DIR}" exec tauri build --target "${WINDOWS_TARGET}"

  build_portable_zip

  log_success "Windows 桌面端打包完成"
  print_artifacts
}

main "$@"
