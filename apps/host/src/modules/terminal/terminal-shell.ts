import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { TerminalCommandTemplate } from "../../types/domain.js";

export interface TerminalShellOption {
  id: string;
  label: string;
  shell: string;
  available: boolean;
  unavailableReason: string | null;
}

interface InternalTerminalShellOption extends TerminalShellOption {
  aliases: string[];
}

export function getDefaultShell(): string {
  return getDefaultShellOption().shell;
}

export function listTerminalShellOptions(): TerminalShellOption[] {
  return getPlatformShellOptions().map(({ aliases: _aliases, ...option }) => option);
}

export function resolveRequestedShell(shell?: string | null): string {
  const input = shell?.trim();

  if (!input) {
    return getDefaultShell();
  }

  const matched = getPlatformShellOptions().find((option) =>
    option.aliases.some((alias) => areShellValuesEqual(alias, input))
  );

  if (!matched) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_SHELL",
      detail: "当前平台不支持指定 shell",
      field: "shell"
    });
  }

  if (!matched.available) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_SHELL",
      detail: matched.unavailableReason ?? "指定 shell 当前不可用",
      field: "shell"
    });
  }

  return matched.shell;
}

export function buildTemplateCommandLine(
  template: TerminalCommandTemplate,
  shell: string
): string {
  const shellType = detectShellType(shell);

  if (shellType === "cmd") {
    return buildCmdCommandLine(template);
  }

  if (shellType === "powershell") {
    return buildPowerShellCommandLine(template);
  }

  return buildPosixCommandLine(template);
}

export function getShellEnterSequence(shell: string): string {
  return detectShellType(shell) === "posix" ? "\n" : "\r";
}

type ShellType = "cmd" | "powershell" | "posix";

function getDefaultShellOption(): InternalTerminalShellOption {
  const options = getPlatformShellOptions();
  const preferred = options.find((option) => option.available);

  if (preferred) {
    return preferred;
  }

  return options[0];
}

function getPlatformShellOptions(): InternalTerminalShellOption[] {
  if (process.platform === "win32") {
    return buildWindowsShellOptions();
  }

  return buildPosixShellOptions();
}

function buildPosixShellOptions(): InternalTerminalShellOption[] {
  // macOS GUI 进程里的 SHELL 可能缺失、失真，甚至带上 `-l` 之类参数。
  // 终端层真正需要的是“可执行文件路径”，不是一段命令行。
  const envShellCandidates = splitPosixShellCandidates(process.env.SHELL);
  const fallbackCandidates =
    process.platform === "darwin" ? ["/bin/zsh", "/bin/bash", "/bin/sh"] : ["/bin/bash", "/bin/sh"];
  const shell =
    resolveFirstExecutablePosixShell([
      ...envShellCandidates,
      ...fallbackCandidates,
      "zsh",
      "bash",
      "sh"
    ]) ??
    fallbackCandidates[fallbackCandidates.length - 1];
  const available = canExecutePosixShell(shell);

  return [
    {
      id: "default",
      label: "默认 Shell",
      shell,
      available,
      unavailableReason: available ? null : "当前没有可执行的 POSIX shell",
      aliases: uniqNonEmptyStrings([...envShellCandidates, shell, path.basename(shell)])
    }
  ];
}

function buildWindowsShellOptions(): InternalTerminalShellOption[] {
  const systemRoot = process.env.SYSTEMROOT ?? "C:\\Windows";
  const cmdPath = process.env.COMSPEC ?? path.join(systemRoot, "System32", "cmd.exe");
  const windowsPowerShellPath = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const powerShell7Path = resolveExistingCandidate([
    path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    path.join(process.env["ProgramW6432"] ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "PowerShell",
      "7",
      "pwsh.exe"
    ),
    resolveExecutableOnPath("pwsh.exe")
  ]);
  const powerShellPath = powerShell7Path ?? windowsPowerShellPath;
  const gitBashPath =
    resolveExistingCandidate([
      path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
      path.join(process.env["ProgramW6432"] ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
      path.join(
        process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
        "Git",
        "bin",
        "bash.exe"
      ),
      path.join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "Git",
        "bin",
        "bash.exe"
      )
    ]) ?? path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe");

  return [
    createWindowsShellOption({
      id: "cmd",
      label: "命令提示符 (CMD)",
      shell: cmdPath,
      aliases: [cmdPath, "cmd", "cmd.exe"]
    }),
    createWindowsShellOption({
      id: "powershell",
      label: "PowerShell",
      shell: powerShellPath,
      aliases: [powerShellPath, windowsPowerShellPath, "powershell", "powershell.exe", "pwsh", "pwsh.exe"]
    }),
    createWindowsShellOption({
      id: "git-bash",
      label: "Git Bash",
      shell: gitBashPath,
      aliases: [gitBashPath, "git-bash", "git bash"]
    })
  ];
}

