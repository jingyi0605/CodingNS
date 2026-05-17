import fs from "node:fs";
import path from "node:path";

import { nowIso } from "../../shared/utils/time.js";
import type { OpenCliRuntimeProfileRecord } from "../../types/domain.js";
import type { OpenCliRuntimeProfileRepository } from "../../storage/repositories/opencli-runtime-profile-repository.js";
import { createOpenCliRuntimeStagingRoot } from "./opencli-runtime-layout.js";
import { CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV } from "./opencli-runtime-guard.js";

export interface OpenCliRuntimeBuilderOptions {
  now?: () => string;
}

export class OpenCliRuntimeBuilder {
  private readonly now: () => string;

  constructor(
    private readonly runtimeProfileRepository: OpenCliRuntimeProfileRepository,
    options: OpenCliRuntimeBuilderOptions = {}
  ) {
    this.now = options.now ?? nowIso;
  }

  buildProfile(profileOrId: string | OpenCliRuntimeProfileRecord): OpenCliRuntimeProfileRecord {
    const profile = resolveProfile(this.runtimeProfileRepository, profileOrId);

    if (profile.status === "ready" && runtimeRootLooksUsable(profile.runtimeRootPath)) {
      return profile;
    }

    const stagingRootPath = createOpenCliRuntimeStagingRoot(profile.runtimeRootPath);

    try {
      const enabledCommandIds = parseEnabledCommandIds(profile.enabledCommandIdsJson);
      const sourceLayout = readOpenCliSourceLayout(profile.sourceInstallPath);
      const filteredManifest = filterManifestEntries(sourceLayout.manifestEntries, enabledCommandIds);
      const enabledSites = new Set(filteredManifest.map((entry) => normalizeManifestCommandId(entry).site));

      fs.rmSync(stagingRootPath, { recursive: true, force: true });
      fs.mkdirSync(stagingRootPath, { recursive: true });

      copyPackageJson(sourceLayout.packageJsonPath, path.join(stagingRootPath, "package.json"));
      writeManifest(path.join(stagingRootPath, "cli-manifest.json"), filteredManifest);
      linkDirectory(sourceLayout.distPath, path.join(stagingRootPath, "dist"));

      if (sourceLayout.nodeModulesPath) {
        linkDirectory(sourceLayout.nodeModulesPath, path.join(stagingRootPath, "node_modules"));
      }

      copyPrunedClis({
        sourceClisRoot: sourceLayout.clisPath,
        targetClisRoot: path.join(stagingRootPath, "clis"),
        enabledSites
      });
      writeOpenCliShim(stagingRootPath);

      fs.mkdirSync(path.dirname(profile.runtimeRootPath), { recursive: true });
      fs.rmSync(profile.runtimeRootPath, { recursive: true, force: true });
      fs.renameSync(stagingRootPath, profile.runtimeRootPath);

      return this.runtimeProfileRepository.upsert({
        ...profile,
        status: "ready",
        updatedAt: this.now(),
        lastErrorCode: null,
        lastErrorDetail: null
      });
    } catch (error) {
      fs.rmSync(stagingRootPath, { recursive: true, force: true });

      return this.runtimeProfileRepository.upsert({
        ...profile,
        status: "failed",
        updatedAt: this.now(),
        lastErrorCode: "OPENCLI_RUNTIME_BUILD_FAILED",
        lastErrorDetail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

interface OpenCliManifestEntry {
  site?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

function resolveProfile(
  repository: OpenCliRuntimeProfileRepository,
  profileOrId: string | OpenCliRuntimeProfileRecord
): OpenCliRuntimeProfileRecord {
  if (typeof profileOrId !== "string") {
    return profileOrId;
  }

  const profile = repository.findById(profileOrId);

  if (!profile) {
    throw new Error(`OPENCLI_RUNTIME_PROFILE_NOT_FOUND:${profileOrId}`);
  }

  return profile;
}

function runtimeRootLooksUsable(runtimeRootPath: string): boolean {
  return [
    path.join(runtimeRootPath, "package.json"),
    path.join(runtimeRootPath, "cli-manifest.json"),
    path.join(runtimeRootPath, "clis"),
    path.join(runtimeRootPath, "bin", "opencli")
  ].every((entryPath) => fs.existsSync(entryPath));
}

function parseEnabledCommandIds(value: string): Set<string> {
  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("OPENCLI_RUNTIME_ENABLED_COMMAND_IDS_INVALID");
  }

  return new Set(parsed);
}

function readOpenCliSourceLayout(sourceInstallPath: string): {
  packageJsonPath: string;
  distPath: string;
  clisPath: string;
  nodeModulesPath: string | null;
  manifestEntries: OpenCliManifestEntry[];
} {
  const packageJsonPath = path.join(sourceInstallPath, "package.json");
  const distPath = path.join(sourceInstallPath, "dist");
  const clisPath = path.join(sourceInstallPath, "clis");
  const nodeModulesPath = path.join(sourceInstallPath, "node_modules");
  const manifestPath = path.join(sourceInstallPath, "cli-manifest.json");

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_PACKAGE_JSON_MISSING");
  }

  if (!fs.existsSync(distPath)) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_DIST_MISSING");
  }

  if (!fs.existsSync(clisPath)) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_CLIS_MISSING");
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_MANIFEST_MISSING");
  }

  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;

  if (!Array.isArray(rawManifest)) {
    throw new Error("OPENCLI_RUNTIME_SOURCE_MANIFEST_INVALID");
  }

  return {
    packageJsonPath,
    distPath,
    clisPath,
    nodeModulesPath: fs.existsSync(nodeModulesPath) ? nodeModulesPath : null,
    manifestEntries: rawManifest as OpenCliManifestEntry[]
  };
}

function filterManifestEntries(
  manifestEntries: readonly OpenCliManifestEntry[],
  enabledCommandIds: ReadonlySet<string>
): OpenCliManifestEntry[] {
  const filteredEntries = manifestEntries.filter((entry) => {
    const { commandId } = normalizeManifestCommandId(entry);
    return enabledCommandIds.has(commandId);
  });

  if (filteredEntries.length !== enabledCommandIds.size) {
    const foundCommandIds = new Set(filteredEntries.map((entry) => normalizeManifestCommandId(entry).commandId));

    for (const commandId of enabledCommandIds) {
      if (!foundCommandIds.has(commandId)) {
        throw new Error(`OPENCLI_RUNTIME_COMMAND_NOT_FOUND:${commandId}`);
      }
    }
  }

  return filteredEntries;
}

function normalizeManifestCommandId(entry: OpenCliManifestEntry): {
  commandId: string;
  site: string;
} {
  const site = typeof entry.site === "string" ? entry.site.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";

  if (!site || !name) {
    throw new Error("OPENCLI_RUNTIME_MANIFEST_ENTRY_INVALID");
  }

  return {
    commandId: `${site}/${name}`,
    site
  };
}

function copyPackageJson(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function writeManifest(targetPath: string, manifestEntries: readonly OpenCliManifestEntry[]): void {
  fs.writeFileSync(targetPath, `${JSON.stringify(manifestEntries, null, 2)}\n`, "utf8");
}

function linkDirectory(sourcePath: string, targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.symlinkSync(
    sourcePath,
    targetPath,
    process.platform === "win32" ? "junction" : "dir"
  );
}

function copyPrunedClis(input: {
  sourceClisRoot: string;
  targetClisRoot: string;
  enabledSites: ReadonlySet<string>;
}): void {
  fs.mkdirSync(input.targetClisRoot, { recursive: true });
  const entries = fs.readdirSync(input.sourceClisRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const shouldCopy = entry.name.startsWith("_") || input.enabledSites.has(entry.name);

    if (!shouldCopy) {
      continue;
    }

    fs.cpSync(
      path.join(input.sourceClisRoot, entry.name),
      path.join(input.targetClisRoot, entry.name),
      { recursive: true }
    );
  }
}

function writeOpenCliShim(runtimeRootPath: string): void {
  const binDir = path.join(runtimeRootPath, "bin");
  const scriptPath = path.join(binDir, "opencli");
  const cmdPath = path.join(binDir, "opencli.cmd");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const runtimeRoot = path.resolve(path.dirname(__filename), "..");
const mainScript = path.join(runtimeRoot, "dist", "src", "main.js");
const manifestPath = path.join(runtimeRoot, "cli-manifest.json");
const env = { ...process.env };
const realHome = env.CODINGNS_OPENCLI_REAL_HOME?.trim();
const realUserProfile = env.CODINGNS_OPENCLI_REAL_USERPROFILE?.trim();
const blockBrowserDependentCommands = /^(1|true|yes)$/i.test(
  (env.${CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV} ?? "").trim()
);

if (realHome) {
  env.HOME = realHome;
}

if (realUserProfile) {
  env.USERPROFILE = realUserProfile;
}

if (blockBrowserDependentCommands) {
  const args = process.argv.slice(2);
  const commandId = args.length >= 2 ? \`\${args[0]}/\${args[1]}\` : "";

  if (commandId) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const matched = Array.isArray(manifest)
        ? manifest.find((entry) => entry && typeof entry === "object" && \`\${entry.site ?? ""}/\${entry.name ?? ""}\` === commandId)
        : null;

      if (matched && matched.browser === true) {
        process.stderr.write(
          \`BROWSER_DEPENDENT_OPENCLI_COMMAND_BLOCKED:\${commandId}\\n真实站点浏览器任务必须走 office.browser.*；如需真实浏览器调试，请使用 executionBackend=opencli_bridge。\\n\`
        );
        process.exit(126);
      }
    } catch {
      // manifest 读取失败时不要在 shim 层误伤，让下游真实命令自己报错。
    }
  }
}

const child = spawn(process.execPath, ["--preserve-symlinks-main", mainScript, ...process.argv.slice(2)], {
  stdio: "inherit",
  env
});

child.on("error", (error) => {
  process.stderr.write(\`\${error instanceof Error ? error.message : String(error)}\\n\`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
`,
    "utf8"
  );
  fs.chmodSync(scriptPath, 0o755);
  fs.writeFileSync(
    cmdPath,
    "@echo off\r\nnode \"%~dp0\\opencli\" %*\r\n",
    "utf8"
  );
}
