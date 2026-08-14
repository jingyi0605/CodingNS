#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/packages/codingns"
STAGING_DIR=""
NPM_AUTH_CONFIG_FILE=""
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

# npm access token 的默认读取位置。
# 不要把 token 放进仓库；这个文件应该只存在于当前用户的 HOME 目录。
DEFAULT_NPM_TOKEN_FILE="${HOME:-}/.codingns/npmjs-token"

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

npm token 读取顺序：

  1. NODE_AUTH_TOKEN 环境变量
  2. NPM_TOKEN 环境变量
  3. NPM_TOKEN_FILE 指向的文件
  4. CODINGNS_NPM_TOKEN_FILE 指向的文件
  5. ~/.codingns/npmjs-token
EOF
}

parse_json_with_node() {
  local script="$1"
  local input="${2:-}"

  REGISTRY_JSON="$input" node -e "$script"
}

cleanup() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi

  if [[ -n "$NPM_AUTH_CONFIG_FILE" && -f "$NPM_AUTH_CONFIG_FILE" ]]; then
    rm -f "$NPM_AUTH_CONFIG_FILE"
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

read_first_line_from_file() {
  local file_path="$1"

  if [[ -z "$file_path" || ! -f "$file_path" ]]; then
    return 1
  fi

  sed -n '1{s/[[:space:]]*$//;p;}' "$file_path"
}

resolve_npm_auth_token() {
  local token=""

  if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
    printf '%s' "$NODE_AUTH_TOKEN"
    return 0
  fi

  if [[ -n "${NPM_TOKEN:-}" ]]; then
    printf '%s' "$NPM_TOKEN"
    return 0
  fi

  token="$(read_first_line_from_file "${NPM_TOKEN_FILE:-}" || true)"
  if [[ -n "$token" ]]; then
    printf '%s' "$token"
    return 0
  fi

  token="$(read_first_line_from_file "${CODINGNS_NPM_TOKEN_FILE:-}" || true)"
  if [[ -n "$token" ]]; then
    printf '%s' "$token"
    return 0
  fi

  token="$(read_first_line_from_file "$DEFAULT_NPM_TOKEN_FILE" || true)"
  if [[ -n "$token" ]]; then
    printf '%s' "$token"
    return 0
  fi

  return 1
}

configure_npm_auth_for_publish() {
  local token=""

  token="$(resolve_npm_auth_token || true)"

  if [[ -z "$token" ]]; then
    echo "未发现脚本专用 npm token，将继续使用 npm 当前登录态。"
    return 0
  fi

  NPM_AUTH_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/codingns-npmrc.XXXXXX")"

  chmod 600 "$NPM_AUTH_CONFIG_FILE"
  {
    echo "registry=https://registry.npmjs.org/"
    printf '//registry.npmjs.org/:_authToken=%s\n' "$token"
  } >"$NPM_AUTH_CONFIG_FILE"

  export NPM_CONFIG_USERCONFIG="$NPM_AUTH_CONFIG_FILE"

  echo "已从预定义位置读取 npm token，并写入临时 npm 配置。"
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

run_npm_pack_and_resolve_filename() {
  local staging_dir="$1"
  local pack_output=""
  local tgz_name=""

  pack_output="$(
    cd "$staging_dir"
    npm pack --ignore-scripts --json
  )"

  tgz_name="$(
    printf '%s' "$pack_output" \
      | node -e '
        const fs = require("fs");
        const input = fs.readFileSync(0, "utf8").trim();
        if (!input) {
          process.exit(1);
        }

        const parsed = JSON.parse(input);
        const firstEntry = Array.isArray(parsed) ? parsed[0] : parsed;

        if (!firstEntry || typeof firstEntry.filename !== "string" || firstEntry.filename.length === 0) {
          process.exit(1);
        }

        process.stdout.write(firstEntry.filename);
      '
  )"

  if [[ -z "$tgz_name" ]]; then
    echo "npm pack 未返回有效的 tgz 文件名" >&2
    exit 1
  fi

  if [[ ! -f "$staging_dir/$tgz_name" ]]; then
    echo "未找到 npm pack 产物：$staging_dir/$tgz_name" >&2
    exit 1
  fi

  echo "$tgz_name"
}

verify_published_tarball() {
  local tarball_path="$1"

  node "$PACKAGE_DIR/scripts/verify-publish-tarball.mjs" "$tarball_path"
}

