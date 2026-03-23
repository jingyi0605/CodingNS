import { AppError } from "../../../shared/errors/app-error.js";
import { nowIso } from "../../../shared/utils/time.js";
import type { TerminalOutputChunk } from "../../../types/domain.js";

interface TerminalBufferState {
  chunks: TerminalOutputChunk[];
  nextCursor: number;
  totalBytes: number;
}

export interface TerminalBackfillResult {
  chunks: TerminalOutputChunk[];
  truncated: boolean;
  latestCursor: string | null;
}

export class TerminalOutputBuffer {
  private readonly buffers = new Map<string, TerminalBufferState>();

  constructor(
    private readonly maxChunks = 400,
    private readonly maxBytes = 256 * 1024,
    private readonly maxChunkSize = 8 * 1024
  ) {}

  append(terminalId: string, content: string): TerminalOutputChunk[] {
    if (!content) {
      return [];
    }

    const buffer = this.getOrCreateBuffer(terminalId);
    const chunks: TerminalOutputChunk[] = [];

    for (let index = 0; index < content.length; index += this.maxChunkSize) {
      const chunk: TerminalOutputChunk = {
        terminalId,
        cursor: String(buffer.nextCursor),
        stream: "stdout",
        content: content.slice(index, index + this.maxChunkSize),
        timestamp: nowIso()
      };

      buffer.nextCursor += 1;
      buffer.chunks.push(chunk);
      buffer.totalBytes += Buffer.byteLength(chunk.content, "utf8");
      chunks.push(chunk);
    }

    while (buffer.chunks.length > this.maxChunks || buffer.totalBytes > this.maxBytes) {
      const removed = buffer.chunks.shift();

      if (!removed) {
        break;
      }

      buffer.totalBytes -= Buffer.byteLength(removed.content, "utf8");
    }

    return chunks;
  }

  readSince(terminalId: string, cursor: string | null): TerminalBackfillResult {
    const buffer = this.buffers.get(terminalId);

    if (!buffer || buffer.chunks.length === 0) {
      return {
        chunks: [],
        truncated: false,
        latestCursor: null
      };
    }

    if (cursor === null) {
      return {
        chunks: [...buffer.chunks],
        truncated: false,
        latestCursor: buffer.chunks.at(-1)?.cursor ?? null
      };
    }

    const parsedCursor = Number(cursor);

    if (!Number.isInteger(parsedCursor) || parsedCursor < 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "RECONNECT_CURSOR_INVALID",
        detail: "重连游标无效",
        field: "lastCursor"
      });
    }

    const earliestCursor = Number(buffer.chunks[0]?.cursor ?? "0");
    const latestCursor = Number(buffer.chunks.at(-1)?.cursor ?? "0");

    if (parsedCursor > latestCursor) {
      throw new AppError({
        statusCode: 400,
        errorCode: "RECONNECT_CURSOR_INVALID",
        detail: "重连游标超出当前输出范围",
        field: "lastCursor"
      });
    }

    if (parsedCursor < earliestCursor - 1) {
      return {
        chunks: [...buffer.chunks],
        truncated: true,
        latestCursor: String(latestCursor)
      };
    }

    return {
      chunks: buffer.chunks.filter((chunk) => Number(chunk.cursor) > parsedCursor),
      truncated: false,
      latestCursor: String(latestCursor)
    };
  }

  private getOrCreateBuffer(terminalId: string): TerminalBufferState {
    let buffer = this.buffers.get(terminalId);

    if (!buffer) {
      buffer = {
        chunks: [],
        nextCursor: 1,
        totalBytes: 0
      };
      this.buffers.set(terminalId, buffer);
    }

    return buffer;
  }
}
