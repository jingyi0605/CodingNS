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
    zh:info_configuring_startup) printf '开始配置 PM2 开机自启（%s）...' "$@";;
    en:info_configuring_startup) printf 'Configuring PM2 to start on boot (%s)...' "$@";;
    zh:info_done) printf '安装流程已完成。';;
    en:info_done) printf 'The installation flow is complete.';;
    zh:info_registry) printf '当前 npm 源：%s' "$@";;
    en:info_registry) printf 'Registry used: %s' "$@";;
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

is_root_user() {
  [[ "$(id -u)" -eq 0 ]]
}

refresh_runtime_binaries() {
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
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

collect_prerequisite_issues() {
  PREREQUISITE_ISSUES=()
  refresh_runtime_binaries

  local node_version="" npm_version="" node_major="" npm_major=""

  if [[ -z "$NODE_BIN" ]]; then
    PREREQUISITE_ISSUES+=("error_no_node")
  else
    node_version="$("$NODE_BIN" -v 2>/dev/null || true)"
    node_major="$(read_major_version "$node_version")"
    if [[ -z "$node_major" ]]; then
      PREREQUISITE_ISSUES+=("error_read_node_version|$node_version")
    elif (( node_major < 22 )); then
      PREREQUISITE_ISSUES+=("error_bad_node_version|$node_version")
    fi
  fi

  if [[ -z "$NPM_BIN" ]]; then
    PREREQUISITE_ISSUES+=("error_no_npm")
  else
    npm_version="$("$NPM_BIN" -v 2>/dev/null || true)"
    npm_major="$(read_major_version "$npm_version")"
    if [[ -z "$npm_major" ]]; then
      PREREQUISITE_ISSUES+=("error_read_npm_version|$npm_version")
    elif (( npm_major < 10 )); then
      PREREQUISITE_ISSUES+=("error_bad_npm_version|$npm_version")
    fi
  fi

  if [[ "$(uname -s)" == "Linux" ]]; then
    command_exists make || PREREQUISITE_ISSUES+=("error_no_make")
    command_exists g++ || PREREQUISITE_ISSUES+=("error_no_cpp_compiler")
    command_exists python3 || PREREQUISITE_ISSUES+=("error_no_python3")
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

  ensure_npm_install_context
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
  "$NPM_BIN" view "$PACKAGE_SPEC" version \
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

install_global_package_once() {
  local registry_url="$1"
  local package_spec="$2"

  if [[ "$DRY_RUN" == "1" ]]; then
    say_info_custom "npm install -g --registry $registry_url $package_spec"
    return 0
  fi

  run_with_optional_sudo env npm_config_registry="$registry_url" \
    "$NPM_BIN" install -g "$package_spec" \
    --registry "$registry_url" \
    --fetch-retries=1 \
    --fetch-timeout=20000 \
    --foreground-scripts
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

resolve_installed_binary() {
  local command_name="$1"
  local candidate=""

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
    return
  fi

  say_info info_skip_codingns
  CODINGNS_BIN="$(resolve_installed_binary "codingns")"
  [[ -n "$CODINGNS_BIN" ]] || die error_skip_codingns_without_existing
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

  if [[ "$INSTALL_PM2" == "1" ]]; then
    say_info info_installing_pm2_missing
    install_global_package "$PM2_PACKAGE_SPEC" "PM2"
  fi

  PM2_BIN="$(resolve_installed_binary "pm2")"
  [[ -n "$PM2_BIN" ]] || die error_no_pm2_after_install
}

start_pm2_service() {
  if [[ "$USE_PM2" != "1" || "$START_PM2_SERVICE" != "1" ]]; then
    say_info info_skip_service_start
    return
  fi

  mkdir -p "$SELECTED_DATA_DIR"

  if [[ "$DRY_RUN" == "1" ]]; then
    say_info_custom "pm2 delete $PROCESS_NAME"
    say_info_custom "pm2 start $CODINGNS_BIN --name $PROCESS_NAME -- start --host 0.0.0.0 --port $SELECTED_PORT --data-dir $SELECTED_DATA_DIR"
    say_info_custom "pm2 save"
    return
  fi

  if "$PM2_BIN" describe "$PROCESS_NAME" >/dev/null 2>&1; then
    say_info info_existing_pm2_process "$PROCESS_NAME"
    "$PM2_BIN" delete "$PROCESS_NAME" >/dev/null 2>&1 || true
  fi

  "$PM2_BIN" start "$CODINGNS_BIN" --name "$PROCESS_NAME" -- \
    start --host 0.0.0.0 --port "$SELECTED_PORT" --data-dir "$SELECTED_DATA_DIR"

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
    say_info_custom "pm2 startup $startup_platform -u $USER --hp $HOME"
    say_info_custom "pm2 save"
    return
  fi

  say_info info_configuring_startup "$startup_platform"

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
    printf -- '- pm2 status\n'
    printf -- '- pm2 logs %s\n' "$PROCESS_NAME"
    printf -- '- pm2 restart %s\n' "$PROCESS_NAME"
    printf -- '- pm2 stop %s\n' "$PROCESS_NAME"
    if [[ "$START_PM2_SERVICE" != "1" ]]; then
      printf -- '- pm2 start %s --name %s -- start --host 0.0.0.0 --port %s --data-dir %s\n' "$CODINGNS_BIN" "$PROCESS_NAME" "$SELECTED_PORT" "$SELECTED_DATA_DIR"
    fi
  else
    printf -- '- %s\n' "$(msg info_pm2_skipped)"
  fi

  if [[ "$USE_PM2" != "1" || "$START_PM2_SERVICE" != "1" ]]; then
    printf '\n'
    say_info info_manual_start_title
    printf 'codingns start --host 0.0.0.0 --port %s --data-dir %s\n' "$SELECTED_PORT" "$SELECTED_DATA_DIR"
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
  ensure_registry_if_needed
  install_or_resolve_codingns
  install_or_resolve_pm2
  start_pm2_service
  configure_startup
  print_success_summary
}

main "$@"
