#!/usr/bin/env bash

set -euo pipefail
shopt -s extglob

PACKAGE_SPEC="${CODINGNS_PACKAGE_SPEC:-@jingyi0605/codingns}"
PM2_PACKAGE_SPEC="${CODINGNS_PM2_PACKAGE_SPEC:-pm2}"
DEFAULT_PORT="${CODINGNS_DEFAULT_PORT:-3002}"
DEFAULT_DATA_DIR="${CODINGNS_DEFAULT_DATA_DIR:-$HOME/.codingns}"
OFFICIAL_NPM_REGISTRY="${CODINGNS_OFFICIAL_REGISTRY:-https://registry.npmjs.org}"
MIRROR_NPM_REGISTRY="${CODINGNS_MIRROR_REGISTRY:-https://registry.npmmirror.com}"
PROCESS_NAME="${CODINGNS_PM2_PROCESS_NAME:-codingns}"
DRY_RUN="${CODINGNS_INSTALL_DRY_RUN:-0}"
REGISTRY_PROBE_PACKAGE_SPEC="${CODINGNS_REGISTRY_PROBE_SPEC:-@openai/codex-sdk}"
WINDOWS_PRIVATE_NODE_VERSION="${CODINGNS_WINDOWS_NODE_VERSION:-22.16.0}"
WINDOWS_PRIVATE_NODE_DIST_BASE="${CODINGNS_WINDOWS_NODE_DIST_BASE:-https://nodejs.org/dist}"
WINDOWS_NODE_PTY_PACKAGE_NAME="${CODINGNS_WINDOWS_NODE_PTY_PACKAGE_NAME:-@codingns/node-pty}"
WINDOWS_BETTER_SQLITE_PACKAGE_NAME="${CODINGNS_WINDOWS_BETTER_SQLITE_PACKAGE_NAME:-better-sqlite3}"

SUPPORTED_CLIS=(
  "claude-code|Claude Code|claude"
  "codex|Codex|codex"
  "opencode|OpenCode|opencode"
  "gemini|Gemini CLI|gemini"
  "kimi|Kimi CLI|kimi"
)

LANG_MODE=""
CLI_SUMMARY_LINES=()
INSTALLED_CLI_COUNT=0
ACTIVE_NPM_REGISTRY=""
NPM_BIN=""
NODE_BIN=""
PM2_BIN=""
CODINGNS_BIN=""
CODINGNS_SCRIPT=""
NPM_GLOBAL_PREFIX=""
USE_SUDO_FOR_NPM="0"
BREW_BIN=""
SELECTED_PORT=""
SELECTED_DATA_DIR=""
INSTALL_CODINGNS="1"
USE_PM2="1"
INSTALL_PM2="1"
START_PM2_SERVICE="1"
ENABLE_STARTUP="1"
PROMPT_INPUT_FD=""
PREREQUISITE_ISSUES=()
INSTALL_OPENCODE="0"
PREREQUISITE_WARNINGS=()
LAST_INSTALL_LOG=""
PRIVATE_INSTALL_CONTEXT="0"
SYSTEM_PATH_SNAPSHOT="${PATH:-}"
SYSTEM_NODE_BIN=""
SYSTEM_NPM_BIN=""
SYSTEM_NODE_VERSION=""
SYSTEM_NODE_ABI=""
TARGET_NODE_VERSION=""
TARGET_NODE_ABI=""
INSTALL_ENV_ARGS=()
RUNTIME_HOME=""
NODE_RUNTIME_ROOT=""
NODE_RUNTIME_VERSIONS_DIR=""
NODE_ACTIVE_META=""
PRIVATE_NODE_VERSION_DIR=""
PRIVATE_NPM_PREFIX=""
PRIVATE_NPM_CACHE_DIR=""
PRIVATE_DOWNLOAD_CACHE_DIR=""
PRIVATE_LOG_DIR=""
PRIVATE_INSTALL_LOG_DIR=""
PRIVATE_PM2_HOME=""
PRIVATE_SERVICE_STATE_DIR=""
PRIVATE_NPM_USERCONFIG=""
PRIVATE_PM2_START_SCRIPT=""
PRIVATE_NODE_SOURCE_URL=""
PRIVATE_NODE_ARCHIVE_SHA256=""
PRIVATE_NPM_CMD=""
PRIVATE_NPX_CMD=""
TARGET_RUNTIME_UNSUPPORTED_PACKAGES=()
TARGET_RUNTIME_FALLBACK_PACKAGES=()
TARGET_RUNTIME_MANAGED_PACKAGE_SUMMARY=()
CODINGNS_PACKAGE_ROOT=""
CODINGNS_PACKAGE_NAME=""
CODINGNS_PACKAGE_VERSION=""
CODINGNS_PTY_PACKAGE_NAME=""
CODINGNS_PTY_PACKAGE_VERSION=""
CODINGNS_BETTER_SQLITE_PACKAGE_NAME=""
CODINGNS_BETTER_SQLITE_PACKAGE_VERSION=""

