import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cliArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const COMMAND_TIMEOUT_MS = readPositiveInt(process.env.CODINGNS_RELATED_TEST_TIMEOUT_MS, 240_000);
const WORKBENCH_LAYOUT_LIGHTWEIGHT_SIBLINGS = [
  "src/features/conversation/components/WorkbenchLayout.affairs-mode.test.tsx",
  "src/features/conversation/components/WorkbenchLayout.parallel-tree.test.tsx",
  "src/features/conversation/components/WorkbenchLayout.session-menu.test.tsx",
  "src/features/conversation/components/WorkbenchLayout.git-panel.delete-branch.test.tsx"
];
const AFFAIRS_WORKBENCH_VIEW_LIGHTWEIGHT_SIBLINGS = [
  "src/features/workbench/components/AffairsWorkbenchView.conversation-list.test.tsx",
  "src/features/workbench/components/AffairsWorkbenchView.agent-history.test.tsx",
  "src/features/workbench/components/AffairsWorkbenchView.conversation-loading.test.tsx",
  "src/features/workbench/components/AffairsWorkbenchView.bootstrap-guard.test.tsx",
  "src/features/workbench/components/AffairsWorkbenchView.assistant-panel.test.tsx"
];
const MESSAGE_TIMELINE_LIGHTWEIGHT_SIBLINGS = [
  "src/features/conversation/components/MessageTimeline.structured-question.test.tsx",
  "src/features/conversation/components/MessageTimeline.apply-patch.test.tsx",
  "src/features/conversation/components/MessageTimeline.view-image.test.tsx"
];
const FILE_VIEWER_MODAL_LIGHTWEIGHT_SIBLINGS = [
  "src/features/conversation/components/FileViewerModal.office-preview.test.tsx"
];
const COMPOSER_PANEL_LIGHTWEIGHT_SIBLINGS = [
  "src/features/conversation/components/ComposerPanel.mentions.test.tsx"
];
const SESSION_RUNTIME_STORE_LIGHTWEIGHT_SIBLINGS = [
  "src/features/conversation/runtime/session-runtime-store.runtime-polling.test.ts",
  "src/features/conversation/runtime/session-runtime-store.queue.test.ts",
  "src/features/conversation/runtime/session-runtime-store.mark-seen.test.ts",
  "src/features/conversation/runtime/session-runtime-store.send-message.test.ts"
];

if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  console.log(`用法：
  pnpm test:related
  pnpm test:related -- apps/host/src/foo.ts apps/user-app/src/bar.tsx

说明：
  - 不传参数时，自动读取当前工作区已改动文件
  - 只推导 host / user-app 的相关测试
  - 直接命中测试文件时，优先跑这些测试文件
  - 其余源码文件走 vitest related`);
  process.exit(0);
}

const changedFiles = cliArgs.length > 0 ? cliArgs : detectChangedFiles();

if (changedFiles.length === 0) {
  console.log("[related-test] 当前没有检测到变更文件，不执行测试。");
  process.exit(0);
}

const normalizedFiles = normalizeExistingRepoFiles(changedFiles);

if (normalizedFiles.length === 0) {
  console.log("[related-test] 传入的文件都不存在或不在仓库内，不执行测试。");
  process.exit(0);
}

const hostPlan = buildPackagePlan("host", normalizedFiles);
const userAppPlan = buildPackagePlan("user-app", normalizedFiles);

if (!hostPlan && !userAppPlan) {
  console.log("[related-test] 本次变更没有命中 host / user-app 测试范围，不执行测试。");
  process.exit(0);
}

