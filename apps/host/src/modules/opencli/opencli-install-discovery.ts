import fs from "node:fs";
import path from "node:path";

import type { OpenCliCatalogSource, OpenCliInstallState } from "../../types/domain.js";

const OPENCLI_PACKAGE_NAME = "@jackwener/opencli";

export interface OpenCliManifestSource {
  kind: Extract<OpenCliCatalogSource, "manifest" | "local_manifest">;
  rootPath: string;
  manifestPath: string;
}

export interface OpenCliInstallDiscoveryResult {
  installState: OpenCliInstallState;
  binaryPath: string | null;
  installPath: string | null;
  version: string | null;
  manifestSource: OpenCliManifestSource | null;
}

export interface OpenCliInstallDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  catalogRootCandidates?: readonly string[];
}

export class OpenCliInstallDiscovery {
  private readonly env: NodeJS.ProcessEnv;
  private readonly catalogRootCandidates: readonly string[];

  constructor(options: OpenCliInstallDiscoveryOptions = {}) {
    this.env = options.env ?? process.env;
    this.catalogRootCandidates = options.catalogRootCandidates ?? [];
  }

  discover(): OpenCliInstallDiscoveryResult {
    const binaryPath = resolveExecutableFromPath("opencli", this.env.PATH ?? null);

    if (binaryPath) {
      const installRoot = findOpenCliRootForExecutable(binaryPath);
      const manifestPath = installRoot ? path.join(installRoot, "cli-manifest.json") : null;

      return {
        installState: "installed",
        binaryPath,
        installPath: installRoot,
        version: installRoot ? readPackageVersion(installRoot) : null,
        manifestSource:
          installRoot && manifestPath && fs.existsSync(manifestPath)
            ? {
                kind: "manifest",
                rootPath: installRoot,
                manifestPath
              }
            : null
      };
    }

    for (const candidateRoot of this.catalogRootCandidates) {
      const resolvedRoot = path.resolve(candidateRoot);
      const manifestPath = path.join(resolvedRoot, "cli-manifest.json");

      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      return {
        installState: "not_installed",
        binaryPath: null,
        installPath: null,
        version: null,
        manifestSource: {
          kind: "local_manifest",
          rootPath: resolvedRoot,
          manifestPath
        }
      };
    }

    return {
      installState: "not_installed",
      binaryPath: null,
      installPath: null,
      version: null,
      manifestSource: null
    };
  }
}

function resolveExecutableFromPath(binaryName: string, pathValue: string | null): string | null {
  if (!pathValue) {
    return null;
  }

  const pathEntries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const executableNames =
    process.platform === "win32"
      ? [binaryName, `${binaryName}.cmd`, `${binaryName}.exe`, `${binaryName}.bat`]
      : [binaryName];

  for (const directory of pathEntries) {
    for (const executableName of executableNames) {
      const candidatePath = path.join(directory, executableName);

      if (isExecutable(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOpenCliRootForExecutable(binaryPath: string): string | null {
  const resolvedBinaryPath = fs.realpathSync(binaryPath);
  let currentDir = path.dirname(resolvedBinaryPath);

  while (true) {
    if (looksLikeOpenCliRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function looksLikeOpenCliRoot(rootPath: string): boolean {
  const packageJsonPath = path.join(rootPath, "package.json");
  const manifestPath = path.join(rootPath, "cli-manifest.json");

  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
    };

    return packageJson.name === OPENCLI_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function readPackageVersion(rootPath: string): string | null {
  const packageJsonPath = path.join(rootPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };

    return typeof packageJson.version === "string" && packageJson.version.trim().length > 0
      ? packageJson.version.trim()
      : null;
  } catch {
    return null;
  }
}
