import { createId } from "../../../shared/utils/id.js";
import { logTerminalDebug, terminalDebugNowMs } from "../../../shared/utils/terminal-debug-log.js";
import { nowIso } from "../../../shared/utils/time.js";
import type { TerminalOutputChunk } from "../../../types/domain.js";
import type { TerminalLogFileRepository } from "../../../storage/repositories/terminal-log-file-repository.js";
import type { TerminalLogSegmentRepository } from "../../../storage/repositories/terminal-log-segment-repository.js";
import { TerminalLogFileStore } from "./terminal-log-file-store.js";
import { TerminalLogWriterClient } from "./terminal-log-writer-client.js";

interface TerminalLogSpoolerOptions {
  databasePath?: string;
  logRootDir: string;
  fileRepository: TerminalLogFileRepository;
  segmentRepository: TerminalLogSegmentRepository;
  flushIntervalMs?: number;
  maxBatchBytes?: number;
}

interface PendingTerminalLogBatch {
  chunks: TerminalOutputChunk[];
  totalBytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  flushPromise: Promise<void> | null;
}

const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_BATCH_BYTES = 256 * 1024;
const CLOSED_WRITER_ERROR_MARKERS = [
  "terminal log writer 已关闭",
  "terminal log writer 已退出"
] as const;

export class TerminalLogSpooler {
  private readonly fileStore: TerminalLogFileStore;
  private readonly pendingByTerminalId = new Map<string, PendingTerminalLogBatch>();
  private readonly flushIntervalMs: number;
  private readonly maxBatchBytes: number;
  private readonly writerClient: TerminalLogWriterClient | null;
  private disposed = false;
  private writerUnavailable = false;

  constructor(private readonly options: TerminalLogSpoolerOptions) {
    this.fileStore = new TerminalLogFileStore(options.logRootDir);
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    this.writerClient =
      options.databasePath && options.databasePath !== ":memory:"
        ? new TerminalLogWriterClient(options.databasePath, options.logRootDir)
        : null;
  }

  appendChunks(terminalId: string, chunks: TerminalOutputChunk[]): void {
    if (this.disposed || this.writerUnavailable || chunks.length === 0) {
      return;
    }

    const batch = this.getOrCreateBatch(terminalId);

    for (const chunk of chunks) {
      batch.chunks.push(chunk);
      batch.totalBytes += Buffer.byteLength(chunk.content, "utf8");
    }

    if (batch.flushing) {
      return;
    }

    this.scheduleFlush(terminalId, batch.totalBytes >= this.maxBatchBytes ? 0 : this.flushIntervalMs);
  }

  async flushTerminal(terminalId: string): Promise<void> {
    if (this.disposed) {
      this.clearTerminal(terminalId);
      return;
    }

    const batch = this.pendingByTerminalId.get(terminalId);

    if (!batch) {
      return;
    }

    if (batch.flushing) {
      await batch.flushPromise;

      if (batch.chunks.length > 0) {
        await this.flushTerminal(terminalId);
      }

      return;
    }

    if (batch.chunks.length === 0) {
      return;
    }

    this.clearBatchTimer(batch);
    batch.flushing = true;

    const flushingChunks = batch.chunks;
    const flushingBytes = batch.totalBytes;
    batch.chunks = [];
    batch.totalBytes = 0;
    const flushStartedAtMs = terminalDebugNowMs();

    logTerminalDebug("terminal.log_flush.started", {
      terminalId,
      chunkCount: flushingChunks.length,
      totalBytes: flushingBytes,
      mode: this.writerClient ? "worker" : "inline"
    });

    const flushPromise = this.persistChunks(terminalId, flushingChunks)
      .then(() => {
        logTerminalDebug("terminal.log_flush.completed", {
          terminalId,
          chunkCount: flushingChunks.length,
          totalBytes: flushingBytes,
          durationMs: terminalDebugNowMs() - flushStartedAtMs,
          mode: this.writerClient ? "worker" : "inline"
        });
      })
      .catch((error) => {
        console.warn("[terminal-log-flush-failed]", {
          terminalId,
          error: error instanceof Error ? error.message : String(error)
        });
        logTerminalDebug("terminal.log_flush.failed", {
          terminalId,
          chunkCount: flushingChunks.length,
          totalBytes: flushingBytes,
          durationMs: terminalDebugNowMs() - flushStartedAtMs,
          error: error instanceof Error ? error.message : String(error),
          mode: this.writerClient ? "worker" : "inline"
        });

        if (this.isWriterClosedError(error)) {
          this.writerUnavailable = true;
          this.clearAllBatchTimers();
          this.pendingByTerminalId.clear();
          return;
        }

        batch.chunks = [...flushingChunks, ...batch.chunks];
        batch.totalBytes += flushingBytes;
        this.scheduleFlush(terminalId, this.flushIntervalMs);
      })
      .finally(() => {
        batch.flushing = false;
        batch.flushPromise = null;

        if (!this.disposed && !this.writerUnavailable && batch.chunks.length > 0) {
          this.scheduleFlush(
            terminalId,
            batch.totalBytes >= this.maxBatchBytes ? 0 : this.flushIntervalMs
          );
        } else if (!batch.timer) {
          this.pendingByTerminalId.delete(terminalId);
        }
      });

    batch.flushPromise = flushPromise;
    await flushPromise;
  }

