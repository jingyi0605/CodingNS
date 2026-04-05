#!/bin/bash
#
# CodingNS iOS 手动编译脚本
#
# 用法:
#   ./scripts/build-ios.sh
#   ./scripts/build-ios.sh --run
#   ./scripts/build-ios.sh --no-open-xcode
#   ./scripts/build-ios.sh --release
#   ./scripts/build-ios.sh --debug
#   ./scripts/build-ios.sh --simulator "iPhone 17 Pro"
#   ./scripts/build-ios.sh --archive
#   ./scripts/build-ios.sh --archive --export
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_APP_DIR="$REPO_DIR/apps/user-app"
TAURI_DIR="$USER_APP_DIR/src-tauri"
IOS_PROJECT_DIR="$TAURI_DIR/gen/apple"
IOS_PROJECT_PATH="$IOS_PROJECT_DIR/app.xcodeproj"
IOS_PROJECT_SPEC_PATH="$SCRIPT_DIR/user-app-ios-project.yml"
TAURI_CONFIG_PATH="$TAURI_DIR/tauri.conf.json"
DERIVED_DATA_DIR="$TAURI_DIR/target/ios-derived-data"
APP_NAME="CodingNS"
BUNDLE_ID="com.codingns.userapp"
IOS_ASSETS_DIR="$IOS_PROJECT_DIR/assets"
IOS_APPICON_DIR="$IOS_PROJECT_DIR/Assets.xcassets/AppIcon.appiconset"
IOS_ICON_SOURCE_PATH="$TAURI_DIR/icons/icon.png"
IOS_ICON_BACKGROUND_TOP="#07111f"
IOS_ICON_BACKGROUND_BOTTOM="#173e9a"
IOS_ICON_FOREGROUND_SIZE=860
SIMULATOR_NAME="iPhone 17 Pro Max"
BUILD_CONFIGURATION="release"
OPEN_XCODE=1
RUN_AFTER_BUILD=0
ARCHIVE_BUILD=0
EXPORT_BUILD=0
ARCHIVE_PATH="$TAURI_DIR/target/ios-archive"
EXPORT_PATH="$TAURI_DIR/target/ios-export"
EXPORT_OPTIONS="$IOS_PROJECT_DIR/ExportOptions.plist"
MARKETING_VERSION=""
IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-}"
IOS_DEVELOPMENT_TEAM=""

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

usage() {
  sed -n '1,12p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      RUN_AFTER_BUILD=1
      shift
      ;;
    --open-xcode)
      OPEN_XCODE=1
      shift
      ;;
    --no-open-xcode)
      OPEN_XCODE=0
      shift
      ;;
    --release)
      BUILD_CONFIGURATION="release"
      shift
      ;;
    --debug)
      BUILD_CONFIGURATION="debug"
      shift
      ;;
    --simulator)
      SIMULATOR_NAME="${2:-}"
      if [[ -z "$SIMULATOR_NAME" ]]; then
        log_error "--simulator 需要传入模拟器名称"
        exit 1
      fi
      shift 2
      ;;
    --archive)
      ARCHIVE_BUILD=1
      shift
      ;;
    --export)
      EXPORT_BUILD=1
      ARCHIVE_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "未知参数: $1"
      usage
      exit 1
      ;;
  esac
done

export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "缺少命令: $1"
    return 1
  fi
}

check_environment() {
  log_info "检查 iOS 编译环境..."

  check_command node
  check_command pnpm
  check_command cargo
  check_command rustup
  check_command xcodebuild
  check_command xcrun
  check_command pod
  check_command xcodegen
  check_command magick

  if [[ ! -d /Applications/Xcode.app ]]; then
    log_error "未找到 /Applications/Xcode.app"
    exit 1
  fi

  xcodebuild -version >/dev/null

  if ! rustup target list --installed | grep -q '^aarch64-apple-ios-sim$'; then
    log_info "安装 Rust iOS Simulator target..."
    rustup target add aarch64-apple-ios-sim
  fi

  if [[ ! -d "$IOS_PROJECT_DIR" ]]; then
    log_warn "未找到 iOS 工程，开始初始化..."
    pnpm --dir "$USER_APP_DIR" exec tauri ios init --ci
  fi

  if [[ ! -d "$IOS_PROJECT_PATH" ]]; then
    log_error "未找到 iOS 工程文件: $IOS_PROJECT_PATH"
    exit 1
  fi
}

