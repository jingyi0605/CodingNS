#!/bin/bash
#
# CodingNS 一键构建脚本
# 支持 macOS、Windows、Ubuntu 三平台安装包构建
#
# 用法:
#   ./build-desktop.sh              # 构建当前平台
#   ./build-desktop.sh macos        # 仅构建 macOS
#   ./build-desktop.sh windows      # 仅构建 Windows (需要交叉编译环境)
#   ./build-desktop.sh linux        # 仅构建 Linux (需要 Docker 或交叉编译环境)
#   ./build-desktop.sh all          # 尝试构建所有平台
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
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 未安装"
        return 1
    fi
    return 0
}

get_current_platform() {
    case "$(uname -s)" in
        Darwin*)    echo "macos" ;;
        Linux*)     echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)          echo "unknown" ;;
    esac
}

# ============================================
# 环境检查
# ============================================
check_common_deps() {
    log_info "检查通用依赖..."

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

    # aarch64 target
    if ! rustup target list --installed | grep -q "aarch64-apple-darwin"; then
        log_info "添加 aarch64-apple-darwin target..."
        rustup target add aarch64-apple-darwin
    fi

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

build_macos() {
    log_info "============================================"
    log_info "构建 macOS 安装包..."
    log_info "============================================"

    check_macos_deps || true

    cd "$REPO_DIR"

    # 设置 PATH 确保 corepack/pnpm 可用
    export PATH="$HOME/bin:$HOME/.cargo/bin:$PATH"

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
    pnpm --dir apps/desktop build

    # 显示产物
    log_success "macOS 构建完成！"
    echo ""
    log_info "产物位置:"

    if [[ -f "$OUTPUT_DIR/macos/CodingNS.app" ]]; then
        log_success "  .app: $OUTPUT_DIR/macos/CodingNS.app"
    fi

    if compgen -G "$OUTPUT_DIR/dmg/*.dmg" > /dev/null; then
        for dmg in "$OUTPUT_DIR/dmg/"*.dmg; do
            log_success "  .dmg: $dmg"
        done
    fi
}

build_windows() {
    log_info "============================================"
    log_info "构建 Windows 安装包..."
    log_info "============================================"

    check_windows_deps || true

    local current_os="$(get_current_platform)"

    if [[ "$current_os" == "windows" ]]; then
        cd "$REPO_DIR"
        pnpm --dir apps/desktop build -- --target x86_64-pc-windows-msvc

        log_success "Windows 构建完成！"
        echo ""
        log_info "产物位置:"

        if compgen -G "$OUTPUT_DIR/msi/*.msi" > /dev/null; then
            for msi in "$OUTPUT_DIR/msi/"*.msi; do
                log_success "  .msi: $msi"
            done
        fi

        if compgen -G "$OUTPUT_DIR/nsis/*.exe" > /dev/null; then
            for exe in "$OUTPUT_DIR/nsis/"*.exe; do
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
        pnpm --dir apps/desktop build -- --target x86_64-unknown-linux-gnu

        log_success "Linux 构建完成！"
        echo ""
        log_info "产物位置:"

        if compgen -G "$OUTPUT_DIR/deb/*.deb" > /dev/null; then
            for deb in "$OUTPUT_DIR/deb/"*.deb; do
                log_success "  .deb: $deb"
            done
        fi

        if compgen -G "$OUTPUT_DIR/appimage/*.AppImage" > /dev/null; then
            for appimage in "$OUTPUT_DIR/appimage/"*.AppImage; do
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
            pnpm --dir apps/desktop build -- --target x86_64-unknown-linux-gnu
        "

    log_success "Linux Docker 构建完成！"
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
    echo "  $0              构建当前平台"
    echo "  $0 macos        构建 macOS (.app, .dmg)"
    echo "  $0 windows      构建 Windows (.exe, .msi)"
    echo "  $0 linux        构建 Linux (.deb, .AppImage)"
    echo "  $0 all          尝试构建所有平台"
    echo "  $0 help         显示帮助信息"
    echo ""
}

main() {
    print_banner

    local target="${1:-$(get_current_platform)}"

    case "$target" in
        help|--help|-h)
            print_usage
            exit 0
            ;;
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
            # 当前平台
            log_info "检测到当前平台: $(get_current_platform)"
            log_info "目标平台: $target"
            echo ""
            check_common_deps || exit 1
            install_deps

            case "$(get_current_platform)" in
                macos)  build_macos ;;
                linux)  build_linux ;;
                windows) build_windows ;;
                *)      log_error "未知平台"; exit 1 ;;
            esac
            ;;
    esac

    echo ""
    log_success "============================================"
    log_success "构建流程完成"
    log_success "============================================"
}

main "$@"
