#!/usr/bin/env bash
#
# CodingNS 发布前统一校验脚本
# 目标：
# 1. 先做本地 npm 打包测试，尽早挡住发布包结构问题
# 2. 只推送一次当前 HEAD 到 GitHub 临时分支
# 3. 并行触发桌面端验包和 Windows 安装回放
# 4. 统一等待结果，并输出每条 workflow 的 run 链接
#
# 用法：
#   bash scripts/verify-release-ci.sh
#   bash scripts/verify-release-ci.sh --allow-dirty
#   bash scripts/verify-release-ci.sh --no-wait --keep-remote-branch
#   bash scripts/verify-release-ci.sh --skip-local-pack
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_REMOTE="github"
DEFAULT_BRANCH_PREFIX="ci/release-verify"
DESKTOP_WORKFLOW_ID=".github/workflows/desktop-release.yml"
WINDOWS_REPLAY_WORKFLOW_ID=".github/workflows/windows-install-replay.yml"

REMOTE_NAME="$DEFAULT_REMOTE"
BRANCH_PREFIX="$DEFAULT_BRANCH_PREFIX"
BRANCH_NAME=""
REPO_SLUG=""
HEAD_SHA=""
GH_GIT_CREDENTIAL_HELPER=""
ALLOW_DIRTY=0
WAIT_FOR_COMPLETION=1
KEEP_REMOTE_BRANCH=0
DRY_RUN=0
RUN_LOCAL_PACK=1
RUN_DESKTOP=1
RUN_WINDOWS_REPLAY=1
REMOTE_BRANCH_PUSHED=0
OVERALL_EXIT_CODE=0

RUN_WORKFLOW_IDS=()
RUN_WORKFLOW_LABELS=()
RUN_DATABASE_IDS=()
RUN_URLS=()

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
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

print_usage() {
  cat <<'EOF'
用法：
  bash scripts/verify-release-ci.sh [选项]

选项：
  --remote <name>              Git 远端名称，默认 github
  --repo <owner/repo>          手工指定 GitHub 仓库，默认从远端 URL 推断
  --branch-prefix <prefix>     临时分支前缀，默认 ci/release-verify
  --branch-name <name>         显式指定临时分支名
  --allow-dirty                允许工作区有未提交改动，但远端只验证当前 HEAD 提交
  --no-wait                    触发远端工作流后不等待完成
  --keep-remote-branch         不自动删除 GitHub 临时分支
  --dry-run                    只打印将执行的动作，不真正执行
  --skip-local-pack            跳过本地 npm 打包测试
  --skip-desktop               跳过远端桌面端验包
  --skip-windows-replay        跳过远端 Windows 安装回放
  -h, --help                   显示帮助

说明：
  1. 默认会执行三段校验：本地 npm 打包、desktop-release、windows-install-replay。
  2. 远端 workflow 会复用同一个 GitHub 临时分支，不会切换本地分支。
  3. 默认等待远端 workflow 完成，并在结束后自动删除 GitHub 临时分支。
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "缺少命令: $1"
    exit 1
  fi
}

ensure_non_empty_arg() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    log_error "参数缺少值: $name"
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --remote)
        REMOTE_NAME="${2:-}"
        shift 2
        ;;
      --repo)
        REPO_SLUG="${2:-}"
        shift 2
        ;;
      --branch-prefix)
        BRANCH_PREFIX="${2:-}"
        shift 2
        ;;
      --branch-name)
        BRANCH_NAME="${2:-}"
        shift 2
        ;;
      --allow-dirty)
        ALLOW_DIRTY=1
        shift
        ;;
      --no-wait)
        WAIT_FOR_COMPLETION=0
        shift
        ;;
      --keep-remote-branch)
        KEEP_REMOTE_BRANCH=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --skip-local-pack)
        RUN_LOCAL_PACK=0
        shift
        ;;
      --skip-desktop)
        RUN_DESKTOP=0
        shift
        ;;
      --skip-windows-replay)
        RUN_WINDOWS_REPLAY=0
        shift
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        log_error "未知参数: $1"
        print_usage
        exit 1
        ;;
    esac
  done
}