  async flushAll(): Promise<void> {
    for (const terminalId of [...this.pendingByTerminalId.keys()]) {
      try {
        await this.flushTerminal(terminalId);
      } catch {
        // flush 失败时保留已有警告，这里继续尝试刷其他终端。
      }
    }
  }

  clearTerminal(terminalId: string): void {
    const batch = this.pendingByTerminalId.get(terminalId);

    if (!batch) {
      return;
    }

    this.clearBatchTimer(batch);
    this.pendingByTerminalId.delete(terminalId);
  }

  async deleteTerminalLogs(terminalId: string): Promise<void> {
    const batch = this.pendingByTerminalId.get(terminalId);
    const flushPromise = batch?.flushPromise ?? null;

    this.clearTerminal(terminalId);

    if (flushPromise) {
      try {
        await flushPromise;
      } catch {
        // flush 失败时继续删除，避免残留损坏的日志索引。
      }
    }

    if (this.writerClient && !this.writerUnavailable) {
      try {
        await this.writerClient.deleteTerminalLogs(terminalId);
        return;
      } catch (error) {
        if (!this.isWriterClosedError(error)) {
          throw error;
        }

        this.writerUnavailable = true;
      }
    }

    this.deleteTerminalLogsInline(terminalId);
  }

  private deleteTerminalLogsInline(terminalId: string): void {
    this.options.segmentRepository.deleteByTerminalId(terminalId);
    this.options.fileRepository.deleteByTerminalId(terminalId);
    this.fileStore.deleteTerminalLogs(terminalId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.flushAll();
    this.disposed = true;
    this.clearAllBatchTimers();
    await this.writerClient?.close();
  }

  private async persistChunks(terminalId: string, chunks: TerminalOutputChunk[]): Promise<void> {
    const startSeq = parseCursor(chunks[0]?.cursor);
    const endSeq = parseCursor(chunks.at(-1)?.cursor);

    if (startSeq === null || endSeq === null) {
      throw new Error("终端日志分段缺少有效 cursor");
    }

    const content = chunks.map((chunk) => chunk.content).join("");

    if (this.writerClient) {
      await this.writerClient.persistChunkBatch({
        terminalId,
        startSeq,
        endSeq,
        content
      });
      return;
    }

    this.persistChunksInline(terminalId, startSeq, endSeq, content);
  }

  private persistChunksInline(
    terminalId: string,
    startSeq: number,
    endSeq: number,
    content: string
  ): void {
    const timestamp = nowIso();
    let activeFile = this.options.fileRepository.findActiveByTerminalId(terminalId);

    if (!activeFile) {
      activeFile = this.options.fileRepository.create({
        id: createId(),
        terminalId,
        relativePath: this.fileStore.buildActiveRelativePath(terminalId),
        status: "active",
        startSeq,
        endSeq: null,
        sizeBytes: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const appendResult = this.fileStore.append(
      activeFile.relativePath,
      content,
      activeFile.sizeBytes
    );

    this.options.segmentRepository.create({
      id: createId(),
      terminalId,
      fileId: activeFile.id,
      startSeq,
      endSeq,
      startOffset: appendResult.startOffset,
      endOffset: appendResult.endOffset,
      byteLength: appendResult.byteLength,
      createdAt: timestamp
    });

    this.options.fileRepository.updateLifecycle({
      id: activeFile.id,
      status: activeFile.status,
      endSeq,
      sizeBytes: appendResult.endOffset,
      updatedAt: timestamp
    });
  }

  private getOrCreateBatch(terminalId: string): PendingTerminalLogBatch {
    let batch = this.pendingByTerminalId.get(terminalId);

    if (!batch) {
      batch = {
        chunks: [],
        totalBytes: 0,
        timer: null,
        flushing: false,
        flushPromise: null
      };
      this.pendingByTerminalId.set(terminalId, batch);
    }

    return batch;
  }

  private scheduleFlush(terminalId: string, delayMs: number): void {
    if (this.disposed) {
      return;
    }

    const batch = this.pendingByTerminalId.get(terminalId);

    if (!batch) {
      return;
    }

    this.clearBatchTimer(batch);
    batch.timer = setTimeout(() => {
      batch.timer = null;
      void this.flushTerminal(terminalId);
    }, Math.max(0, delayMs));
    batch.timer.unref?.();
  }

  private clearBatchTimer(batch: PendingTerminalLogBatch): void {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
  }

  private clearAllBatchTimers(): void {
    for (const batch of this.pendingByTerminalId.values()) {
      this.clearBatchTimer(batch);
    }
  }

  private isWriterClosedError(error: unknown): boolean {
    if (!this.writerClient) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return CLOSED_WRITER_ERROR_MARKERS.some((marker) => message.includes(marker));
  }
}

function parseCursor(cursor: string | undefined): number | null {
  const value = Number(cursor);

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}