read_tauri_string() {
  local js_expr="$1"

  node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expr = process.argv[2];
    const value = Function("config", `return (${expr});`)(config);
    process.stdout.write(value == null ? "" : String(value));
  ' "$TAURI_CONFIG_PATH" "$js_expr"
}

load_ios_build_metadata() {
  if [[ ! -f "$TAURI_CONFIG_PATH" ]]; then
    log_error "未找到 Tauri 配置文件: $TAURI_CONFIG_PATH"
    exit 1
  fi

  MARKETING_VERSION="$(read_tauri_string 'config.version')"
  IOS_DEVELOPMENT_TEAM="$(read_tauri_string 'config.bundle?.iOS?.developmentTeam')"

  if [[ -z "$IOS_BUILD_NUMBER" ]]; then
    IOS_BUILD_NUMBER="$(read_tauri_string 'config.bundle?.iOS?.bundleVersion')"
  fi

  if [[ -z "$MARKETING_VERSION" ]]; then
    log_error "tauri.conf.json 缺少 version"
    exit 1
  fi

  if [[ -z "$IOS_DEVELOPMENT_TEAM" ]]; then
    log_error "tauri.conf.json 缺少 bundle.iOS.developmentTeam"
    exit 1
  fi

  if [[ -z "$IOS_BUILD_NUMBER" ]]; then
    log_error "缺少 iOS 构建号。请在 tauri.conf.json 的 bundle.iOS.bundleVersion 中配置，或通过 IOS_BUILD_NUMBER 传入。"
    exit 1
  fi
}

