import type fs from "node:fs";

import { AppError } from "../../shared/errors/app-error.js";
import { hashContent } from "../../shared/utils/hash.js";

export interface FileVersionInfo {
  version: string;
  updatedAt: string;
  size: number;
}

export class FileVersionChecker {
  create(buffer: Buffer, stats: Pick<fs.Stats, "mtime">): FileVersionInfo {
    return {
      version: hashContent(buffer),
      updatedAt: stats.mtime.toISOString(),
      size: buffer.byteLength
    };
  }

  ensure(expectedVersion: string | undefined, currentVersion: string): void {
    if (!expectedVersion?.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_CONTENT",
        detail: "保存文件必须提供 expectedVersion",
        field: "expectedVersion"
      });
    }

    if (expectedVersion !== currentVersion) {
      throw new AppError({
        statusCode: 409,
        errorCode: "FILE_VERSION_CONFLICT",
        detail: "文件已被其他修改覆盖，请先刷新再保存",
        field: "expectedVersion"
      });
    }
  }
}
