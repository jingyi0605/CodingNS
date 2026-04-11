import crypto from "node:crypto";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileAccessGuard } from "./file-access-guard.js";

const FILE_PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
const HTML_FILE_EXTENSIONS = new Set([".html", ".htm"]);
const PREVIEW_CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".cjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".bmp", "image/bmp"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".eot", "application/vnd.ms-fontobject"]
]);

interface FilePreviewTokenPayload {
  workspaceId: string;
  expiresAt: number;
}

export interface FilePreviewLinkResult {
  previewPath: string;
  previewUrl: string;
  expiresAt: string;
}

export interface PublicFilePreviewResult {
  absolutePath: string;
  relativePath: string;
  contentType: string;
}

export class FilePreviewLinkService {
  constructor(
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly signingSecret: string
  ) {}

  createLink(workspaceId: string, requestedPath: string, _userId: string): FilePreviewLinkResult {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });

    if (!isHtmlFile(resolved.relativePath)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_PREVIEW_NOT_SUPPORTED",
        detail: "当前只支持为 HTML 文件生成页面预览",
        field: "path"
      });
    }

    const expiresAt = Date.now() + FILE_PREVIEW_TOKEN_TTL_MS;
    const token = this.createToken({
      workspaceId,
      expiresAt
    });

    return {
      previewPath: buildPublicPreviewPath(token, resolved.relativePath),
      previewUrl: "",
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  resolvePublicFile(token: string, requestedPath: string): PublicFilePreviewResult {
    const payload = this.verifyToken(token);
    const resolved = this.fileAccessGuard.resolvePath(payload.workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const contentType = resolvePreviewContentType(resolved.relativePath);

    if (!contentType) {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_PREVIEW_ASSET_NOT_SUPPORTED",
        detail: "当前预览链接不支持加载这种文件类型",
        field: "path"
      });
    }

    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      contentType
    };
  }

  private createToken(payload: FilePreviewTokenPayload): string {
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): FilePreviewTokenPayload {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
      throw buildInvalidPreviewTokenError();
    }

    const expectedSignature = this.sign(encodedPayload);

    if (!safeCompare(signature, expectedSignature)) {
      throw buildInvalidPreviewTokenError();
    }

    let payload: FilePreviewTokenPayload;

    try {
      payload = JSON.parse(decodeBase64Url(encodedPayload)) as FilePreviewTokenPayload;
    } catch {
      throw buildInvalidPreviewTokenError();
    }

    if (!payload.workspaceId || typeof payload.expiresAt !== "number") {
      throw buildInvalidPreviewTokenError();
    }

    if (payload.expiresAt <= Date.now()) {
      throw new AppError({
        statusCode: 401,
        errorCode: "FILE_PREVIEW_TOKEN_EXPIRED",
        detail: "预览链接已经过期，请重新打开 HTML 预览"
      });
    }

    return payload;
  }

  private sign(encodedPayload: string): string {
    return crypto
      .createHmac("sha256", this.signingSecret)
      .update(encodedPayload)
      .digest("base64url");
  }
}

export function buildPublicPreviewPath(token: string, relativePath: string): string {
  return `/preview/files/${encodeURIComponent(token)}/${encodeRelativePath(relativePath)}`;
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isHtmlFile(filePath: string): boolean {
  return HTML_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolvePreviewContentType(filePath: string): string | null {
  return PREVIEW_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? null;
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildInvalidPreviewTokenError(): AppError {
  return new AppError({
    statusCode: 401,
    errorCode: "FILE_PREVIEW_TOKEN_INVALID",
    detail: "预览链接无效，请重新打开 HTML 预览"
  });
}
