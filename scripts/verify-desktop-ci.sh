#!/usr/bin/env bash
#
# GitHub Actions 桌面端远端验包脚本
# 目标：
# 1. 不切换当前本地分支
# 2. 直接把当前 HEAD 推到 GitHub 临时分支
# 3. 触发 workflow_dispatch 验证桌面端构建
# 4. 等待结果并输出 run 链接
#
# 用法：
#   bash scripts/verify-desktop-ci.sh
#   bash scripts/verify-desktop-ci.sh --keep-remote-branch
#   bash scripts/verify-desktop-ci.sh --branch-name ci/manual-check
#   bash scripts/verify-desktop-ci.sh --dry-run
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_REMOTE="github"
DEFAULT_WORKFLOW=".github/workflows/desktop-release.yml"
DEFAULT_BRANCH_PREFIX="ci/desktop-verify"

REMOTE_NAME="$DEFAULT_REMOTE"
WORKFLOW_ID="$DEFAULT_WORKFLOW"
BRANCH_PREFIX="$DEFAULT_BRANCH_PREFIX"
BRANCH_NAME=""
REPO_SLUG=""
HEAD_SHA=""
ALLOW_DIRTY=0
WAIT_FOR_COMPLETION=1
KEEP_REMOTE_BRANCH=0
DRY_RUN=0
REMOTE_BRANCH_PUSHED=0

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

print_menu() {
  local current_branch=""
  local current_sha=""

  current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
  current_sha="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"

  cat <<EOF

================ GitHub Actions 桌面端验包 ================
当前分支: $current_branch
当前提交: $current_sha

请选择要执行的操作：
  1) 标准验证
     只验证当前 HEAD，要求工作区干净，等待 CI 结束
  2) 验证当前 HEAD（忽略未提交改动）
     未提交改动不会进入 GitHub Actions，等待 CI 结束
  3) 只触发 CI，不等待结果
     适合先丢到远端跑，稍后自己看结果
  4) 验证并保留远端临时分支
     方便你后续在 GitHub 上继续排查
  5) 预演模式（dry-run）
     只打印将执行什么，不真正推送和触发
  6) 自定义临时分支名
     适合你想给这次验证起个固定名字
  0) 退出
==========================================================
EOF
}

print_usage() {
  cat <<'EOF'
用法：
  bash scripts/verify-desktop-ci.sh [选项]

选项：
  --remote <name>              Git 远端名称，默认 github
  --repo <owner/repo>          手工指定 GitHub 仓库，默认从远端 URL 推断
  --workflow <id-or-file>      要触发的 workflow，默认 .github/workflows/desktop-release.yml
  --branch-prefix <prefix>     临时分支前缀，默认 ci/desktop-verify
  --branch-name <name>         显式指定临时分支名
  --allow-dirty                允许工作区有未提交改动，但远端只验证当前 HEAD 提交
  --no-wait                    触发后不等待结果，直接输出 run 查询提示
  --keep-remote-branch         不自动删除 GitHub 临时分支
  --dry-run                    只打印将要执行的动作，不真正推送或触发 CI
  -h, --help                   显示帮助

说明：
  1. 这个脚本不会切换您当前本地分支。
  2. 默认把当前 HEAD 推到 GitHub 临时分支，然后触发 workflow_dispatch。
  3. 如果本地还有未提交改动，GitHub Actions 根本看不到；默认直接拦截。
EOF
}

run_menu() {
  local choice=""

  print_menu
  printf '请输入序号: '
  read -r choice

  case "$choice" in
    1)
      ;;
    2)
      ALLOW_DIRTY=1
      ;;
    3)
      ALLOW_DIRTY=1
      WAIT_FOR_COMPLETION=0
      ;;
    4)
      ALLOW_DIRTY=1
      KEEP_REMOTE_BRANCH=1
      ;;
    5)
      ALLOW_DIRTY=1
      DRY_RUN=1
      ;;
    6)
      ALLOW_DIRTY=1
      printf '请输入临时分支名: '
      read -r BRANCH_NAME
      if [[ -z "$BRANCH_NAME" ]]; then
        log_error "临时分支名不能为空"
        exit 1
      fi
      ;;
    0)
      log_info "已退出。"
      exit 0
      ;;
    *)
      log_error "无效选项: $choice"
      exit 1
      ;;
  esac
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "缺少命令: $1"
    exit 1
  fi
}

cleanup_remote_branch() {
  if [[ "$KEEP_REMOTE_BRANCH" -eq 1 || "$DRY_RUN" -eq 1 || "$REMOTE_BRANCH_PUSHED" -ne 1 ]]; then
    return 0
  fi

  log_info "删除 GitHub 临时分支: $BRANCH_NAME"
  if git push "$REMOTE_NAME" ":refs/heads/$BRANCH_NAME" >/dev/null 2>&1; then
    log_success "已删除 GitHub 临时分支: $BRANCH_NAME"
  else
    log_warn "GitHub 临时分支删除失败，请手工检查: $BRANCH_NAME"
  fi
}

trap cleanup_remote_branch EXIT

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
      --workflow)
        WORKFLOW_ID="${2:-}"
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

ensure_non_empty_arg() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    log_error "参数缺少值: $name"
    exit 1
  fi
}

