import { createId } from "../../../shared/utils/id.js";
import { nowIso } from "../../../shared/utils/time.js";
import type { TerminalOutputChunk } from "../../../types/domain.js";
import type { TerminalLogFileRepository } from "../../../storage/repositories/terminal-log-file-repository.js";
import type { TerminalLogSegmentRepository } from "../../../storage/repositories/terminal-log-segment-repository.js";
import { TerminalLogFileStore } from "./terminal-log-file-store.js";

interface TerminalLogSpoolerOptions {
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
}

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_BYTES = 32 * 1024;

export class TerminalLogSpooler {
  private readonly fileStore: TerminalLogFileStore;
  private readonly pendingByTerminalId = new Map<string, PendingTerminalLogBatch>();
  private readonly flushIntervalMs: number;
  private readonly maxBatchBytes: number;

  constructor(private readonly options: TerminalLogSpoolerOptions) {
    this.fileStore = new TerminalLogFileStore(options.logRootDir);
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
  }

  appendChunks(terminalId: string, chunks: TerminalOutputChunk[]): void {
    if (chunks.length === 0) {
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

  flushTerminal(terminalId: string): void {
    const batch = this.pendingByTerminalId.get(terminalId);

    if (!batch || batch.flushing || batch.chunks.length === 0) {
      return;
    }

    this.clearBatchTimer(batch);
    batch.flushing = true;

    const flushingChunks = batch.chunks;
    const flushingBytes = batch.totalBytes;
    batch.chunks = [];
    batch.totalBytes = 0;

    try {
      this.persistChunks(terminalId, flushingChunks);
    } catch (error) {
      batch.chunks = [...flushingChunks, ...batch.chunks];
      batch.totalBytes += flushingBytes;
      console.warn("[terminal-log-flush-failed]", {
        terminalId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.scheduleFlush(terminalId, this.flushIntervalMs);
    } finally {
      batch.flushing = false;

      if (batch.chunks.length > 0) {
        this.scheduleFlush(
          terminalId,
          batch.totalBytes >= this.maxBatchBytes ? 0 : this.flushIntervalMs
        );
      } else if (!batch.timer) {
        this.pendingByTerminalId.delete(terminalId);
      }
    }
  }

  flushAll(): void {
    for (const terminalId of [...this.pendingByTerminalId.keys()]) {
      this.flushTerminal(terminalId);
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

  deleteTerminalLogs(terminalId: string): void {
    this.clearTerminal(terminalId);
    this.fileStore.deleteTerminalLogs(terminalId);
  }

  private persistChunks(terminalId: string, chunks: TerminalOutputChunk[]): void {
    const startSeq = parseCursor(chunks[0]?.cursor);
    const endSeq = parseCursor(chunks.at(-1)?.cursor);

    if (startSeq === null || endSeq === null) {
      throw new Error("终端日志分段缺少有效 cursor");
    }

    const content = chunks.map((chunk) => chunk.content).join("");
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
        flushing: false
      };
      this.pendingByTerminalId.set(terminalId, batch);
    }

    return batch;
  }

  private scheduleFlush(terminalId: string, delayMs: number): void {
    const batch = this.pendingByTerminalId.get(terminalId);

    if (!batch) {
      return;
    }

    this.clearBatchTimer(batch);
    batch.timer = setTimeout(() => {
      batch.timer = null;
      this.flushTerminal(terminalId);
    }, Math.max(0, delayMs));
  }

  private clearBatchTimer(batch: PendingTerminalLogBatch): void {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
  }
}

function parseCursor(cursor: string | undefined): number | null {
  const value = Number(cursor);

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}
