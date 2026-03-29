import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const versionFilePath = path.join(rootDir, 'VERSION');
const jsonTargets = [
  'packages/codingns/package.json',
  'apps/desktop/package.json',
  'apps/host/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/user-app/src-tauri/tauri.conf.json',
];
const cargoTargets = [
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/user-app/src-tauri/Cargo.toml',
];
const iosProjectTarget = 'scripts/user-app-ios-project.yml';

const version = await readVersion();
const changedFiles = [];

for (const relativePath of jsonTargets) {
  const changed = await syncJsonVersion(relativePath, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

for (const relativePath of cargoTargets) {
  const changed = await syncCargoVersion(relativePath, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

const iosChanged = await syncIosProjectVersion(iosProjectTarget, version);
if (iosChanged) {
  changedFiles.push(iosProjectTarget);
}

if (changedFiles.length === 0) {
  console.log(`版本已同步，无需更新：${version}`);
} else {
  console.log(`已同步产品版本到 ${version}`);
  for (const relativePath of changedFiles) {
    console.log(`- ${relativePath}`);
  }
}

async function readVersion() {
  const rawVersion = (await readFile(versionFilePath, 'utf8')).trim();

  if (!isValidSemver(rawVersion)) {
    throw new Error(`VERSION 文件中的版本号不合法：${rawVersion}`);
  }

  return rawVersion;
}

function isValidSemver(input) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(input);
}

async function syncJsonVersion(relativePath, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  const json = JSON.parse(source);

  if (json.version === nextVersion) {
    return false;
  }

  json.version = nextVersion;
  await writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return true;
}

async function syncCargoVersion(relativePath, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  const nextSource = source.replace(
    /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/,
    `$1${nextVersion}$3`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}

async function syncIosProjectVersion(relativePath, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  let nextSource = source.replace(
    /^(\s*CFBundleShortVersionString:\s*).+$/m,
    `$1${nextVersion}`,
  );
  nextSource = nextSource.replace(
    /^(\s*CFBundleVersion:\s*).+$/m,
    `$1"${nextVersion}"`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}
