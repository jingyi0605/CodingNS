import { inflateRawSync } from "node:zlib";
import { AppError, APP_ERROR_CODES } from "../../../contracts/src/index.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;

interface ZipEntryRecord {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function shortSummary(text: string, limit = 180): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractXmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  for (const match of raw.matchAll(pattern)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

function findEndOfCentralDirectory(buffer: Buffer, formatLabel: string): number {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new AppError(
    `${formatLabel} 文件不是合法的 ZIP 容器`,
    APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
  );
}

function readZipRecords(buffer: Buffer, formatLabel: string): ZipEntryRecord[] {
  const eocdOffset = findEndOfCentralDirectory(buffer, formatLabel);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const records: ZipEntryRecord[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new AppError(
        `${formatLabel} ZIP 中央目录损坏`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryPath = buffer.subarray(fileNameStart, fileNameEnd).toString("utf-8");

    records.push({
      path: entryPath,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    cursor = fileNameEnd + extraFieldLength + commentLength;
  }

  return records;
}

function extractZipEntry(buffer: Buffer, record: ZipEntryRecord, formatLabel: string): Buffer {
  const offset = record.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new AppError(
      `${formatLabel} ZIP 本地头损坏：${record.path}`,
      APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
    );
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraFieldLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + record.compressedSize;
  if (dataEnd > buffer.length) {
    throw new AppError(
      `${formatLabel} ZIP 条目越界：${record.path}`,
      APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
    );
  }

  const compressed = buffer.subarray(dataStart, dataEnd);
  if (record.compressionMethod === ZIP_METHOD_STORED) {
    return Buffer.from(compressed);
  }
  if (record.compressionMethod === ZIP_METHOD_DEFLATE) {
    return inflateRawSync(compressed);
  }

  throw new AppError(
    `${formatLabel} 使用了当前未支持的 ZIP 压缩方法：${record.compressionMethod}`,
    APP_ERROR_CODES.PARSER_COMPLEX_FORMAT_UNSUPPORTED,
  );
}

export function readZipEntries(buffer: Buffer, formatLabel: string): Map<string, Buffer> {
  const records = readZipRecords(buffer, formatLabel);
  const entries = new Map<string, Buffer>();
  for (const record of records) {
    entries.set(record.path, extractZipEntry(buffer, record, formatLabel));
  }
  return entries;
}

export function readZipText(entries: Map<string, Buffer>, entryPath: string, formatLabel: string): string;
export function readZipText(
  entries: Map<string, Buffer>,
  entryPath: string,
  formatLabel: string,
  required: true,
): string;
export function readZipText(
  entries: Map<string, Buffer>,
  entryPath: string,
  formatLabel: string,
  required: false,
): string | null;
export function readZipText(
  entries: Map<string, Buffer>,
  entryPath: string,
  formatLabel: string,
  required = true,
): string | null {
  const content = entries.get(entryPath);
  if (!content) {
    if (!required) {
      return null;
    }
    throw new AppError(
      `${formatLabel} 缺少必需条目：${entryPath}`,
      APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
    );
  }
  return content.toString("utf-8");
}
