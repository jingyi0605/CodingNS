import path from "node:path";

export interface CommandLaunch {
  command: string;
  args: string[];
  shell: boolean;
}

export function resolveCommandLaunch(
  commandPath: string,
  args: readonly string[] = []
): CommandLaunch {
  const normalizedCommandPath = commandPath.trim();

  if (!normalizedCommandPath) {
    throw new Error("COMMAND_PATH_REQUIRED");
  }

  if (isNodeScriptPath(normalizedCommandPath)) {
    return {
      command: process.execPath,
      args: [normalizedCommandPath, ...args],
      shell: false
    };
  }

  return {
    command: normalizedCommandPath,
    args: [...args],
    shell: shouldSpawnViaShell(normalizedCommandPath)
  };
}

function isNodeScriptPath(commandPath: string): boolean {
  const extension = path.extname(commandPath).toLowerCase();
  return extension === ".js" || extension === ".cjs" || extension === ".mjs";
}

function shouldSpawnViaShell(commandPath: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  // Windows 上 .cmd/.bat 文件需要通过 shell 执行
  if (/\.(cmd|bat)$/i.test(commandPath)) {
    return true;
  }

  // Windows 上裸名命令（无扩展名、无路径分隔符）需要 shell 才能从 PATH 解析 .cmd 文件
  const extension = path.extname(commandPath);
  if (!extension && !commandPath.includes(path.sep) && !commandPath.includes("/")) {
    return true;
  }

  return false;
}