msg() {
  local key="$1"
  shift || true

  case "${LANG_MODE}:${key}" in
    zh:choose_language_title) printf '请选择安装脚本语言';;
    en:choose_language_title) printf 'Select installer language';;
    zh:choose_language_option_zh) printf '1) 中文';;
    en:choose_language_option_zh) printf '1) 中文';;
    zh:choose_language_option_en) printf '2) English';;
    en:choose_language_option_en) printf '2) English';;
    zh:choose_language_prompt) printf '请输入 1 或 2 [1]: ';;
    en:choose_language_prompt) printf 'Enter 1 or 2 [1]: ';;

    zh:prefix) printf '[codingns-install] ';;
    en:prefix) printf '[codingns-install] ';;

    zh:error_root) printf '不要直接用 sudo 整个执行脚本。请用普通用户运行，脚本会在需要管理员权限时单独请求 sudo。';;
    en:error_root) printf 'Do not run the whole installer with sudo. Run it as a normal user and the script will request sudo only when needed.';;
    zh:error_no_node) printf '未检测到 node，请先安装 Node.js 22 或更高版本。';;
    en:error_no_node) printf 'Node.js was not found. Please install Node.js 22 or later first.';;
    zh:error_no_npm) printf '未检测到 npm，请先安装 npm 10 或更高版本。';;
    en:error_no_npm) printf 'npm was not found. Please install npm 10 or later first.';;
    zh:error_no_make) printf '未检测到 make，Linux 下安装 CodingNS 需要编译工具链。';;
    en:error_no_make) printf 'make was not found. CodingNS installation on Linux needs a native build toolchain.';;
    zh:error_no_cpp_compiler) printf '未检测到 g++，Linux 下安装 CodingNS 需要 C++ 编译器。';;
    en:error_no_cpp_compiler) printf 'g++ was not found. CodingNS installation on Linux needs a C++ compiler.';;
    zh:error_no_python3) printf '未检测到 python3，Linux 下安装 CodingNS 需要 Python 3。';;
    en:error_no_python3) printf 'python3 was not found. CodingNS installation on Linux needs Python 3.';;
    zh:error_bad_node_version) printf '当前 Node.js 版本是 %s，项目要求 >= 22。' "$@";;
    en:error_bad_node_version) printf 'Your current Node.js version is %s, but CodingNS requires >= 22.' "$@";;
    zh:error_bad_npm_version) printf '当前 npm 版本是 %s，项目要求 >= 10。' "$@";;
    en:error_bad_npm_version) printf 'Your current npm version is %s, but CodingNS requires >= 10.' "$@";;
    zh:error_read_node_version) printf '无法识别 Node.js 版本：%s' "$@";;
    en:error_read_node_version) printf 'Unable to detect the Node.js version: %s' "$@";;
    zh:error_read_npm_version) printf '无法识别 npm 版本：%s' "$@";;
    en:error_read_npm_version) printf 'Unable to detect the npm version: %s' "$@";;
    zh:error_read_prefix) printf '无法读取 npm 全局安装目录。';;
    en:error_read_prefix) printf 'Unable to read the npm global install directory.';;
    zh:error_no_sudo) printf 'npm 全局目录不可写，且当前系统没有 sudo，无法继续安装。';;
    en:error_no_sudo) printf 'The npm global directory is not writable and sudo is not available, so the installer cannot continue.';;
    zh:error_port_invalid) printf '端口必须是 1 到 65535 之间的整数。';;
    en:error_port_invalid) printf 'The port must be an integer between 1 and 65535.';;
    zh:error_registry_unavailable) printf '官方 npm 源和国内镜像都不可用，请检查网络后重试。';;
    en:error_registry_unavailable) printf 'Both the official npm registry and the mirror are unavailable. Please check your network and try again.';;
    zh:error_no_codingns_after_install) printf '安装完成后仍未找到 codingns 命令。';;
    en:error_no_codingns_after_install) printf 'The codingns command was still not found after installation.';;
    zh:error_no_pm2_after_install) printf '安装完成后仍未找到 pm2 命令。';;
    en:error_no_pm2_after_install) printf 'The pm2 command was still not found after installation.';;
    zh:error_skip_codingns_without_existing) printf '你跳过了 CodingNS 安装，但当前机器上也没有可用的 codingns 命令。';;
    en:error_skip_codingns_without_existing) printf 'You skipped CodingNS installation, but there is no existing codingns command on this machine.';;
    zh:error_skip_pm2_without_existing) printf '你跳过了 PM2 安装，但当前机器上也没有可用的 pm2 命令。';;
    en:error_skip_pm2_without_existing) printf 'You skipped PM2 installation, but there is no existing pm2 command on this machine.';;
    zh:error_prompt_interrupted) printf '没有读取到终端输入，安装流程已中止。请在交互式终端里重新运行脚本。';;
    en:error_prompt_interrupted) printf 'No terminal input was received. The installation was aborted. Please run the script again in an interactive terminal.';;
    zh:error_prereq_auto_install_cancelled) printf '缺少必备环境，且你没有同意自动安装，安装流程已中止。';;
    en:error_prereq_auto_install_cancelled) printf 'Required dependencies are missing, and automatic installation was not approved. The installation was aborted.';;
    zh:error_prereq_auto_install_unsupported) printf '当前系统暂不支持自动安装必备环境，请先手工安装 Node.js 22+、npm 10+ 和所需编译工具后重试。';;
    en:error_prereq_auto_install_unsupported) printf 'Automatic dependency installation is not supported on this system yet. Please install Node.js 22+, npm 10+, and the required build tools manually, then try again.';;
    zh:error_prereq_auto_install_failed) printf '自动安装必备环境失败，请检查网络、权限或软件源后重试。';;
    en:error_prereq_auto_install_failed) printf 'Automatic dependency installation failed. Please check your network, permissions, or package sources and try again.';;
    zh:error_no_supported_linux_installer) printf '当前 Linux 发行版没有检测到受支持的自动安装方式。暂时只支持 apt-get。';;
    en:error_no_supported_linux_installer) printf 'No supported automatic installer was detected for this Linux distribution. Only apt-get is supported for now.';;
    zh:error_brew_install_failed) printf 'Homebrew 安装或初始化失败，无法继续自动安装 Node.js。';;
    en:error_brew_install_failed) printf 'Homebrew installation or initialization failed, so Node.js cannot be installed automatically.';;
    zh:error_windows_private_node_unsupported_arch) printf '当前 Windows 安装只支持 x64 架构，检测到：%s' "$@";;
    en:error_windows_private_node_unsupported_arch) printf 'This Windows installer currently supports only x64. Detected: %s' "$@";;
    zh:error_windows_private_node_missing_tools) printf '当前 Windows 环境缺少私有 Node.js 运行时所需工具，请先安装 curl 和 unzip，或设置 CODINGNS_WINDOWS_NODE_DIST_BASE 指向已可访问的分发源。';;
    en:error_windows_private_node_missing_tools) printf 'The Windows environment is missing tools required for the private Node.js runtime. Install curl and unzip first, or set CODINGNS_WINDOWS_NODE_DIST_BASE to a reachable distribution source.';;
    zh:error_windows_private_node_download_failed) printf '无法下载 Windows 私有 Node.js 运行时：%s' "$@";;
    en:error_windows_private_node_download_failed) printf 'Unable to download the private Windows Node.js runtime: %s' "$@";;
    zh:error_windows_private_node_extract_failed) printf '无法解压 Windows 私有 Node.js 运行时：%s' "$@";;
    en:error_windows_private_node_extract_failed) printf 'Unable to extract the private Windows Node.js runtime: %s' "$@";;
    zh:error_windows_private_node_incomplete) printf 'Windows 私有 Node.js 运行时不完整：%s' "$@";;
    en:error_windows_private_node_incomplete) printf 'The private Windows Node.js runtime is incomplete: %s' "$@";;
    zh:error_windows_private_node_checksum_missing) printf '无法获取 Windows 私有 Node.js 运行时的 SHA256 校验值：%s' "$@";;
    en:error_windows_private_node_checksum_missing) printf 'Unable to determine the SHA256 checksum for the private Windows Node.js runtime: %s' "$@";;
    zh:error_windows_private_node_checksum_failed) printf 'Windows 私有 Node.js 运行时校验失败：%s' "$@";;
    en:error_windows_private_node_checksum_failed) printf 'The private Windows Node.js runtime checksum verification failed: %s' "$@";;
    zh:error_windows_target_runtime_unsupported) printf '目标私有运行时不受支持：%s' "$@";;
    en:error_windows_target_runtime_unsupported) printf 'The target private runtime is unsupported: %s' "$@";;

    zh:info_need_sudo) printf '检测到 npm 全局目录需要管理员权限，后续全局安装会使用 sudo。';;
    en:info_need_sudo) printf 'The npm global directory needs administrator permission. The installer will use sudo for global installs.';;
    zh:info_intro) printf '这会通过交互式向导安装或更新 %s，并按你的选择配置 PM2。' "$@";;
    en:info_intro) printf 'This interactive installer will install or update %s and configure PM2 only for the steps you choose.' "$@";;
    zh:info_prereq_check_title) printf '开始检查必备运行环境...';;
    en:info_prereq_check_title) printf 'Checking required runtime dependencies...';;
    zh:info_prereq_missing_title) printf '检测到以下必备环境缺失或版本不符合要求：';;
    en:info_prereq_missing_title) printf 'The following required dependencies are missing or do not meet the version requirements:';;
    zh:info_installing_homebrew) printf '未检测到 Homebrew，开始自动安装 Homebrew...';;
    en:info_installing_homebrew) printf 'Homebrew was not found. Installing Homebrew automatically...';;
    zh:info_installing_nodejs) printf '开始自动安装或升级 Node.js 运行环境...';;
    en:info_installing_nodejs) printf 'Installing or upgrading the Node.js runtime automatically...';;
    zh:info_installing_linux_build_tools) printf '开始自动安装 Linux 编译工具链...';;
    en:info_installing_linux_build_tools) printf 'Installing the Linux native build toolchain automatically...';;
    zh:info_installing_pm2_missing) printf '未检测到 PM2，开始自动安装 PM2...';;
    en:info_installing_pm2_missing) printf 'PM2 was not found. Installing PM2 automatically...';;
    zh:info_using_existing_pm2) printf '检测到已有 PM2，继续复用当前安装。';;
    en:info_using_existing_pm2) printf 'An existing PM2 installation was found. Reusing it.';;
    zh:info_auto_install_done) printf '必备环境已准备完成，继续安装流程。';;
    en:info_auto_install_done) printf 'Required dependencies are now ready. Continuing the installation flow.';;
    zh:info_detect_clis) printf '检测当前机器上的受支持 CLI：';;
    en:info_detect_clis) printf 'Checking supported CLI tools on this machine:';;
    zh:info_no_cli) printf '当前没有检测到任何受支持的 CLI。';;
    en:info_no_cli) printf 'No supported CLI tools were detected on this machine.';;
    zh:info_recommend_opencode) printf '建议优先安装 OpenCode：自带免费模型，开箱即用；即使现在先装 CodingNS，后续补装 CLI 也不影响。';;
    en:info_recommend_opencode) printf 'OpenCode is the recommended first CLI to install: it works out of the box with built-in free models, and you can still add more CLI tools later.';;
    zh:info_install_opencode) printf '安装 OpenCode：%s' "$@";;
    en:info_install_opencode) printf 'Install OpenCode: %s' "$@";;
    zh:info_installing_opencode) printf '开始安装 OpenCode...';;
    en:info_installing_opencode) printf 'Installing OpenCode...';;
    zh:info_opencode_installed) printf 'OpenCode 安装流程已执行完成。';;
    en:info_opencode_installed) printf 'The OpenCode installation flow completed.';;
    zh:warn_opencode_install_failed) printf 'OpenCode 安装没有成功，你可以稍后手工执行：curl -fsSL https://opencode.ai/install | bash';;
    en:warn_opencode_install_failed) printf 'OpenCode installation did not complete successfully. You can run this later: curl -fsSL https://opencode.ai/install | bash';;
    zh:warn_opencode_install_requires_curl) printf '当前机器没有检测到 curl，暂时无法自动安装 OpenCode。';;
    en:warn_opencode_install_requires_curl) printf 'curl was not found on this machine, so OpenCode cannot be installed automatically right now.';;
    zh:info_summary_title) printf '安装计划：';;
    en:info_summary_title) printf 'Installation plan:';;
    zh:info_port) printf '服务端口：%s' "$@";;
    en:info_port) printf 'Service port: %s' "$@";;
    zh:info_data_dir) printf '数据目录：%s' "$@";;
    en:info_data_dir) printf 'Data directory: %s' "$@";;
    zh:info_install_codingns) printf '安装或更新 CodingNS：%s' "$@";;
    en:info_install_codingns) printf 'Install or update CodingNS: %s' "$@";;
    zh:info_use_pm2) printf '安装为服务并开机自动启动：%s' "$@";;
    en:info_use_pm2) printf 'Install as a service and start on boot: %s' "$@";;
    zh:info_install_pm2) printf '安装或更新 PM2：%s' "$@";;
    en:info_install_pm2) printf 'Install or update PM2: %s' "$@";;
    zh:info_start_service) printf '用 PM2 启动服务：%s' "$@";;
    en:info_start_service) printf 'Start the service with PM2: %s' "$@";;
    zh:info_startup) printf '配置开机自启：%s' "$@";;
    en:info_startup) printf 'Configure start on boot: %s' "$@";;
    zh:info_begin) printf '开始执行你选中的步骤...';;
    en:info_begin) printf 'Starting the steps you selected...';;
    zh:info_using_official_registry) printf 'npm 源探测结果：使用官方源 %s' "$@";;
    en:info_using_official_registry) printf 'Registry check: using the official npm registry %s' "$@";;
    zh:warn_official_registry_failed) printf '官方 npm 源暂时不可用，准备切换到国内镜像。';;
    en:warn_official_registry_failed) printf 'The official npm registry is temporarily unavailable. Switching to the mirror.';;
    zh:info_using_mirror_registry) printf 'npm 源探测结果：使用镜像源 %s' "$@";;
    en:info_using_mirror_registry) printf 'Registry check: using the mirror %s' "$@";;
    zh:info_installing_codingns) printf '开始安装或更新 CodingNS...';;
    en:info_installing_codingns) printf 'Installing or updating CodingNS...';;
    zh:info_skip_codingns) printf '已跳过 CodingNS 安装，继续使用当前机器上的现有命令。';;
    en:info_skip_codingns) printf 'Skipped CodingNS installation. The installer will use the existing command on this machine.';;
    zh:info_installing_pm2) printf '开始安装或更新 PM2...';;
    en:info_installing_pm2) printf 'Installing or updating PM2...';;
    zh:info_skip_pm2_install) printf '已跳过 PM2 安装，继续使用当前机器上的现有命令。';;
    en:info_skip_pm2_install) printf 'Skipped PM2 installation. The installer will use the existing pm2 command on this machine.';;
    zh:info_existing_pm2_process) printf '检测到已有 PM2 进程 %s，先删除旧配置再重建。' "$@";;
    en:info_existing_pm2_process) printf 'An existing PM2 process named %s was found. The installer will replace it with the new configuration.' "$@";;
    zh:info_skip_pm2_management) printf '已按你的选择跳过 PM2 托管。';;
    en:info_skip_pm2_management) printf 'PM2 management was skipped as requested.';;
    zh:info_skip_service_start) printf '已按你的选择跳过用 PM2 启动服务。';;
    en:info_skip_service_start) printf 'Starting the service with PM2 was skipped as requested.';;
    zh:info_skip_startup) printf '已按你的选择跳过开机自启配置。';;
    en:info_skip_startup) printf 'Start-on-boot configuration was skipped as requested.';;
    zh:warn_no_startup_platform) printf '当前系统未识别到可自动配置的开机自启平台，已跳过这一步。你后续可以手工执行 pm2 startup。';;
    en:warn_no_startup_platform) printf 'This system does not expose a supported start-on-boot platform for automatic setup, so that step was skipped. You can still run pm2 startup manually later.';;
    zh:warn_linux_startup_no_sudo) printf '当前 Linux 平台需要 sudo 才能写入 systemd 启动项，已跳过自动配置。';;
    en:warn_linux_startup_no_sudo) printf 'This Linux machine needs sudo to write the systemd startup entry, so automatic startup setup was skipped.';;
    zh:warn_windows_missing_build_tools) printf '当前是 Windows 环境，但未检测到 Visual Studio C++ Build Tools。CodingNS 依赖 better-sqlite3、node-pty 这类原生模块；如果预编译包下载失败，npm 会回退到本机编译，并要求你先安装 Visual Studio Build Tools 2022，勾选“Desktop development with C++”。';;
    en:warn_windows_missing_build_tools) printf 'This is a Windows environment, but Visual Studio C++ Build Tools were not detected. CodingNS depends on native modules such as better-sqlite3 and node-pty. If the prebuilt binaries cannot be downloaded, npm falls back to local compilation and requires Visual Studio Build Tools 2022 with the "Desktop development with C++" workload.';;
    zh:warn_windows_node24_native_modules) printf '当前是 Windows + Node.js %s。这个组合安装原生模块时更容易暴露预编译包下载或本机编译问题，建议优先使用 Node.js 22 LTS。' "$@";;
    en:warn_windows_node24_native_modules) printf 'You are using Windows + Node.js %s. This combination is more likely to surface native module prebuild or local compilation issues, so Node.js 22 LTS is recommended first.' "$@";;
    zh:warn_windows_registry_not_enough) printf '补充说明：切换 npm 源只会影响 npm 包下载，不会解决 better-sqlite3 或 node-pty 从 GitHub Releases 下载预编译包失败的问题。';;
    en:warn_windows_registry_not_enough) printf 'Important: switching the npm registry only affects npm package downloads. It does not fix failures when better-sqlite3 or node-pty try to download prebuilt binaries from GitHub Releases.';;
    zh:warn_windows_install_failed_vs) printf '安装日志里已经看到 node-gyp 找不到 Visual Studio。请先安装 Visual Studio Build Tools 2022，并勾选“Desktop development with C++”，然后重试。';;
    en:warn_windows_install_failed_vs) printf 'The install log shows that node-gyp could not find Visual Studio. Install Visual Studio Build Tools 2022 with the "Desktop development with C++" workload, then retry.';;
    zh:warn_windows_install_failed_prebuild_network) printf '安装日志里已经看到原生模块预编译包下载失败（例如 ECONNRESET 或 timed out）。这通常是访问 GitHub Releases 失败，不是 npm 源本身的问题。';;
    en:warn_windows_install_failed_prebuild_network) printf 'The install log shows that downloading native prebuilt binaries failed (for example ECONNRESET or timed out). This is usually a GitHub Releases connectivity problem, not an npm registry problem.';;
    zh:warn_windows_using_private_node) printf 'Windows 正式安装将使用 CodingNS 私有 Node.js %s 运行时，系统 Node 仅用于诊断。' "$@";;
    en:warn_windows_using_private_node) printf 'Windows installation will use the private CodingNS Node.js %s runtime. The system Node.js is used for diagnostics only.' "$@";;
    zh:warn_windows_target_runtime_fallback_build) printf '目标私有运行时下，以下原生依赖仍可能回退本机编译：%s' "$@";;
    en:warn_windows_target_runtime_fallback_build) printf 'Under the target private runtime, these native dependencies may still fall back to local compilation: %s' "$@";;
    zh:info_runtime_better_sqlite) printf '实际 SQLite 依赖：%s' "$@";;
    en:info_runtime_better_sqlite) printf 'Runtime SQLite dependency: %s' "$@";;
    zh:warn_windows_system_node_diagnostics) printf '检测到系统 Node.js：%s（ABI %s）' "$@";;
    en:warn_windows_system_node_diagnostics) printf 'Detected system Node.js: %s (ABI %s)' "$@";;
    zh:info_windows_target_runtime_summary) printf '目标私有运行时：Windows x64 + Node.js %s（ABI %s）' "$@";;
    en:info_windows_target_runtime_summary) printf 'Target private runtime: Windows x64 + Node.js %s (ABI %s)' "$@";;
    zh:info_windows_managed_package_summary) printf '受管原生依赖检查：%s' "$@";;
    en:info_windows_managed_package_summary) printf 'Managed native package check: %s' "$@";;
    zh:warn_install_log_path) printf '失败日志位置：%s' "$@";;
    en:warn_install_log_path) printf 'Failure log path: %s' "$@";;
    zh:info_configuring_startup) printf '开始配置 PM2 开机自启（%s）...' "$@";;
    en:info_configuring_startup) printf 'Configuring PM2 to start on boot (%s)...' "$@";;
    zh:info_done) printf '安装流程已完成。';;
    en:info_done) printf 'The installation flow is complete.';;
    zh:info_registry) printf '当前 npm 源：%s' "$@";;
    en:info_registry) printf 'Registry used: %s' "$@";;
    zh:info_runtime_node) printf '实际运行时 Node.js：%s' "$@";;
    en:info_runtime_node) printf 'Runtime Node.js: %s' "$@";;
    zh:info_runtime_prefix) printf '实际 npm 前缀：%s' "$@";;
    en:info_runtime_prefix) printf 'Runtime npm prefix: %s' "$@";;
    zh:info_runtime_pm2_home) printf '实际 PM2 HOME：%s' "$@";;
    en:info_runtime_pm2_home) printf 'Runtime PM2 HOME: %s' "$@";;
    zh:info_runtime_pty) printf '实际 PTY 依赖：%s' "$@";;
    en:info_runtime_pty) printf 'Runtime PTY dependency: %s' "$@";;
    zh:info_access_title) printf '访问方式：';;
    en:info_access_title) printf 'Access:';;
    zh:info_process_name) printf 'PM2 进程名称：%s' "$@";;
    en:info_process_name) printf 'PM2 process name: %s' "$@";;
    zh:info_service_url) printf '浏览器或客户端连接地址：http://127.0.0.1:%s/' "$@";;
    en:info_service_url) printf 'Browser or client URL: http://127.0.0.1:%s/' "$@";;
    zh:info_password_title) printf '登录说明：';;
    en:info_password_title) printf 'Login:';;
    zh:info_password_none) printf '默认密码：无';;
    en:info_password_none) printf 'Default password: none';;
    zh:info_password_setup_hint) printf '首次访问会进入初始化页面，请先创建管理员账号和密码。';;
    en:info_password_setup_hint) printf 'On first access, you will see the bootstrap page and create the admin account and password yourself.';;
    zh:info_manual_start_title) printf '你还没有让脚本替你启动服务。后续可以手工执行：';;
    en:info_manual_start_title) printf 'You chose not to let the installer start the service. You can run this command later:';;
    zh:info_pm2_title) printf '后续 PM2 管理方式：';;
    en:info_pm2_title) printf 'PM2 management:';;
    zh:info_pm2_skipped) printf '你这次没有启用 PM2 托管。';;
    en:info_pm2_skipped) printf 'PM2 management was not enabled in this installation.';;
    zh:info_open_docs_title) printf '如果你想继续看后续操作说明，可以访问：';;
    en:info_open_docs_title) printf 'If you want the next-step guide, open:';;
    zh:info_docs_link) printf 'https://docs.codingns.com/quick-install/host-installation';;
    en:info_docs_link) printf 'https://docs.codingns.com/quick-install/host-installation';;

    zh:prompt_port) printf '请输入服务端口';;
    en:prompt_port) printf 'Enter the service port';;
    zh:prompt_data_dir) printf '请输入数据保存目录';;
    en:prompt_data_dir) printf 'Enter the data directory';;
    zh:prompt_auto_install_prereq) printf '检测到缺少必备环境，是否现在自动安装？';;
    en:prompt_auto_install_prereq) printf 'Required dependencies are missing. Install them automatically now?';;
    zh:prompt_install_opencode) printf '当前没有检测到受支持 CLI，是否现在安装 OpenCode？';;
    en:prompt_install_opencode) printf 'No supported CLI was detected. Install OpenCode now?';;
    zh:prompt_install_codingns) printf '现在安装或更新 CodingNS 吗？';;
    en:prompt_install_codingns) printf 'Install or update CodingNS now?';;
    zh:prompt_use_pm2) printf '是否将 CodingNS 安装为服务并开机自动启动？';;
    en:prompt_use_pm2) printf 'Install CodingNS as a service and start it automatically on boot?';;
    zh:prompt_confirm_plan) printf '按上面的计划继续吗？';;
    en:prompt_confirm_plan) printf 'Continue with this plan?';;
    zh:prompt_aborted) printf '已取消安装流程。';;
    en:prompt_aborted) printf 'The installation flow was cancelled.';;

    zh:yes_word) printf '是';;
    en:yes_word) printf 'Yes';;
    zh:no_word) printf '否';;
    en:no_word) printf 'No';;
    *)
      printf '%s' "$key"
      ;;
  esac
}

