#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/packages/codingns"
STAGING_DIR=""
WORKTREE_PARENT_DIR=""
WORKTREE_DIR=""
SELECTED_COMMIT_SHA=""
SELECTED_COMMIT_SHORT=""
SELECTED_COMMIT_DATE=""
SELECTED_COMMIT_SUBJECT=""

dry_run="false"
provenance="false"
publish_tag=""
selected_mode=""

print_help() {
  cat <<'EOF'
用法：

  bash scripts/publish-npm-package.sh [选项]

选项：

  --dry-run     只做发布预演，不真正发布到 npm
  --mode        指定执行模式：pack 或 publish；指定后不再进入交互菜单
  --provenance  发布时附带 npm provenance
  --tag         显式指定 npm dist-tag；默认根据版本号自动判断
  --help        显示帮助
EOF
}

cleanup() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi

  if [[ -n "$WORKTREE_DIR" ]]; then
    git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi

  if [[ -n "$WORKTREE_PARENT_DIR" && -d "$WORKTREE_PARENT_DIR" ]]; then
    rm -rf "$WORKTREE_PARENT_DIR"
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run="true"
      shift
      ;;
    --mode)
      if [[ $# -lt 2 ]]; then
        echo "缺少 --mode 的取值" >&2
        exit 1
      fi

      selected_mode="$2"
      shift 2
      ;;
    --provenance)
      provenance="true"
      shift
      ;;
    --tag)
      if [[ $# -lt 2 ]]; then
        echo "缺少 --tag 的取值" >&2
        exit 1
      fi

      publish_tag="$2"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "不支持的参数：$1" >&2
      exit 1
      ;;
  esac
done

read_package_field() {
  local target_root="$1"
  local field_name="$2"

  (
    cd "$target_root"
    node -p "require('./packages/codingns/package.json')['$field_name']"
  )
}

choose_recent_commit() {
  local commits=()
  local index=""
  local selected_line=""
  local i=""
  local commit_sha=""
  local commit_short=""
  local commit_date=""
  local commit_subject=""

  while IFS= read -r line; do
    commits+=("$line")
  done < <(
    git -C "$ROOT_DIR" log -n 5 --date=short --pretty=format:'%H%x1f%h%x1f%ad%x1f%s'
  )

  if [[ "${#commits[@]}" -eq 0 ]]; then
    echo "最近提交记录为空，无法选择版本" >&2
    exit 1
  fi

  echo ""
  echo "==> 最近 5 次提交"

  for i in "${!commits[@]}"; do
    IFS=$'\x1f' read -r commit_sha commit_short commit_date commit_subject <<<"${commits[$i]}"
    echo "  [$((i + 1))] $commit_short  $commit_date  $commit_subject"
  done

  echo ""
  read -rp "请选择提交编号 [1-${#commits[@]}]: " index

  if [[ ! "$index" =~ ^[0-9]+$ ]] || [[ "$index" -lt 1 ]] || [[ "$index" -gt "${#commits[@]}" ]]; then
    echo "无效提交编号：$index" >&2
    exit 1
  fi

  selected_line="${commits[$((index - 1))]}"
  IFS=$'\x1f' read -r SELECTED_COMMIT_SHA SELECTED_COMMIT_SHORT SELECTED_COMMIT_DATE SELECTED_COMMIT_SUBJECT <<<"$selected_line"
}

prepare_commit_worktree() {
  local commit_sha="$1"

  WORKTREE_PARENT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codingns-publish-worktree.XXXXXX")"
  WORKTREE_DIR="$WORKTREE_PARENT_DIR/repo"

  echo ""
  echo "==> 检出目标提交"
  echo "提交：$SELECTED_COMMIT_SHORT"
  echo "说明：$SELECTED_COMMIT_DATE $SELECTED_COMMIT_SUBJECT"
  git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR" "$commit_sha" >/dev/null

  echo ""
  echo "==> 安装目标提交依赖"
  pnpm --dir "$WORKTREE_DIR" install --frozen-lockfile
}

resolve_publish_tag() {
  local target_package_version="$1"

  if [[ -n "$publish_tag" ]]; then
    echo "$publish_tag"
    return
  fi

  if [[ "$target_package_version" == *-* ]]; then
    echo "beta"
    return
  fi

  echo "latest"
}

reset_staging_dir() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi

  STAGING_DIR="$(mktemp -d)"
}

resolve_output_tgz_path() {
  local output_package_dir="$1"
  local tgz_name="$2"
  local commit_suffix="$3"

  if [[ -z "$commit_suffix" ]]; then
    echo "$output_package_dir/$tgz_name"
    return
  fi

  echo "$output_package_dir/${tgz_name%.tgz}-$commit_suffix.tgz"
}

execute_publish_flow() {
  local target_root="$1"
  local output_package_dir="$2"
  local mode="$3"
  local source_label="$4"
  local commit_suffix="$5"
  local target_package_dir="$target_root/packages/codingns"
  local target_package_name=""
  local target_package_version=""
  local target_publish_tag=""
  local output_tgz_path=""
  local tgz=""
  local -a publish_cmd=()

  target_package_name="$(read_package_field "$target_root" "name")"
  target_package_version="$(read_package_field "$target_root" "version")"

  echo ""
  echo "==> 打包来源"
  echo "来源：$source_label"
  echo "包名：$target_package_name"
  echo "版本：$target_package_version"

  reset_staging_dir

  echo ""
  echo "==> 构建独立服务包"
  pnpm --dir "$target_root" run build:standalone

  echo "==> 生成发布暂存目录"
  node "$target_package_dir/scripts/create-publish-staging.mjs" "$STAGING_DIR"

  case "$mode" in
    pack)
      echo ""
      echo "==> 执行 npm pack"
      tgz="$(cd "$STAGING_DIR" && npm pack --ignore-scripts 2>&1 | tail -1)"
      output_tgz_path="$(resolve_output_tgz_path "$output_package_dir" "$tgz" "$commit_suffix")"
      mv "$STAGING_DIR/$tgz" "$output_tgz_path"
      echo "已生成：$output_tgz_path"
      ;;
    publish)
      target_publish_tag="$(resolve_publish_tag "$target_package_version")"

      echo "==> 校验 npm 打包清单"
      (cd "$STAGING_DIR" && npm pack --dry-run --ignore-scripts >/dev/null)

      publish_cmd=(npm publish --access public --tag "$target_publish_tag")

      if [[ "$provenance" == "true" ]]; then
        publish_cmd+=(--provenance)
      fi

      if [[ "$dry_run" == "true" ]]; then
        publish_cmd+=(--dry-run)
      fi

      echo ""
      echo "==> 发布信息"
      echo "来源：$source_label"
      echo "包名：$target_package_name"
      echo "版本：$target_package_version"
      echo "dist-tag：$target_publish_tag"
      echo "预演：$dry_run"
      echo "provenance：$provenance"
      echo ""

      echo "==> 执行 npm publish"
      (cd "$STAGING_DIR" && "${publish_cmd[@]}" --ignore-scripts)
      ;;
    *)
      echo "不支持的执行模式：$mode" >&2
      exit 1
      ;;
  esac
}

