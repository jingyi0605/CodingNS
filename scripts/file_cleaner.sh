#!/bin/bash
#
# 仓库清理脚本
# 作用：
# 1. 扫描仓库里常见的大体积构建产物和运行日志
# 2. 按分类展示可清理内容和占用大小
# 3. 按分类执行清理，并保护 Android release 密钥、桌面签名密钥等敏感文件
#

set -euo pipefail

export LANG="${LANG:-zh_CN.UTF-8}"
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BUILD_CATEGORY="构建数据"
RUNTIME_LOG_CATEGORY="运行日志"

USER_APP_TARGET="$REPO_DIR/apps/user-app/src-tauri/target"
DESKTOP_TARGET="$REPO_DIR/apps/desktop/src-tauri/target"
USER_APP_ANDROID_BUILD="$REPO_DIR/apps/user-app/src-tauri/gen/android/app/build"
USER_APP_ANDROID_GRADLE="$REPO_DIR/apps/user-app/src-tauri/gen/android/.gradle"
USER_APP_ANDROID_BUILDSRC_BUILD="$REPO_DIR/apps/user-app/src-tauri/gen/android/buildSrc/build"
USER_APP_ANDROID_BUILDSRC_GRADLE="$REPO_DIR/apps/user-app/src-tauri/gen/android/buildSrc/.gradle"
USER_APP_APPLE_EXTERNALS="$REPO_DIR/apps/user-app/src-tauri/gen/apple/Externals"
DESKTOP_GEN="$REPO_DIR/apps/desktop/src-tauri/gen"

SUMMARY_RUNTIME_DIR="$REPO_DIR/apps/host/data/host/butler-runtime/summary-codex-home"

ANDROID_RELEASE_KEYSTORE="$USER_APP_TARGET/codingns-release.jks"
ANDROID_RELEASE_KEY_PROPERTIES="$REPO_DIR/apps/user-app/src-tauri/gen/android/app/key.properties"

MACOS_SECRETS_DIR="$REPO_DIR/.local-secrets/macos-signing"
UPDATER_SECRETS_DIR="$REPO_DIR/.local-secrets/updater"

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

format_bytes() {
    local bytes="$1"
    awk -v size="$bytes" '
        function human(x) {
            split("B KB MB GB TB PB", units, " ");
            unit = 1;
            while (x >= 1024 && unit < 6) {
                x /= 1024;
                unit++;
            }
            if (unit == 1) {
                return sprintf("%d%s", x, units[unit]);
            }
            return sprintf("%.1f%s", x, units[unit]);
        }
        BEGIN { print human(size); }
    '
}

path_size_bytes() {
    local path="$1"
    if [[ ! -e "$path" ]]; then
        echo 0
        return 0
    fi

    local size
    size="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
    if [[ -z "$size" ]]; then
        echo 0
        return 0
    fi
    echo $(( size * 1024 ))
}

sum_sizes() {
    local total=0
    local path
    for path in "$@"; do
        total=$(( total + $(path_size_bytes "$path") ))
    done
    echo "$total"
}

print_category_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

print_path_line() {
    local path="$1"
    local label="$2"
    local bytes
    bytes="$(path_size_bytes "$path")"
    if [[ "$bytes" -eq 0 ]]; then
        return 0
    fi
    printf '  - %-20s %8s  %s\n' "$label" "$(format_bytes "$bytes")" "${path#$REPO_DIR/}"
}

build_category_size() {
    sum_sizes \
        "$USER_APP_TARGET" \
        "$DESKTOP_TARGET" \
        "$USER_APP_ANDROID_BUILD" \
        "$USER_APP_ANDROID_GRADLE" \
        "$USER_APP_ANDROID_BUILDSRC_BUILD" \
        "$USER_APP_ANDROID_BUILDSRC_GRADLE" \
        "$USER_APP_APPLE_EXTERNALS" \
        "$DESKTOP_GEN"
}