function createWindowsShellOption(input: {
  id: string;
  label: string;
  shell: string;
  aliases: string[];
}): InternalTerminalShellOption {
  const available = existsSync(input.shell) || canResolveExecutable(input.shell);

  return {
    id: input.id,
    label: input.label,
    shell: input.shell,
    available,
    unavailableReason: available ? null : `${input.label} 当前未安装或不可执行`,
    aliases: uniqNonEmptyStrings(input.aliases)
  };
}

function detectShellType(shell: string): ShellType {
  const shellName = path.basename(shell).toLowerCase();

  if (shellName === "cmd.exe" || shellName === "cmd") {
    return "cmd";
  }

  if (
    shellName === "powershell.exe" ||
    shellName === "powershell" ||
    shellName === "pwsh.exe" ||
    shellName === "pwsh"
  ) {
    return "powershell";
  }

  return "posix";
}

function splitPosixShellCandidates(shell: string | null | undefined): string[] {
  const value = shell?.trim();

  if (!value) {
    return [];
  }

  const directCandidate = stripWrappingQuotes(value);

  if (
    !/\s/.test(directCandidate) &&
    (canExecutePosixShell(directCandidate) || path.isAbsolute(directCandidate))
  ) {
    return [directCandidate];
  }

  const firstToken = stripWrappingQuotes(value.split(/\s+/, 1)[0] ?? "");

  if (!firstToken) {
    return [];
  }

  return uniqNonEmptyStrings([firstToken, directCandidate]);
}

function buildCmdCommandLine(template: TerminalCommandTemplate): string {
  const envPrefix = Object.entries(template.env)
    .map(([key, value]) => `set "${key}=${value.replaceAll('"', '""')}"`)
    .join(" && ");
  const commandLine = [template.command, ...template.args]
    .map((item) => `"${item.replaceAll('"', '""')}"`)
    .join(" ");

  return envPrefix ? `${envPrefix} && ${commandLine}` : commandLine;
}

function buildPowerShellCommandLine(template: TerminalCommandTemplate): string {
  const envPrefix = Object.entries(template.env)
    .map(([key, value]) => `$env:${key}='${value.replaceAll("'", "''")}'`)
    .join("; ");
  const commandLine = `& ${[template.command, ...template.args]
    .map((item) => `'${item.replaceAll("'", "''")}'`)
    .join(" ")}`;

  return envPrefix ? `${envPrefix}; ${commandLine}` : commandLine;
}

function buildPosixCommandLine(template: TerminalCommandTemplate): string {
  const envPrefix = Object.entries(template.env)
    .map(([key, value]) => `${key}='${value.replaceAll("'", `'\\''`)}'`)
    .join(" ");
  const commandLine = resolvePosixTemplateCommandLine(template);

  return envPrefix ? `${envPrefix} ${commandLine}` : commandLine;
}

function resolvePosixTemplateCommandLine(template: TerminalCommandTemplate): string {
  if (template.args.length > 0) {
    return quotePosixCommandParts([template.command, ...template.args]);
  }

  const parsedCommand = parseLoosePosixCommand(template.command);

  if (parsedCommand.mode === "raw") {
    return template.command;
  }

  if (parsedCommand.parts.length <= 1) {
    return quotePosixCommandParts(parsedCommand.parts);
  }

  // 兼容历史“快捷命令”数据：用户把整条命令塞进 command，但我们不能把它整体包成单引号。
  // 如果整串内容本身就是一个真实可执行路径（例如带空格的脚本路径），仍然按单个命令处理。
  if (canExecuteTemplateCommandAsWhole(template.command, template.cwd)) {
    return quotePosixCommandParts([template.command]);
  }

  if (startsWithPosixEnvAssignment(parsedCommand.parts)) {
    return template.command;
  }

  return quotePosixCommandParts(parsedCommand.parts);
}

