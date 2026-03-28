import { appendFileSync, closeSync, mkdirSync, openSync, readSync, rmSync } from "node:fs";
import path from "node:path";

export interface TerminalLogAppendResult {
  startOffset: number;
  endOffset: number;
  byteLength: number;
}

export class TerminalLogFileStore {
  constructor(private readonly rootDir: string) {}

  append(relativePath: string, content: string, currentSizeBytes: number): TerminalLogAppendResult {
    const filePath = this.resolvePath(relativePath);

    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, content, "utf8");

    const byteLength = Buffer.byteLength(content, "utf8");

    return {
      startOffset: currentSizeBytes,
      endOffset: currentSizeBytes + byteLength,
      byteLength
    };
  }

  deleteTerminalLogs(terminalId: string): void {
    const terminalDir = this.resolvePath(terminalId);
    rmSync(terminalDir, { recursive: true, force: true });
  }

  read(relativePath: string, startOffset: number, byteLength: number): string {
    const filePath = this.resolvePath(relativePath);
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(byteLength);

    try {
      readSync(fd, buffer, 0, byteLength, startOffset);
    } finally {
      closeSync(fd);
    }

    return buffer.toString("utf8");
  }

  buildActiveRelativePath(terminalId: string): string {
    return path.join(terminalId, "active.log");
  }

  private resolvePath(relativePath: string): string {
    const resolvedRoot = path.resolve(this.rootDir);
    const resolvedPath = path.resolve(resolvedRoot, relativePath);

    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Invalid terminal log path: ${relativePath}`);
    }

    return resolvedPath;
  }
}