runtime_log_category_size() {
    sum_sizes \
        "$SUMMARY_RUNTIME_DIR/logs_1.sqlite" \
        "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-wal" \
        "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-shm"
}

show_build_category() {
    local total
    total="$(build_category_size)"
    print_category_header "${BUILD_CATEGORY}（$(format_bytes "$total")）"
    print_path_line "$USER_APP_TARGET" "user target"
    print_path_line "$DESKTOP_TARGET" "desktop target"
    print_path_line "$USER_APP_ANDROID_BUILD" "android build"
    print_path_line "$USER_APP_ANDROID_GRADLE" "android .gradle"
    print_path_line "$USER_APP_ANDROID_BUILDSRC_BUILD" "buildSrc build"
    print_path_line "$USER_APP_ANDROID_BUILDSRC_GRADLE" "buildSrc .gradle"
    print_path_line "$USER_APP_APPLE_EXTERNALS" "apple Externals"
    print_path_line "$DESKTOP_GEN" "desktop gen"

    if [[ -f "$ANDROID_RELEASE_KEYSTORE" ]]; then
        printf '  - %-20s %8s  %s\n' "保护文件" "$(format_bytes "$(path_size_bytes "$ANDROID_RELEASE_KEYSTORE")")" "${ANDROID_RELEASE_KEYSTORE#$REPO_DIR/}"
    fi
    if [[ -f "$ANDROID_RELEASE_KEY_PROPERTIES" ]]; then
        printf '  - %-20s %8s  %s\n' "保护文件" "$(format_bytes "$(path_size_bytes "$ANDROID_RELEASE_KEY_PROPERTIES")")" "${ANDROID_RELEASE_KEY_PROPERTIES#$REPO_DIR/}"
    fi
}

show_runtime_log_category() {
    local total
    total="$(runtime_log_category_size)"
    print_category_header "${RUNTIME_LOG_CATEGORY}（$(format_bytes "$total")）"
    print_path_line "$SUMMARY_RUNTIME_DIR/logs_1.sqlite" "sqlite"
    print_path_line "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-wal" "sqlite wal"
    print_path_line "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-shm" "sqlite shm"
}

show_secret_guards() {
    print_category_header "保护规则"
    echo "  - 不删除 Android release 密钥：${ANDROID_RELEASE_KEYSTORE#$REPO_DIR/}"
    echo "  - 不删除 Android key.properties：${ANDROID_RELEASE_KEY_PROPERTIES#$REPO_DIR/}"
    echo "  - 不删除桌面签名密钥目录：${MACOS_SECRETS_DIR#$REPO_DIR/}"
    echo "  - 不删除桌面 updater 密钥目录：${UPDATER_SECRETS_DIR#$REPO_DIR/}"
}

show_selected_summary() {
    local label="$1"
    local total_bytes="$2"

    print_category_header "汇总"
    printf '  - %-20s %8s\n' "$label" "$(format_bytes "$total_bytes")"
}

scan_build_data() {
    print_info "开始检查 $BUILD_CATEGORY..."
    show_build_category
    show_secret_guards
    show_selected_summary "$BUILD_CATEGORY" "$(build_category_size)"
}

scan_runtime_logs() {
    print_info "开始检查 $RUNTIME_LOG_CATEGORY..."
    show_runtime_log_category
    show_secret_guards
    show_selected_summary "$RUNTIME_LOG_CATEGORY" "$(runtime_log_category_size)"
}

scan_repository() {
    print_info "开始检查仓库可清理内容..."
    show_build_category
    show_runtime_log_category
    show_secret_guards

    local build_total runtime_total overall_total
    build_total="$(build_category_size)"
    runtime_total="$(runtime_log_category_size)"
    overall_total=$(( build_total + runtime_total ))

    print_category_header "汇总"
    printf '  - %-20s %8s\n' "$BUILD_CATEGORY" "$(format_bytes "$build_total")"
    printf '  - %-20s %8s\n' "$RUNTIME_LOG_CATEGORY" "$(format_bytes "$runtime_total")"
    printf '  - %-20s %8s\n' "总计可清理" "$(format_bytes "$overall_total")"
}

