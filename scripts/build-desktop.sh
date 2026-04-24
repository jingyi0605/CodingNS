#!/bin/bash
#
# CodingNS 桌面端构建 / 发布脚本
# 支持 macOS、Windows、Ubuntu 三平台安装包构建
# macOS 额外支持 release-macos 阶段：签名、公证、校验
#
# 用法:
#   ./build-desktop.sh                     # 构建当前平台
#   ./build-desktop.sh build              # 构建当前平台
#   ./build-desktop.sh build macos        # 仅构建 macOS
#   ./build-desktop.sh release-macos      # macOS 签名、公证、校验
#   ./build-desktop.sh release-copy       # 一站式构建 + 签名 + 公证 + 复制 macOS 产物
#   ./build-desktop.sh release-macos-copy # macOS 签名、公证、校验后复制（需先 build）
#   ./build-desktop.sh windows            # 兼容旧用法：仅构建 Windows
#   ./build-desktop.sh linux              # 兼容旧用法：仅构建 Linux
#   ./build-desktop.sh all                # 尝试构建所有平台
#

set -euo pipefail

# ============================================
# 配置
# ============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$REPO_DIR/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
OUTPUT_DIR="$TAURI_DIR/target/release/bundle"
MACOS_RELEASE_DIR="$TAURI_DIR/target/release/macos-release"
MACOS_SIGNING_DIR_DEFAULT="$REPO_DIR/.local-secrets/macos-signing"
MACOS_SIGNING_DIR="${MACOS_SIGNING_DIR:-$MACOS_SIGNING_DIR_DEFAULT}"
MACOS_SIGNING_ENV_FILE="$MACOS_SIGNING_DIR/release-macos.env"
MACOS_SIGNING_CSR_FILE="$MACOS_SIGNING_DIR/developer-id-signing.csr.pem"
MACOS_KEYCHAIN_PATH_DEFAULT="$HOME/Library/Keychains/login.keychain-db"
MACOS_KEYCHAIN_PATH="${MACOS_KEYCHAIN_PATH:-$MACOS_KEYCHAIN_PATH_DEFAULT}"
MACOS_CERT_IMPORT_SCRIPT="$REPO_DIR/scripts/import-macos-signing-certificate.sh"
CARGO_HOME_DEFAULT="$REPO_DIR/.cargo-home"
MACOS_RELEASE_COPY_DIR_DEFAULT="$HOME/WorkFile/临时文件"
DESKTOP_UPDATER_MANIFEST_URL_DEFAULT="https://github.com/jingyi0605/CodingNS/releases/latest/download/latest.json"
TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER="__CODINGNS_TAURI_UPDATER_PUBLIC_KEY__"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# 工具函数
# ============================================
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

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 未安装"
        return 1
    fi
    return 0
}

resolve_python_cmd() {
    if command -v python3 &> /dev/null; then
        echo "python3"
        return 0
    fi

    if command -v python &> /dev/null; then
        echo "python"
        return 0
    fi

    log_error "未找到 Python，无法生成临时 Tauri 配置"
    return 1
}

get_current_platform() {
    case "$(uname -s)" in
        Darwin*)    echo "macos" ;;
        Linux*)     echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)          echo "unknown" ;;
    esac
}

ensure_local_tool_paths() {
    local candidates=(
        "/usr/local/bin"
        "/opt/homebrew/bin"
        "$HOME/.cargo/bin"
        "$HOME/bin"
    )
    local dir

    for dir in "${candidates[@]}"; do
        if [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]]; then
            PATH="$dir:$PATH"
        fi
    done

    export PATH
}

ensure_project_cargo_home() {
    if [[ -n "${CARGO_HOME:-}" ]]; then
        return 0
    fi

    export CARGO_HOME="$CARGO_HOME_DEFAULT"
    mkdir -p "$CARGO_HOME"

    cat > "$CARGO_HOME/config.toml" <<'EOF'
[registries.crates-io]
protocol = "sparse"

[source.crates-io]
registry = "sparse+https://index.crates.io/"

[net]
git-fetch-with-cli = true
EOF
}

resolve_desktop_updater_manifest_url() {
    echo "${CODINGNS_TAURI_UPDATER_ENDPOINT:-$DESKTOP_UPDATER_MANIFEST_URL_DEFAULT}"
}

prepare_desktop_temp_dir() {
    local temp_dir="$TAURI_DIR/target/tmp"
    mkdir -p "$temp_dir"
    printf '%s\n' "$temp_dir"
}