registry_version_exists() {
  local target_package_name="$1"
  local target_package_version="$2"
  local versions_json=""

  versions_json="$(
    npm view "$target_package_name" versions --json --registry https://registry.npmjs.org/ 2>/dev/null || true
  )"

  if [[ -z "$versions_json" ]]; then
    return 1
  fi

  TARGET_PACKAGE_VERSION="$target_package_version" parse_json_with_node '
    const raw = process.env.REGISTRY_JSON || "";
    const targetVersion = process.env.TARGET_PACKAGE_VERSION || "";

    if (!raw || !targetVersion) {
      process.exit(1);
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      process.exit(1);
    }

    const versions = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "string"
        ? [parsed]
        : [];

    process.exit(versions.includes(targetVersion) ? 0 : 1);
  ' "$versions_json"
}

read_registry_dist_tag_version() {
  local target_package_name="$1"
  local target_publish_tag="$2"
  local dist_tags_json=""

  dist_tags_json="$(
    npm view "$target_package_name" dist-tags --json --registry https://registry.npmjs.org/ 2>/dev/null || true
  )"

  if [[ -z "$dist_tags_json" ]]; then
    return 1
  fi

  TARGET_PUBLISH_TAG="$target_publish_tag" parse_json_with_node '
    const raw = process.env.REGISTRY_JSON || "";
    const targetTag = process.env.TARGET_PUBLISH_TAG || "";

    if (!raw || !targetTag) {
      process.exit(1);
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      process.exit(1);
    }

    if (!parsed || typeof parsed !== "object") {
      process.exit(1);
    }

    const tagVersion = parsed[targetTag];

    if (typeof tagVersion !== "string" || tagVersion.length === 0) {
      process.exit(1);
    }

    process.stdout.write(tagVersion);
  ' "$dist_tags_json"
}

verify_registry_version_before_publish() {
  local target_package_name="$1"
  local target_package_version="$2"

  echo "==> 检查 npm 是否已存在同版本"

  if registry_version_exists "$target_package_name" "$target_package_version"; then
    echo "npm 已存在 ${target_package_name}@${target_package_version}，停止发布。" >&2
    exit 1
  fi

  echo "npm 尚不存在 ${target_package_name}@${target_package_version}，可以继续发布。"
}

verify_registry_version_after_publish() {
  local target_package_name="$1"
  local target_package_version="$2"
  local target_publish_tag="$3"
  local max_attempts="${4:-12}"
  local sleep_seconds="${5:-5}"
  local attempt=""
  local tag_version=""

  echo ""
  echo "==> 校验 npm 已收录新版本"

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if registry_version_exists "$target_package_name" "$target_package_version"; then
      tag_version="$(read_registry_dist_tag_version "$target_package_name" "$target_publish_tag" || true)"

      if [[ "$tag_version" == "$target_package_version" ]]; then
        echo "npm 已收录 ${target_package_name}@${target_package_version}，且 dist-tag ${target_publish_tag} 已指向该版本。"
        return 0
      fi
    fi

    echo "第 $attempt/$max_attempts 次校验未完成，等待 ${sleep_seconds}s 后重试..."
    sleep "$sleep_seconds"
  done

  echo "npm 发布后校验失败：未确认 ${target_package_name}@${target_package_version} 已出现在版本列表，或 dist-tag ${target_publish_tag} 仍未指向该版本。" >&2
  exit 1
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
      tgz="$(run_npm_pack_and_resolve_filename "$STAGING_DIR")"
      verify_published_tarball "$STAGING_DIR/$tgz"
      output_tgz_path="$(resolve_output_tgz_path "$output_package_dir" "$tgz" "$commit_suffix")"
      mv "$STAGING_DIR/$tgz" "$output_tgz_path"
      echo "已生成：$output_tgz_path"
      ;;
    publish)
      target_publish_tag="$(resolve_publish_tag "$target_package_version")"

      verify_registry_version_before_publish "$target_package_name" "$target_package_version"

      echo "==> 校验 npm 打包清单"
      (cd "$STAGING_DIR" && npm pack --dry-run --ignore-scripts >/dev/null)
      tgz="$(run_npm_pack_and_resolve_filename "$STAGING_DIR")"
      verify_published_tarball "$STAGING_DIR/$tgz"
      rm -f "$STAGING_DIR/$tgz"

      configure_npm_auth_for_publish

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
      verify_registry_version_after_publish \
        "$target_package_name" \
        "$target_package_version" \
        "$target_publish_tag"
      ;;
    *)
      echo "不支持的执行模式：$mode" >&2
      exit 1
      ;;
  esac
}

main() {
  local package_name=""
  local package_version=""
  local choice=""

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
    return
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
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