safe_remove_path() {
    local path="$1"
    if [[ ! -e "$path" ]]; then
        return 0
    fi

    case "$path" in
        "$MACOS_SECRETS_DIR"|"$UPDATER_SECRETS_DIR"|"$ANDROID_RELEASE_KEYSTORE"|"$ANDROID_RELEASE_KEY_PROPERTIES")
            print_warn "保护路径，跳过删除：${path#$REPO_DIR/}"
            return 0
            ;;
    esac

    rm -rf "$path"
    print_success "已删除：${path#$REPO_DIR/}"
}

clean_user_target_preserve_keystore() {
    if [[ ! -d "$USER_APP_TARGET" ]]; then
        return 0
    fi

    print_info "清理 user-app target，保留 Android release 密钥"
    local item
    shopt -s nullglob dotglob
    for item in "$USER_APP_TARGET"/*; do
        case "$item" in
            "$ANDROID_RELEASE_KEYSTORE")
                print_warn "保留密钥：${item#$REPO_DIR/}"
                ;;
            *)
                rm -rf "$item"
                print_success "已删除：${item#$REPO_DIR/}"
                ;;
        esac
    done
    shopt -u nullglob dotglob
}

clean_build_data() {
    print_info "开始清理 $BUILD_CATEGORY"
    clean_user_target_preserve_keystore
    safe_remove_path "$DESKTOP_TARGET"
    safe_remove_path "$USER_APP_ANDROID_BUILD"
    safe_remove_path "$USER_APP_ANDROID_GRADLE"
    safe_remove_path "$USER_APP_ANDROID_BUILDSRC_BUILD"
    safe_remove_path "$USER_APP_ANDROID_BUILDSRC_GRADLE"
    safe_remove_path "$USER_APP_APPLE_EXTERNALS"
    safe_remove_path "$DESKTOP_GEN"
    print_success "$BUILD_CATEGORY 清理完成"
}

clean_runtime_logs() {
    print_info "开始清理 $RUNTIME_LOG_CATEGORY"
    safe_remove_path "$SUMMARY_RUNTIME_DIR/logs_1.sqlite"
    safe_remove_path "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-wal"
    safe_remove_path "$SUMMARY_RUNTIME_DIR/logs_1.sqlite-shm"
    print_success "$RUNTIME_LOG_CATEGORY 清理完成"
}

confirm_action() {
    local prompt="$1"
    read -r -p "$prompt [y/N]: " answer
    case "$answer" in
        y|Y|yes|YES)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

show_menu() {
    echo ""
    echo "请选择操作："
    echo "1. 仓库检查"
    echo "2. 清理构建数据"
    echo "3. 清理运行日志"
    echo "4. 清理全部"
    echo "0. 退出"
}

main() {
    cd "$REPO_DIR"

    while true; do
        show_menu
        read -r -p "输入选项编号: " choice

        case "$choice" in
            1)
                scan_repository
                ;;
            2)
                scan_build_data
                if confirm_action "确认只清理 $BUILD_CATEGORY 吗？本次不会清理 $RUNTIME_LOG_CATEGORY"; then
                    clean_build_data
                else
                    print_warn "已取消清理"
                fi
                ;;
            3)
                scan_runtime_logs
                if confirm_action "确认只清理 $RUNTIME_LOG_CATEGORY 吗？本次不会清理 $BUILD_CATEGORY"; then
                    clean_runtime_logs
                else
                    print_warn "已取消清理"
                fi
                ;;
            4)
                scan_repository
                if confirm_action "确认清理全部可清理分类吗？"; then
                    clean_build_data
                    clean_runtime_logs
                else
                    print_warn "已取消清理"
                fi
                ;;
            0)
                print_info "退出"
                exit 0
                ;;
            *)
                print_error "无效选项：$choice"
                ;;
        esac
    done
}

main "$@"
