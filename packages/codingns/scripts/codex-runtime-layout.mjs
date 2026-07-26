import fs from "node:fs";
import path from "node:path";

/**
 * 按平台包自己的清单定位 Codex 二进制，同时兼容没有清单的旧版目录。
 */
export function resolveCodexVendorBinaryPath({
  vendorRoot,
  targetTriple,
  binaryName
}) {
  const normalizedVendorRoot = path.resolve(String(vendorRoot || ""));
  const normalizedTargetTriple = String(targetTriple || "").trim();
  const normalizedBinaryName = String(binaryName || "").trim();

  if (!normalizedTargetTriple || !normalizedBinaryName) {
    return null;
  }

  const targetRoot = path.join(normalizedVendorRoot, normalizedTargetTriple);
  const manifestEntrypoint = readManifestEntrypoint(targetRoot);
  const candidates = [
    manifestEntrypoint ? resolveSafeEntrypoint(targetRoot, manifestEntrypoint) : null,
    path.join(targetRoot, "bin", normalizedBinaryName),
    path.join(targetRoot, "codex", normalizedBinaryName)
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readManifestEntrypoint(targetRoot) {
  const manifestPath = path.join(targetRoot, "codex-package.json");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return typeof manifest?.entrypoint === "string" && manifest.entrypoint.trim()
      ? manifest.entrypoint.trim()
      : null;
  } catch {
    return null;
  }
}

function resolveSafeEntrypoint(targetRoot, entrypoint) {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedEntrypoint = path.resolve(resolvedTargetRoot, entrypoint);

  if (!resolvedEntrypoint.startsWith(`${resolvedTargetRoot}${path.sep}`)) {
    return null;
  }

  return resolvedEntrypoint;
}