validate_ios_build_metadata() {
  if [[ ! "$MARKETING_VERSION" =~ ^[0-9]+(\.[0-9]+){2}$ ]]; then
    log_error "version 必须是三段式 semver，例如 0.1.4。当前值: $MARKETING_VERSION"
    exit 1
  fi

  if [[ ! "$IOS_BUILD_NUMBER" =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]]; then
    log_error "iOS 构建号不合法: $IOS_BUILD_NUMBER"
    log_error "CFBundleVersion 必须以非零数字开头，且每段只能包含数字。建议使用 104、105 或 1.4.0 这类值。"
    exit 1
  fi

  if [[ ! "$IOS_DEVELOPMENT_TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
    log_error "Apple Development Team ID 不合法: $IOS_DEVELOPMENT_TEAM"
    exit 1
  fi
}

sync_ios_project() {
  if [[ ! -f "$IOS_PROJECT_SPEC_PATH" ]]; then
    log_warn "未找到外部 iOS 工程模板，将继续使用生成目录内的 project.yml"
    return
  fi

  log_info "同步 iOS 工程模板，避免生成目录变更丢失..."
  cp "$IOS_PROJECT_SPEC_PATH" "$IOS_PROJECT_DIR/project.yml"
  xcodegen generate --spec "$IOS_PROJECT_DIR/project.yml" --project "$IOS_PROJECT_DIR" >/dev/null
}

sync_export_options() {
  if [[ ! -f "$EXPORT_OPTIONS" ]]; then
    log_error "未找到导出配置: $EXPORT_OPTIONS"
    exit 1
  fi

  /usr/libexec/PlistBuddy -c "Set :teamID $IOS_DEVELOPMENT_TEAM" "$EXPORT_OPTIONS" >/dev/null
}

prepare_ios_app_icons() {
  local temp_dir
  local source_icon_path
  local generated_dir
  local stripped_dir

  if [[ ! -f "$IOS_ICON_SOURCE_PATH" ]]; then
    log_error "未找到 iOS 图标源文件: $IOS_ICON_SOURCE_PATH"
    exit 1
  fi

  if [[ ! -d "$IOS_APPICON_DIR" ]]; then
    log_error "未找到 iOS AppIcon 目录: $IOS_APPICON_DIR"
    exit 1
  fi

  temp_dir="$(mktemp -d)"
  source_icon_path="$temp_dir/ios-app-icon-source.png"
  generated_dir="$temp_dir/generated-icons"
  stripped_dir="$temp_dir/stripped-icons"

  log_info "重新生成 iOS AppIcon，移除透明背景和 alpha 通道..."

  # iOS AppIcon 不能带透明通道，这里先把现有透明图标铺到稳定的渐变底色上。
  magick \
    -size 1024x1024 "gradient:${IOS_ICON_BACKGROUND_TOP}-${IOS_ICON_BACKGROUND_BOTTOM}" \
    \( "$IOS_ICON_SOURCE_PATH" -resize "${IOS_ICON_FOREGROUND_SIZE}x${IOS_ICON_FOREGROUND_SIZE}" \) \
    -gravity center \
    -compose over \
    -composite \
    -alpha remove \
    -alpha off \
    "PNG24:$source_icon_path"

  pnpm --dir "$USER_APP_DIR" exec tauri icon "$source_icon_path" -o "$generated_dir" >/dev/null

  if [[ ! -d "$generated_dir/ios" ]]; then
    log_error "Tauri 未生成 iOS 图标目录: $generated_dir/ios"
    exit 1
  fi

  mkdir -p "$stripped_dir"

  for icon_path in "$generated_dir"/ios/*.png; do
    local icon_name
    icon_name="$(basename "$icon_path")"

    # Tauri 生成的 PNG 即使已经完全不透明，仍然会保留 alpha 通道元数据。
    # Xcode 发布时会直接拒绝，所以这里再明确转成无 alpha 的 PNG24。
    magick "$icon_path" -alpha off "PNG24:$stripped_dir/$icon_name"
  done

  cp "$stripped_dir"/*.png "$IOS_APPICON_DIR/"

  if sips -g hasAlpha "$IOS_APPICON_DIR/AppIcon-512@2x.png" | grep -q "yes"; then
    log_error "iOS AppIcon 仍然包含 alpha 通道，请检查图标生成流程"
    exit 1
  fi

  rm -rf "$temp_dir"
  log_success "iOS AppIcon 已更新为无透明通道版本"
}

validate_ios_app_icons() {
  log_info "校验 iOS AppIcon..."

  if [[ ! -f "$IOS_APPICON_DIR/Contents.json" ]]; then
    log_error "缺少 AppIcon 配置文件: $IOS_APPICON_DIR/Contents.json"
    exit 1
  fi

  if ! grep -q '"idiom" : "ios-marketing"' "$IOS_APPICON_DIR/Contents.json"; then
    log_error "AppIcon 缺少 ios-marketing 1024x1024 图标声明"
    exit 1
  fi

  if [[ ! -f "$IOS_APPICON_DIR/AppIcon-512@2x.png" ]]; then
    log_error "缺少 1024x1024 的营销图标: $IOS_APPICON_DIR/AppIcon-512@2x.png"
    exit 1
  fi

  while IFS= read -r -d '' icon_path; do
    if sips -g hasAlpha "$icon_path" | grep -q "yes"; then
      log_error "检测到带 alpha 通道的 iOS 图标: $icon_path"
      exit 1
    fi
  done < <(find "$IOS_APPICON_DIR" -maxdepth 1 -name '*.png' -print0)
}

build_frontend() {
  log_info "构建前端资源，确保使用当前最新本地代码..."
  pnpm --dir "$USER_APP_DIR" build
}

sync_frontend_assets() {
  local dist_dir="$USER_APP_DIR/dist"

  if [[ ! -f "$dist_dir/index.html" ]]; then
    log_error "前端构建产物缺少 index.html: $dist_dir"
    exit 1
  fi

  log_info "同步前端静态资源到 iOS bundle..."
  mkdir -p "$IOS_ASSETS_DIR"
  rsync -a --delete "$dist_dir/" "$IOS_ASSETS_DIR/"
}

validate_apple_metadata() {
  log_info "校验 Apple 提审元数据..."

  # 这几个 plist 文件只要结构损坏，最糟糕的结果不是本地编不过，
  # 而是上传后被 App Store Connect 直接判成二进制无效。
  plutil -lint "$IOS_PROJECT_DIR/app_iOS/PrivacyInfo.xcprivacy"
  plutil -lint "$IOS_PROJECT_DIR/app_iOS/Info.plist"
  plutil -lint "$IOS_PROJECT_DIR/app_iOS/app_iOS.entitlements"
  plutil -lint "$EXPORT_OPTIONS"

  if grep -q '<key>NSPrivacyTrackingDomains</key>' "$IOS_PROJECT_DIR/app_iOS/PrivacyInfo.xcprivacy"; then
    log_error "当前应用未声明跟踪，但 PrivacyInfo.xcprivacy 里仍然存在 NSPrivacyTrackingDomains"
    exit 1
  fi

  if grep -q 'YOUR_TEAM_ID' "$EXPORT_OPTIONS"; then
    log_error "ExportOptions.plist 里仍然保留了 teamID 占位符"
    exit 1
  fi
}

build_ios() {
  local destination="platform=iOS Simulator,name=$SIMULATOR_NAME"

  log_info "开始编译 iOS 工程..."
  log_info "Scheme: app_iOS"
  log_info "Configuration: $BUILD_CONFIGURATION"
  log_info "Simulator: $SIMULATOR_NAME"
  if [[ "$BUILD_CONFIGURATION" == "release" ]]; then
    log_info "本次将直接使用应用内静态前端资源，不依赖 Vite 开发服务器。"
  else
    log_warn "Debug 配置仍可能依赖 Tauri devUrl；如果前端开发服务器没启动，应用可能白屏。"
  fi

  mkdir -p "$DERIVED_DATA_DIR"

  xcodebuild \
    -project "$IOS_PROJECT_PATH" \
    -scheme app_iOS \
    -configuration "$BUILD_CONFIGURATION" \
    -destination "$destination" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    MARKETING_VERSION="$MARKETING_VERSION" \
    CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
    build
}

archive_ios() {
  log_info "开始 Archive iOS 工程（真机）..."
  log_info "Scheme: app_iOS"
  log_info "Configuration: release"
  log_info "Archive 输出: $ARCHIVE_PATH"

  # 确保安装了真机 Rust target
  if ! rustup target list --installed | grep -q '^aarch64-apple-ios$'; then
    log_info "安装 Rust iOS 真机 target..."
    rustup target add aarch64-apple-ios
  fi

  mkdir -p "$DERIVED_DATA_DIR"
  mkdir -p "$(dirname "$ARCHIVE_PATH")"

  xcodebuild \
    -project "$IOS_PROJECT_PATH" \
    -scheme app_iOS \
    -configuration release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH.xcarchive" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    MARKETING_VERSION="$MARKETING_VERSION" \
    CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
    archive \
    ENABLE_BITCODE=NO

  log_success "Archive 完成: $ARCHIVE_PATH.xcarchive"
}

export_ios() {
  if [[ ! -d "$ARCHIVE_PATH.xcarchive" ]]; then
    log_error "未找到 Archive: $ARCHIVE_PATH.xcarchive，请先执行 --archive"
    exit 1
  fi

  if [[ ! -f "$EXPORT_OPTIONS" ]]; then
    log_error "未找到导出配置: $EXPORT_OPTIONS"
    exit 1
  fi

  log_info "开始导出 IPA..."
  log_info "Archive: $ARCHIVE_PATH.xcarchive"
  log_info "ExportOptions: $EXPORT_OPTIONS"
  log_info "导出目录: $EXPORT_PATH"

  mkdir -p "$EXPORT_PATH"

  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH.xcarchive" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$EXPORT_OPTIONS"

  log_success "IPA 导出完成: $EXPORT_PATH"
}

open_xcode() {
  log_info "打开 Xcode 工程..."
  open -a Xcode "$IOS_PROJECT_PATH"
}

run_in_simulator() {
  local app_path="$DERIVED_DATA_DIR/Build/Products/${BUILD_CONFIGURATION}-iphonesimulator/${APP_NAME}.app"

  if [[ ! -d "$app_path" ]]; then
    log_error "未找到编译产物: $app_path"
    exit 1
  fi

  log_info "启动模拟器..."
  xcrun simctl boot "$SIMULATOR_NAME" >/dev/null 2>&1 || true
  open -a Simulator

  log_info "安装应用到模拟器..."
  xcrun simctl install booted "$app_path"

  log_info "启动应用..."
  xcrun simctl launch booted "$BUNDLE_ID"
}

print_summary() {
  if [[ "$ARCHIVE_BUILD" -eq 1 ]]; then
    log_success "iOS Archive 流程完成"
    echo
    echo "Archive: $ARCHIVE_PATH.xcarchive"
    if [[ "$EXPORT_BUILD" -eq 1 ]]; then
      echo "IPA: $EXPORT_PATH"
    fi
    echo "Version: $MARKETING_VERSION ($IOS_BUILD_NUMBER)"
    echo
    echo "后续步骤:"
    echo "1. 使用 Transporter 上传 IPA 到 App Store Connect"
    echo "2. 登录 App Store Connect 选择构建版本并提交审核"
  else
    local app_path="$DERIVED_DATA_DIR/Build/Products/${BUILD_CONFIGURATION}-iphonesimulator/${APP_NAME}.app"
    log_success "iOS 编译完成"
    echo
    echo "工程路径: $IOS_PROJECT_PATH"
    echo "构建产物: $app_path"
    echo "DerivedData: $DERIVED_DATA_DIR"
    echo "Version: $MARKETING_VERSION ($IOS_BUILD_NUMBER)"
    echo
    echo "说明:"
    echo "1. 这个脚本读取的是您当前磁盘上的本地代码。"
    echo "2. 它会先重新构建前端，再由 Xcode 在编译时重新构建 Rust 部分。"
    echo "3. 它不会自动帮您 git pull，远端最新代码需要您自己先同步。"
    echo "4. 默认使用 release 编译，运行时直接加载应用内静态前端资源。"
    echo "5. 编译成功后默认会自动打开 Xcode 工程，可用 --no-open-xcode 关闭。"
    echo "6. 要构建 App Store 版本，使用 --archive --export 参数。"
  fi
}

main() {
  check_environment
  load_ios_build_metadata
  validate_ios_build_metadata
  sync_ios_project
  sync_export_options
  prepare_ios_app_icons
  validate_ios_app_icons
  build_frontend
  sync_frontend_assets
  validate_apple_metadata

  if [[ "$ARCHIVE_BUILD" -eq 1 ]]; then
    archive_ios
    if [[ "$EXPORT_BUILD" -eq 1 ]]; then
      export_ios
    fi
  else
    build_ios

    if [[ "$OPEN_XCODE" -eq 1 ]]; then
      open_xcode
    fi

    if [[ "$RUN_AFTER_BUILD" -eq 1 ]]; then
      run_in_simulator
    fi
  fi

  print_summary
}

main "$@"