validate_args() {
  ensure_non_empty_arg "--remote" "$REMOTE_NAME"
  ensure_non_empty_arg "--workflow" "$WORKFLOW_ID"
  ensure_non_empty_arg "--branch-prefix" "$BRANCH_PREFIX"
  if [[ -n "$BRANCH_NAME" ]]; then
    ensure_non_empty_arg "--branch-name" "$BRANCH_NAME"
  fi
}

check_worktree_state() {
  if [[ -z "$(git status --short --untracked-files=all)" ]]; then
    return 0
  fi

  if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
    log_warn "检测到未提交改动，但脚本只会验证当前 HEAD 提交。未提交内容不会进入 GitHub Actions。"
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

  REPO_SLUG="$(python3 - "$remote_url" <<'PY'
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
PY
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

resolve_head_sha() {
  HEAD_SHA="$(git rev-parse HEAD)"
}

generate_branch_name() {
  if [[ -n "$BRANCH_NAME" ]]; then
    return 0
  fi

  BRANCH_NAME="${BRANCH_PREFIX}-$(date +%Y%m%d-%H%M%S)-${HEAD_SHA:0:7}"
}

print_summary() {
  cat <<EOF
远端 CI 验证参数：
  GitHub 仓库: $REPO_SLUG
  工作流: $WORKFLOW_ID
  提交 SHA: $HEAD_SHA
  临时分支: $BRANCH_NAME
EOF
}

push_temp_branch() {
  log_info "推送当前 HEAD 到 GitHub 临时分支..."
  git push "$REMOTE_NAME" "$HEAD_SHA:refs/heads/$BRANCH_NAME"
  REMOTE_BRANCH_PUSHED=1
  log_success "已推送 GitHub 临时分支: $BRANCH_NAME"
}

dispatch_workflow() {
  log_info "触发 GitHub Actions workflow_dispatch..."
  gh workflow run "$WORKFLOW_ID" --repo "$REPO_SLUG" --ref "$BRANCH_NAME"
  log_success "已触发 workflow_dispatch"
}

find_run_json() {
  gh run list \
    --repo "$REPO_SLUG" \
    --workflow "$WORKFLOW_ID" \
    --branch "$BRANCH_NAME" \
    --event workflow_dispatch \
    --limit 20 \
    --json databaseId,headSha,status,conclusion,url,displayTitle,createdAt,workflowName | \
    python3 -c '
import json
import sys

head_sha = sys.argv[1]
runs = json.load(sys.stdin)
matched = [item for item in runs if item.get("headSha") == head_sha]
matched.sort(key=lambda item: (item.get("createdAt") or "", item.get("databaseId") or 0), reverse=True)

if matched:
    print(json.dumps(matched[0], ensure_ascii=False))
' "$HEAD_SHA"
}

wait_until_run_created() {
  local max_attempts=24
  local attempt=1
  local run_json=""

  while (( attempt <= max_attempts )); do
    run_json="$(find_run_json || true)"
    if [[ -n "$run_json" ]]; then
      printf '%s\n' "$run_json"
      return 0
    fi

    printf '%b[INFO]%b 等待 GitHub Actions 创建 workflow run（%s/%s）...\n' "$BLUE" "$NC" "$attempt" "$max_attempts" >&2
    sleep 5
    attempt=$((attempt + 1))
  done

  log_error "超时：一直没查到这次 workflow run。"
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

watch_run() {
  local run_id="$1"

  log_info "等待 workflow run 完成: $run_id"
  gh run watch "$run_id" --repo "$REPO_SLUG" --interval 5 --compact --exit-status
}

show_final_result() {
  local run_id="$1"
  local final_json=""
  local conclusion=""
  local url=""

  final_json="$(gh run view "$run_id" --repo "$REPO_SLUG" --json conclusion,url,displayTitle,workflowName,number,status)"
  conclusion="$(extract_json_field "$final_json" "conclusion")"
  url="$(extract_json_field "$final_json" "url")"

  if [[ "$conclusion" == "success" ]]; then
    log_success "GitHub Actions 验证通过"
  else
    log_error "GitHub Actions 验证失败: ${conclusion:-unknown}"
  fi

  echo "Run 链接: $url"
}

main() {
  if [[ $# -eq 0 ]]; then
    run_menu
  else
    parse_args "$@"
  fi

  validate_args

  require_command git
  require_command gh
  require_command python3

  cd "$REPO_DIR"

  check_worktree_state
  resolve_repo_slug
  resolve_head_sha
  generate_branch_name
  print_summary

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_warn "dry-run 模式：不会真正推送分支，也不会触发 GitHub Actions。"
    exit 0
  fi

  check_github_auth

  push_temp_branch
  dispatch_workflow

  local run_json=""
  local run_id=""
  local run_url=""

  run_json="$(wait_until_run_created)"
  run_id="$(extract_json_field "$run_json" "databaseId")"
  run_url="$(extract_json_field "$run_json" "url")"

  log_success "已找到 workflow run: $run_id"
  echo "Run 链接: $run_url"

  if [[ "$WAIT_FOR_COMPLETION" -eq 0 ]]; then
    log_warn "已按要求跳过等待。您可以稍后查看上面的 run 链接。"
    exit 0
  fi

  watch_run "$run_id"
  show_final_result "$run_id"
}

main "$@"
