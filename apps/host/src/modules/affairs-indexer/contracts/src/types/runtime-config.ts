export type ExportMode = "legacy" | "v2" | "dual";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface RuntimeConfig {
  rootDir: string;
  indexDir: string;
  dbPath: string;
  exportDir: string;
  exportV2Dir: string;
  configFilePath: string | null;
  exportMode: ExportMode;
  watchDebounceMs: number;
  parserTimeoutMs: number;
  disabledParserExtensions: string[];
  allowedExtensions: string[];
  tagRulesPath: string;
  writeBatchSize: number;
  logLevel: LogLevel;
}
