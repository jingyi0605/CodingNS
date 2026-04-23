import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

const DEBOUNCE_MS = 800;

/**
 * 只监听 Codex 归档目录的增删变化。
 *
 * 这里故意不监听整个 `.codex`，避免会话消息持续落盘时把 Host 刷新链路打爆。
 * 归档 / 取消归档的事实最终都会体现为 `archived_sessions` 里的文件增删，
 * 所以盯住这里就够了。
 */
export class CodexArchiveWatcher {
  private readonly watcher: FSWatcher;
  private debounceTimer: NodeJS.Timeout | null = null;
  private onChange: (() => void) | null = null;

  constructor(codexHomeDir: string) {
    const archiveDir = path.join(codexHomeDir, "archived_sessions");

    this.watcher = chokidar.watch(archiveDir, {
      depth: 1,
      ignoreInitial: true,
      ignorePermissionErrors: true,
      persistent: true
    });

    this.watcher.on("add", () => {
      this.scheduleRefresh();
    });
    this.watcher.on("unlink", () => {
      this.scheduleRefresh();
    });
  }

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    void this.watcher.close();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChange?.();
    }, DEBOUNCE_MS);
  }
}
