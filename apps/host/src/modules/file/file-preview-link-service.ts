import crypto from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileAccessGuard } from "./file-access-guard.js";
import { detectPreviewKind, resolvePreviewContentType } from "./file-preview-types.js";

const FILE_PREVIEW_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

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
  workspaceId: string;
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

    const previewKind = detectPreviewKind(resolved.relativePath);

    if (previewKind !== "html" && previewKind !== "image" && previewKind !== "pdf") {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_PREVIEW_NOT_SUPPORTED",
        detail: "当前只支持为 HTML、图片和 PDF 生成受控预览链接",
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

  createOnlyOfficeLink(workspaceId: string, requestedPath: string, _userId: string): FilePreviewLinkResult {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const previewKind = detectPreviewKind(resolved.relativePath);

    if (previewKind !== "office") {
      throw new AppError({
        statusCode: 400,
        errorCode: "FILE_PREVIEW_NOT_SUPPORTED",
        detail: "当前只支持为 Office 文件生成 ONLYOFFICE 受控链接",
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

  resolveWorkspaceId(token: string): string {
    return this.verifyToken(token).workspaceId;
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
      workspaceId: payload.workspaceId,
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
        detail: "预览链接已经过期，请重新打开文件预览"
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
    detail: "预览链接无效，请重新打开文件预览"
  });
}