say_info() {
  printf '%s' "$(msg prefix)"
  msg "$@"
  printf '\n'
}

say_warn() {
  printf '%s' "$(msg prefix)" >&2
  msg "$@" >&2
  printf '\n' >&2
}

die() {
  printf '%s' "$(msg prefix)" >&2
  msg "$@" >&2
  printf '\n' >&2
  exit 1
}

die_without_language() {
  printf '%s\n' '[codingns-install] 交互式安装需要终端输入，请直接在终端中运行该命令。 / This interactive installer requires terminal input. Please run the command in a terminal.' >&2
  exit 1
}

init_prompt_input() {
  if [[ -n "${CODINGNS_INSTALL_INPUT_FD:-}" ]]; then
    PROMPT_INPUT_FD="${CODINGNS_INSTALL_INPUT_FD}"
    return
  fi

  if { exec 3</dev/tty; } 2>/dev/null; then
    PROMPT_INPUT_FD="3"
    return
  fi

  die_without_language
}

prompt_read_line() {
  local prompt_text="$1"
  local __result_var="$2"
  local line_value=""

  printf '%s' "$prompt_text" >&2

  if ! IFS= read -r -u "$PROMPT_INPUT_FD" line_value; then
    if [[ -n "$LANG_MODE" ]]; then
      die error_prompt_interrupted
    fi
    die_without_language
  fi

  printf -v "$__result_var" '%s' "$line_value"
}

choose_language() {
  local input=""

  while true; do
    printf '%s\n' 'Select installer language / 请选择安装脚本语言'
    printf '%s\n' '1) 中文'
    printf '%s\n' '2) English'
    prompt_read_line 'Enter 1 or 2 / 请输入 1 或 2 [1]: ' input
    input="$(trim "$input")"

    case "$input" in
      ""|1)
        LANG_MODE="zh"
        return
        ;;
      2)
        LANG_MODE="en"
        return
        ;;
      *)
        printf '%s\n' 'Please enter 1 or 2. / 请输入 1 或 2。'
        ;;
    esac
  done
}

