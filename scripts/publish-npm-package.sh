#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/packages/codingns"

package_name="$(cd "$ROOT_DIR" && node -p "require('./packages/codingns/package.json').name")"
package_version="$(cd "$ROOT_DIR" && node -p "require('./packages/codingns/package.json').version")"

dry_run="false"
provenance="false"
publish_tag=""

print_help() {
  cat <<'EOF'
用法：

  bash scripts/publish-npm-package.sh [选项]

选项：

  --dry-run     只做发布预演，不真正发布到 npm
  --provenance  发布时附带 npm provenance
  --tag         显式指定 npm dist-tag；默认根据版本号自动判断
  --help        显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run="true"
      shift
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

# 交互选择操作模式
echo ""
echo "==> $package_name v$package_version"
echo ""
echo "  [1] 仅本地打包（npm pack）"
echo "  [2] 打包并发布到 npm"
echo ""

read -rp "请选择操作编号 [1-2]: " choice

if [[ ! "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt 2 ]]; then
  echo "无效选择：$choice" >&2
  exit 1
fi

echo ""
echo "==> 构建独立服务包"
pnpm --dir "$ROOT_DIR" run build:standalone

case "$choice" in
  1)
    echo ""
    echo "==> 执行 npm pack"
    tgz="$(cd "$PACKAGE_DIR" && npm pack 2>&1 | tail -1)"
    echo "已生成：$PACKAGE_DIR/$tgz"
    ;;
  2)
    if [[ -z "$publish_tag" ]]; then
      if [[ "$package_version" == *-* ]]; then
        publish_tag="beta"
      else
        publish_tag="latest"
      fi
    fi

    echo "==> 校验 npm 打包清单"
    (cd "$PACKAGE_DIR" && npm pack --dry-run >/dev/null)

    publish_cmd=(npm publish --access public --tag "$publish_tag")

    if [[ "$provenance" == "true" ]]; then
      publish_cmd+=(--provenance)
    fi

    if [[ "$dry_run" == "true" ]]; then
      publish_cmd+=(--dry-run)
    fi

    echo ""
    echo "==> 发布信息"
    echo "包名：$package_name"
    echo "版本：$package_version"
    echo "dist-tag：$publish_tag"
    echo "预演：$dry_run"
    echo "provenance：$provenance"
    echo ""

    echo "==> 执行 npm publish"
    (cd "$PACKAGE_DIR" && "${publish_cmd[@]}")
    ;;
esac