validate_args() {
  ensure_non_empty_arg "--remote" "$REMOTE_NAME"
  ensure_non_empty_arg "--branch-prefix" "$BRANCH_PREFIX"

  if [[ -n "$BRANCH_NAME" ]]; then
    ensure_non_empty_arg "--branch-name" "$BRANCH_NAME"
  fi

  if [[ "$RUN_LOCAL_PACK" -eq 0 && "$RUN_DESKTOP" -eq 0 && "$RUN_WINDOWS_REPLAY" -eq 0 ]]; then
    log_error "至少要保留一项校验，不能全部跳过。"
    exit 1
  fi

  if [[ "$WAIT_FOR_COMPLETION" -eq 0 && "$KEEP_REMOTE_BRANCH" -eq 0 ]]; then
    KEEP_REMOTE_BRANCH=1
    log_warn "--no-wait 下自动保留 GitHub 临时分支，避免 workflow 运行时失去分支引用。"
  fi
}

check_worktree_state() {
  if [[ -z "$(git status --short --untracked-files=all)" ]]; then
    return 0
  fi

  if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
    log_warn "检测到未提交改动，但远端 workflow 只会验证当前 HEAD 提交。未提交内容不会进入 GitHub Actions。"
    return 0
  fi

  log_error "检测到未提交改动。请先提交，或者明确加 --allow-dirty。"
  exit 1
}

resolve_repo_slug() {
  if [[ -n "$REPO_SLUG" ]]; then
    return 0
  fi

  local remote_url=""
  remote_url="$(git remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
  if [[ -z "$remote_url" ]]; then
    log_error "找不到远端: $REMOTE_NAME"
    exit 1
  fi

  REPO_SLUG="$(python3 - "$remote_url" <<'PY2'
import re
import sys

url = sys.argv[1].strip()
patterns = [
    r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$",
]

for pattern in patterns:
    match = re.search(pattern, url)
    if match:
        print(f"{match.group(1)}/{match.group(2)}")
        sys.exit(0)

sys.exit(1)
PY2
)" || {
    log_error "无法从远端 URL 解析 GitHub 仓库: $remote_url"
    exit 1
  }
}

check_github_auth() {
  if gh api user >/dev/null 2>&1; then
    return 0
  fi

  log_error "GitHub CLI 不可用。请先执行 gh auth login，或者提供可用的 GH_TOKEN / GITHUB_TOKEN。"
  exit 1
}

resolve_gh_git_credential_helper() {
  local gh_path=""

  gh_path="$(command -v gh)"
  if [[ -z "$gh_path" ]]; then
    log_error "找不到 gh 命令，无法为 git push 注入 GitHub 认证。"
    exit 1
  fi

  GH_GIT_CREDENTIAL_HELPER="!$gh_path auth git-credential"
}

git_push_with_gh_auth() {
  git \
    -c "credential.https://github.com.helper=" \
    -c "credential.https://github.com.helper=$GH_GIT_CREDENTIAL_HELPER" \
    push "$@"
}

cleanup_remote_branch() {
  if [[ "$KEEP_REMOTE_BRANCH" -eq 1 || "$DRY_RUN" -eq 1 || "$REMOTE_BRANCH_PUSHED" -ne 1 ]]; then
    return 0
  fi

  log_info "删除 GitHub 临时分支: $BRANCH_NAME"
  if git_push_with_gh_auth "$REMOTE_NAME" ":refs/heads/$BRANCH_NAME" >/dev/null 2>&1; then
    log_success "已删除 GitHub 临时分支: $BRANCH_NAME"
  else
    log_warn "GitHub 临时分支删除失败，请手工检查: $BRANCH_NAME"
  fi
}

trap cleanup_remote_branch EXIT

resolve_head_sha() {
  HEAD_SHA="$(git rev-parse HEAD)"
}

generate_branch_name() {
  if [[ -n "$BRANCH_NAME" ]]; then
    return 0
  fi

  BRANCH_NAME="${BRANCH_PREFIX}-$(date +%Y%m%d-%H%M%S)-${HEAD_SHA:0:7}"
}

