import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const stagingRoot = process.argv[2];

if (!stagingRoot) {
  throw new Error("缺少发布暂存目录参数");
}

const packageJsonPath = path.join(packageRoot, "package.json");
const stagingPackageJsonPath = path.join(stagingRoot, "package.json");

fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });
fs.cpSync(packageRoot, stagingRoot, {
  recursive: true,
  filter: (sourcePath) => {
    const baseName = path.basename(sourcePath);
    return baseName !== ".DS_Store" && !baseName.endsWith(".tgz");
  }
});

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const workspacePackageVersions = collectWorkspacePackageVersions();

rewriteWorkspaceDependencies(packageJson, workspacePackageVersions);

if (packageJson.scripts && typeof packageJson.scripts === "object") {
  delete packageJson.scripts.prepack;
}

fs.writeFileSync(stagingPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.info(`[codingns] 已生成发布暂存目录：${stagingRoot}`);

function collectWorkspacePackageVersions() {
  const packageDirectories = [
    path.join(workspaceRoot, "packages"),
    path.join(workspaceRoot, "apps")
  ];
  const versionMap = new Map();

  for (const directory of packageDirectories) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(directory, entry.name, "package.json");

      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      if (typeof manifest.name === "string" && typeof manifest.version === "string") {
        versionMap.set(manifest.name, manifest.version);
      }
    }
  }

  return versionMap;
}

function rewriteWorkspaceDependencies(packageJson, workspacePackageVersions) {
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];

  for (const fieldName of dependencyFields) {
    const dependencies = packageJson[fieldName];

    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const [dependencyName, versionRange] of Object.entries(dependencies)) {
      if (typeof versionRange !== "string" || !versionRange.startsWith("workspace:")) {
        continue;
      }

      const resolvedVersion = resolveWorkspaceRange(
        dependencyName,
        versionRange,
        workspacePackageVersions
      );

      dependencies[dependencyName] = resolvedVersion;
    }
  }
}

function resolveWorkspaceRange(dependencyName, versionRange, workspacePackageVersions) {
  const packageVersion = workspacePackageVersions.get(dependencyName);

  if (!packageVersion) {
    throw new Error(`找不到 workspace 依赖版本：${dependencyName}`);
  }

  const workspaceValue = versionRange.slice("workspace:".length);

  if (workspaceValue === "*" || workspaceValue === "") {
    return packageVersion;
  }

  if (workspaceValue === "^") {
    return `^${packageVersion}`;
  }

  if (workspaceValue === "~") {
    return `~${packageVersion}`;
  }

  if (workspaceValue.startsWith("^") || workspaceValue.startsWith("~")) {
    return workspaceValue[0] + packageVersion;
  }

  return workspaceValue;
}
