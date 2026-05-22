#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR="${1:-${RUNNER_TEMP:-$REPO_DIR/.tmp}/windows-install-replay}"
PACKAGE_STAGE_DIR="$OUTPUT_DIR/codingns-package"
BETTER_SQLITE_VENDOR_STAGE_DIR="$OUTPUT_DIR/better-sqlite3-win32-x64-node22"

log_info() {
  printf '[windows-replay] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[windows-replay] 缺少命令：%s\n' "$1" >&2
    exit 1
  fi
}

require_node_major() {
  local expected_major="$1"
  local actual_major=""

  actual_major="$(node -p "String(process.versions.node || '').split('.')[0]")"
  if [[ "$actual_major" != "$expected_major" ]]; then
    printf '[windows-replay] 当前脚本要求 Node %s，检测到 Node %s。\n' "$expected_major" "${actual_major:-unknown}" >&2
    exit 1
  fi
}

resolve_npm_pack_filename() {
  local package_dir="$1"

  (
    cd "$package_dir"
    npm pack --ignore-scripts --json
  ) | node -e '
    const fs = require("node:fs");
    const input = fs.readFileSync(0, "utf8").trim();
    const result = JSON.parse(input);
    const entry = Array.isArray(result) ? result[0] : result;
    if (!entry || typeof entry.filename !== "string" || !entry.filename.trim()) {
      process.exit(1);
    }
    process.stdout.write(entry.filename.trim());
  '
}

patch_stage_package_json() {
  local stage_dir="$1"
  local node_pty_tarball_name="$2"

  node - "$stage_dir" "$node_pty_tarball_name" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [stageDir, nodePtyTarballName] = process.argv.slice(2);
const packageJsonPath = path.join(stageDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

packageJson.optionalDependencies = {
  ...packageJson.optionalDependencies,
  "@codingns/node-pty": `file:../${nodePtyTarballName}`,
  "better-sqlite3": "file:../better-sqlite3-win32-x64-node22"
};

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
EOF
}

write_manifest() {
  local output_dir="$1"
  local node_pty_tarball_name="$2"

  node - "$output_dir" "$node_pty_tarball_name" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [outputDir, nodePtyTarballName] = process.argv.slice(2);
const manifest = {
  schemaVersion: 1,
  preparedAt: new Date().toISOString(),
  codingnsPackageDir: "codingns-package",
  nodePtyTarball: nodePtyTarballName,
  betterSqliteDir: "better-sqlite3-win32-x64-node22"
};

fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
EOF
}

write_stage_metadata() {
  local stage_dir="$1"

  node - "$stage_dir" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [stageDir] = process.argv.slice(2);
const packageJsonPath = path.join(stageDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const metadataPath = path.join(stageDir, ".codingns-install-metadata.json");

const metadata = {
  packageName: typeof packageJson.name === "string" ? packageJson.name : "",
  packageVersion: typeof packageJson.version === "string" ? packageJson.version : ""
};

fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
EOF
}

main() {
  require_command pnpm
  require_command node
  require_command npm
  require_node_major 22

  rm -rf "$OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"

  log_info "安装工作区依赖（忽略 lifecycle scripts，避免 Windows 验收前误触原生脚本）"
  pnpm --dir "$REPO_DIR" install --ignore-scripts --frozen-lockfile

  log_info "对本地 @codingns/node-pty 应用 fork 补丁"
  (
    cd "$REPO_DIR/packages/node-pty-fork"
    npm run apply:patches
  )

  log_info "构建本地 @codingns/node-pty 预编译产物（显式走 npm，避开 pnpm 自带 node-gyp 的 Windows 差异）"
  (
    cd "$REPO_DIR/packages/node-pty-fork"
    npm run build:native
    npm run verify:runtime
  )

  log_info "生成 @codingns/node-pty npm tarball"
  local node_pty_tgz_name=""
  node_pty_tgz_name="$(resolve_npm_pack_filename "$REPO_DIR/packages/node-pty-fork")"
  mv "$REPO_DIR/packages/node-pty-fork/$node_pty_tgz_name" "$OUTPUT_DIR/$node_pty_tgz_name"

  log_info "准备 better-sqlite3 Windows Node 22 受控包"
  rm -rf "$BETTER_SQLITE_VENDOR_STAGE_DIR"
  mkdir -p "$OUTPUT_DIR"
  cp -R "$REPO_DIR/packages/codingns/vendor-src/better-sqlite3-win32-x64-node22" "$BETTER_SQLITE_VENDOR_STAGE_DIR"

  log_info "构建 CodingNS 独立服务包"
  pnpm --dir "$REPO_DIR" run build:standalone
  node "$REPO_DIR/packages/codingns/scripts/create-publish-staging.mjs" "$PACKAGE_STAGE_DIR"

  log_info "把发布暂存目录改写为本地 node-pty 安装回放包"
  patch_stage_package_json "$PACKAGE_STAGE_DIR" "$node_pty_tgz_name"
  write_stage_metadata "$PACKAGE_STAGE_DIR"
  write_manifest "$OUTPUT_DIR" "$node_pty_tgz_name"

  log_info "Windows 安装回放输入已准备完成：$OUTPUT_DIR"
}

main "$@"
