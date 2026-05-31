import fs from "node:fs";
import path from "node:path";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function iterateNdjsonFileSync<T>(
  filePath: string,
  onRecord: (value: T) => void
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fd = fs.openSync(filePath, "r");
  const chunkSize = 64 * 1024;
  const buffer = Buffer.allocUnsafe(chunkSize);
  let remainder = "";

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead <= 0) {
        break;
      }

      const content = remainder + buffer.toString("utf-8", 0, bytesRead);
      const lines = content.split("\n");
      remainder = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        onRecord(JSON.parse(trimmed) as T);
      }
    }

    const tail = remainder.trim();
    if (tail) {
      onRecord(JSON.parse(tail) as T);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export interface JsonArrayFileWriter {
  append(value: unknown): void;
  close(): void;
}

export function createJsonArrayFileWriter(
  filePath: string,
  options: {
    prefix: string;
    suffix: string;
  }
): JsonArrayFileWriter {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, options.prefix, "utf-8");
  let isFirst = true;
  let closed = false;

  return {
    append(value: unknown): void {
      if (closed) {
        throw new Error(`JSON 数组写入器已关闭：${filePath}`);
      }

      const chunk = `${isFirst ? "" : ","}\n${JSON.stringify(value, null, 2)}`;
      fs.appendFileSync(filePath, chunk, "utf-8");
      isFirst = false;
    },
    close(): void {
      if (closed) {
        return;
      }

      const trailer = `${isFirst ? "" : "\n"}${options.suffix}`;
      fs.appendFileSync(filePath, trailer, "utf-8");
      closed = true;
    }
  };
}
