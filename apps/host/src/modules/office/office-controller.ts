import { readFileSync } from "node:fs";

import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { OfficeConnectorKind, OfficeRiskLevel, OfficeTaskStatus, OfficeTaskType } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import type { OfficePreviewLinkService } from "./office-preview-link-service.js";
import type { CreateOfficeTaskInput, ReplyOfficeApprovalInput } from "./office-service.js";
import { OfficeService } from "./office-service.js";

interface OfficeTaskListQuery {
  workspaceId?: string;
  taskType?: OfficeTaskType;
  status?: OfficeTaskStatus;
  riskLevel?: OfficeRiskLevel;
  limit?: string;
}

interface OfficeTaskParams {
  taskId: string;
}

interface OfficeArtifactParams {
  artifactId: string;
}

interface OfficeArtifactFileParams {
  taskId: string;
  fileName: string;
}

interface OfficePreviewWildcardParams {
  "*": string;
}

interface OfficeApprovalParams {
  approvalId: string;
}

interface OfficeConnectorListQuery {
  kind?: OfficeConnectorKind;
}

export class OfficeController {
  constructor(
    private readonly officeService: OfficeService,
    private readonly officePreviewLinkService: OfficePreviewLinkService
  ) {}

  readonly listTasks = async (
    request: FastifyRequest<{ Querystring: OfficeTaskListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;
    reply.send({
      items: this.officeService.listTasks({
        userId,
        workspaceId: normalizeOptionalText(request.query.workspaceId),
        taskType: request.query.taskType,
        status: request.query.status,
        riskLevel: request.query.riskLevel,
        limit: Number.isFinite(limit) ? limit : undefined
      })
    });
  };

  readonly createTask = async (
    request: FastifyRequest<{ Body: Omit<CreateOfficeTaskInput, "userId"> }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    reply.send(
      this.officeService.createTask({
        ...request.body,
        userId
      })
    );
  };

  readonly getTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const detail = this.officeService.getTaskDetail(request.params.taskId, userId);

    reply.send({
      ...detail,
      artifacts: detail.artifacts.map((artifact) => ({
        ...artifact,
        previewPath: this.officePreviewLinkService.createArtifactLink(artifact.id, userId).previewPath,
        previewUrl: buildAbsolutePreviewUrl(
          request,
          this.officePreviewLinkService.createArtifactLink(artifact.id, userId).previewPath
        )
      }))
    });
  };

  readonly createArtifactPreviewLink = async (
    request: FastifyRequest<{ Params: OfficeArtifactParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const previewLink = this.officePreviewLinkService.createArtifactLink(
      request.params.artifactId,
      requireUserId(request)
    );

    reply.send({
      ...previewLink,
      previewUrl: buildAbsolutePreviewUrl(request, previewLink.previewPath)
    });
  };

  readonly readArtifactContent = async (
    request: FastifyRequest<{ Params: OfficeArtifactParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const artifact = this.officeService.getArtifact(request.params.artifactId, requireUserId(request));

    if (!artifact.storagePath) {
      throw new Error("办公产物缺少 storagePath");
    }

    reply
      .header("Cache-Control", "private, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(artifact.name)}"`)
      .type(artifact.contentType ?? "application/octet-stream")
      .send(readFileSync(artifact.storagePath));
  };

  readonly readArtifactFileContent = async (
    request: FastifyRequest<{ Params: OfficeArtifactFileParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const artifactFile = this.officeService.getArtifactFile(
      request.params.taskId,
      request.params.fileName,
      requireUserId(request)
    );

    reply
      .header("Cache-Control", "private, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(artifactFile.fileName)}"`)
      .type(artifactFile.contentType)
      .send(readFileSync(artifactFile.absolutePath));
  };

  readonly createTaskFilePreviewLink = async (
    request: FastifyRequest<{ Params: OfficeArtifactFileParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const previewLink = this.officePreviewLinkService.createTaskFileLink(
      request.params.taskId,
      request.params.fileName,
      requireUserId(request)
    );

    reply.send({
      ...previewLink,
      previewUrl: buildAbsolutePreviewUrl(request, previewLink.previewPath)
    });
  };

  readonly readArtifactPreview = async (
    request: FastifyRequest<{ Params: OfficePreviewWildcardParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { token, artifactId } = parseOfficeArtifactPreviewTail(request.params["*"]);
    const artifact = this.officePreviewLinkService.resolveArtifact(
      token,
      artifactId
    );

    reply
      .header("Cache-Control", "private, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(artifact.fileName)}"`)
      .type(artifact.contentType ?? "application/octet-stream")
      .send(readFileSync(artifact.storagePath));
  };

  readonly readArtifactTaskFilePreview = async (
    request: FastifyRequest<{ Params: OfficePreviewWildcardParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { token, taskId, fileName } = parseOfficeTaskFilePreviewTail(request.params["*"]);
    const artifactFile = this.officePreviewLinkService.resolveTaskFile(
      token,
      taskId,
      fileName
    );

    reply
      .header("Cache-Control", "private, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(artifactFile.fileName)}"`)
      .type(artifactFile.contentType)
      .send(readFileSync(artifactFile.absolutePath));
  };

  readonly cancelTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.officeService.cancelTask(request.params.taskId, requireUserId(request)));
  };

  readonly retryTask = async (
    request: FastifyRequest<{ Params: OfficeTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.officeService.retryTask(request.params.taskId, requireUserId(request)));
  };

  readonly listConnectors = async (
    request: FastifyRequest<{ Querystring: OfficeConnectorListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.officeService.listConnectors(request.query.kind)
    });
  };

  readonly replyApproval = async (
    request: FastifyRequest<{
      Params: OfficeApprovalParams;
      Body: Omit<ReplyOfficeApprovalInput, "approvalId" | "userId">;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.officeService.replyApproval({
        approvalId: request.params.approvalId,
        userId: requireUserId(request),
        status: request.body.status,
        decisionNote: request.body.decisionNote
      })
    );
  };
}

function normalizeOptionalText(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAbsolutePreviewUrl(request: FastifyRequest, previewPath: string): string {
  const protocol = (
    (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim()
    || request.protocol
    || "http"
  );
  const host = (
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
    || request.headers.host
    || "127.0.0.1"
  );

  return new URL(
    previewPath,
    host.endsWith("/") ? `${protocol}://${host}` : `${protocol}://${host}/`
  ).toString();
}

function parseOfficeArtifactPreviewTail(tail: string | undefined): {
  token: string;
  artifactId: string;
} {
  const [rawToken, rawArtifactId] = splitPreviewTail(tail, 2);

  return {
    token: rawToken,
    artifactId: rawArtifactId
  };
}

function parseOfficeTaskFilePreviewTail(tail: string | undefined): {
  token: string;
  taskId: string;
  fileName: string;
} {
  const [rawToken, rawTaskId, rawFileName] = splitPreviewTail(tail, 3);

  return {
    token: rawToken,
    taskId: rawTaskId,
    fileName: rawFileName
  };
}

function splitPreviewTail(tail: string | undefined, expectedSegments: number): string[] {
  const segments = (tail ?? "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw buildInvalidOfficePreviewPathError();
      }
    });

  if (segments.length !== expectedSegments) {
    throw buildInvalidOfficePreviewPathError();
  }

  return segments;
}

function buildInvalidOfficePreviewPathError(): AppError {
  return new AppError({
    statusCode: 404,
    errorCode: "OFFICE_PREVIEW_PATH_INVALID",
    detail: "办公预览路径无效"
  });
}