validate_desktop_updater_build_env() {
    if [[ -n "${CODINGNS_TAURI_UPDATER_PUBLIC_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
        return 0
    fi
    return 1
}

prepare_desktop_tauri_build_config() {
    local python_cmd
    local temp_dir
    local config_path
    python_cmd="$(resolve_python_cmd)" || return 1
    temp_dir="$(prepare_desktop_temp_dir)" || return 1
    config_path="$temp_dir/tauri-build-config-$$.json"

    if validate_desktop_updater_build_env; then
        # 这个函数会被命令替换捕获输出，日志必须走 stderr，stdout 只保留配置文件路径。
        log_info "检测到 updater 签名密钥，启用自动更新产物生成。" >&2
        "$python_cmd" - "$TAURI_DIR/tauri.conf.json" "$config_path" "${CODINGNS_TAURI_UPDATER_PUBLIC_KEY}" "$(resolve_desktop_updater_manifest_url)" "$TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER" <<'PY'
import json
import sys
from pathlib import Path

source_path, target_path, pubkey, endpoint, placeholder = sys.argv[1:]

with Path(source_path).open("r", encoding="utf-8") as file:
    config = json.load(file)

plugins = config.setdefault("plugins", {})
updater = plugins.setdefault("updater", {})

if updater.get("pubkey") == placeholder or not str(updater.get("pubkey", "")).strip():
    updater["pubkey"] = pubkey.strip()

updater["endpoints"] = [endpoint]

with Path(target_path).open("w", encoding="utf-8") as file:
    json.dump(config, file, ensure_ascii=False, indent=2)
    file.write("\n")
PY
    else
        log_warn "未检测到 updater 签名密钥（CODINGNS_TAURI_UPDATER_PUBLIC_KEY / TAURI_SIGNING_PRIVATE_KEY），跳过自动更新产物生成。" >&2
        "$python_cmd" - "$TAURI_DIR/tauri.conf.json" "$config_path" <<'PY'
import json
import sys
from pathlib import Path

source_path, target_path = sys.argv[1:]

with Path(source_path).open("r", encoding="utf-8") as file:
    config = json.load(file)

config.setdefault("bundle", {})["createUpdaterArtifacts"] = False
plugins = config.setdefault("plugins", {})
if "updater" in plugins:
    del plugins["updater"]

with Path(target_path).open("w", encoding="utf-8") as file:
    json.dump(config, file, ensure_ascii=False, indent=2)
    file.write("\n")
PY
    fi

    printf '%s\n' "$config_path"
}

require_env() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        log_error "缺少环境变量: $name"
        return 1
    fi
    return 0
}

expand_home_path() {
    local raw_path="${1:-}"

    case "$raw_path" in
        "~")
            printf '%s\n' "$HOME"
            ;;
        "~/"*)
            printf '%s/%s\n' "$HOME" "${raw_path#~/}"
            ;;
        *)
            printf '%s\n' "$raw_path"
            ;;
    esac
}

ensure_macos_host() {
    if [[ "$(get_current_platform)" != "macos" ]]; then
        log_error "release-macos 只能在 macOS 上运行"
        exit 1
    fi
}

ensure_rust_target() {
    local target="$1"
    if ! rustup target list --installed | grep -q "^${target}$"; then
        log_info "添加 ${target} target..."
        rustup target add "$target"
    fi
}

resolve_macos_build_target() {
    echo "${MACOS_BUILD_TARGET:-universal-apple-darwin}"
}

resolve_bundle_output_dir() {
    local target="${1:-}"

    if [[ -n "$target" ]]; then
        echo "$TAURI_DIR/target/$target/release/bundle"
    else
        echo "$OUTPUT_DIR"
    fi
}

