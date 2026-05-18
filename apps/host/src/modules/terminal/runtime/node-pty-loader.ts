import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const WINDOWS_PREBUILT_NODE_PTY_PACKAGE = "@codingns/node-pty";
const DEFAULT_NODE_PTY_PACKAGE = "node-pty";

export type NodePtyModule = typeof import("node-pty");
export type { IPty } from "node-pty";

let cachedNodePtyModule: NodePtyModule | null = null;
let cachedNodePtyPackageName: string | null = null;
let cachedNodePtyPackageRoot: string | null = null;

export function loadNodePty(): NodePtyModule {
  if (cachedNodePtyModule) {
    return cachedNodePtyModule;
  }

  if (shouldPreferWindowsPrebuiltNodePty()) {
    const preferredPackage = tryLoadNodePtyPackage(WINDOWS_PREBUILT_NODE_PTY_PACKAGE);

    if (preferredPackage) {
      cacheLoadedNodePty(preferredPackage);
      return preferredPackage.module;
    }
  }

  const defaultPackage = tryLoadNodePtyPackage(DEFAULT_NODE_PTY_PACKAGE);

  if (defaultPackage) {
    cacheLoadedNodePty(defaultPackage);
    return defaultPackage.module;
  }

  const attemptedPackages = shouldPreferWindowsPrebuiltNodePty()
    ? `${WINDOWS_PREBUILT_NODE_PTY_PACKAGE}, ${DEFAULT_NODE_PTY_PACKAGE}`
    : DEFAULT_NODE_PTY_PACKAGE;

  throw new Error(`未找到可用的 PTY 运行时依赖：${attemptedPackages}`);
}

export function resolveLoadedNodePtyPackageRoot(): string | null {
  loadNodePty();
  return cachedNodePtyPackageRoot;
}

export function resolveLoadedNodePtyPackageName(): string {
  loadNodePty();
  return cachedNodePtyPackageName ?? DEFAULT_NODE_PTY_PACKAGE;
}

function shouldPreferWindowsPrebuiltNodePty(): boolean {
  return (
    process.platform === "win32" &&
    process.arch === "x64" &&
    readNodeMajorVersion(process.versions.node) === 22
  );
}

function readNodeMajorVersion(versionText: string): number {
  const normalized = versionText.trim().replace(/^v/, "");
  const majorText = normalized.split(".")[0] ?? "";
  const major = Number.parseInt(majorText, 10);
  return Number.isFinite(major) ? major : Number.NaN;
}

function tryLoadNodePtyPackage(
  packageName: string
): { module: NodePtyModule; packageName: string; packageRoot: string } | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const module = require(packageName) as NodePtyModule;
    return {
      module,
      packageName,
      packageRoot: path.dirname(packageJsonPath)
    };
  } catch {
    return null;
  }
}

function cacheLoadedNodePty(input: {
  module: NodePtyModule;
  packageName: string;
  packageRoot: string;
}): void {
  cachedNodePtyModule = input.module;
  cachedNodePtyPackageName = input.packageName;
  cachedNodePtyPackageRoot = input.packageRoot;
}
