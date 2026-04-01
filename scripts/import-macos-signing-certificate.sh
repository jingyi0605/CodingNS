#!/bin/bash
#
# 将 Apple 返回的 Developer ID Application 证书与本地私钥组装成可用签名身份
#
# 用法:
#   ./import-macos-signing-certificate.sh /path/to/DeveloperIDApplication.cer
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MACOS_SIGNING_DIR="${MACOS_SIGNING_DIR:-$REPO_DIR/.local-secrets/macos-signing}"
KEY_PATH="$MACOS_SIGNING_DIR/developer-id-signing.key.pem"
CSR_PATH="$MACOS_SIGNING_DIR/developer-id-signing.csr.pem"
CER_PATH="$MACOS_SIGNING_DIR/apple-developer-id-application.cer"
PEM_PATH="$MACOS_SIGNING_DIR/apple-developer-id-application.pem"
P12_PATH="$MACOS_SIGNING_DIR/apple-developer-id-application.p12"
ENV_PATH="$MACOS_SIGNING_DIR/release-macos.env"
KEYCHAIN_PATH="${MACOS_KEYCHAIN_PATH:-$HOME/Library/Keychains/login.keychain-db}"

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

require_file() {
    local path="$1"
    local label="$2"

    if [[ ! -f "$path" ]]; then
        log_error "${label}不存在: $path"
        exit 1
    fi
}

resolve_input_cert() {
    if [[ $# -ge 1 ]]; then
        echo "$1"
        return 0
    fi

    if [[ -f "$CER_PATH" ]]; then
        echo "$CER_PATH"
        return 0
    fi

    log_error "请传入 Apple 返回的 Developer ID Application 证书路径"
    echo "用法: $0 /path/to/DeveloperIDApplication.cer"
    exit 1
}

convert_cert_to_pem() {
    local input_cert="$1"

    cp "$input_cert" "$CER_PATH"

    if openssl x509 -inform DER -in "$CER_PATH" -out "$PEM_PATH" 2>/dev/null; then
        return 0
    fi

    if openssl x509 -in "$CER_PATH" -out "$PEM_PATH" 2>/dev/null; then
        return 0
    fi

    log_error "无法解析证书格式: $input_cert"
    exit 1
}

extract_identity_name() {
    local subject

    subject="$(openssl x509 -in "$PEM_PATH" -noout -subject -nameopt RFC2253)"
    echo "$subject" | sed -E 's/^subject=.*CN=([^,]+).*/\1/'
}

write_release_env() {
    local identity_name="$1"

    cat > "$ENV_PATH" <<EOF
# macOS release-macos 本地配置
# 该文件位于 .local-secrets 目录下，不会进入 Git

export APPLE_SIGN_IDENTITY='${identity_name}'

# 推荐使用 notarytool 的 keychain profile，避免把密码明文写到文件里
# export APPLE_NOTARY_PROFILE='codingns-notary'

# 如果你暂时没有配置 keychain profile，也可以改用下面三项
# export APPLE_ID='your-apple-id@example.com'
# export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
# export APPLE_TEAM_ID='TEAMID'

# 如果后续需要自定义 entitlements，再取消注释
# export MACOS_ENTITLEMENTS_PATH='${REPO_DIR}/apps/desktop/src-tauri/entitlements.plist'
EOF
}

main() {
    local input_cert
    local identity_name
    local p12_password

    mkdir -p "$MACOS_SIGNING_DIR"
    chmod 700 "$MACOS_SIGNING_DIR"

    input_cert="$(resolve_input_cert "$@")"

    require_file "$KEY_PATH" "本地私钥"
    require_file "$CSR_PATH" "本地 CSR"
    require_file "$input_cert" "Apple 证书"

    convert_cert_to_pem "$input_cert"

    identity_name="$(extract_identity_name)"
    if [[ -z "$identity_name" ]]; then
        log_error "无法从证书中解析签名身份名称"
        exit 1
    fi

    p12_password="${MACOS_P12_PASSWORD:-codingns-import-temp}"
    log_info "组装本地 p12 证书包..."
    openssl pkcs12 -export \
        -inkey "$KEY_PATH" \
        -in "$PEM_PATH" \
        -out "$P12_PATH" \
        -name "$identity_name" \
        -passout "pass:${p12_password}"

    log_info "验证 p12 文件可读性..."
    openssl pkcs12 -in "$P12_PATH" -passin "pass:${p12_password}" -noout >/dev/null

    log_info "导入证书到钥匙串: $KEYCHAIN_PATH"
    security import "$P12_PATH" \
        -f pkcs12 \
        -k "$KEYCHAIN_PATH" \
        -P "$p12_password" \
        -T /usr/bin/codesign \
        -T /usr/bin/security

    if [[ -n "${MACOS_KEYCHAIN_PASSWORD:-}" ]]; then
        log_info "设置钥匙串访问权限，避免 codesign 重复弹框..."
        security set-key-partition-list \
            -S apple-tool:,apple:,codesign: \
            -s \
            -k "$MACOS_KEYCHAIN_PASSWORD" \
            "$KEYCHAIN_PATH" >/dev/null
    else
        log_warn "未提供 MACOS_KEYCHAIN_PASSWORD，首次 codesign 时系统可能弹出钥匙串授权窗口"
    fi

    write_release_env "$identity_name"

    log_success "Developer ID Application 证书已导入"
    log_success "签名身份: $identity_name"
    log_info "本地 release-macos 配置文件: $ENV_PATH"
    log_info "下一步建议："
    log_info "  1. 在 $ENV_PATH 中补齐 notarization 配置"
    log_info "  2. 运行 ./scripts/build-desktop.sh release-macos"
}

main "$@"