append_workflow_once() {
  local workflow_id="$1"
  local workflow_label="$2"
  local index=""

  for index in "${!RUN_WORKFLOW_IDS[@]}"; do
    if [[ "${RUN_WORKFLOW_IDS[$index]}" == "$workflow_id" ]]; then
      return 0
    fi
  done

  RUN_WORKFLOW_IDS+=("$workflow_id")
  RUN_WORKFLOW_LABELS+=("$workflow_label")
}

prepare_workflows() {
  if [[ "$RUN_DESKTOP" -eq 1 ]]; then
    append_workflow_once "$DESKTOP_WORKFLOW_ID" "桌面端验包"
  fi

  if [[ "$RUN_WINDOWS_REPLAY" -eq 1 ]]; then
    append_workflow_once "$WINDOWS_REPLAY_WORKFLOW_ID" "Windows 安装回放"
  fi
}

print_summary() {
  local local_pack_label="跳过"
  local desktop_label="跳过"
  local windows_label="跳过"

  if [[ "$RUN_LOCAL_PACK" -eq 1 ]]; then
    local_pack_label="执行"
  fi
  if [[ "$RUN_DESKTOP" -eq 1 ]]; then
    desktop_label="执行"
  fi
  if [[ "$RUN_WINDOWS_REPLAY" -eq 1 ]]; then
    windows_label="执行"
  fi

  cat <<EOF
统一发布前校验参数：
  GitHub 仓库: $REPO_SLUG
  提交 SHA: $HEAD_SHA
  临时分支: $BRANCH_NAME
  本地 npm 打包测试: $local_pack_label
  远端桌面端验包: $desktop_label
  远端 Windows 安装回放: $windows_label
EOF
}

run_local_pack_test() {
  if [[ "$RUN_LOCAL_PACK" -ne 1 ]]; then
    return 0
  fi

  log_info "开始本地 npm 打包测试..."
  bash "$SCRIPT_DIR/test-package-builds.sh" 4
  log_success "本地 npm 打包测试通过"
}

push_temp_branch() {
  if [[ "${#RUN_WORKFLOW_IDS[@]}" -eq 0 ]]; then
    return 0
  fi

  log_info "推送当前 HEAD 到 GitHub 临时分支..."
  git_push_with_gh_auth "$REMOTE_NAME" "$HEAD_SHA:refs/heads/$BRANCH_NAME"
  REMOTE_BRANCH_PUSHED=1
  log_success "已推送 GitHub 临时分支: $BRANCH_NAME"
}

dispatch_workflow() {
  local workflow_id="$1"
  local workflow_label="$2"

  log_info "触发 ${workflow_label} workflow_dispatch..."
  gh workflow run "$workflow_id" --repo "$REPO_SLUG" --ref "$BRANCH_NAME"
  log_success "已触发 ${workflow_label}"
}

find_run_json() {
  local workflow_id="$1"

  gh run list \
    --repo "$REPO_SLUG" \
    --workflow "$workflow_id" \
    --branch "$BRANCH_NAME" \
    --event workflow_dispatch \
    --limit 20 \
    --json databaseId,headSha,status,conclusion,url,displayTitle,createdAt,workflowName | \
    python3 -c '
import json
import sys

workflow_head_sha = sys.argv[1]
runs = json.load(sys.stdin)
matched = [item for item in runs if item.get("headSha") == workflow_head_sha]
matched.sort(key=lambda item: (item.get("createdAt") or "", item.get("databaseId") or 0), reverse=True)

if matched:
    print(json.dumps(matched[0], ensure_ascii=False))
' "$HEAD_SHA"
}

wait_until_run_created() {
  local workflow_id="$1"
  local workflow_label="$2"
  local max_attempts=24
  local attempt=1
  local run_json=""

  while (( attempt <= max_attempts )); do
    run_json="$(find_run_json "$workflow_id" || true)"
    if [[ -n "$run_json" ]]; then
      printf '%s\n' "$run_json"
      return 0
    fi

    printf '%b[INFO]%b 等待 %s 创建 workflow run（%s/%s）...\n' "$BLUE" "$NC" "$workflow_label" "$attempt" "$max_attempts" >&2
    sleep 5
    attempt=$((attempt + 1))
  done

  log_error "超时：一直没查到 ${workflow_label} 的 workflow run。"
  exit 1
}

