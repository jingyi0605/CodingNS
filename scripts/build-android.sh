#!/bin/bash
#
# CodingNS Android 构建脚本
# 支持 debug / release 两种模式，仅构建 arm64 架构
#
# 用法:
#   ./build-android.sh              # 默认构建 release
#   ./build-android.sh debug        # 构建 debug 版本
#   ./build-android.sh release      # 构建 release 版本（需要签名密钥）
#

set -euo pipefail

# ============================================
# 配置
# ============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_APP_DIR="$REPO_DIR/apps/user-app"
TAURI_DIR="$USER_APP_DIR/src-tauri"
ANDROID_DIR="$TAURI_DIR/gen/android"
KEYSTORE_DIR="$TAURI_DIR/target"
KEYSTORE="$KEYSTORE_DIR/codingns-release.jks"
KEY_PROPERTIES="$ANDROID_DIR/app/key.properties"
KEY_ALIAS="codingns"
KEYSTORE_PASS="codingns123"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================
# 工具函数
# ============================================
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================
# 环境检测与配置
# ============================================
setup_env() {
    # JAVA_HOME: 优先级 环境变量 > brew openjdk@21
    if [[ -z "${JAVA_HOME:-}" ]]; then
        local brew_jdk="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        if [[ -d "$brew_jdk" ]]; then
            export JAVA_HOME="$brew_jdk"
            log_info "JAVA_HOME -> $JAVA_HOME"
        else
            log_error "未找到 JDK，请安装: brew install openjdk@21"
            exit 1
        fi
    fi

    # ANDROID_HOME
    if [[ -z "${ANDROID_HOME:-}" ]]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    fi
    if [[ ! -d "$ANDROID_HOME/cmdline-tools" ]]; then
        log_error "未找到 Android SDK cmdline-tools: $ANDROID_HOME/cmdline-tools"
        log_error "请通过 Android Studio 或 sdkmanager 安装"
        exit 1
    fi

    # NDK_HOME: 自动检测最新稳定版
    if [[ -z "${NDK_HOME:-}" ]]; then
        local ndk_dir="$ANDROID_HOME/ndk"
        if [[ -d "$ndk_dir" ]]; then
            local latest_ndk=$(ls "$ndk_dir" 2>/dev/null | grep -v "rc" | sort -V | tail -1)
            if [[ -n "$latest_ndk" ]]; then
                export NDK_HOME="$ndk_dir/$latest_ndk"
            fi
        fi
    fi

    log_info "JAVA_HOME    = $JAVA_HOME"
    log_info "ANDROID_HOME = $ANDROID_HOME"
    log_info "NDK_HOME     = ${NDK_HOME:-未设置}"
}

# ============================================
# 签名密钥
# ============================================
ensure_keystore() {
    if [[ -f "$KEYSTORE" ]]; then
        log_success "签名密钥已存在: $KEYSTORE"
        return 0
    fi

    log_info "生成 release 签名密钥..."
    mkdir -p "$KEYSTORE_DIR"

    "$JAVA_HOME/bin/keytool" -genkeypair -v \
        -keystore "$KEYSTORE" \
        -keyalg RSA -keysize 2048 -validity 10000 \
        -alias "$KEY_ALIAS" \
        -storepass "$KEYSTORE_PASS" \
        -keypass "$KEYSTORE_PASS" \
        -dname "CN=CodingNS,OU=Dev,O=CodingNS,L=Beijing,ST=Beijing,C=CN"

    log_success "签名密钥已生成: $KEYSTORE"
}

# 写入 key.properties（构建前调用，构建后清理）
write_key_properties() {
    cat > "$KEY_PROPERTIES" << EOF
storeFile=$KEYSTORE
storePassword=$KEYSTORE_PASS
keyAlias=$KEY_ALIAS
keyPassword=$KEYSTORE_PASS
EOF
}

clean_key_properties() {
    rm -f "$KEY_PROPERTIES"
}

# ============================================
# 依赖检查
# ============================================
check_android_targets() {
    local targets=("aarch64-linux-android")
    for t in "${targets[@]}"; do
        if ! rustup target list --installed | grep -q "$t"; then
            log_info "安装 Rust target: $t"
            rustup target add "$t"
        fi
    done
    log_success "Android Rust targets 已就绪"
}

install_deps() {
    cd "$REPO_DIR"

    if [[ -d "$REPO_DIR/node_modules" && -d "$USER_APP_DIR/node_modules" ]]; then
        log_info "工作区依赖已存在，跳过 pnpm install"
        return 0
    fi

    log_info "安装项目依赖..."
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install --no-frozen-lockfile
    log_success "依赖安装完成"
}

# ============================================
# 构建
# ============================================
build_debug() {
    log_info "============================================"
    log_info "构建 Android Debug APK (arm64)"
    log_info "============================================"

    cd "$USER_APP_DIR"
    pnpm tauri android build --debug -t aarch64 --apk
    print_output "debug"
}

build_release() {
    log_info "============================================"
    log_info "构建 Android Release APK (arm64)"
    log_info "============================================"

    ensure_keystore
    write_key_properties

    cd "$USER_APP_DIR"
    pnpm tauri android build -t aarch64 --apk || {
        clean_key_properties
        log_error "构建失败"
        exit 1
    }

    clean_key_properties
    print_output "release"
}

# ============================================
# 输出
# ============================================
print_output() {
    local mode="$1"
    local apk_dir="$ANDROID_DIR/app/build/outputs/apk"

    echo ""
    log_success "============================================"
    log_success "构建完成！"
    log_success "============================================"

    local found=0
    for apk in $(find "$apk_dir" -name "*.apk" 2>/dev/null); do
        local size=$(du -h "$apk" | cut -f1 | tr -d ' ')
        log_success "  $apk  ($size)"
        found=1
    done

    if [[ $found -eq 0 ]]; then
        log_warn "未找到 APK 文件，请检查构建日志"
    fi
}

# ============================================
# 主程序
# ============================================
print_banner() {
    echo ""
    echo "╔═══════════════════════════════════════════╗"
    echo "║      CodingNS Android 构建脚本            ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
}

print_usage() {
    echo "用法:"
    echo "  $0              默认构建 release"
    echo "  $0 debug        构建 debug 版本"
    echo "  $0 release      构建 release 版本（需签名密钥）"
    echo "  $0 help         显示帮助"
    echo ""
    echo "签名密钥位置: $KEYSTORE"
    echo "首次构建 release 会自动生成签名密钥"
    echo ""
}

main() {
    print_banner

    local mode="${1:-release}"

    case "$mode" in
        help|--help|-h)
            print_usage
            exit 0
            ;;
        debug|release)
            ;;
        *)
            log_error "未知模式: $mode (可选: debug | release)"
            exit 1
            ;;
    esac

    setup_env
    check_android_targets
    install_deps

    case "$mode" in
        debug)   build_debug   ;;
        release) build_release ;;
    esac
}

main "$@"
