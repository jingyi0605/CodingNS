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
const cargoLockTargets = [
  { relativePath: 'apps/desktop/src-tauri/Cargo.lock', packageName: 'codingns-desktop' },
  { relativePath: 'apps/user-app/src-tauri/Cargo.lock', packageName: 'app' },
];
const iosProjectTargets = [
  'scripts/user-app-ios-project.yml',
  'apps/user-app/src-tauri/gen/apple/project.yml',
];
const iosPbxprojTargets = ['apps/user-app/src-tauri/gen/apple/app.xcodeproj/project.pbxproj'];
const iosPlistTargets = ['apps/user-app/src-tauri/gen/apple/app_iOS/Info.plist'];
const androidTargets = ['apps/user-app/src-tauri/gen/android/app/tauri.properties'];

const version = await readVersion();
const androidVersionCode = buildAndroidVersionCode(version);
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

for (const { relativePath, packageName } of cargoLockTargets) {
  const changed = await syncCargoLockVersion(relativePath, packageName, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

for (const relativePath of iosProjectTargets) {
  const changed = await syncIosProjectVersion(relativePath, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

for (const relativePath of iosPbxprojTargets) {
  const changed = await syncIosPbxprojVersion(relativePath, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

for (const relativePath of iosPlistTargets) {
  const changed = await syncIosPlistVersion(relativePath, version);
  if (changed) {
    changedFiles.push(relativePath);
  }
}

for (const relativePath of androidTargets) {
  const changed = await syncAndroidVersion(relativePath, version, androidVersionCode);
  if (changed) {
    changedFiles.push(relativePath);
  }
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

function buildAndroidVersionCode(input) {
  const [coreVersion] = input.split(/[+-]/, 1);
  const [major, minor, patch] = coreVersion.split('.').map(Number);

  return major * 1_000_000 + minor * 1_000 + patch;
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

async function syncCargoLockVersion(relativePath, packageName, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  const nextSource = source.replace(
    new RegExp(`(\\[\\[package\\]\\]\\nname = "${escapeRegExp(packageName)}"\\nversion = ")([^"]+)(")`),
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
  nextSource = nextSource.replace(
    /^(\s*MARKETING_VERSION:\s*).+$/m,
    `$1${nextVersion}`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}

async function syncIosPbxprojVersion(relativePath, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  const nextSource = source.replace(
    /^(\s*MARKETING_VERSION = ).+;$/gm,
    `$1${nextVersion};`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}

async function syncIosPlistVersion(relativePath, nextVersion) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  let nextSource = source.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/,
    `$1${nextVersion}$3`,
  );
  nextSource = nextSource.replace(
    /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/,
    `$1${nextVersion}$3`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}

async function syncAndroidVersion(relativePath, nextVersion, nextVersionCode) {
  const filePath = path.join(rootDir, relativePath);
  const source = await readFile(filePath, 'utf8');
  let nextSource = source.replace(
    /^(tauri\.android\.versionName=).+$/m,
    `$1${nextVersion}`,
  );
  nextSource = nextSource.replace(
    /^(tauri\.android\.versionCode=).+$/m,
    `$1${nextVersionCode}`,
  );

  if (nextSource === source) {
    return false;
  }

  await writeFile(filePath, nextSource, 'utf8');
  return true;
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