try {
  if (hostPlan) {
    runHostPlan(hostPlan);
  }

  if (userAppPlan) {
    runUserAppPlan(userAppPlan);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[related-test] 执行失败：${detail}`);
  process.exit(1);
}

function detectChangedFiles() {
  const tracked = new Set([
    ...readGitLines(["diff", "--name-only", "--diff-filter=ACMR"]),
    ...readGitLines(["diff", "--name-only", "--diff-filter=ACMR", "--cached"]),
    ...readGitLines(["ls-files", "--others", "--exclude-standard"])
  ]);

  return Array.from(tracked);
}

function readGitLines(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} 执行失败`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeExistingRepoFiles(files) {
  const seen = new Set();
  const output = [];

  for (const raw of files) {
    const repoRelative = normalizeRepoRelativePath(raw);

    if (!repoRelative || seen.has(repoRelative)) {
      continue;
    }

    if (!fs.existsSync(path.join(repoRoot, repoRelative))) {
      continue;
    }

    seen.add(repoRelative);
    output.push(repoRelative);
  }

  return output;
}

function normalizeRepoRelativePath(input) {
  const absoluteInput = path.isAbsolute(input) ? input : path.join(repoRoot, input);
  const relativePath = path.relative(repoRoot, absoluteInput);

  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  return relativePath.split(path.sep).join("/");
}

function buildPackagePlan(packageName, files) {
  const matchedFiles = files.filter((file) => {
    if (packageName === "host") {
      return file.startsWith("apps/host/") || file.startsWith("packages/session-sync-core/");
    }

    return file.startsWith("apps/user-app/");
  });

  if (matchedFiles.length === 0) {
    return null;
  }

  const packageDir = packageName === "host" ? "apps/host" : "apps/user-app";
  const directTestFiles = [];
  const relatedSourceFiles = [];

  for (const repoFile of matchedFiles) {
    if (repoFile.startsWith(`${packageDir}/`) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(repoFile)) {
      directTestFiles.push(repoFile.slice(packageDir.length + 1));
      continue;
    }

    if (repoFile.startsWith(`${packageDir}/`)) {
      const packageRelative = path.relative(packageDir, repoFile).split(path.sep).join("/");
      const siblingTests = findSiblingTestFiles(packageDir, packageRelative);

      if (siblingTests.length > 0) {
        directTestFiles.push(...siblingTests);
        continue;
      }

      relatedSourceFiles.push(packageRelative);
      continue;
    }

    relatedSourceFiles.push(repoFile);
  }

  return {
    packageName,
    matchedFiles,
    directTestFiles: Array.from(new Set(directTestFiles)),
    relatedSourceFiles: Array.from(new Set(relatedSourceFiles))
  };
}

function findSiblingTestFiles(packageDir, packageRelative) {
  if (packageDir === "apps/user-app" && packageRelative === "src/features/conversation/components/WorkbenchLayout.tsx") {
    return WORKBENCH_LAYOUT_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  if (packageDir === "apps/user-app" && packageRelative === "src/features/workbench/components/AffairsWorkbenchView.tsx") {
    return AFFAIRS_WORKBENCH_VIEW_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  if (packageDir === "apps/user-app" && packageRelative === "src/features/conversation/components/MessageTimeline.tsx") {
    return MESSAGE_TIMELINE_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  if (packageDir === "apps/user-app" && packageRelative === "src/features/conversation/components/FileViewerModal.tsx") {
    return FILE_VIEWER_MODAL_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  if (packageDir === "apps/user-app" && packageRelative === "src/features/conversation/components/ComposerPanel.tsx") {
    return COMPOSER_PANEL_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  if (packageDir === "apps/user-app" && packageRelative === "src/features/conversation/runtime/session-runtime-store.ts") {
    return SESSION_RUNTIME_STORE_LIGHTWEIGHT_SIBLINGS.filter((entry) =>
      fs.existsSync(path.join(repoRoot, packageDir, entry))
    );
  }

  const parsed = path.posix.parse(packageRelative);
  const prefix = parsed.dir ? `${parsed.dir}/` : "";
  const siblingDir = path.join(repoRoot, packageDir, parsed.dir);

  if (!fs.existsSync(siblingDir)) {
    return [];
  }

  const directFileNames = [
    `${parsed.base}.test${parsed.ext}`,
    `${parsed.base}.spec${parsed.ext}`
  ];
  const splitMatchers = [
    new RegExp(`^${escapeRegExp(parsed.name)}\\.[^.]+\\.test\\.[cm]?[jt]sx?$`),
    new RegExp(`^${escapeRegExp(parsed.name)}\\.[^.]+\\.spec\\.[cm]?[jt]sx?$`)
  ];

  const directMatches = [];
  const splitMatches = [];

  for (const entry of fs.readdirSync(siblingDir)) {
    if (directFileNames.includes(entry)) {
      directMatches.push(`${prefix}${entry}`);
      continue;
    }

    if (splitMatchers.some((matcher) => matcher.test(entry))) {
      splitMatches.push(`${prefix}${entry}`);
    }
  }

  return [...splitMatches.sort((left, right) => left.localeCompare(right)), ...directMatches]
    .filter((entry, index, list) => list.indexOf(entry) === index);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runHostPlan(plan) {
  console.log(`[related-test] host 命中文件：${plan.matchedFiles.join(", ")}`);
  const hasDirectHostTests = plan.directTestFiles.length > 0;

  if (!hasDirectHostTests) {
    runCommand("pnpm", ["--dir", "packages/session-sync-core", "build"]);
  }

  if (hasDirectHostTests) {
    console.log(`[related-test] host 直接测试：${plan.directTestFiles.join(", ")}`);
    runCommand("pnpm", ["--dir", "apps/host", "test", ...plan.directTestFiles]);
  }

  if (plan.relatedSourceFiles.length > 0) {
    console.log(`[related-test] host 关联测试：${plan.relatedSourceFiles.join(", ")}`);
    runCommand("pnpm", [
      "--dir",
      "apps/host",
      "test",
      "--",
      "related",
      ...plan.relatedSourceFiles,
      "--passWithNoTests"
    ]);
  }
}

function runUserAppPlan(plan) {
  console.log(`[related-test] user-app 命中文件：${plan.matchedFiles.join(", ")}`);

  if (plan.directTestFiles.length > 0) {
    console.log(`[related-test] user-app 直接测试：${plan.directTestFiles.join(", ")}`);
    runCommand("pnpm", ["--dir", "apps/user-app", "test", ...plan.directTestFiles]);
  }

  if (plan.relatedSourceFiles.length > 0) {
    console.log(`[related-test] user-app 关联测试：${plan.relatedSourceFiles.join(", ")}`);
    runCommand("pnpm", [
      "--dir",
      "apps/user-app",
      "test",
      "--",
      "related",
      ...plan.relatedSourceFiles,
      "--passWithNoTests"
    ]);
  }
}

function runCommand(command, args) {
  const actualCommand = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(actualCommand, args, {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: COMMAND_TIMEOUT_MS
  });

  if (result.error?.name === "TimeoutError" || result.signal === "SIGTERM") {
    throw new Error(`${command} ${args.join(" ")} 超时，已在 ${Math.round(COMMAND_TIMEOUT_MS / 1000)} 秒后终止`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 失败，退出码 ${result.status ?? "unknown"}`);
  }
}

function readPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}
