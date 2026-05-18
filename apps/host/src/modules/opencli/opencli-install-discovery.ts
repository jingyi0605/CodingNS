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
  packagedInstallRootCandidates?: readonly string[];
}

export class OpenCliInstallDiscovery {
  private readonly env: NodeJS.ProcessEnv;
  private readonly catalogRootCandidates: readonly string[];
  private readonly packagedInstallRootCandidates: readonly string[];
  private readonly hasExplicitPackagedInstallCandidates: boolean;

  constructor(options: OpenCliInstallDiscoveryOptions = {}) {
    this.env = options.env ?? process.env;
    this.catalogRootCandidates = options.catalogRootCandidates ?? [];
    this.hasExplicitPackagedInstallCandidates = Array.isArray(options.packagedInstallRootCandidates);
    this.packagedInstallRootCandidates = options.packagedInstallRootCandidates ?? resolvePackagedOpenCliRootCandidates();
  }

  discover(): OpenCliInstallDiscoveryResult {
    if (this.hasExplicitPackagedInstallCandidates) {
      const packagedInstall = this.resolvePackagedInstall();

      if (packagedInstall) {
        return packagedInstall;
      }
    }

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

    if (!this.hasExplicitPackagedInstallCandidates) {
      const packagedInstall = this.resolvePackagedInstall();

      if (packagedInstall) {
        return packagedInstall;
      }
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

  private resolvePackagedInstall(): OpenCliInstallDiscoveryResult | null {
    for (const candidateRoot of this.packagedInstallRootCandidates) {
      const resolvedRoot = path.resolve(candidateRoot);

      if (!looksLikeOpenCliRoot(resolvedRoot)) {
        continue;
      }

      const binaryPath = resolveOpenCliBinaryFromInstallRoot(resolvedRoot);
      const manifestPath = path.join(resolvedRoot, "cli-manifest.json");

      return {
        installState: "installed",
        binaryPath,
        installPath: resolvedRoot,
        version: readPackageVersion(resolvedRoot),
        manifestSource: fs.existsSync(manifestPath)
          ? {
              kind: "manifest",
              rootPath: resolvedRoot,
              manifestPath
            }
          : null
      };
    }

    return null;
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

function resolvePackagedOpenCliRootCandidates(): string[] {
  const candidates = [
    path.resolve(import.meta.dirname, "../../../../../packages/codingns/node_modules/@jackwener/opencli"),
    path.resolve(import.meta.dirname, "../../../../../node_modules/@jackwener/opencli")
  ];

  return candidates.filter((candidate, index, values) => values.indexOf(candidate) === index);
}

function resolveOpenCliBinaryFromInstallRoot(rootPath: string): string | null {
  const packageBinCandidates = readPackageBinCandidates(rootPath);
  const fallbackCandidates =
    process.platform === "win32"
      ? [
          path.join(rootPath, "bin", "opencli.cmd"),
          path.join(rootPath, "bin", "opencli.exe"),
          path.join(rootPath, "bin", "opencli.bat"),
          path.join(rootPath, "node_modules", ".bin", "opencli.cmd"),
          path.join(rootPath, "node_modules", ".bin", "opencli.exe"),
          path.join(rootPath, "node_modules", ".bin", "opencli.bat")
        ]
      : [
          path.join(rootPath, "bin", "opencli"),
          path.join(rootPath, "node_modules", ".bin", "opencli")
        ];
  const candidates = [...packageBinCandidates, ...fallbackCandidates]
    .filter((candidate, index, values) => values.indexOf(candidate) === index);

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readPackageBinCandidates(rootPath: string): string[] {
  const packageJsonPath = path.join(rootPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      bin?: unknown;
    };
    const packageBin = packageJson.bin;

    if (typeof packageBin === "string" && packageBin.trim().length > 0) {
      return [path.resolve(rootPath, packageBin.trim())];
    }

    if (typeof packageBin === "object" && packageBin !== null) {
      const opencliBin = (packageBin as Record<string, unknown>).opencli;

      if (typeof opencliBin === "string" && opencliBin.trim().length > 0) {
        return [path.resolve(rootPath, opencliBin.trim())];
      }
    }
  } catch {
    return [];
  }

  return [];
}
