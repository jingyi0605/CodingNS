import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tauriConfigPath = path.join(rootDir, "apps", "user-app", "src-tauri", "tauri.conf.json");
const tauriPropertiesPath = path.join(
  rootDir,
  "apps",
  "user-app",
  "src-tauri",
  "gen",
  "android",
  "app",
  "tauri.properties"
);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!options.apk || !options.output || !options.downloadUrl || !options.publishedAt) {
  printUsage();
  throw new Error("缺少必要参数：--apk、--output、--download-url、--published-at");
}

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const tauriProperties = readJavaProperties(tauriPropertiesPath);
await main();

function parseArgs(argv) {
  const parsed = {
    help: false,
    apk: null,
    output: null,
    channel: "stable",
    downloadUrl: null,
    publishedAt: null,
    htmlUrl: null,
    notes: null,
    notesFile: null,
    minSupportedVersionCode: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--apk":
        parsed.apk = requireValue(token, nextValue);
        index += 1;
        break;
      case "--output":
        parsed.output = requireValue(token, nextValue);
        index += 1;
        break;
      case "--channel":
        parsed.channel = requireValue(token, nextValue);
        index += 1;
        break;
      case "--download-url":
        parsed.downloadUrl = requireValue(token, nextValue);
        index += 1;
        break;
      case "--published-at":
        parsed.publishedAt = requireValue(token, nextValue);
        index += 1;
        break;
      case "--html-url":
        parsed.htmlUrl = requireValue(token, nextValue);
        index += 1;
        break;
      case "--notes":
        parsed.notes = requireValue(token, nextValue);
        index += 1;
        break;
      case "--notes-file":
        parsed.notesFile = requireValue(token, nextValue);
        index += 1;
        break;
      case "--min-supported-version-code": {
        const rawValue = requireValue(token, nextValue);
        const numericValue = Number(rawValue);

        if (!Number.isInteger(numericValue) || numericValue <= 0) {
          throw new Error(`无效的最小支持版本号：${rawValue}`);
        }

        parsed.minSupportedVersionCode = numericValue;
        index += 1;
        break;
      }
      default:
        throw new Error(`不支持的参数：${token}`);
    }
  }

  return parsed;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} 缺少参数值`);
  }

  return value;
}

function readJavaProperties(filePath) {
  const result = new Map();
  const source = fs.readFileSync(filePath, "utf8");

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result.set(key, value);
  }

  return result;
}

function resolveNotes(options) {
  if (typeof options.notes === "string") {
    return options.notes;
  }

  if (typeof options.notesFile === "string") {
    return fs.readFileSync(path.resolve(rootDir, options.notesFile), "utf8");
  }

  return "";
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function main() {
  const version = tauriProperties.get("tauri.android.versionName")?.trim() || tauriConfig.version;
  const versionCode = Number(tauriProperties.get("tauri.android.versionCode")?.trim() || "0");
  const packageName = String(tauriConfig.identifier || "").trim();

  if (!version || !Number.isInteger(versionCode) || versionCode <= 0 || !packageName) {
    throw new Error("无法从现有 Android 配置解析 version/versionCode/packageName");
  }

  const apkPath = path.resolve(rootDir, options.apk);
  const outputPath = path.resolve(rootDir, options.output);
  const sha256 = await sha256File(apkPath);
  const notes = resolveNotes(options);
  const manifest = {
    channel: options.channel || "stable",
    version,
    versionCode,
    packageName,
    fileName: path.basename(apkPath),
    downloadUrl: options.downloadUrl,
    sha256: `sha256:${sha256}`,
    publishedAt: options.publishedAt,
    notes,
    minSupportedVersionCode: options.minSupportedVersionCode ?? null,
    htmlUrl: options.htmlUrl ?? null
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`[android-manifest] 已生成 ${path.relative(rootDir, outputPath)}`);
}

function printUsage() {
  console.log(`用法：
  node scripts/generate-android-release-manifest.mjs \\
    --apk <apk-path> \\
    --output <json-path> \\
    --download-url <url> \\
    --published-at <iso-datetime> \\
    [--channel stable|beta] \\
    [--html-url <url>] \\
    [--notes <text> | --notes-file <file>] \\
    [--min-supported-version-code <number>]`);
}