function quotePosixCommandParts(parts: string[]): string {
  return parts.map((item) => `'${item.replaceAll("'", `'\\''`)}'`).join(" ");
}

function canExecuteTemplateCommandAsWhole(command: string, cwd: string): boolean {
  const candidate = command.trim();

  if (!candidate || !/\s/.test(candidate)) {
    return false;
  }

  const unwrappedCandidate = stripWrappingQuotes(candidate);

  if (path.isAbsolute(unwrappedCandidate)) {
    return canExecuteFile(unwrappedCandidate);
  }

  const resolvedFromCwd = path.resolve(cwd, unwrappedCandidate);

  return canExecuteFile(resolvedFromCwd);
}

function startsWithPosixEnvAssignment(parts: string[]): boolean {
  if (parts.length <= 1) {
    return false;
  }

  let sawAssignment = false;

  for (const part of parts) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(part)) {
      sawAssignment = true;
      continue;
    }

    return sawAssignment;
  }

  return false;
}

function parseLoosePosixCommand(
  command: string
): { mode: "raw" } | { mode: "parts"; parts: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let escaping = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";

    if (quote === "single") {
      if (char === "'") {
        quote = null;
        continue;
      }

      current += char;
      continue;
    }

    if (quote === "double") {
      if (char === '"') {
        quote = null;
        continue;
      }

      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }

      if (char === "\\") {
        const nextChar = command[index + 1] ?? "";

        if (nextChar === '"' || nextChar === "$" || nextChar === "`" || nextChar === "\\") {
          escaping = true;
          continue;
        }

        current += char;
        continue;
      }

      if (char === "$" || char === "`") {
        return { mode: "raw" };
      }

      current += char;
      continue;
    }

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === "'") {
      quote = "single";
      continue;
    }

    if (char === '"') {
      quote = "double";
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    if (isPosixShellOperator(char) || needsRawPosixExpansion(char, current)) {
      return { mode: "raw" };
    }

    current += char;
  }

  if (escaping || quote !== null) {
    return { mode: "raw" };
  }

  if (current) {
    parts.push(current);
  }

  return {
    mode: "parts",
    parts: parts.length > 0 ? parts : [command]
  };
}

function isPosixShellOperator(char: string): boolean {
  return char === "|" || char === "&" || char === ";" || char === "<" || char === ">" || char === "(" || char === ")";
}

function needsRawPosixExpansion(char: string, currentToken: string): boolean {
  if (char === "$" || char === "`" || char === "*" || char === "?" || char === "[" || char === "{") {
    return true;
  }

  return char === "~" && currentToken.length === 0;
}

function resolveExistingCandidate(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveFirstExecutablePosixShell(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalizedCandidate = candidate?.trim();

    if (!normalizedCandidate) {
      continue;
    }

    const executablePath = resolveExecutablePosix(normalizedCandidate);

    if (executablePath) {
      return executablePath;
    }
  }

  return null;
}

function resolveExecutablePosix(shell: string): string | null {
  if (canExecuteFile(shell)) {
    return shell;
  }

  return canResolveExecutable(shell) ? resolveExecutableOnPath(shell) : null;
}

function canExecutePosixShell(shell: string): boolean {
  return resolveExecutablePosix(shell) !== null;
}

function canExecuteFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value.trim();
}

function canResolveExecutable(shell: string): boolean {
  if (existsSync(shell)) {
    return true;
  }

  return resolveExecutableOnPath(shell) !== null;
}

function resolveExecutableOnPath(executableName: string): string | null {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const pathextEntries = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const baseName = path.extname(executableName) ? executableName : executableName.toLowerCase();
  const namesToCheck = path.extname(executableName)
    ? [executableName]
    : pathextEntries.map((extension) => `${executableName}${extension.toLowerCase()}`);

  for (const entry of pathEntries) {
    const directPath = path.join(entry, executableName);

    if (existsSync(directPath)) {
      return directPath;
    }

    if (path.extname(baseName)) {
      continue;
    }

    for (const candidateName of namesToCheck) {
      const candidatePath = path.join(entry, candidateName);

      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function areShellValuesEqual(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  return left.trim() === right.trim();
}

function uniqNonEmptyStrings(values: string[]): string[] {
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized) {
      continue;
    }

    if (result.some((item) => areShellValuesEqual(item, normalized))) {
      continue;
    }

    result.push(normalized);
  }

  return result;
}