trim() {
  local value="$1"
  value="${value##+([[:space:]])}"
  value="${value%%+([[:space:]])}"
  printf '%s' "$value"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_windows_environment() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_root_user() {
  [[ "$(id -u)" -eq 0 ]]
}

refresh_runtime_binaries() {
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
}

build_windows_runtime_paths() {
  RUNTIME_HOME="$SELECTED_DATA_DIR/runtime"
  NODE_RUNTIME_ROOT="$RUNTIME_HOME/node-22"
  NODE_RUNTIME_VERSIONS_DIR="$NODE_RUNTIME_ROOT/versions"
  NODE_ACTIVE_META="$NODE_RUNTIME_ROOT/active.json"
  PRIVATE_NODE_VERSION_DIR="$NODE_RUNTIME_VERSIONS_DIR/node-v${WINDOWS_PRIVATE_NODE_VERSION}-win-x64"
  PRIVATE_NPM_PREFIX="$RUNTIME_HOME/npm-global"
  PRIVATE_NPM_CACHE_DIR="$RUNTIME_HOME/cache/npm"
  PRIVATE_DOWNLOAD_CACHE_DIR="$RUNTIME_HOME/cache/downloads"
  PRIVATE_LOG_DIR="$RUNTIME_HOME/logs"
  PRIVATE_INSTALL_LOG_DIR="$PRIVATE_LOG_DIR/install"
  PRIVATE_PM2_HOME="$RUNTIME_HOME/pm2"
  PRIVATE_SERVICE_STATE_DIR="$RUNTIME_HOME/service"
  PRIVATE_NPM_USERCONFIG="$PRIVATE_NPM_PREFIX/npmrc"
}

ensure_windows_runtime_dirs() {
  mkdir -p \
    "$NODE_RUNTIME_VERSIONS_DIR" \
    "$PRIVATE_NPM_PREFIX" \
    "$PRIVATE_NPM_CACHE_DIR" \
    "$PRIVATE_DOWNLOAD_CACHE_DIR" \
    "$PRIVATE_INSTALL_LOG_DIR" \
    "$PRIVATE_PM2_HOME" \
    "$PRIVATE_SERVICE_STATE_DIR"
}

read_node_version_text() {
  local node_path="$1"
  "$node_path" -p "process.version" 2>/dev/null | tr -d '\r'
}

read_node_abi_text() {
  local node_path="$1"
  "$node_path" -p "process.versions.modules" 2>/dev/null | tr -d '\r'
}

normalize_version_text() {
  local version_text="$1"
  printf '%s' "${version_text#v}"
}

to_native_windows_path() {
  local target_path="$1"
  if is_windows_environment && command_exists cygpath; then
    cygpath -w "$target_path"
    return
  fi
  printf '%s\n' "$target_path"
}

native_path_for_node_runtime() {
  local target_path="$1"
  if is_windows_environment; then
    to_native_windows_path "$target_path"
    return
  fi
  printf '%s\n' "$target_path"
}

extract_package_name_from_spec() {
  local package_spec="$1"

  if [[ "$package_spec" == @*/* ]]; then
    local without_scope_prefix="${package_spec#@}"
    local scope_name="${without_scope_prefix%%/*}"
    local package_tail="${without_scope_prefix#*/}"
    printf '@%s/%s\n' "$scope_name" "${package_tail%%@*}"
    return
  fi

  printf '%s\n' "${package_spec%%@*}"
}

is_registry_package_spec() {
  local package_spec="$1"

  case "$package_spec" in
    file:*|git+*|github:*|http://*|https://*|./*|../*|/*|*.tgz|*.tar.gz)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

resolve_registry_probe_package_spec() {
  if is_registry_package_spec "$PACKAGE_SPEC"; then
    printf '%s\n' "$PACKAGE_SPEC"
    return
  fi

  printf '%s\n' "$REGISTRY_PROBE_PACKAGE_SPEC"
}

resolve_private_package_root_from_spec() {
  local npm_prefix="$1"
  local package_spec="$2"
  local package_name=""
  local package_root=""
  local local_package_root=""

  local_package_root="$(resolve_local_package_spec_dir "$package_spec" || true)"

  if [[ -d "$local_package_root" && -f "$local_package_root/package.json" ]]; then
    printf '%s\n' "$local_package_root"
    return 0
  fi

  package_name="$(extract_package_name_from_spec "$package_spec")"
  [[ -n "$package_name" ]] || return 1

  case "$package_name" in
    http://*|https://*|file:*|git+*|github:*|./*|../*|/*)
      return 1
      ;;
  esac

  package_root="$npm_prefix/node_modules/$package_name"
  [[ -f "$package_root/package.json" ]] || return 1
  printf '%s\n' "$package_root"
}

resolve_local_package_spec_dir() {
  local package_spec="$1"
  local local_package_root=""

  local_package_root="$package_spec"
  if [[ "$local_package_root" == file:* ]]; then
    local_package_root="${local_package_root#file:}"
  fi

  if [[ "$local_package_root" =~ ^[A-Za-z]:[\\/].* ]] && is_windows_environment && command_exists cygpath; then
    local_package_root="$(cygpath -u "$local_package_root" 2>/dev/null || printf '%s' "$local_package_root")"
  fi

  printf '%s\n' "$local_package_root"
}

resolve_private_package_root_from_command_name() {
  local npm_prefix="$1"
  local command_name="$2"

  [[ -n "$NODE_BIN" ]] || return 1
  [[ -n "$npm_prefix" ]] || return 1
  [[ -n "$command_name" ]] || return 1
  [[ -d "$npm_prefix/node_modules" ]] || return 1

  "$NODE_BIN" - "$npm_prefix" "$command_name" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [npmPrefix, commandName] = process.argv.slice(2);
const nodeModulesRoot = path.join(npmPrefix, "node_modules");

function normalizeBinName(binPath) {
  return path.basename(binPath).replace(/\.(?:mjs|cjs|js)$/iu, "");
}

function packageOwnsCommand(packageJson) {
  const binField = packageJson?.bin;

  if (typeof binField === "string") {
    return normalizeBinName(binField) === commandName;
  }

  if (binField && typeof binField === "object") {
    return typeof binField[commandName] === "string" && binField[commandName].trim().length > 0;
  }

  return false;
}

function inspectPackageRoot(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageOwnsCommand(packageJson) ? packageRoot : null;
  } catch {
    return null;
  }
}

function printIfFound(packageRoot) {
  const resolvedRoot = inspectPackageRoot(packageRoot);
  if (resolvedRoot) {
    process.stdout.write(resolvedRoot);
    process.exit(0);
  }
}

for (const entry of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  if (entry.name.startsWith("@")) {
    const scopeRoot = path.join(nodeModulesRoot, entry.name);
    for (const scopedEntry of fs.readdirSync(scopeRoot, { withFileTypes: true })) {
      if (!scopedEntry.isDirectory()) {
        continue;
      }
      printIfFound(path.join(scopeRoot, scopedEntry.name));
    }
    continue;
  }

  printIfFound(path.join(nodeModulesRoot, entry.name));
}

process.exit(1);
EOF
}

read_package_json_field() {
  local package_json_path="$1"
  local field_name="$2"

  [[ -n "$NODE_BIN" ]] || return 1
  [[ -f "$package_json_path" ]] || return 1

  "$NODE_BIN" - "$package_json_path" "$field_name" <<'EOF'
const fs = require("node:fs");

const [packageJsonPath, fieldName] = process.argv.slice(2);
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const value = packageJson?.[fieldName];

if (typeof value === "string" && value.trim()) {
  process.stdout.write(value.trim());
}
EOF
}

read_install_metadata_field() {
  local metadata_path="$1"
  local field_name="$2"

  [[ -n "$NODE_BIN" ]] || return 1
  [[ -f "$metadata_path" ]] || return 1

  "$NODE_BIN" - "$metadata_path" "$field_name" <<'EOF'
const fs = require("node:fs");

const [metadataPath, fieldName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const value = payload?.[fieldName];

if (typeof value === "string" && value.trim()) {
  process.stdout.write(value.trim());
}
EOF
}

resolve_package_root_from_dependency() {
  local owner_package_root="$1"
  local dependency_name="$2"

  [[ -n "$NODE_BIN" ]] || return 1
  [[ -n "$owner_package_root" ]] || return 1
  [[ -f "$owner_package_root/package.json" ]] || return 1

  "$NODE_BIN" - "$owner_package_root" "$dependency_name" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const [ownerPackageRoot, dependencyName] = process.argv.slice(2);

function findPackageRoot(startPath, expectedPackageName) {
  let currentDirectory = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (packageJson?.name === expectedPackageName) {
          process.stdout.write(currentDirectory);
          process.exit(0);
        }
      } catch {
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      process.exit(1);
    }

    currentDirectory = parentDirectory;
  }
}

try {
  const packageRequire = createRequire(path.join(ownerPackageRoot, "package.json"));
  const resolvedEntry = packageRequire.resolve(dependencyName);
  findPackageRoot(resolvedEntry, dependencyName);
} catch (error) {
  if (error && typeof error === "object" && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    try {
      const packageRequire = createRequire(path.join(ownerPackageRoot, "package.json"));
      const resolvedPackageJson = packageRequire.resolve(`${dependencyName}/package.json`);
      process.stdout.write(path.dirname(resolvedPackageJson));
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }

  process.exit(1);
}
EOF
}

resolve_required_better_sqlite_package_name() {
  printf 'better-sqlite3\n'
}

resolve_codingns_better_sqlite_dependency_metadata() {
  CODINGNS_BETTER_SQLITE_PACKAGE_NAME=""
  CODINGNS_BETTER_SQLITE_PACKAGE_VERSION=""

  if [[ -z "$CODINGNS_PACKAGE_ROOT" ]]; then
    return 0
  fi

  local required_package_name=""
  local dependency_package_root=""
  local dependency_package_json=""

  required_package_name="$(resolve_required_better_sqlite_package_name)"
  dependency_package_root="$(resolve_package_root_from_dependency "$CODINGNS_PACKAGE_ROOT" "$required_package_name" 2>/dev/null || true)"

  if [[ -z "$dependency_package_root" && "$required_package_name" != "better-sqlite3" ]]; then
    dependency_package_root="$(resolve_package_root_from_dependency "$CODINGNS_PACKAGE_ROOT" "better-sqlite3" 2>/dev/null || true)"
    if [[ -n "$dependency_package_root" ]]; then
      required_package_name="better-sqlite3"
    fi
  fi

  if [[ -z "$dependency_package_root" ]]; then
    return 0
  fi

  dependency_package_json="$dependency_package_root/package.json"
  if [[ ! -f "$dependency_package_json" ]]; then
    return 0
  fi

  CODINGNS_BETTER_SQLITE_PACKAGE_NAME="$(read_package_json_field "$dependency_package_json" "name" || true)"
  CODINGNS_BETTER_SQLITE_PACKAGE_VERSION="$(read_package_json_field "$dependency_package_json" "version" || true)"

  [[ -n "$CODINGNS_BETTER_SQLITE_PACKAGE_NAME" ]] || CODINGNS_BETTER_SQLITE_PACKAGE_NAME="$required_package_name"
  return 0
}

resolve_required_pty_package_name() {
  if ! is_windows_environment; then
    printf 'node-pty\n'
    return
  fi

  local target_major=""
  target_major="$(read_major_version "${TARGET_NODE_VERSION:-}")"

  if [[ "$target_major" == "22" ]] && [[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "amd64" ]]; then
    printf '%s\n' "$WINDOWS_NODE_PTY_PACKAGE_NAME"
    return
  fi

  printf 'node-pty\n'
}

resolve_codingns_pty_dependency_metadata() {
  CODINGNS_PTY_PACKAGE_NAME=""
  CODINGNS_PTY_PACKAGE_VERSION=""

  if [[ -z "$CODINGNS_PACKAGE_ROOT" ]]; then
    return 0
  fi

  local required_package_name=""
  local dependency_package_root=""
  local dependency_package_json=""

  required_package_name="$(resolve_required_pty_package_name)"
  dependency_package_root="$(resolve_package_root_from_dependency "$CODINGNS_PACKAGE_ROOT" "$required_package_name" 2>/dev/null || true)"

  if [[ -z "$dependency_package_root" && "$required_package_name" != "node-pty" ]]; then
    dependency_package_root="$(resolve_package_root_from_dependency "$CODINGNS_PACKAGE_ROOT" "node-pty" 2>/dev/null || true)"
    if [[ -n "$dependency_package_root" ]]; then
      required_package_name="node-pty"
    fi
  fi

  if [[ -z "$dependency_package_root" ]]; then
    return 0
  fi

  dependency_package_json="$dependency_package_root/package.json"
  if [[ ! -f "$dependency_package_json" ]]; then
    return 0
  fi

  CODINGNS_PTY_PACKAGE_NAME="$(read_package_json_field "$dependency_package_json" "name" || true)"
  CODINGNS_PTY_PACKAGE_VERSION="$(read_package_json_field "$dependency_package_json" "version" || true)"

  [[ -n "$CODINGNS_PTY_PACKAGE_NAME" ]] || CODINGNS_PTY_PACKAGE_NAME="$required_package_name"
  return 0
}

resolve_script_from_npm_shim() {
  local shim_path="$1"

  [[ -n "$NODE_BIN" ]] || return 1
  [[ -f "$shim_path" ]] || return 1

  "$NODE_BIN" - "$shim_path" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const shimPath = path.resolve(process.argv[2]);
const shimDir = path.dirname(shimPath);
const content = fs.readFileSync(shimPath, "utf8");
const patterns = [
  /%~dp0\\([^"\r\n]+?\.(?:mjs|cjs|js))/gi,
  /\$basedir\/([^"\r\n]+?\.(?:mjs|cjs|js))/g,
  /"([^"\r\n]*node_modules[\\/][^"\r\n]+?\.(?:mjs|cjs|js))"/g,
  /'([^'\r\n]*node_modules[\\/][^'\r\n]+?\.(?:mjs|cjs|js))'/g
];

for (const pattern of patterns) {
  for (const match of content.matchAll(pattern)) {
    const candidate = (match[1] || "").trim();
    if (!candidate) {
      continue;
    }

    const normalized = candidate
      .replace(/^%~dp0/i, "")
      .replace(/^%dp0%/i, "")
      .replace(/^\$basedir\/?/i, "")
      .replace(/\\/g, "/");
    const resolved = path.resolve(shimDir, normalized);

    if (fs.existsSync(resolved)) {
      process.stdout.write(resolved);
      process.exit(0);
    }
  }
}

process.exit(1);
EOF
}

download_file_with_fallback() {
  local source_url="$1"
  local target_path="$2"
  local native_target_path=""

  if command_exists curl; then
    curl -fL "$source_url" -o "$target_path"
    return
  fi

  if command_exists powershell.exe; then
    native_target_path="$(to_native_windows_path "$target_path")"
    CODINGNS_DOWNLOAD_URL="$source_url" \
    CODINGNS_DOWNLOAD_OUT="$native_target_path" \
      powershell.exe -NoLogo -NoProfile -Command \
        '$ErrorActionPreference = "Stop"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $env:CODINGNS_DOWNLOAD_URL -OutFile $env:CODINGNS_DOWNLOAD_OUT'
    return
  fi

  return 1
}

extract_zip_with_fallback() {
  local archive_path="$1"
  local output_dir="$2"
  local native_archive_path=""
  local native_output_dir=""

  if command_exists unzip; then
    unzip -oq "$archive_path" -d "$output_dir"
    return
  fi

  if command_exists tar; then
    tar -xf "$archive_path" -C "$output_dir"
    return
  fi

  if command_exists powershell.exe; then
    native_archive_path="$(to_native_windows_path "$archive_path")"
    native_output_dir="$(to_native_windows_path "$output_dir")"
    CODINGNS_ZIP_PATH="$native_archive_path" \
    CODINGNS_ZIP_OUT="$native_output_dir" \
      powershell.exe -NoLogo -NoProfile -Command \
        '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:CODINGNS_ZIP_PATH -DestinationPath $env:CODINGNS_ZIP_OUT -Force'
    return
  fi

  return 1
}

compute_file_sha256() {
  local target_path="$1"
  local native_target_path=""

  if command_exists sha256sum; then
    sha256sum "$target_path" | awk '{print $1}'
    return
  fi

  if command_exists shasum; then
    shasum -a 256 "$target_path" | awk '{print $1}'
    return
  fi

  if command_exists certutil.exe; then
    certutil.exe -hashfile "$target_path" SHA256 2>/dev/null | awk 'NR==2 {print $1}' | tr -d '\r'
    return
  fi

  if command_exists powershell.exe; then
    native_target_path="$(to_native_windows_path "$target_path")"
    CODINGNS_HASH_PATH="$native_target_path" \
      powershell.exe -NoLogo -NoProfile -Command \
        '$ErrorActionPreference = "Stop"; (Get-FileHash -LiteralPath $env:CODINGNS_HASH_PATH -Algorithm SHA256).Hash.ToLowerInvariant()' | tr -d '\r'
    return
  fi

  return 1
}

write_private_node_active_meta() {
  local node_exe="$PRIVATE_NODE_VERSION_DIR/node.exe"
  local npm_cmd="$PRIVATE_NODE_VERSION_DIR/npm.cmd"
  local npx_cmd="$PRIVATE_NODE_VERSION_DIR/npx.cmd"

  cat >"$NODE_ACTIVE_META" <<EOF
{
  "version": "${WINDOWS_PRIVATE_NODE_VERSION}",
  "platform": "win32",
  "arch": "x64",
  "nodeDir": "${PRIVATE_NODE_VERSION_DIR}",
  "nodeExe": "${node_exe}",
  "npmCmd": "${npm_cmd}",
  "npxCmd": "${npx_cmd}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "sourceUrl": "${PRIVATE_NODE_SOURCE_URL}",
  "sha256": "${PRIVATE_NODE_ARCHIVE_SHA256}"
}
EOF
}

resolve_private_node_paths() {
  local node_exe="$PRIVATE_NODE_VERSION_DIR/node.exe"
  local npm_cmd="$PRIVATE_NODE_VERSION_DIR/npm.cmd"
  local npx_cmd="$PRIVATE_NODE_VERSION_DIR/npx.cmd"

  [[ -x "$node_exe" ]] || die error_windows_private_node_incomplete "$node_exe"
  [[ -f "$npm_cmd" ]] || die error_windows_private_node_incomplete "$npm_cmd"
  [[ -f "$npx_cmd" ]] || die error_windows_private_node_incomplete "$npx_cmd"

  NODE_BIN="$node_exe"
  NPM_BIN="$npm_cmd"
  PRIVATE_NPM_CMD="$npm_cmd"
  PRIVATE_NPX_CMD="$npx_cmd"
  TARGET_NODE_VERSION="$(read_node_version_text "$NODE_BIN")"
  TARGET_NODE_ABI="$(read_node_abi_text "$NODE_BIN")"
  write_private_node_active_meta
}

download_windows_private_node_runtime() {
  local archive_name="node-v${WINDOWS_PRIVATE_NODE_VERSION}-win-x64.zip"
  local archive_path="$PRIVATE_DOWNLOAD_CACHE_DIR/$archive_name"
  local shasums_path="$PRIVATE_DOWNLOAD_CACHE_DIR/SHASUMS256-v${WINDOWS_PRIVATE_NODE_VERSION}.txt"
  local archive_url="${WINDOWS_PRIVATE_NODE_DIST_BASE}/v${WINDOWS_PRIVATE_NODE_VERSION}/${archive_name}"
  local shasums_url="${WINDOWS_PRIVATE_NODE_DIST_BASE}/v${WINDOWS_PRIVATE_NODE_VERSION}/SHASUMS256.txt"
  local extract_dir="$PRIVATE_NODE_VERSION_DIR"
  local expected_sha256=""
  local actual_sha256=""

  PRIVATE_NODE_SOURCE_URL="$archive_url"
  mkdir -p "$NODE_RUNTIME_VERSIONS_DIR"

  if [[ "$DRY_RUN" == "1" ]]; then
    say_info_custom "download \"$archive_url\" -> \"$archive_path\""
    say_info_custom "download \"$shasums_url\" -> \"$shasums_path\""
    say_info_custom "verify sha256 \"$archive_path\""
    say_info_custom "extract \"$archive_path\" -> \"$NODE_RUNTIME_VERSIONS_DIR\""
    PRIVATE_NODE_ARCHIVE_SHA256="dry-run"
    return
  fi

  if [[ ! -f "$shasums_path" ]]; then
    if ! download_file_with_fallback "$shasums_url" "$shasums_path"; then
      die error_windows_private_node_download_failed "$shasums_url"
    fi
  fi

  expected_sha256="$(awk -v target="$archive_name" '$2 == target {print $1; exit}' "$shasums_path" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
  [[ -n "$expected_sha256" ]] || die error_windows_private_node_checksum_missing "$shasums_path"
  PRIVATE_NODE_ARCHIVE_SHA256="$expected_sha256"

  if [[ -f "$archive_path" ]]; then
    actual_sha256="$(compute_file_sha256 "$archive_path" | tr -d '\r' | tr '[:upper:]' '[:lower:]' || true)"
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
      rm -f "$archive_path"
    fi
  fi

  if [[ ! -f "$archive_path" ]]; then
    if ! download_file_with_fallback "$archive_url" "$archive_path"; then
      die error_windows_private_node_download_failed "$archive_url"
    fi
  fi

  actual_sha256="$(compute_file_sha256 "$archive_path" | tr -d '\r' | tr '[:upper:]' '[:lower:]' || true)"
  [[ -n "$actual_sha256" ]] || die error_windows_private_node_checksum_missing "$archive_path"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    rm -f "$archive_path"
    die error_windows_private_node_checksum_failed "$archive_name"
  fi

  rm -rf "$extract_dir"
  if ! extract_zip_with_fallback "$archive_path" "$NODE_RUNTIME_VERSIONS_DIR"; then
    die error_windows_private_node_extract_failed "$archive_path"
  fi
}

ensure_private_node_runtime() {
  if ! is_windows_environment; then
    return
  fi

  local machine_arch=""
  machine_arch="$(uname -m)"
  case "$machine_arch" in
    x86_64|amd64)
      ;;
    *)
      die error_windows_private_node_unsupported_arch "$machine_arch"
      ;;
  esac

  build_windows_runtime_paths
  ensure_windows_runtime_dirs

  say_warn warn_windows_using_private_node "$WINDOWS_PRIVATE_NODE_VERSION"

  if [[ -n "$SYSTEM_NODE_VERSION" ]]; then
    say_warn warn_windows_system_node_diagnostics "${SYSTEM_NODE_VERSION:-unknown}" "${SYSTEM_NODE_ABI:-unknown}"
  fi

  if [[ -x "$PRIVATE_NODE_VERSION_DIR/node.exe" && -f "$PRIVATE_NODE_VERSION_DIR/npm.cmd" && -f "$PRIVATE_NODE_VERSION_DIR/npx.cmd" ]]; then
    resolve_private_node_paths
    return
  fi

  download_windows_private_node_runtime

  if [[ "$DRY_RUN" == "1" ]]; then
    NODE_BIN="$PRIVATE_NODE_VERSION_DIR/node.exe"
    NPM_BIN="$PRIVATE_NODE_VERSION_DIR/npm.cmd"
    TARGET_NODE_VERSION="v${WINDOWS_PRIVATE_NODE_VERSION}"
    TARGET_NODE_ABI="unknown"
    return
  fi

  resolve_private_node_paths
}

collect_target_runtime_native_support() {
  TARGET_RUNTIME_UNSUPPORTED_PACKAGES=()
  TARGET_RUNTIME_FALLBACK_PACKAGES=()
  TARGET_RUNTIME_MANAGED_PACKAGE_SUMMARY=()

  if ! is_windows_environment; then
    return
  fi

  [[ -n "$TARGET_NODE_VERSION" ]] || TARGET_NODE_VERSION="$(read_node_version_text "$NODE_BIN")"
  [[ -n "$TARGET_NODE_ABI" ]] || TARGET_NODE_ABI="$(read_node_abi_text "$NODE_BIN")"

  local target_major=""
  target_major="$(read_major_version "$TARGET_NODE_VERSION")"

  TARGET_RUNTIME_MANAGED_PACKAGE_SUMMARY+=("${WINDOWS_NODE_PTY_PACKAGE_NAME}: 目标是 win32 + x64 + Node 22，预期使用随包预编译，不接受本机编译")
  TARGET_RUNTIME_MANAGED_PACKAGE_SUMMARY+=("${WINDOWS_BETTER_SQLITE_PACKAGE_NAME}: 目标是 win32 + x64 + Node 22，预期使用随包预编译，不接受本机编译")

  if [[ "$target_major" != "22" ]]; then
    TARGET_RUNTIME_UNSUPPORTED_PACKAGES+=("${WINDOWS_NODE_PTY_PACKAGE_NAME}: requires Node 22")
  fi

  if [[ "$(uname -m)" != "x86_64" && "$(uname -m)" != "amd64" ]]; then
    TARGET_RUNTIME_UNSUPPORTED_PACKAGES+=("${WINDOWS_NODE_PTY_PACKAGE_NAME}: requires x64")
  fi

}

ensure_windows_target_runtime_supported() {
  if ! is_windows_environment; then
    return
  fi

  collect_target_runtime_native_support

  say_info info_windows_target_runtime_summary "${TARGET_NODE_VERSION:-unknown}" "${TARGET_NODE_ABI:-unknown}"
  local package_summary=""
  for package_summary in "${TARGET_RUNTIME_MANAGED_PACKAGE_SUMMARY[@]}"; do
    say_info info_windows_managed_package_summary "$package_summary"
  done

  if (( ${#TARGET_RUNTIME_UNSUPPORTED_PACKAGES[@]} > 0 )); then
    die error_windows_target_runtime_unsupported "$(IFS=', '; printf '%s' "${TARGET_RUNTIME_UNSUPPORTED_PACKAGES[*]}")"
  fi

}

build_private_install_env() {
  INSTALL_ENV_ARGS=()
  PRIVATE_INSTALL_CONTEXT="0"

  if ! is_windows_environment; then
    return
  fi

  PRIVATE_INSTALL_CONTEXT="1"
  INSTALL_ENV_ARGS=(
    "PATH=${PRIVATE_NODE_VERSION_DIR}:${PRIVATE_NPM_PREFIX}:${SYSTEM_PATH_SNAPSHOT}"
    "PM2_HOME=${PRIVATE_PM2_HOME}"
    "npm_config_prefix=${PRIVATE_NPM_PREFIX}"
    "npm_config_cache=${PRIVATE_NPM_CACHE_DIR}"
    "npm_config_userconfig=${PRIVATE_NPM_USERCONFIG}"
    "CODINGNS_DATA_DIR=${SELECTED_DATA_DIR}"
    "CODINGNS_RUNTIME_ROOT=${RUNTIME_HOME}"
    "CODINGNS_RUNTIME_NODE_VERSION=${WINDOWS_PRIVATE_NODE_VERSION}"
    "CODINGNS_PM2_PROCESS_NAME=${PROCESS_NAME}"
  )
}

path_or_parent_writable() {
  local target="$1"
  while [[ ! -e "$target" ]]; do
    target="$(dirname "$target")"
    if [[ "$target" == "/" ]]; then
      break
    fi
  done
  [[ -w "$target" ]]
}

read_major_version() {
  local version_text="$1"
  version_text="${version_text#v}"
  version_text="${version_text%%[^0-9.]*}"
  if [[ "$version_text" =~ ^([0-9]+) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf ''
}

localized_bool() {
  if [[ "$1" == "1" ]]; then
    msg yes_word
  else
    msg no_word
  fi
}

read_with_default() {
  local prompt="$1"
  local default_value="$2"
  local input=""
  local prompt_text=""

  if [[ "$LANG_MODE" == "zh" ]]; then
    prompt_text="$(printf '%s（默认：%s）：' "$prompt" "$default_value")"
  else
    prompt_text="$(printf '%s (Default: %s):' "$prompt" "$default_value")"
  fi

  prompt_read_line "$prompt_text " input
  input="$(trim "$input")"

  if [[ -z "$input" ]]; then
    printf '%s\n' "$default_value"
    return
  fi

  printf '%s\n' "$input"
}

read_yes_no() {
  local prompt="$1"
  local default_value="$2"
  local input=""
  local normalized_default=""
  local normalized_input=""
  local yes_suffix=""

  normalized_default="$(trim "$default_value")"

  if [[ "$LANG_MODE" == "zh" ]]; then
    yes_suffix="[Y/n]"
    [[ "$normalized_default" == "n" ]] && yes_suffix="[y/N]"
  else
    yes_suffix="[Y/n]"
    [[ "$normalized_default" == "n" ]] && yes_suffix="[y/N]"
  fi

  while true; do
    prompt_read_line "$(printf '%s %s: ' "$prompt" "$yes_suffix")" input
    input="$(trim "$input")"

    if [[ -z "$input" ]]; then
      input="$normalized_default"
    fi

    normalized_input="$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')"

    case "$normalized_input" in
      y|yes|1|shi|是)
        printf '1\n'
        return
        ;;
      n|no|0|fou|否)
        printf '0\n'
        return
        ;;
      *)
        if [[ "$LANG_MODE" == "zh" ]]; then
          say_warn_custom '请输入 y 或 n。'
        else
          say_warn_custom 'Please enter y or n.'
        fi
        ;;
    esac
  done
}

say_warn_custom() {
  printf '%s' "$(msg prefix)" >&2
  printf '%s\n' "$1" >&2
}

expand_path() {
  local raw_path="$1"

  case "$raw_path" in
    "~")
      printf '%s\n' "$HOME"
      ;;
    "~/"*)
      printf '%s/%s\n' "$HOME" "${raw_path#~/}"
      ;;
    [A-Za-z]:\\*|[A-Za-z]:/*)
      if is_windows_environment && command_exists cygpath; then
        cygpath -u "$raw_path"
      else
        printf '%s\n' "$raw_path"
      fi
      ;;
    /*)
      printf '%s\n' "$raw_path"
      ;;
    *)
      printf '%s/%s\n' "$(pwd)" "$raw_path"
      ;;
  esac
}

validate_port() {
  local port_text="$1"
  if [[ ! "$port_text" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  local port_value=$((10#$port_text))
  (( port_value >= 1 && port_value <= 65535 ))
}

has_windows_native_build_tools() {
  command_exists cl && return 0
  command_exists msbuild && return 0
  command_exists vswhere && return 0
  [[ -x "/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" ]] && return 0
  [[ -x "/c/Program Files/Microsoft Visual Studio/2022/BuildTools/MSBuild/Current/Bin/MSBuild.exe" ]] && return 0
  return 1
}

collect_prerequisite_issues() {
  PREREQUISITE_ISSUES=()
  PREREQUISITE_WARNINGS=()
  refresh_runtime_binaries

  local node_version="" npm_version="" node_major="" npm_major=""

  SYSTEM_NODE_BIN="$NODE_BIN"
  SYSTEM_NPM_BIN="$NPM_BIN"
  SYSTEM_NODE_VERSION=""
  SYSTEM_NODE_ABI=""

  if [[ -z "$NODE_BIN" ]]; then
    if ! is_windows_environment; then
      PREREQUISITE_ISSUES+=("error_no_node")
    fi
  else
    node_version="$("$NODE_BIN" -v 2>/dev/null || true)"
    SYSTEM_NODE_VERSION="$node_version"
    SYSTEM_NODE_ABI="$("$NODE_BIN" -p "process.versions.modules" 2>/dev/null | tr -d '\r' || true)"
    node_major="$(read_major_version "$node_version")"
    if [[ -z "$node_major" ]]; then
      if ! is_windows_environment; then
        PREREQUISITE_ISSUES+=("error_read_node_version|$node_version")
      fi
    elif (( node_major < 22 )) && ! is_windows_environment; then
      PREREQUISITE_ISSUES+=("error_bad_node_version|$node_version")
    fi
  fi

  if [[ -z "$NPM_BIN" ]]; then
    if ! is_windows_environment; then
      PREREQUISITE_ISSUES+=("error_no_npm")
    fi
  else
    npm_version="$("$NPM_BIN" -v 2>/dev/null || true)"
    npm_major="$(read_major_version "$npm_version")"
    if [[ -z "$npm_major" ]]; then
      if ! is_windows_environment; then
        PREREQUISITE_ISSUES+=("error_read_npm_version|$npm_version")
      fi
    elif (( npm_major < 10 )) && ! is_windows_environment; then
      PREREQUISITE_ISSUES+=("error_bad_npm_version|$npm_version")
    fi
  fi

  if [[ "$(uname -s)" == "Linux" ]]; then
    command_exists make || PREREQUISITE_ISSUES+=("error_no_make")
    command_exists g++ || PREREQUISITE_ISSUES+=("error_no_cpp_compiler")
    command_exists python3 || PREREQUISITE_ISSUES+=("error_no_python3")
  fi

  if is_windows_environment; then
    if ! has_windows_native_build_tools; then
      PREREQUISITE_WARNINGS+=("warn_windows_missing_build_tools")
      PREREQUISITE_WARNINGS+=("warn_windows_registry_not_enough")
    fi

    if [[ -n "$node_major" ]] && (( node_major >= 24 )); then
      PREREQUISITE_WARNINGS+=("warn_windows_node24_native_modules|$node_version")
    fi
  fi

  if (( ${#PREREQUISITE_ISSUES[@]} > 0 )); then
    return 1
  fi

  return 0
}

print_prerequisite_issues() {
  local issue raw_key raw_arg
  say_warn info_prereq_missing_title
  for issue in "${PREREQUISITE_ISSUES[@]}"; do
    IFS='|' read -r raw_key raw_arg <<<"$issue"
    printf '%s' "$(msg prefix)" >&2
    printf -- '- ' >&2
    if [[ -n "${raw_arg:-}" ]]; then
      msg "$raw_key" "$raw_arg" >&2
    else
      msg "$raw_key" >&2
    fi
    printf '\n' >&2
  done
}

print_prerequisite_warnings() {
  local issue raw_key raw_arg
  for issue in "${PREREQUISITE_WARNINGS[@]}"; do
    IFS='|' read -r raw_key raw_arg <<<"$issue"
    if [[ -n "${raw_arg:-}" ]]; then
      say_warn "$raw_key" "$raw_arg"
    else
      say_warn "$raw_key"
    fi
  done
}

detect_brew_bin() {
  if command_exists brew; then
    command -v brew
    return
  fi

  if [[ -x "/opt/homebrew/bin/brew" ]]; then
    printf '%s\n' "/opt/homebrew/bin/brew"
    return
  fi

  if [[ -x "/usr/local/bin/brew" ]]; then
    printf '%s\n' "/usr/local/bin/brew"
    return
  fi

  printf '\n'
}

activate_brew_shellenv() {
  BREW_BIN="$(detect_brew_bin)"
  [[ -n "$BREW_BIN" ]] || die error_brew_install_failed

  if [[ "$DRY_RUN" == "1" ]]; then
    case "$BREW_BIN" in
      /opt/homebrew/bin/brew)
        export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
        ;;
      /usr/local/bin/brew)
        export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
        ;;
    esac
    return
  fi

  eval "$("$BREW_BIN" shellenv)"
}

supports_automatic_prerequisite_install() {
  local system_name
  system_name="$(uname -s)"

  case "$system_name" in
    Darwin)
      return 0
      ;;
    Linux)
      command_exists apt-get
      return
      ;;
    *)
      return 1
      ;;
  esac
}

install_prerequisites_macos() {
  if ! command_exists brew && [[ -z "$(detect_brew_bin)" ]]; then
    say_info info_installing_homebrew
    if [[ "$DRY_RUN" == "1" ]]; then
      say_info_custom "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
      BREW_BIN="/opt/homebrew/bin/brew"
    else
      NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || die error_brew_install_failed
    fi
  fi

  activate_brew_shellenv
  say_info info_installing_nodejs

  if [[ "$DRY_RUN" == "1" ]]; then
    say_info_custom "$BREW_BIN install node"
    return
  fi

  if "$BREW_BIN" list node >/dev/null 2>&1; then
    "$BREW_BIN" upgrade node || "$BREW_BIN" install node
  else
    "$BREW_BIN" install node
  fi

  hash -r
}

install_prerequisites_linux_apt() {
  say_info info_installing_nodejs
  say_info info_installing_linux_build_tools

  local apt_prefix=()
  local gpg_target_prefix=()
  local tee_prefix=()

  if is_root_user; then
    apt_prefix=()
    gpg_target_prefix=()
    tee_prefix=()
  else
    command_exists sudo || die error_no_sudo
    apt_prefix=(sudo)
    gpg_target_prefix=(sudo)
    tee_prefix=(sudo)
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    if is_root_user; then
      say_info_custom "apt-get update"
      say_info_custom "apt-get install -y ca-certificates curl gnupg build-essential python3"
      say_info_custom "mkdir -p /etc/apt/keyrings"
      say_info_custom "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg"
      say_info_custom "echo \"deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\" > /etc/apt/sources.list.d/nodesource.list"
      say_info_custom "apt-get update"
      say_info_custom "apt-get install -y nodejs"
    else
      say_info_custom "sudo apt-get update"
      say_info_custom "sudo apt-get install -y ca-certificates curl gnupg build-essential python3"
      say_info_custom "sudo mkdir -p /etc/apt/keyrings"
      say_info_custom "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg"
      say_info_custom "echo \"deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null"
      say_info_custom "sudo apt-get update"
      say_info_custom "sudo apt-get install -y nodejs"
    fi
    return
  fi

  "${apt_prefix[@]}" apt-get update
  "${apt_prefix[@]}" apt-get install -y ca-certificates curl gnupg build-essential python3
  "${apt_prefix[@]}" mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | "${gpg_target_prefix[@]}" gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  if is_root_user; then
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  else
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | "${tee_prefix[@]}" tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  fi

  "${apt_prefix[@]}" apt-get update
  "${apt_prefix[@]}" apt-get install -y nodejs
  hash -r
}

auto_install_prerequisites() {
  local system_name
  system_name="$(uname -s)"

  case "$system_name" in
    Darwin)
      install_prerequisites_macos
      ;;
    Linux)
      if ! command_exists apt-get; then
        die error_no_supported_linux_installer
      fi
      install_prerequisites_linux_apt
      ;;
    *)
      die error_prereq_auto_install_unsupported
      ;;
  esac
}

ensure_npm_install_context() {
  if is_windows_environment; then
    [[ -n "$NPM_BIN" ]] || die error_no_npm
    NPM_GLOBAL_PREFIX="$PRIVATE_NPM_PREFIX"
    USE_SUDO_FOR_NPM="0"
    return
  fi

  refresh_runtime_binaries

  NPM_GLOBAL_PREFIX="$(trim "$("$NPM_BIN" config get prefix 2>/dev/null || true)")"
  [[ -n "$NPM_GLOBAL_PREFIX" ]] || die error_read_prefix

  USE_SUDO_FOR_NPM="0"
  if ! path_or_parent_writable "$NPM_GLOBAL_PREFIX"; then
    if is_root_user; then
      USE_SUDO_FOR_NPM="0"
    elif command_exists sudo; then
      USE_SUDO_FOR_NPM="1"
      say_info info_need_sudo
    else
      die error_no_sudo
    fi
  fi
}

prepare_windows_install_runtime() {
  if ! is_windows_environment; then
    return
  fi

  ensure_private_node_runtime
  ensure_windows_target_runtime_supported
  build_private_install_env
  ensure_npm_install_context
}

ensure_prerequisites() {
  say_info info_prereq_check_title

  if ! collect_prerequisite_issues; then
    print_prerequisite_issues

    if ! supports_automatic_prerequisite_install; then
      die error_prereq_auto_install_unsupported
    fi

    if [[ "$(read_yes_no "$(msg prompt_auto_install_prereq)" "y")" != "1" ]]; then
      die error_prereq_auto_install_cancelled
    fi

    auto_install_prerequisites

    if ! collect_prerequisite_issues; then
      print_prerequisite_issues
      die error_prereq_auto_install_failed
    fi

    say_info info_auto_install_done
  fi

  if (( ${#PREREQUISITE_WARNINGS[@]} > 0 )); then
    print_prerequisite_warnings
  fi

  if ! is_windows_environment; then
    ensure_npm_install_context
  fi
}

detect_supported_clis() {
  CLI_SUMMARY_LINES=()
  INSTALLED_CLI_COUNT=0

  local spec provider_id label command_name command_path version_text
  for spec in "${SUPPORTED_CLIS[@]}"; do
    IFS='|' read -r provider_id label command_name <<<"$spec"
    command_path="$(command -v "$command_name" 2>/dev/null || true)"
    if [[ -n "$command_path" ]]; then
      version_text="$(read_cli_version "$command_name")"
      CLI_SUMMARY_LINES[${#CLI_SUMMARY_LINES[@]}]="- ${label}: ${version_text}"
      INSTALLED_CLI_COUNT=$((INSTALLED_CLI_COUNT + 1))
    else
      if [[ "$LANG_MODE" == "zh" ]]; then
        CLI_SUMMARY_LINES[${#CLI_SUMMARY_LINES[@]}]="- ${label}：未检测到"
      else
        CLI_SUMMARY_LINES[${#CLI_SUMMARY_LINES[@]}]="- ${label}: not detected"
      fi
    fi
  done
}

read_cli_version() {
  local command_name="$1"
  local output=""

  output="$("$command_name" --version 2>&1 | sed -n '1p' | tr -d '\r' || true)"
  if [[ -n "$(trim "$output")" ]]; then
    printf '%s\n' "$(trim "$output")"
    return
  fi

  output="$("$command_name" version 2>&1 | sed -n '1p' | tr -d '\r' || true)"
  if [[ -n "$(trim "$output")" ]]; then
    printf '%s\n' "$(trim "$output")"
    return
  fi

  output="$("$command_name" -v 2>&1 | sed -n '1p' | tr -d '\r' || true)"
  if [[ -n "$(trim "$output")" ]]; then
    printf '%s\n' "$(trim "$output")"
    return
  fi

  if [[ "$LANG_MODE" == "zh" ]]; then
    printf '%s\n' "已找到命令，版本未知"
  else
    printf '%s\n' "found, version unknown"
  fi
}

print_cli_summary() {
  say_info info_detect_clis
  local line
  for line in "${CLI_SUMMARY_LINES[@]}"; do
    printf '%s\n' "$line"
  done
}

collect_install_options() {
  while true; do
    SELECTED_PORT="$(read_with_default "$(msg prompt_port)" "$DEFAULT_PORT")"
    if validate_port "$SELECTED_PORT"; then
      break
    fi
    say_warn error_port_invalid
  done

  local raw_data_dir=""
  raw_data_dir="$(read_with_default "$(msg prompt_data_dir)" "$DEFAULT_DATA_DIR")"
  SELECTED_DATA_DIR="$(expand_path "$raw_data_dir")"

  detect_supported_clis
  print_cli_summary

  if (( INSTALLED_CLI_COUNT == 0 )); then
    say_warn info_no_cli
    say_warn info_recommend_opencode
    INSTALL_OPENCODE="$(read_yes_no "$(msg prompt_install_opencode)" "y")"
  else
    INSTALL_OPENCODE="0"
  fi

  INSTALL_CODINGNS="$(read_yes_no "$(msg prompt_install_codingns)" "y")"
  USE_PM2="$(read_yes_no "$(msg prompt_use_pm2)" "y")"

  if [[ "$USE_PM2" == "1" ]]; then
    INSTALL_PM2="1"
    START_PM2_SERVICE="1"
    ENABLE_STARTUP="1"
  else
    INSTALL_PM2="0"
    START_PM2_SERVICE="0"
    ENABLE_STARTUP="0"
  fi
}

print_install_summary() {
  printf '\n'
  say_info info_summary_title
  printf -- '- %s\n' "$(msg info_port "$SELECTED_PORT")"
  printf -- '- %s\n' "$(msg info_data_dir "$SELECTED_DATA_DIR")"
  if (( INSTALLED_CLI_COUNT == 0 )); then
    printf -- '- %s\n' "$(msg info_install_opencode "$(localized_bool "$INSTALL_OPENCODE")")"
  fi
  printf -- '- %s\n' "$(msg info_install_codingns "$(localized_bool "$INSTALL_CODINGNS")")"
  printf -- '- %s\n' "$(msg info_use_pm2 "$(localized_bool "$USE_PM2")")"
}

probe_registry() {
  local registry_url="$1"
  local probe_package_spec=""
  probe_package_spec="$(resolve_registry_probe_package_spec)"
  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    env "${INSTALL_ENV_ARGS[@]}" "$NPM_BIN" view "$probe_package_spec" version \
      --registry "$registry_url" \
      --fetch-retries=1 \
      --fetch-timeout=6000 \
      --silent >/dev/null 2>&1
    return
  fi

  "$NPM_BIN" view "$probe_package_spec" version \
    --registry "$registry_url" \
    --fetch-retries=1 \
    --fetch-timeout=6000 \
    --silent >/dev/null 2>&1
}

resolve_registry() {
  if probe_registry "$OFFICIAL_NPM_REGISTRY"; then
    ACTIVE_NPM_REGISTRY="$OFFICIAL_NPM_REGISTRY"
    say_info info_using_official_registry "$ACTIVE_NPM_REGISTRY"
    return
  fi

  say_warn warn_official_registry_failed

  if probe_registry "$MIRROR_NPM_REGISTRY"; then
    ACTIVE_NPM_REGISTRY="$MIRROR_NPM_REGISTRY"
    say_info info_using_mirror_registry "$ACTIVE_NPM_REGISTRY"
    return
  fi

  die error_registry_unavailable
}

run_with_optional_sudo() {
  if [[ "$USE_SUDO_FOR_NPM" == "1" ]]; then
    sudo "$@"
    return
  fi

  "$@"
}

create_install_log_file() {
  local base_dir=""
  local log_path=""

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" && -n "$PRIVATE_INSTALL_LOG_DIR" ]]; then
    base_dir="$PRIVATE_INSTALL_LOG_DIR"
  else
    base_dir="${TMPDIR:-/tmp}"
  fi
  mkdir -p "$base_dir" >/dev/null 2>&1 || true

  if log_path="$(mktemp "$base_dir/codingns-install.XXXXXX.log" 2>/dev/null)"; then
    printf '%s\n' "$log_path"
    return
  fi

  if log_path="$(mktemp -t codingns-install.XXXXXX 2>/dev/null)"; then
    printf '%s\n' "$log_path"
    return
  fi

  log_path="$base_dir/codingns-install-$$.log"
  : > "$log_path"
  printf '%s\n' "$log_path"
}

diagnose_install_failure() {
  local package_label="$1"
  local log_path="$2"

  [[ -n "$log_path" && -f "$log_path" ]] || return
  [[ "$package_label" == "CodingNS" ]] || return

  if grep -Eq 'Could not find any Visual Studio installation to use|Desktop development with C\+\+' "$log_path"; then
    say_warn warn_windows_install_failed_vs
  fi

  if grep -Eq 'prebuild-install warn install (read ECONNRESET|Request timed out|No prebuilt binaries found)' "$log_path"; then
    say_warn warn_windows_install_failed_prebuild_network
    say_warn warn_windows_registry_not_enough
  fi

  say_warn warn_install_log_path "$log_path"
}

install_global_package_once() {
  local registry_url="$1"
  local package_spec="$2"
  local install_log=""

  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$NPM_BIN\" install -g --registry $registry_url $package_spec"
    else
      say_info_custom "npm install -g --registry $registry_url $package_spec"
    fi
    return 0
  fi

  install_log="$(create_install_log_file)"
  LAST_INSTALL_LOG="$install_log"

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    env "${INSTALL_ENV_ARGS[@]}" npm_config_registry="$registry_url" \
      "$NPM_BIN" install -g "$package_spec" \
      --registry "$registry_url" \
      --fetch-retries=1 \
      --fetch-timeout=20000 \
      --foreground-scripts 2>&1 | tee "$install_log"
    return
  fi

  run_with_optional_sudo env npm_config_registry="$registry_url" \
    "$NPM_BIN" install -g "$package_spec" \
    --registry "$registry_url" \
    --fetch-retries=1 \
    --fetch-timeout=20000 \
    --foreground-scripts 2>&1 | tee "$install_log"
}

say_info_custom() {
  printf '%s%s\n' "$(msg prefix)" "$1"
}

install_global_package() {
  local package_spec="$1"
  local package_label="$2"

  if install_global_package_once "$ACTIVE_NPM_REGISTRY" "$package_spec"; then
    return
  fi

  if [[ "$ACTIVE_NPM_REGISTRY" == "$MIRROR_NPM_REGISTRY" ]]; then
    if [[ "$LANG_MODE" == "zh" ]]; then
      die_custom "$package_label 安装失败，请检查 npm 日志。"
    else
      die_custom "$package_label installation failed. Please check the npm logs."
    fi
  fi

  if [[ "$LANG_MODE" == "zh" ]]; then
    say_warn_custom "$package_label 在官方 npm 源安装失败，改用镜像重试。"
  else
    say_warn_custom "$package_label failed from the official npm registry. Retrying with the mirror."
  fi

  ACTIVE_NPM_REGISTRY="$MIRROR_NPM_REGISTRY"
  install_global_package_once "$ACTIVE_NPM_REGISTRY" "$package_spec" || {
    diagnose_install_failure "$package_label" "$LAST_INSTALL_LOG"
    if [[ "$LANG_MODE" == "zh" ]]; then
      die_custom "$package_label 在镜像源安装也失败了，请检查网络或权限。"
    else
      die_custom "$package_label also failed from the mirror. Please check your network or permissions."
    fi
  }
}

die_custom() {
  printf '%s%s\n' "$(msg prefix)" "$1" >&2
  exit 1
}

resolve_private_installed_binary() {
  local command_name="$1"

  [[ -n "$NPM_GLOBAL_PREFIX" ]] || return 1

  if is_windows_environment && [[ -f "$NPM_GLOBAL_PREFIX/${command_name}.cmd" ]]; then
    printf '%s\n' "$NPM_GLOBAL_PREFIX/${command_name}.cmd"
    return 0
  fi

  if [[ -x "$NPM_GLOBAL_PREFIX/$command_name" || -f "$NPM_GLOBAL_PREFIX/$command_name" ]]; then
    printf '%s\n' "$NPM_GLOBAL_PREFIX/$command_name"
    return 0
  fi

  if [[ -x "$NPM_GLOBAL_PREFIX/bin/$command_name" || -f "$NPM_GLOBAL_PREFIX/bin/$command_name" ]]; then
    printf '%s\n' "$NPM_GLOBAL_PREFIX/bin/$command_name"
    return 0
  fi

  return 1
}

resolve_installed_binary() {
  local command_name="$1"
  local candidate=""

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    resolve_private_installed_binary "$command_name" || printf '\n'
    return
  fi

  candidate="$(command -v "$command_name" 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return
  fi

  if [[ -x "$NPM_GLOBAL_PREFIX/bin/$command_name" ]]; then
    printf '%s\n' "$NPM_GLOBAL_PREFIX/bin/$command_name"
    return
  fi

  printf '\n'
}

resolve_realpath_fallback() {
  local target_path="$1"

  if command_exists realpath; then
    realpath "$target_path"
    return
  fi

  "$NODE_BIN" -e 'const fs=require("node:fs"); const path=require("node:path"); console.log(fs.realpathSync(path.resolve(process.argv[1])));' "$target_path"
}

resolve_codingns_script_path() {
  local binary_path="$1"
  local resolved_path=""
  local private_package_root=""
  local shim_target=""

  [[ -n "$binary_path" ]] || return 1
  [[ -n "$NODE_BIN" ]] || return 1

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    private_package_root="$(resolve_private_package_root_from_command_name "$NPM_GLOBAL_PREFIX" "codingns" || true)"
    if [[ -z "$private_package_root" ]]; then
      private_package_root="$(resolve_private_package_root_from_spec "$NPM_GLOBAL_PREFIX" "$PACKAGE_SPEC" || true)"
    fi
    if [[ -n "$private_package_root" && -f "$private_package_root/bin/codingns.mjs" ]]; then
      printf '%s\n' "$private_package_root/bin/codingns.mjs"
      return 0
    fi
  fi

  resolved_path="$(resolve_realpath_fallback "$binary_path" 2>/dev/null || true)"
  resolved_path="$(trim "$resolved_path")"

  if [[ -z "$resolved_path" ]]; then
    return 1
  fi

  if [[ "$resolved_path" == *.cmd || "$resolved_path" == *.ps1 ]]; then
    shim_target="$(resolve_script_from_npm_shim "$resolved_path" 2>/dev/null || true)"
    shim_target="$(trim "$shim_target")"
    if [[ -n "$shim_target" && -f "$shim_target" ]]; then
      printf '%s\n' "$shim_target"
      return 0
    fi
  fi

  if [[ ! -f "$resolved_path" ]]; then
    return 1
  fi

  printf '%s\n' "$resolved_path"
}

write_private_runtime_state() {
  if [[ "$PRIVATE_INSTALL_CONTEXT" != "1" ]]; then
    return
  fi

  local install_state_path="$PRIVATE_SERVICE_STATE_DIR/install-state.json"
  local previous_state_path="$PRIVATE_SERVICE_STATE_DIR/install-state.previous.json"
  local launch_env_path="$PRIVATE_SERVICE_STATE_DIR/launch-env.json"

  mkdir -p "$PRIVATE_SERVICE_STATE_DIR"

  if [[ -f "$install_state_path" ]]; then
    cp "$install_state_path" "$previous_state_path"
  fi

  CODINGNS_STATE_PACKAGE_NAME="${CODINGNS_PACKAGE_NAME:-$PACKAGE_SPEC}" \
  CODINGNS_STATE_PACKAGE_VERSION="${CODINGNS_PACKAGE_VERSION}" \
  CODINGNS_STATE_PTY_PACKAGE_NAME="${CODINGNS_PTY_PACKAGE_NAME}" \
  CODINGNS_STATE_PTY_PACKAGE_VERSION="${CODINGNS_PTY_PACKAGE_VERSION}" \
  CODINGNS_STATE_BETTER_SQLITE_PACKAGE_NAME="${CODINGNS_BETTER_SQLITE_PACKAGE_NAME}" \
  CODINGNS_STATE_BETTER_SQLITE_PACKAGE_VERSION="${CODINGNS_BETTER_SQLITE_PACKAGE_VERSION}" \
  CODINGNS_STATE_PACKAGE_SPEC="${PACKAGE_SPEC}" \
  CODINGNS_STATE_REGISTRY="${ACTIVE_NPM_REGISTRY}" \
  CODINGNS_STATE_NODE_VERSION="$(normalize_version_text "${TARGET_NODE_VERSION:-$WINDOWS_PRIVATE_NODE_VERSION}")" \
  CODINGNS_STATE_NODE_EXE="${NODE_BIN}" \
  CODINGNS_STATE_NPM_CMD="${NPM_BIN}" \
  CODINGNS_STATE_NPM_PREFIX="${NPM_GLOBAL_PREFIX}" \
  CODINGNS_STATE_PM2_HOME="${PRIVATE_PM2_HOME}" \
  CODINGNS_STATE_CODINGNS_COMMAND="${CODINGNS_BIN}" \
  CODINGNS_STATE_PM2_COMMAND="${PM2_BIN}" \
  CODINGNS_STATE_DATA_DIR="${SELECTED_DATA_DIR}" \
  CODINGNS_STATE_PORT="${SELECTED_PORT}" \
  CODINGNS_STATE_PROCESS_NAME="${PROCESS_NAME}" \
  CODINGNS_STATE_INSTALLED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$NODE_BIN" - "$install_state_path" <<'EOF'
const fs = require("node:fs");

const outputPath = process.argv[2];
const payload = {
  schemaVersion: 1,
  packageName: process.env.CODINGNS_STATE_PACKAGE_NAME ?? "",
  packageVersion: process.env.CODINGNS_STATE_PACKAGE_VERSION ?? "",
  ptyPackageName: process.env.CODINGNS_STATE_PTY_PACKAGE_NAME ?? "",
  ptyPackageVersion: process.env.CODINGNS_STATE_PTY_PACKAGE_VERSION ?? "",
  betterSqlitePackageName: process.env.CODINGNS_STATE_BETTER_SQLITE_PACKAGE_NAME ?? "",
  betterSqlitePackageVersion: process.env.CODINGNS_STATE_BETTER_SQLITE_PACKAGE_VERSION ?? "",
  packageSpec: process.env.CODINGNS_STATE_PACKAGE_SPEC ?? "",
  registry: process.env.CODINGNS_STATE_REGISTRY ?? "",
  nodeVersion: process.env.CODINGNS_STATE_NODE_VERSION ?? "",
  nodeExe: process.env.CODINGNS_STATE_NODE_EXE ?? "",
  npmCmd: process.env.CODINGNS_STATE_NPM_CMD ?? "",
  npmPrefix: process.env.CODINGNS_STATE_NPM_PREFIX ?? "",
  pm2Home: process.env.CODINGNS_STATE_PM2_HOME ?? "",
  codingnsCommand: process.env.CODINGNS_STATE_CODINGNS_COMMAND ?? "",
  pm2Command: process.env.CODINGNS_STATE_PM2_COMMAND ?? "",
  dataDir: process.env.CODINGNS_STATE_DATA_DIR ?? "",
  port: Number(process.env.CODINGNS_STATE_PORT ?? "0"),
  processName: process.env.CODINGNS_STATE_PROCESS_NAME ?? "",
  installedAt: process.env.CODINGNS_STATE_INSTALLED_AT ?? ""
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
EOF

  CODINGNS_LAUNCH_PATH="${PRIVATE_NODE_VERSION_DIR}:${PRIVATE_NPM_PREFIX}:${SYSTEM_PATH_SNAPSHOT}" \
  CODINGNS_LAUNCH_PM2_HOME="${PRIVATE_PM2_HOME}" \
  CODINGNS_LAUNCH_NPM_PREFIX="${PRIVATE_NPM_PREFIX}" \
  CODINGNS_LAUNCH_NPM_CACHE="${PRIVATE_NPM_CACHE_DIR}" \
  CODINGNS_LAUNCH_NPM_USERCONFIG="${PRIVATE_NPM_USERCONFIG}" \
  CODINGNS_LAUNCH_DATA_DIR="${SELECTED_DATA_DIR}" \
  CODINGNS_LAUNCH_RUNTIME_ROOT="${RUNTIME_HOME}" \
  CODINGNS_LAUNCH_RUNTIME_NODE_VERSION="${WINDOWS_PRIVATE_NODE_VERSION}" \
  CODINGNS_LAUNCH_PM2_PROCESS_NAME="${PROCESS_NAME}" \
    "$NODE_BIN" - "$launch_env_path" <<'EOF'
const fs = require("node:fs");

const outputPath = process.argv[2];
const payload = {
  PATH: process.env.CODINGNS_LAUNCH_PATH ?? "",
  PM2_HOME: process.env.CODINGNS_LAUNCH_PM2_HOME ?? "",
  npm_config_prefix: process.env.CODINGNS_LAUNCH_NPM_PREFIX ?? "",
  npm_config_cache: process.env.CODINGNS_LAUNCH_NPM_CACHE ?? "",
  npm_config_userconfig: process.env.CODINGNS_LAUNCH_NPM_USERCONFIG ?? "",
  CODINGNS_DATA_DIR: process.env.CODINGNS_LAUNCH_DATA_DIR ?? "",
  CODINGNS_RUNTIME_ROOT: process.env.CODINGNS_LAUNCH_RUNTIME_ROOT ?? "",
  CODINGNS_RUNTIME_NODE_VERSION: process.env.CODINGNS_LAUNCH_RUNTIME_NODE_VERSION ?? "",
  CODINGNS_PM2_PROCESS_NAME: process.env.CODINGNS_LAUNCH_PM2_PROCESS_NAME ?? ""
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
EOF
}

collect_access_urls() {
  local port="$1"

  if [[ -z "$NODE_BIN" ]]; then
    printf '%s\n' "http://127.0.0.1:${port}/"
    printf '%s\n' "http://localhost:${port}/"
    return
  fi

  "$NODE_BIN" - "$port" <<'EOF'
const os = require("node:os");

const port = process.argv[2];
const urls = new Set([
  `http://127.0.0.1:${port}/`,
  `http://localhost:${port}/`
]);

const hostname = os.hostname().trim();
if (hostname && hostname !== "localhost") {
  urls.add(`http://${hostname}:${port}/`);
}

for (const entries of Object.values(os.networkInterfaces())) {
  for (const entry of entries ?? []) {
    if (!entry || entry.internal) {
      continue;
    }

    const family = typeof entry.family === "string" ? entry.family : `IPv${entry.family}`;

    if (family === "IPv4") {
      urls.add(`http://${entry.address}:${port}/`);
      continue;
    }

    if (family === "IPv6" && !entry.address.startsWith("fe80:")) {
      urls.add(`http://[${entry.address}]:${port}/`);
    }
  }
}

for (const url of urls) {
  console.log(url);
}
EOF
}

ensure_registry_if_needed() {
  if [[ "$INSTALL_CODINGNS" == "1" || "$INSTALL_PM2" == "1" ]]; then
    resolve_registry
  fi
}

install_opencode_if_requested() {
  if [[ "$INSTALL_OPENCODE" != "1" ]]; then
    return
  fi

  if ! command_exists curl; then
    say_warn warn_opencode_install_requires_curl
    return
  fi

  say_info info_installing_opencode

  if [[ "$DRY_RUN" == "1" ]]; then
    say_info_custom "curl -fsSL https://opencode.ai/install | bash"
    return
  fi

  if curl -fsSL https://opencode.ai/install | bash; then
    say_info info_opencode_installed
    return
  fi

  say_warn warn_opencode_install_failed
}

install_or_resolve_codingns() {
  if [[ "$INSTALL_CODINGNS" == "1" ]]; then
    say_info info_installing_codingns
    install_global_package "$PACKAGE_SPEC" "CodingNS"
    CODINGNS_BIN="$(resolve_installed_binary "codingns")"
    [[ -n "$CODINGNS_BIN" ]] || die error_no_codingns_after_install
  else
    say_info info_skip_codingns
    CODINGNS_BIN="$(resolve_installed_binary "codingns")"
    [[ -n "$CODINGNS_BIN" ]] || die error_skip_codingns_without_existing
  fi

  CODINGNS_SCRIPT="$(resolve_codingns_script_path "$CODINGNS_BIN" || true)"
  [[ -n "$CODINGNS_SCRIPT" ]] || die error_no_codingns_after_install

  CODINGNS_PACKAGE_ROOT="$(resolve_private_package_root_from_command_name "$NPM_GLOBAL_PREFIX" "codingns" || true)"
  if [[ -z "$CODINGNS_PACKAGE_ROOT" ]]; then
    CODINGNS_PACKAGE_ROOT="$(resolve_private_package_root_from_spec "$NPM_GLOBAL_PREFIX" "$PACKAGE_SPEC" || true)"
  fi
  if [[ -z "$CODINGNS_PACKAGE_ROOT" && -n "$CODINGNS_SCRIPT" ]]; then
    CODINGNS_PACKAGE_ROOT="$(dirname "$(dirname "$CODINGNS_SCRIPT")")"
  fi

  if [[ -n "$CODINGNS_PACKAGE_ROOT" && -f "$CODINGNS_PACKAGE_ROOT/package.json" ]]; then
    CODINGNS_PACKAGE_NAME="$(read_package_json_field "$CODINGNS_PACKAGE_ROOT/package.json" "name" || true)"
    CODINGNS_PACKAGE_VERSION="$(read_package_json_field "$CODINGNS_PACKAGE_ROOT/package.json" "version" || true)"
  fi

  if [[ -z "$CODINGNS_PACKAGE_NAME" ]]; then
    local local_package_spec_dir=""
    local metadata_path=""
    local_package_spec_dir="$(resolve_local_package_spec_dir "$PACKAGE_SPEC" || true)"
    metadata_path="$local_package_spec_dir/.codingns-install-metadata.json"
    if [[ -f "$metadata_path" ]]; then
      CODINGNS_PACKAGE_NAME="$(read_install_metadata_field "$metadata_path" "packageName" || true)"
      CODINGNS_PACKAGE_VERSION="$(read_install_metadata_field "$metadata_path" "packageVersion" || true)"
    fi
  fi

  if [[ -z "$CODINGNS_PACKAGE_NAME" && -n "$CODINGNS_SCRIPT" ]]; then
    local resolved_package_root=""
    resolved_package_root="$(dirname "$(dirname "$CODINGNS_SCRIPT")")"
    if [[ -f "$resolved_package_root/package.json" ]]; then
      CODINGNS_PACKAGE_ROOT="$resolved_package_root"
      CODINGNS_PACKAGE_NAME="$(read_package_json_field "$resolved_package_root/package.json" "name" || true)"
      CODINGNS_PACKAGE_VERSION="$(read_package_json_field "$resolved_package_root/package.json" "version" || true)"
    fi
  fi

  [[ -n "$CODINGNS_PACKAGE_NAME" ]] || CODINGNS_PACKAGE_NAME="$(extract_package_name_from_spec "$PACKAGE_SPEC")"
  resolve_codingns_pty_dependency_metadata
  resolve_codingns_better_sqlite_dependency_metadata
}

install_or_resolve_pm2() {
  if [[ "$USE_PM2" != "1" ]]; then
    say_info info_skip_pm2_management
    return
  fi

  PM2_BIN="$(resolve_installed_binary "pm2")"
  if [[ -n "$PM2_BIN" ]]; then
    say_info info_using_existing_pm2
    return
  fi

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" || "$INSTALL_PM2" == "1" ]]; then
    say_info info_installing_pm2_missing
    install_global_package "$PM2_PACKAGE_SPEC" "PM2"
  fi

  PM2_BIN="$(resolve_installed_binary "pm2")"
  [[ -n "$PM2_BIN" ]] || die error_no_pm2_after_install
}

write_private_pm2_start_script() {
  if [[ "$PRIVATE_INSTALL_CONTEXT" != "1" ]]; then
    return
  fi

  [[ -n "$NODE_BIN" ]] || die error_no_node
  [[ -n "$CODINGNS_SCRIPT" ]] || die error_no_codingns_after_install

  PRIVATE_PM2_START_SCRIPT="$PRIVATE_SERVICE_STATE_DIR/start-codingns.mjs"
  mkdir -p "$PRIVATE_SERVICE_STATE_DIR"

  local native_pm2_start_script=""
  local native_codingns_script=""
  local native_data_dir=""
  native_pm2_start_script="$(native_path_for_node_runtime "$PRIVATE_PM2_START_SCRIPT")"
  native_codingns_script="$(native_path_for_node_runtime "$CODINGNS_SCRIPT")"
  native_data_dir="$(native_path_for_node_runtime "$SELECTED_DATA_DIR")"

  CODINGNS_PM2_TARGET_SCRIPT="$native_codingns_script" \
  CODINGNS_PM2_TARGET_PORT="$SELECTED_PORT" \
  CODINGNS_PM2_TARGET_DATA_DIR="$native_data_dir" \
    "$NODE_BIN" - "$native_pm2_start_script" <<'EOF'
const fs = require("node:fs");

const outputPath = process.argv[2];
const targetScript = process.env.CODINGNS_PM2_TARGET_SCRIPT ?? "";
const targetPort = process.env.CODINGNS_PM2_TARGET_PORT ?? "";
const targetDataDir = process.env.CODINGNS_PM2_TARGET_DATA_DIR ?? "";

const script = `import { spawn } from "node:child_process";

const child = spawn(process.execPath, [
  ${JSON.stringify(targetScript)},
  "start",
  "--host",
  "0.0.0.0",
  "--port",
  ${JSON.stringify(targetPort)},
  "--data-dir",
  ${JSON.stringify(targetDataDir)}
], {
  stdio: "inherit",
  windowsHide: true
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[codingns-pm2] 启动失败：" + (error?.message || error));
  process.exit(1);
});
`;

fs.writeFileSync(outputPath, script);
EOF
}

start_pm2_service() {
  if [[ "$USE_PM2" != "1" || "$START_PM2_SERVICE" != "1" ]]; then
    say_info info_skip_service_start
    return
  fi

  mkdir -p "$SELECTED_DATA_DIR"

  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$PM2_BIN\" delete $PROCESS_NAME"
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$PM2_BIN\" start $PRIVATE_SERVICE_STATE_DIR/start-codingns.mjs --name $PROCESS_NAME --cwd $SELECTED_DATA_DIR --interpreter $NODE_BIN"
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$PM2_BIN\" save"
    else
      say_info_custom "pm2 delete $PROCESS_NAME"
      say_info_custom "pm2 start $NODE_BIN --name $PROCESS_NAME --cwd $HOME --interpreter none -- $CODINGNS_SCRIPT start --host 0.0.0.0 --port $SELECTED_PORT --data-dir $SELECTED_DATA_DIR"
      say_info_custom "pm2 save"
    fi
    return
  fi

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    write_private_pm2_start_script

    if env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" describe "$PROCESS_NAME" >/dev/null 2>&1; then
      say_info info_existing_pm2_process "$PROCESS_NAME"
      env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" delete "$PROCESS_NAME" >/dev/null 2>&1 || true
    fi

    local native_pm2_start_script=""
    local native_service_cwd=""
    local native_node_bin=""
    native_pm2_start_script="$(native_path_for_node_runtime "$PRIVATE_PM2_START_SCRIPT")"
    native_service_cwd="$(native_path_for_node_runtime "$SELECTED_DATA_DIR")"
    native_node_bin="$(native_path_for_node_runtime "$NODE_BIN")"

    env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" start "$native_pm2_start_script" --name "$PROCESS_NAME" --cwd "$native_service_cwd" --interpreter "$native_node_bin"

    env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" save >/dev/null
    return
  fi

  if "$PM2_BIN" describe "$PROCESS_NAME" >/dev/null 2>&1; then
    say_info info_existing_pm2_process "$PROCESS_NAME"
    "$PM2_BIN" delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  fi

  "$PM2_BIN" start "$NODE_BIN" --name "$PROCESS_NAME" --cwd "$HOME" --interpreter none -- \
    "$CODINGNS_SCRIPT" start --host 0.0.0.0 --port "$SELECTED_PORT" --data-dir "$SELECTED_DATA_DIR"

  "$PM2_BIN" save >/dev/null
}

configure_startup() {
  if [[ "$USE_PM2" != "1" || "$START_PM2_SERVICE" != "1" || "$ENABLE_STARTUP" != "1" ]]; then
    say_info info_skip_startup
    return
  fi

  local system_name startup_platform
  system_name="$(uname -s)"
  startup_platform=""

  case "$system_name" in
    Darwin)
      startup_platform="launchd"
      ;;
    Linux)
      if command_exists systemctl; then
        startup_platform="systemd"
      fi
      ;;
  esac

  if [[ -z "$startup_platform" ]]; then
    say_warn warn_no_startup_platform
    return
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$PM2_BIN\" startup $startup_platform -u $USER --hp $HOME"
      say_info_custom "env ${INSTALL_ENV_ARGS[*]} \"$PM2_BIN\" save"
    else
      say_info_custom "pm2 startup $startup_platform -u $USER --hp $HOME"
      say_info_custom "pm2 save"
    fi
    return
  fi

  say_info info_configuring_startup "$startup_platform"

  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    if [[ "$startup_platform" == "systemd" ]]; then
      if is_root_user; then
        env PATH="$PATH" "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" startup systemd -u "$USER" --hp "$HOME"
      elif command_exists sudo; then
        sudo env PATH="$PATH" "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" startup systemd -u "$USER" --hp "$HOME"
      else
        say_warn warn_linux_startup_no_sudo
        return
      fi
    else
      env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" startup launchd -u "$USER" --hp "$HOME"
    fi

    env "${INSTALL_ENV_ARGS[@]}" "$PM2_BIN" save >/dev/null
    return
  fi

  if [[ "$startup_platform" == "systemd" ]]; then
    if is_root_user; then
      env PATH="$PATH" "$PM2_BIN" startup systemd -u "$USER" --hp "$HOME"
    elif command_exists sudo; then
      sudo env PATH="$PATH" "$PM2_BIN" startup systemd -u "$USER" --hp "$HOME"
    else
      say_warn warn_linux_startup_no_sudo
      return
    fi
  else
    "$PM2_BIN" startup launchd -u "$USER" --hp "$HOME"
  fi

  "$PM2_BIN" save >/dev/null
}

print_success_summary() {
  printf '\n'
  say_info info_done
  printf -- '- %s\n' "$(msg info_data_dir "$SELECTED_DATA_DIR")"

  if [[ "$ACTIVE_NPM_REGISTRY" != "" ]]; then
    printf -- '- %s\n' "$(msg info_registry "$ACTIVE_NPM_REGISTRY")"
  fi
  if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
    printf -- '- %s\n' "$(msg info_runtime_node "${TARGET_NODE_VERSION:-v$WINDOWS_PRIVATE_NODE_VERSION}")"
    printf -- '- %s\n' "$(msg info_runtime_prefix "$NPM_GLOBAL_PREFIX")"
    printf -- '- %s\n' "$(msg info_runtime_pm2_home "$PRIVATE_PM2_HOME")"
    if [[ -n "$CODINGNS_PTY_PACKAGE_NAME" ]]; then
      local runtime_pty_summary="$CODINGNS_PTY_PACKAGE_NAME"
      if [[ -n "$CODINGNS_PTY_PACKAGE_VERSION" ]]; then
        runtime_pty_summary="${runtime_pty_summary}@${CODINGNS_PTY_PACKAGE_VERSION}"
      fi
      printf -- '- %s\n' "$(msg info_runtime_pty "$runtime_pty_summary")"
    fi

    if [[ -n "$CODINGNS_BETTER_SQLITE_PACKAGE_NAME" ]]; then
      local runtime_better_sqlite_summary="$CODINGNS_BETTER_SQLITE_PACKAGE_NAME"
      if [[ -n "$CODINGNS_BETTER_SQLITE_PACKAGE_VERSION" ]]; then
        runtime_better_sqlite_summary="${runtime_better_sqlite_summary}@${CODINGNS_BETTER_SQLITE_PACKAGE_VERSION}"
      fi
      printf -- '- %s\n' "$(msg info_runtime_better_sqlite "$runtime_better_sqlite_summary")"
    fi
  fi

  printf '\n'
  say_info info_access_title
  while IFS= read -r access_url; do
    [[ -n "$access_url" ]] || continue
    printf -- '- %s\n' "$access_url"
  done < <(collect_access_urls "$SELECTED_PORT")

  printf '\n'
  say_info info_password_title
  printf -- '- %s\n' "$(msg info_password_none)"
  printf -- '- %s\n' "$(msg info_password_setup_hint)"

  printf '\n'
  say_info info_pm2_title
  if [[ "$USE_PM2" == "1" ]]; then
    printf -- '- %s\n' "$(msg info_process_name "$PROCESS_NAME")"
    if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
      printf -- '- env PM2_HOME=%s %s status\n' "$PRIVATE_PM2_HOME" "$PM2_BIN"
      printf -- '- env PM2_HOME=%s %s logs %s\n' "$PRIVATE_PM2_HOME" "$PM2_BIN" "$PROCESS_NAME"
      printf -- '- env PM2_HOME=%s %s restart %s\n' "$PRIVATE_PM2_HOME" "$PM2_BIN" "$PROCESS_NAME"
      printf -- '- env PM2_HOME=%s %s stop %s\n' "$PRIVATE_PM2_HOME" "$PM2_BIN" "$PROCESS_NAME"
    else
      printf -- '- pm2 status\n'
      printf -- '- pm2 logs %s\n' "$PROCESS_NAME"
      printf -- '- pm2 restart %s\n' "$PROCESS_NAME"
      printf -- '- pm2 stop %s\n' "$PROCESS_NAME"
    fi
    if [[ "$START_PM2_SERVICE" != "1" ]]; then
      if [[ "$PRIVATE_INSTALL_CONTEXT" == "1" ]]; then
        printf -- '- env PM2_HOME=%s %s start %s --name %s --cwd %s --interpreter %s\n' "$PRIVATE_PM2_HOME" "$PM2_BIN" "$PRIVATE_SERVICE_STATE_DIR/start-codingns.mjs" "$PROCESS_NAME" "$SELECTED_DATA_DIR" "$NODE_BIN"
      else
        printf -- '- pm2 start %s --name %s --cwd %s --interpreter none -- %s start --host 0.0.0.0 --port %s --data-dir %s\n' "$NODE_BIN" "$PROCESS_NAME" "$HOME" "$CODINGNS_SCRIPT" "$SELECTED_PORT" "$SELECTED_DATA_DIR"
      fi
    fi
  else
    printf -- '- %s\n' "$(msg info_pm2_skipped)"
  fi

  if [[ "$USE_PM2" != "1" || "$START_PM2_SERVICE" != "1" ]]; then
    printf '\n'
    say_info info_manual_start_title
    printf '%s start --host 0.0.0.0 --port %s --data-dir %s\n' "$CODINGNS_BIN" "$SELECTED_PORT" "$SELECTED_DATA_DIR"
  fi

  printf '\n'
  say_info info_open_docs_title
  printf '%s\n' "$(msg info_docs_link)"
}

main() {
  init_prompt_input
  choose_language
  ensure_prerequisites

  say_info info_intro "$PACKAGE_SPEC"
  collect_install_options
  print_install_summary

  if [[ "$(read_yes_no "$(msg prompt_confirm_plan)" "y")" != "1" ]]; then
    say_info prompt_aborted
    exit 0
  fi

  printf '\n'
  say_info info_begin
  install_opencode_if_requested
  prepare_windows_install_runtime
  ensure_registry_if_needed
  install_or_resolve_codingns
  install_or_resolve_pm2
  write_private_pm2_start_script
  write_private_runtime_state
  start_pm2_service
  configure_startup
  print_success_summary
}

main "$@"