extract_json_field() {
  local json_input="$1"
  local field_name="$2"

  printf '%s' "$json_input" | python3 -c '
import json
import sys

field_name = sys.argv[1]
payload = json.load(sys.stdin)
value = payload.get(field_name, "")
if value is None:
    value = ""
print(value)
' "$field_name"
}

collect_runs() {
  local index=""
  local run_json=""
  local run_id=""
  local run_url=""

  RUN_DATABASE_IDS=()
  RUN_URLS=()

  for index in "${!RUN_WORKFLOW_IDS[@]}"; do
    run_json="$(wait_until_run_created "${RUN_WORKFLOW_IDS[$index]}" "${RUN_WORKFLOW_LABELS[$index]}")"
    run_id="$(extract_json_field "$run_json" "databaseId")"
    run_url="$(extract_json_field "$run_json" "url")"

    RUN_DATABASE_IDS+=("$run_id")
    RUN_URLS+=("$run_url")

    log_success "已找到 ${RUN_WORKFLOW_LABELS[$index]} run: $run_id"
    echo "Run 链接: $run_url"
  done
}

watch_run() {
  local run_id="$1"
  local workflow_label="$2"

  log_info "等待 ${workflow_label} 完成: $run_id"
  if ! gh run watch "$run_id" --repo "$REPO_SLUG" --interval 5 --compact --exit-status; then
    OVERALL_EXIT_CODE=1
  fi
}

show_final_result() {
  local run_id="$1"
  local workflow_label="$2"
  local final_json=""
  local conclusion=""
  local url=""

  final_json="$(gh run view "$run_id" --repo "$REPO_SLUG" --json conclusion,url,status)"
  conclusion="$(extract_json_field "$final_json" "conclusion")"
  url="$(extract_json_field "$final_json" "url")"

  if [[ "$conclusion" == "success" ]]; then
    log_success "${workflow_label} 通过"
  else
    log_error "${workflow_label} 失败: ${conclusion:-unknown}"
    OVERALL_EXIT_CODE=1
  fi

  echo "Run 链接: $url"
}

run_remote_workflows() {
  local index=""

  if [[ "${#RUN_WORKFLOW_IDS[@]}" -eq 0 ]]; then
    return 0
  fi

  check_github_auth
  resolve_gh_git_credential_helper
  push_temp_branch

  for index in "${!RUN_WORKFLOW_IDS[@]}"; do
    dispatch_workflow "${RUN_WORKFLOW_IDS[$index]}" "${RUN_WORKFLOW_LABELS[$index]}"
  done

  collect_runs

  if [[ "$WAIT_FOR_COMPLETION" -eq 0 ]]; then
    log_warn "已按要求跳过等待。请稍后查看上面的 run 链接。"
    return 0
  fi

  for index in "${!RUN_DATABASE_IDS[@]}"; do
    watch_run "${RUN_DATABASE_IDS[$index]}" "${RUN_WORKFLOW_LABELS[$index]}"
  done

  for index in "${!RUN_DATABASE_IDS[@]}"; do
    show_final_result "${RUN_DATABASE_IDS[$index]}" "${RUN_WORKFLOW_LABELS[$index]}"
  done

  return "$OVERALL_EXIT_CODE"
}

main() {
  parse_args "$@"
  validate_args

  require_command git
  require_command gh
  require_command python3

  cd "$REPO_DIR"

  check_worktree_state
  resolve_repo_slug
  resolve_head_sha
  generate_branch_name
  prepare_workflows
  print_summary

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_warn "dry-run 模式：不会真正执行本地打包，也不会推送或触发 GitHub Actions。"
    exit 0
  fi

  run_local_pack_test
  run_remote_workflows
}

main "$@"
