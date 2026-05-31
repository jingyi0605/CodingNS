import type { LogLevel } from "../../../contracts/src/index.js";

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface LoggerContext {
  component?: string;
  command?: string;
  data?: Record<string, unknown>;
}

/**
 * 极简结构化日志。
 * 只做一件事：把 stderr 日志收敛成稳定 JSON，方便 CLI、脚本和后续 MCP 复用。
 */
export class StructuredLogger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_WEIGHT[level] <= LOG_LEVEL_WEIGHT[this.minLevel] && this.minLevel !== "silent";
  }

  private emit(level: LogLevel, message: string, context: LoggerContext = {}): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(context.component ? { component: context.component } : {}),
      ...(context.command ? { command: context.command } : {}),
      ...(context.data ? { data: context.data } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  error(message: string, context: LoggerContext = {}): void {
    this.emit("error", message, context);
  }

  warn(message: string, context: LoggerContext = {}): void {
    this.emit("warn", message, context);
  }

  info(message: string, context: LoggerContext = {}): void {
    this.emit("info", message, context);
  }

  debug(message: string, context: LoggerContext = {}): void {
    this.emit("debug", message, context);
  }
}