package_name="$(read_package_field "$ROOT_DIR" "name")"
package_version="$(read_package_field "$ROOT_DIR" "version")"

echo ""
echo "==> $package_name v$package_version"
echo ""

if [[ -n "$selected_mode" ]]; then
  if [[ "$selected_mode" != "pack" && "$selected_mode" != "publish" ]]; then
    echo "不支持的 --mode：$selected_mode，仅支持 pack 或 publish" >&2
    exit 1
  fi

  execute_publish_flow "$ROOT_DIR" "$PACKAGE_DIR" "$selected_mode" "当前工作区" ""
  exit 0
fi

echo "  [1] 基于当前工作区仅本地打包（npm pack）"
echo "  [2] 基于当前工作区打包并发布到 npm"
echo "  [3] 从最近 5 次提交中选择一个版本，仅本地打包"
echo "  [4] 从最近 5 次提交中选择一个版本，发布到 npm"
echo ""

read -rp "请选择操作编号 [1-4]: " choice

if [[ ! "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt 4 ]]; then
  echo "无效选择：$choice" >&2
  exit 1
fi

case "$choice" in
  1)
    execute_publish_flow "$ROOT_DIR" "$PACKAGE_DIR" "pack" "当前工作区" ""
    ;;
  2)
    execute_publish_flow "$ROOT_DIR" "$PACKAGE_DIR" "publish" "当前工作区" ""
    ;;
  3)
    choose_recent_commit
    prepare_commit_worktree "$SELECTED_COMMIT_SHA"
    execute_publish_flow \
      "$WORKTREE_DIR" \
      "$PACKAGE_DIR" \
      "pack" \
      "提交 $SELECTED_COMMIT_SHORT ($SELECTED_COMMIT_DATE $SELECTED_COMMIT_SUBJECT)" \
      "$SELECTED_COMMIT_SHORT"
    ;;
  4)
    choose_recent_commit
    prepare_commit_worktree "$SELECTED_COMMIT_SHA"
    execute_publish_flow \
      "$WORKTREE_DIR" \
      "$PACKAGE_DIR" \
      "publish" \
      "提交 $SELECTED_COMMIT_SHORT ($SELECTED_COMMIT_DATE $SELECTED_COMMIT_SUBJECT)" \
      "$SELECTED_COMMIT_SHORT"
    ;;
esac
