export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface RuntimeConfig {
  rootDir: string;
  indexDir: string;
  dbPath: string;
  exportDir: string;
  configFilePath: string | null;
  watchDebounceMs: number;
  parserTimeoutMs: number;
  disabledParserExtensions: string[];
  allowedExtensions: string[];
  tagRulesPath: string;
  writeBatchSize: number;
  logLevel: LogLevel;
}
