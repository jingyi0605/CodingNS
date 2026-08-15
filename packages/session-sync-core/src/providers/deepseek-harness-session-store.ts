import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DSH_HOME_ENV = "DSH_HOME";
const SESSION_ROOT_NAME = "sessions";
const SESSION_LOG_NAMES = ["session.jsonl.zstd", "session.jsonl"] as const;

export interface DeepSeekHarnessSessionStoreOptions {
  /** 可选的 Harness 主目录；未提供时读取 DSH_HOME 或 ~/.dsh。 */
  dshHomeDir?: string;
  /** 已知工作区路径，用于直接定位会话目录。 */
  cwd?: string | null;
  /** 测试或调用方可传入独立环境映射。 */
  env?: NodeJS.ProcessEnv;
}

export interface DeepSeekHarnessDeletedSession {
  sessionDir: string;
  projectDir: string;
}

/**
 * 删除 DeepSeek Harness 的持久化会话目录。
 *
 * rc.5 没有 session.delete RPC，JSONL 后端的一个会话完整拥有自己的
 * 目录，因此删除目录是唯一能真正清理历史数据的操作。目录名和项目名
 * 使用上游同样的编码规则，且不会把用户输入直接拼进文件系统路径。
 */
export function deleteDeepSeekHarnessSessionFiles(
  providerSessionId: string,
  options: DeepSeekHarnessSessionStoreOptions = {}
): DeepSeekHarnessDeletedSession[] {
  const sessionId = providerSessionId.trim();
  if (!sessionId) {
    throw new Error("PROVIDER_SESSION_NOT_FOUND");
  }

  const sessionsRoot = join(resolveDshHome(options), SESSION_ROOT_NAME);
  const encodedSessionId = encodeSegment(sessionId);
  const candidates = new Map<string, string>();

  if (options.cwd?.trim()) {
    const projectPath = join(sessionsRoot, projectKey(options.cwd));
    candidates.set(join(projectPath, encodedSessionId), projectPath);
  }

  // cwd 可能来自旧版本摘要或已被规范化，定位失败时扫描一级项目目录。
  // 只检查编码后的会话目录，不递归用户文件，避免误删其它数据。
  if (existsSync(sessionsRoot)) {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }

      const projectPath = join(sessionsRoot, entry.name);
      candidates.set(join(projectPath, encodedSessionId), projectPath);
    }
  }

  const deleted: DeepSeekHarnessDeletedSession[] = [];
  for (const [sessionPath, projectPath] of candidates) {
    if (!isSessionDirectory(sessionPath)) {
      continue;
    }

    rmSync(sessionPath, { recursive: true, force: true });
    deleted.push({ sessionDir: sessionPath, projectDir: projectPath });
  }

  if (deleted.length === 0) {
    throw new Error("PROVIDER_SESSION_NOT_FOUND");
  }

  return deleted;
}

function resolveDshHome(options: DeepSeekHarnessSessionStoreOptions): string {
  const configured = options.dshHomeDir?.trim();
  const fromEnv = (options.env ?? process.env)[DSH_HOME_ENV]?.trim();
  const selected = configured || fromEnv || join(homedir(), ".dsh");
  const expanded = selected === "~"
    ? homedir()
    : selected.startsWith("~/") || selected.startsWith("~\\")
      ? join(homedir(), selected.slice(2))
      : selected;
  return resolve(expanded);
}

/** 上游 dsh-session-persistence-jsonl 的 session id 路径编码。 */
function encodeSegment(value: string): string {
  if (value === ".") {
    return "~002E";
  }
  if (value === "..") {
    return "~002E~002E";
  }

  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const character = String.fromCharCode(code);
    encoded += character !== "~" && /^[A-Za-z0-9._-]$/.test(character)
      ? character
      : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return encoded;
}

/** 上游 projectKey 的跨平台、有限长度实现。 */
function projectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;

  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) {
        readable += "-";
      }
      separatorRun = true;
      continue;
    }

    if (character !== "~" && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    separatorRun = false;
  }

  const slug = readable.replace(/^-+/, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

function isSessionDirectory(sessionPath: string): boolean {
  let stats;
  try {
    stats = lstatSync(sessionPath);
  } catch {
    return false;
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return false;
  }

  return SESSION_LOG_NAMES.some((name) => existsSync(join(sessionPath, name)));
}