load_macos_release_env() {
    if [[ -f "$MACOS_SIGNING_ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$MACOS_SIGNING_ENV_FILE"
    fi
}

find_built_macos_app() {
    local bundle_dir
    shopt -s nullglob
    bundle_dir="$(resolve_bundle_output_dir "$(resolve_macos_build_target)")"
    local apps=("$bundle_dir/macos/"*.app)
    shopt -u nullglob

    if (( ${#apps[@]} == 0 )); then
        log_error "未找到 macOS .app 产物，请先执行: $0 build macos"
        return 1
    fi

    printf '%s\n' "${apps[0]}"
}

find_macos_app_binary() {
    local app_path="$1"
    find "$app_path/Contents/MacOS" -maxdepth 1 -type f | head -n 1
}

prepare_macos_release_dir() {
    rm -rf "$MACOS_RELEASE_DIR"
    mkdir -p "$MACOS_RELEASE_DIR"
}

print_macos_build_artifacts() {
    local app_path="$1"
    local bundle_dir

    bundle_dir="$(resolve_bundle_output_dir "$(resolve_macos_build_target)")"

    echo ""
    log_info "产物位置:"

    if [[ -d "$app_path" ]]; then
        log_success "  .app: $app_path"
    fi

    if compgen -G "$bundle_dir/dmg/*.dmg" > /dev/null; then
        for dmg in "$bundle_dir/dmg/"*.dmg; do
            log_success "  .dmg: $dmg"
        done
    fi
}

print_macos_release_artifacts() {
    local app_path="$1"
    local dmg_path="$2"

    echo ""
    log_info "发布产物位置:"
    log_success "  signed app: $app_path"
    log_success "  notarized dmg: $dmg_path"
}

copy_macos_release_artifacts() {
    local copy_root
    local destination_dir
    local release_app_path="$MACOS_RELEASE_DIR/CodingNS.app"
    local release_dmg_path="$MACOS_RELEASE_DIR/CodingNS.dmg"
    local timestamp

    if [[ -n "${CODINGNS_MACOS_RELEASE_COPY_DIR:-}" ]]; then
        copy_root="$(expand_home_path "$CODINGNS_MACOS_RELEASE_COPY_DIR")"
    else
        copy_root="$(expand_home_path "$MACOS_RELEASE_COPY_DIR_DEFAULT")"
        log_warn "未检测到 CODINGNS_MACOS_RELEASE_COPY_DIR，回退到默认目录: $copy_root"
    fi

    timestamp="$(date +%Y%m%d-%H%M%S)"
    destination_dir="$copy_root/CodingNS-macos-notarized-$timestamp"

    if [[ ! -d "$release_app_path" ]]; then
        log_error "未找到 notarized app: $release_app_path"
        return 1
    fi

    if [[ ! -f "$release_dmg_path" ]]; then
        log_error "未找到 notarized dmg: $release_dmg_path"
        return 1
    fi

    log_info "复制 macOS 发布产物到: $destination_dir"
    mkdir -p "$destination_dir"
    rsync -a "$release_app_path" "$destination_dir/"
    cp "$release_dmg_path" "$destination_dir/"

    echo ""
    log_info "复制后的产物位置:"
    log_success "  target dir: $destination_dir"
    log_success "  app: $destination_dir/$(basename "$release_app_path")"
    log_success "  dmg: $destination_dir/$(basename "$release_dmg_path")"
}

resolve_notarytool_args() {
    NOTARYTOOL_ARGS=()

    if [[ -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
        NOTARYTOOL_ARGS+=(--keychain-profile "$APPLE_NOTARY_PROFILE")
        return 0
    fi

    require_env APPLE_ID || return 1
    require_env APPLE_APP_SPECIFIC_PASSWORD || return 1
    require_env APPLE_TEAM_ID || return 1

    NOTARYTOOL_ARGS+=(
        --apple-id "$APPLE_ID"
        --password "$APPLE_APP_SPECIFIC_PASSWORD"
        --team-id "$APPLE_TEAM_ID"
    )
}

print_waiting_for_apple_certificate() {
    log_warn "release-macos 当前停在“等待 Apple 证书”阶段。"

    if [[ -f "$MACOS_SIGNING_CSR_FILE" ]]; then
        log_info "CSR 已生成，可提交到 Apple Developer：$MACOS_SIGNING_CSR_FILE"
    else
        log_warn "本地还没有发现 CSR 文件：$MACOS_SIGNING_CSR_FILE"
    fi

    log_info "拿到 Apple 返回的 Developer ID Application 证书后，运行："
    log_info "  $MACOS_CERT_IMPORT_SCRIPT /path/to/DeveloperIDApplication.cer"

    if [[ -f "$MACOS_SIGNING_ENV_FILE" ]]; then
        log_info "本地签名配置文件位置：$MACOS_SIGNING_ENV_FILE"
    else
        log_info "建议把签名配置写到：$MACOS_SIGNING_ENV_FILE"
    fi
}

check_macos_release_deps() {
    log_info "检查 macOS 发布依赖..."

    local missing=0
    local commands=(codesign security xcrun hdiutil ditto spctl)

    for cmd in "${commands[@]}"; do
        if ! check_command "$cmd"; then
            missing=1
        fi
    done

    if ! xcode-select -p &> /dev/null; then
        log_error "请运行: xcode-select --install"
        missing=1
    fi

    return $missing
}

verify_sign_identity() {
    if [[ -z "${APPLE_SIGN_IDENTITY:-}" ]]; then
        print_waiting_for_apple_certificate
        log_error "缺少 APPLE_SIGN_IDENTITY，当前无法继续签名"
        return 1
    fi

    if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGN_IDENTITY"; then
        log_error "当前钥匙串找不到签名证书: $APPLE_SIGN_IDENTITY"
        log_error "请先把 Developer ID Application 证书导入钥匙串，或修正 APPLE_SIGN_IDENTITY"
        log_info "可使用导入脚本：$MACOS_CERT_IMPORT_SCRIPT"
        return 1
    fi

    return 0
}

prepare_macos_keychain_access() {
    if [[ ! -f "$MACOS_KEYCHAIN_PATH" ]]; then
        log_warn "未找到钥匙串文件，跳过访问权限预处理: $MACOS_KEYCHAIN_PATH"
        return 0
    fi

    if [[ -z "${MACOS_KEYCHAIN_PASSWORD:-}" ]]; then
        log_warn "未配置 MACOS_KEYCHAIN_PASSWORD；如果 login.keychain 已锁定，codesign 可能报 errSecInternalComponent"
        return 0
    fi

    log_info "解锁 macOS 登录钥匙串..."
    security unlock-keychain -p "$MACOS_KEYCHAIN_PASSWORD" "$MACOS_KEYCHAIN_PATH"

    log_info "刷新私钥访问权限，允许 codesign 在 CLI / tmux 下直接取钥..."
    security set-key-partition-list \
        -S apple-tool:,apple:,codesign: \
        -s \
        -k "$MACOS_KEYCHAIN_PASSWORD" \
        "$MACOS_KEYCHAIN_PATH" >/dev/null
}

sign_macos_app() {
    local app_path="$1"

    if [[ -n "${MACOS_ENTITLEMENTS_PATH:-}" ]]; then
        if [[ ! -f "$MACOS_ENTITLEMENTS_PATH" ]]; then
            log_error "MACOS_ENTITLEMENTS_PATH 指向的文件不存在: $MACOS_ENTITLEMENTS_PATH"
            return 1
        fi
    fi

    log_info "对 .app 执行 Developer ID 签名..."
    if [[ -n "${MACOS_ENTITLEMENTS_PATH:-}" ]]; then
        codesign \
            --force \
            --deep \
            --timestamp \
            --options runtime \
            --sign "$APPLE_SIGN_IDENTITY" \
            --entitlements "$MACOS_ENTITLEMENTS_PATH" \
            "$app_path"
    else
        codesign \
            --force \
            --deep \
            --timestamp \
            --options runtime \
            --sign "$APPLE_SIGN_IDENTITY" \
            "$app_path"
    fi
}

verify_macos_signature() {
    local app_path="$1"

    log_info "校验签名完整性..."
    codesign --verify --deep --strict --verbose=2 "$app_path"
}

create_macos_release_dmg() {
    local signed_app_path="$1"
    local app_name
    local staging_dir
    local dmg_path
    local tmp_dmg_path
    local volume_name

    app_name="$(basename "$signed_app_path" .app)"
    dmg_path="$MACOS_RELEASE_DIR/${app_name}.dmg"
    volume_name="${MACOS_DMG_VOLUME_NAME:-$app_name}"

    # 用临时目录和临时 dmg 路径，避免 runner 上已有同名文件句柄或系统索引占用目标路径。
    staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/codingns-macos-dmg-src.XXXXXX")"
    tmp_dmg_path="$(mktemp "${TMPDIR:-/tmp}/${app_name}.XXXXXX.dmg")"

    if [[ -z "$staging_dir" || -z "$tmp_dmg_path" ]]; then
        log_error "创建 DMG 临时目录失败"
        rm -rf "$staging_dir"
        rm -f "$tmp_dmg_path"
        return 1
    fi

    rm -f "$tmp_dmg_path"
    if ! ditto "$signed_app_path" "$staging_dir/${app_name}.app"; then
        log_error "复制 .app 到 DMG staging 目录失败"
        rm -rf "$staging_dir"
        rm -f "$tmp_dmg_path"
        return 1
    fi

    log_info "重新生成用于发布的 DMG..." >&2
    rm -f "$dmg_path"

    if ! hdiutil create \
        -volname "$volume_name" \
        -srcfolder "$staging_dir" \
        -ov \
        -format UDZO \
        "$tmp_dmg_path" > /dev/null; then
        log_error "重新生成 DMG 失败，hdiutil 无法写出镜像"
        rm -rf "$staging_dir"
        rm -f "$tmp_dmg_path"
        return 1
    fi

    if ! mv "$tmp_dmg_path" "$dmg_path"; then
        log_error "无法把临时 DMG 移动到发布目录: $dmg_path"
        rm -rf "$staging_dir"
        rm -f "$tmp_dmg_path"
        return 1
    fi

    rm -rf "$staging_dir"

    echo "$dmg_path"
}

create_macos_release_zip() {
    local signed_app_path="$1"
    local app_name
    local zip_path

    app_name="$(basename "$signed_app_path" .app)"
    zip_path="$MACOS_RELEASE_DIR/${app_name}.zip"

    rm -f "$zip_path"
    log_info "打包用于 app notarization 的 ZIP..." >&2
    ditto -c -k --keepParent "$signed_app_path" "$zip_path"

    echo "$zip_path"
}

sign_macos_dmg() {
    local dmg_path="$1"

    if [[ ! -f "$dmg_path" ]]; then
        log_error "待签名的 DMG 不存在: $dmg_path"
        return 1
    fi

    log_info "对 DMG 执行签名..."
    codesign \
        --force \
        --timestamp \
        --sign "$APPLE_SIGN_IDENTITY" \
        "$dmg_path"
}

notarize_macos_file() {
    local file_path="$1"
    local submit_output
    local submission_id
    local status_output
    local status

    log_info "提交 Apple notarization..."
    submit_output="$(xcrun notarytool submit "$file_path" "${NOTARYTOOL_ARGS[@]}" --no-wait --output-format json)"
    submission_id="$(printf '%s\n' "$submit_output" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

    if [[ -z "$submission_id" ]]; then
        log_error "无法从 notarytool submit 输出中解析 submission id"
        printf '%s\n' "$submit_output"
        return 1
    fi

    log_info "notarization submission id: $submission_id"
    log_info "等待 Apple 完成处理..."
    xcrun notarytool wait "$submission_id" "${NOTARYTOOL_ARGS[@]}" --timeout 30m || true

    status_output="$(xcrun notarytool info "$submission_id" "${NOTARYTOOL_ARGS[@]}" --output-format json)"
    status="$(printf '%s\n' "$status_output" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

    if [[ "$status" != "Accepted" ]]; then
        log_error "notarization 未通过，当前状态: ${status:-unknown}"
        printf '%s\n' "$status_output"
        xcrun notarytool log "$submission_id" "${NOTARYTOOL_ARGS[@]}" || true
        return 1
    fi

    log_success "notarization 已通过: $submission_id"
}

staple_macos_artifact() {
    local path="$1"

    log_info "回写 notarization 票据: $path"
    xcrun stapler staple -v "$path"
}

validate_notarized_macos_release() {
    local app_path="$1"
    local dmg_path="$2"

    log_info "执行最终 Gatekeeper 校验..."
    xcrun stapler validate -v "$dmg_path"
    log_info "复核 .app 签名完整性..."
    codesign --verify --deep --strict --verbose=2 "$app_path"
    spctl --assess --type execute -vv "$app_path"
    spctl --assess --type open --context context:primary-signature -vv "$dmg_path"
}

show_macos_binary_architecture() {
    local app_path="$1"
    local binary_path

    binary_path="$(find_macos_app_binary "$app_path")"
    if [[ -n "$binary_path" ]] && command -v lipo &> /dev/null; then
        log_info "主程序架构信息:"
        lipo -info "$binary_path"
    fi
}

# ============================================
# 环境检查
# ============================================
check_common_deps() {
    log_info "检查通用依赖..."
    ensure_local_tool_paths
    ensure_project_cargo_home

    local missing=0

    # Node.js
    if ! check_command node; then
        log_error "请安装 Node.js 20+ : https://nodejs.org/"
        missing=1
    else
        log_success "Node.js $(node -v)"
    fi

    # pnpm
    if ! check_command pnpm; then
        log_info "安装 pnpm..."
        npm install -g pnpm@10.7.1
    fi
    log_success "pnpm $(pnpm -v)"

    # Rust
    if ! check_command rustc; then
        log_error "请安装 Rust: https://rustup.rs/"
        missing=1
    else
        log_success "Rust $(rustc -V)"
    fi

    if ! check_command cargo; then
        log_error "Cargo 未找到"
        missing=1
    fi

    return $missing
}

check_macos_deps() {
    log_info "检查 macOS 构建依赖..."

    local missing=0

    # Xcode Command Line Tools
    if ! xcode-select -p &> /dev/null; then
        log_error "请运行: xcode-select --install"
        missing=1
    else
        log_success "Xcode Command Line Tools 已安装"
    fi

    case "$(resolve_macos_build_target)" in
        ""|"aarch64-apple-darwin")
            ensure_rust_target "aarch64-apple-darwin"
            ;;
        "x86_64-apple-darwin")
            ensure_rust_target "x86_64-apple-darwin"
            ;;
        "universal-apple-darwin")
            ensure_rust_target "aarch64-apple-darwin"
            ensure_rust_target "x86_64-apple-darwin"
            ;;
        *)
            log_warn "MACOS_BUILD_TARGET=$(resolve_macos_build_target) 未被脚本识别，将直接交给 tauri build 处理"
            ;;
    esac

    return $missing
}

check_windows_deps() {
    log_info "检查 Windows 构建依赖..."

    local missing=0
    local current_os="$(get_current_platform)"

    if [[ "$current_os" != "windows" ]]; then
        log_warn "当前不在 Windows 系统，交叉编译可能受限"
        log_warn "建议使用 GitHub Actions 或 Windows VM 进行构建"
    fi

    # MSVC target
    if ! rustup target list --installed | grep -q "x86_64-pc-windows-msvc"; then
        log_info "添加 x86_64-pc-windows-msvc target..."
        rustup target add x86_64-pc-windows-msvc
    fi

    return $missing
}

check_linux_deps() {
    log_info "检查 Linux 构建依赖..."

    local missing=0
    local current_os="$(get_current_platform)"

    if [[ "$current_os" != "linux" ]]; then
        log_warn "当前不在 Linux 系统，交叉编译可能受限"
        log_warn "建议使用 Docker 或 GitHub Actions 进行构建"

        # 检查 Docker
        if check_command docker; then
            log_success "Docker 可用，可使用容器构建 Linux 包"
        fi
    else
        # 检查必要的库
        local libs=("libwebkit2gtk-4.1-dev" "libgtk-3-dev" "libayatana-appindicator3-dev" " librsvg2-dev")
        for lib in "${libs[@]}"; do
            if ! dpkg -l "$lib" &> /dev/null 2>&1; then
                log_warn "缺少库: $lib"
                log_info "运行: sudo apt install -y $lib"
            fi
        done
    fi

    # GNU target
    if ! rustup target list --installed | grep -q "x86_64-unknown-linux-gnu"; then
        log_info "添加 x86_64-unknown-linux-gnu target..."
        rustup target add x86_64-unknown-linux-gnu
    fi

    return $missing
}

# ============================================
# 构建函数
# ============================================
install_deps() {
    log_info "安装项目依赖..."
    cd "$REPO_DIR"

    if [[ -d "$REPO_DIR/node_modules" && -d "$REPO_DIR/apps/desktop/node_modules" && -d "$REPO_DIR/apps/user-app/node_modules" ]]; then
        log_info "检测到工作区依赖已存在，跳过 pnpm install。"
        return 0
    fi

    if pnpm install --frozen-lockfile; then
        log_success "依赖安装完成（frozen-lockfile）"
        return 0
    fi

    log_warn "pnpm-lock.yaml 与 package.json 当前不同步，严格安装失败。"
    log_warn "回退到 --no-frozen-lockfile 继续安装，请后续补齐锁文件。"
    if pnpm install --no-frozen-lockfile; then
        log_success "依赖安装完成"
        return 0
    fi

    if [[ -d "$REPO_DIR/node_modules" && -d "$REPO_DIR/apps/desktop/node_modules" && -d "$REPO_DIR/apps/user-app/node_modules" ]]; then
        log_warn "pnpm install 失败，但现有 node_modules 已存在，继续使用当前依赖打包。"
        return 0
    fi

    log_error "依赖安装失败，且当前工作区没有可复用的 node_modules。"
    return 1
}

run_desktop_tauri_build() {
    local target="${1:-}"
    local bundles="${2:-}"
    local config_path
    local status
    local cmd=(pnpm --dir apps/desktop exec tauri build)

    config_path="$(prepare_desktop_tauri_build_config)" || return 1

    if [[ -n "$target" ]]; then
        cmd+=(--target "$target")
    fi

    if [[ -n "$bundles" ]]; then
        cmd+=(--bundles "$bundles")
    fi

    cmd+=(--config "$config_path")

    if PATH=/usr/local/bin:/opt/homebrew/bin:$PATH "${cmd[@]}"; then
        status=0
    else
        status=$?
    fi

    rm -f "$config_path"
    return $status
}

build_macos() {
    log_info "============================================"
    log_info "构建 macOS 安装包..."
    log_info "============================================"

    check_macos_deps || true

    cd "$REPO_DIR"

    # 设置 PATH 确保 corepack/pnpm 可用
    ensure_local_tool_paths
    ensure_project_cargo_home

    # 创建 corepack shim (如果不存在)
    if ! command -v corepack &> /dev/null; then
        mkdir -p ~/bin
        cat > ~/bin/corepack << 'EOF'
#!/bin/bash
if [ "$1" = "pnpm" ]; then shift; fi
exec /opt/homebrew/bin/pnpm "$@"
EOF
        chmod +x ~/bin/corepack
    fi

    # 构建
    local build_target
    build_target="$(resolve_macos_build_target)"

    if [[ -n "$build_target" ]]; then
        log_info "使用 macOS 构建目标: $build_target"
        run_desktop_tauri_build "$build_target" "app"
    else
        run_desktop_tauri_build "" "app"
    fi

    # 显示产物
    log_success "macOS 构建完成！"
    print_macos_build_artifacts "$(find_built_macos_app)"
    show_macos_binary_architecture "$(find_built_macos_app)"
}

release_macos() {
    log_info "============================================"
    log_info "执行 macOS 发布流程（签名 / 公证 / 校验）..."
    log_info "============================================"

    ensure_macos_host
    load_macos_release_env
    check_macos_release_deps || exit 1
    prepare_macos_keychain_access || exit 1
    verify_sign_identity || exit 1
    resolve_notarytool_args || exit 1

    local source_app_path
    local release_app_path
    local release_dmg_path
    local app_name

    source_app_path="$(find_built_macos_app)" || exit 1
    app_name="$(basename "$source_app_path" .app)"

    prepare_macos_release_dir
    release_app_path="$MACOS_RELEASE_DIR/${app_name}.app"

    log_info "复制 build 阶段产物到独立发布目录..."
    ditto "$source_app_path" "$release_app_path"

    sign_macos_app "$release_app_path"
    verify_macos_signature "$release_app_path"

    if ! release_dmg_path="$(create_macos_release_dmg "$release_app_path")"; then
        log_error "DMG 生成失败，终止后续签名和公证"
        return 1
    fi
    sign_macos_dmg "$release_dmg_path"
    notarize_macos_file "$release_dmg_path"

    staple_macos_artifact "$release_dmg_path"
    validate_notarized_macos_release "$release_app_path" "$release_dmg_path"

    log_success "macOS 发布流程完成！"
    print_macos_release_artifacts "$release_app_path" "$release_dmg_path"
}

build_windows() {
    log_info "============================================"
    log_info "构建 Windows 安装包..."
    log_info "============================================"

    check_windows_deps || true

    local current_os="$(get_current_platform)"

    if [[ "$current_os" == "windows" ]]; then
        cd "$REPO_DIR"
        local bundle_dir
        bundle_dir="$(resolve_bundle_output_dir "x86_64-pc-windows-msvc")"
        run_desktop_tauri_build "x86_64-pc-windows-msvc"

        log_success "Windows 构建完成！"
        echo ""
        log_info "产物位置:"

        if compgen -G "$bundle_dir/msi/*.msi" > /dev/null; then
            for msi in "$bundle_dir/msi/"*.msi; do
                log_success "  .msi: $msi"
            done
        fi

        if compgen -G "$bundle_dir/nsis/*.exe" > /dev/null; then
            for exe in "$bundle_dir/nsis/"*.exe; do
                log_success "  .exe: $exe"
            done
        fi
    else
        log_warn "============================================"
        log_warn "跨平台构建建议"
        log_warn "============================================"
        log_warn "Windows 安装包需要在 Windows 系统上构建。"
        log_warn "推荐方案:"
        log_warn ""
        log_warn "1. 使用 GitHub Actions (推荐):"
        log_warn "   - 创建 .github/workflows/build.yml"
        log_warn "   - 使用 windows-latest runner"
        log_warn ""
        log_warn "2. 使用 Windows VM 或双系统"
        log_warn ""
        log_warn "3. 使用 Wine + MSVC (复杂，不推荐)"
        log_warn ""
    fi
}

build_linux() {
    log_info "============================================"
    log_info "构建 Linux (Ubuntu) 安装包..."
    log_info "============================================"

    check_linux_deps || true

    local current_os="$(get_current_platform)"

    if [[ "$current_os" == "linux" ]]; then
        cd "$REPO_DIR"
        local bundle_dir
        bundle_dir="$(resolve_bundle_output_dir "x86_64-unknown-linux-gnu")"
        run_desktop_tauri_build "x86_64-unknown-linux-gnu"

        log_success "Linux 构建完成！"
        echo ""
        log_info "产物位置:"

        if compgen -G "$bundle_dir/deb/*.deb" > /dev/null; then
            for deb in "$bundle_dir/deb/"*.deb; do
                log_success "  .deb: $deb"
            done
        fi

        if compgen -G "$bundle_dir/appimage/*.AppImage" > /dev/null; then
            for appimage in "$bundle_dir/appimage/"*.AppImage; do
                log_success "  .AppImage: $appimage"
            done
        fi
    else
        # 尝试使用 Docker
        if check_command docker; then
            log_info "检测到 Docker，使用容器构建..."
            build_linux_with_docker
        else
            log_warn "============================================"
            log_warn "跨平台构建建议"
            log_warn "============================================"
            log_warn "Linux 安装包需要在 Linux 系统上构建。"
            log_warn "推荐方案:"
            log_warn ""
            log_warn "1. 使用 GitHub Actions (推荐):"
            log_warn "   - 创建 .github/workflows/build.yml"
            log_warn "   - 使用 ubuntu-latest runner"
            log_warn ""
            log_warn "2. 安装 Docker 后使用容器构建"
            log_warn ""
            log_warn "3. 使用 Linux VM"
            log_warn ""
        fi
    fi
}

build_linux_with_docker() {
    log_info "使用 Docker 构建 Linux 包..."

    cd "$REPO_DIR"

    # 使用 Tauri 官方构建镜像
    docker run --rm -v "$REPO_DIR:/app" -w /app \
        -e CARGO_HOME=/app/.cargo-cache \
        ghcr.io/tauri-apps/tauri:1.5 \
        sh -c "
            apt-get update && apt-get install -y nodejs npm
            npm install -g pnpm@10.7.1
            pnpm install --frozen-lockfile
            pnpm --dir apps/desktop exec tauri build --target x86_64-unknown-linux-gnu
        "

    log_success "Linux Docker 构建完成！"
}

# ============================================
# 一站式发布：build macos + release-macos
# ============================================
release_all_macos() {
    log_info "============================================"
    log_info "一站式 macOS 发布（构建 + 签名 + 公证）..."
    log_info "============================================"
    echo ""

    ensure_macos_host
    load_macos_release_env

    # 预检：签名身份是否可用
    log_info "预检签名环境..."
    check_macos_release_deps || exit 1

    if ! verify_sign_identity; then
        log_error "签名证书不可用，请先导入证书："
        log_info "  $MACOS_CERT_IMPORT_SCRIPT /path/to/DeveloperIDApplication.cer"
        log_info "或检查本地配置：$MACOS_SIGNING_ENV_FILE"
        exit 1
    fi

    if ! resolve_notarytool_args; then
        log_error "notarytool 认证参数不可用，请在 $MACOS_SIGNING_ENV_FILE 中配置："
        log_info "  APPLE_NOTARY_PROFILE（推荐）"
        log_info "  或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID"
        exit 1
    fi

    log_success "签名和公证环境预检通过"
    echo ""

    # 构建
    check_common_deps || exit 1
    install_deps
    build_macos

    echo ""
    log_info "构建完成，开始签名和公证流程..."
    echo ""

    # 签名 + 公证
    release_macos
}

release_macos_and_copy() {
    release_macos
    copy_macos_release_artifacts
}

release_all_macos_and_copy() {
    release_all_macos
    copy_macos_release_artifacts
}

# ============================================
# 主程序
# ============================================
print_banner() {
    echo ""
    echo "╔═══════════════════════════════════════════╗"
    echo "║         CodingNS 构建脚本 v1.0            ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
}

print_usage() {
    echo "用法:"
    echo "  $0                         构建当前平台"
    echo "  $0 build                   构建当前平台"
    echo "  $0 build macos             构建 macOS 通用包 (.app)"
    echo "  $0 build windows           构建 Windows (.exe, .msi)"
    echo "  $0 build linux             构建 Linux (.deb, .AppImage)"
    echo "  $0 release                 一站式构建 + 签名 + 公证 macOS 通用包"
    echo "  $0 release-macos           macOS 签名、公证、校验（需先 build）"
    echo "  $0 release-copy            一站式构建 + 签名 + 公证，并复制到目标目录"
    echo "  $0 release-macos-copy      macOS 签名、公证、校验后复制（需先 build）"
    echo "  $0 macos                   兼容旧用法：构建 macOS"
    echo "  $0 windows                 兼容旧用法：构建 Windows"
    echo "  $0 linux                   兼容旧用法：构建 Linux"
    echo "  $0 all                     尝试构建所有平台"
    echo "  $0 help                    显示帮助信息"
    echo ""
    echo "release / release-macos 需要的环境变量："
    echo "  APPLE_SIGN_IDENTITY        例如: Developer ID Application: Your Name (TEAMID)"
    echo "  APPLE_NOTARY_PROFILE       可选，notarytool 的 keychain profile"
    echo "  APPLE_ID                   未使用 APPLE_NOTARY_PROFILE 时必填"
    echo "  APPLE_APP_SPECIFIC_PASSWORD 未使用 APPLE_NOTARY_PROFILE 时必填"
    echo "  APPLE_TEAM_ID              未使用 APPLE_NOTARY_PROFILE 时必填"
    echo "  MACOS_KEYCHAIN_PASSWORD    可选，login.keychain 密码；CLI/tmux 签名失败时建议提供"
    echo "  MACOS_KEYCHAIN_PATH        可选，默认 $HOME/Library/Keychains/login.keychain-db"
    echo "  MACOS_ENTITLEMENTS_PATH    可选，自定义 entitlements 文件"
    echo "  MACOS_BUILD_TARGET         可选，默认 universal-apple-darwin"
    echo "  CODINGNS_MACOS_RELEASE_COPY_DIR  可选，release-copy / release-macos-copy 的复制目标目录"
    echo "  默认复制目录                    $MACOS_RELEASE_COPY_DIR_DEFAULT"
    echo "  默认本地配置文件           $MACOS_SIGNING_ENV_FILE"
    echo ""
    echo "本地签名证书导入："
    echo "  $MACOS_CERT_IMPORT_SCRIPT /path/to/DeveloperIDApplication.cer"
    echo ""
}

run_build_target() {
    local target="${1:-$(get_current_platform)}"

    case "$target" in
        macos|darwin|osx)
            check_common_deps || exit 1
            install_deps
            build_macos
            ;;
        windows|win|msvc)
            check_common_deps || exit 1
            install_deps
            build_windows
            ;;
        linux|ubuntu|debian)
            check_common_deps || exit 1
            install_deps
            build_linux
            ;;
        all)
            check_common_deps || exit 1
            install_deps
            build_macos
            build_windows
            build_linux
            ;;
        *)
            log_error "未知构建目标: $target"
            exit 1
            ;;
    esac
}

main() {
    print_banner

    local target="${1:-$(get_current_platform)}"
    local build_target="${2:-$(get_current_platform)}"

    case "$target" in
        help|--help|-h)
            print_usage
            exit 0
            ;;
        build)
            log_info "执行构建阶段"
            log_info "目标平台: $build_target"
            echo ""
            run_build_target "$build_target"
            ;;
        release)
            release_all_macos
            ;;
        release-macos)
            release_macos
            ;;
        release-copy)
            release_all_macos_and_copy
            ;;
        release-macos-copy)
            release_macos_and_copy
            ;;
        macos|darwin|osx|windows|win|msvc|linux|ubuntu|debian|all)
            log_info "兼容旧用法，默认进入构建阶段"
            log_info "目标平台: $target"
            echo ""
            run_build_target "$target"
            ;;
        *)
            # 当前平台
            log_info "检测到当前平台: $(get_current_platform)"
            log_info "目标平台: $target"
            echo ""
            run_build_target "$(get_current_platform)"
            ;;
    esac

    echo ""
    log_success "============================================"
    log_success "脚本执行完成"
    log_success "============================================"
}

main "$@"
