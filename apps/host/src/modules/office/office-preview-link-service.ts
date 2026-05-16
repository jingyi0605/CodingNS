import crypto from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import type { OfficeService } from "./office-service.js";

const OFFICE_PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

interface OfficePreviewTokenPayload {
  userId: string;
  artifactId?: string;
  taskId?: string;
  fileName?: string;
  expiresAt: number;
}

export interface OfficePreviewLinkResult {
  previewPath: string;
  previewUrl: string;
  expiresAt: string;
}

export class OfficePreviewLinkService {
  constructor(
    private readonly officeService: Pick<OfficeService, "getArtifact" | "getArtifactFile">,
    private readonly signingSecret: string
  ) {}

  createArtifactLink(artifactId: string, userId: string): OfficePreviewLinkResult {
    const artifact = this.officeService.getArtifact(artifactId, userId);
    const expiresAt = Date.now() + OFFICE_PREVIEW_TOKEN_TTL_MS;
    const token = this.createToken({
      userId,
      artifactId: artifact.id,
      expiresAt
    });

    return {
      previewPath: buildOfficeArtifactPreviewPath(token, artifact.id),
      previewUrl: "",
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  createTaskFileLink(taskId: string, fileName: string, userId: string): OfficePreviewLinkResult {
    const artifactFile = this.officeService.getArtifactFile(taskId, fileName, userId);
    const expiresAt = Date.now() + OFFICE_PREVIEW_TOKEN_TTL_MS;
    const token = this.createToken({
      userId,
      taskId: taskId.trim(),
      fileName: artifactFile.fileName,
      expiresAt
    });

    return {
      previewPath: buildOfficeTaskFilePreviewPath(token, taskId.trim(), artifactFile.fileName),
      previewUrl: "",
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  resolveArtifact(token: string, artifactId: string): {
    storagePath: string;
    fileName: string;
    contentType: string | null;
  } {
    const payload = this.verifyToken(token);

    if (payload.artifactId !== artifactId.trim()) {
      throw buildInvalidOfficePreviewTokenError();
    }

    const artifact = this.officeService.getArtifact(artifactId, payload.userId);

    if (!artifact.storagePath) {
      throw new AppError({
        statusCode: 404,
        errorCode: "OFFICE_ARTIFACT_NOT_FOUND",
        detail: "未找到对应办公产物"
      });
    }

    return {
      storagePath: artifact.storagePath,
      fileName: artifact.name,
      contentType: artifact.contentType
    };
  }

  resolveTaskFile(token: string, taskId: string, fileName: string): {
    absolutePath: string;
    fileName: string;
    contentType: string;
  } {
    const payload = this.verifyToken(token);

    if (payload.taskId !== taskId.trim() || payload.fileName !== fileName.trim()) {
      throw buildInvalidOfficePreviewTokenError();
    }

    return this.officeService.getArtifactFile(taskId, fileName, payload.userId);
  }

  private createToken(payload: OfficePreviewTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(encodedPayload)
      .digest("base64url");

    return `${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): OfficePreviewTokenPayload {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
      throw buildInvalidOfficePreviewTokenError();
    }

    const expectedSignature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(encodedPayload)
      .digest("base64url");
    const leftBuffer = Buffer.from(signature);
    const rightBuffer = Buffer.from(expectedSignature);

    if (leftBuffer.byteLength !== rightBuffer.byteLength || !crypto.timingSafeEqual(leftBuffer, rightBuffer)) {
      throw buildInvalidOfficePreviewTokenError();
    }

    let payload: OfficePreviewTokenPayload;

    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as OfficePreviewTokenPayload;
    } catch {
      throw buildInvalidOfficePreviewTokenError();
    }

    if (!payload.userId || typeof payload.expiresAt !== "number") {
      throw buildInvalidOfficePreviewTokenError();
    }

    if (payload.expiresAt <= Date.now()) {
      throw new AppError({
        statusCode: 401,
        errorCode: "OFFICE_PREVIEW_TOKEN_EXPIRED",
        detail: "办公预览链接已经过期，请重新打开"
      });
    }

    return payload;
  }
}

export function buildOfficeArtifactPreviewPath(token: string, artifactId: string): string {
  return `/preview/office/artifacts/${encodeURIComponent(token)}/${encodeURIComponent(artifactId)}`;
}

export function buildOfficeTaskFilePreviewPath(token: string, taskId: string, fileName: string): string {
  return `/preview/office/tasks/${encodeURIComponent(token)}/${encodeURIComponent(taskId)}/${encodeURIComponent(fileName)}`;
}

function buildInvalidOfficePreviewTokenError(): AppError {
  return new AppError({
    statusCode: 401,
    errorCode: "OFFICE_PREVIEW_TOKEN_INVALID",
    detail: "办公预览链接无效，请重新打开"
  });
}
