import type { FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "node:fs";

import { AppError } from "../../shared/errors/app-error.js";
import type { PresentationExportTaskService } from "./presentation-export-task-service.js";

interface CreatePresentationExportBody {
  workspaceId?: string;
  path?: string;
  htmlContent?: string;
  format?: "pdf" | "pptx";
}

interface PresentationExportTaskParams {
  taskId: string;
}

export class PresentationController {
  constructor(private readonly presentationExportTaskService: PresentationExportTaskService) {}

  readonly createExportTask = async (
    request: FastifyRequest<{ Body: CreatePresentationExportBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);

    const workspaceId = request.body?.workspaceId?.trim() ?? "";
    const sourcePath = request.body?.path?.trim() ?? "";
    const htmlContent = request.body?.htmlContent ?? "";
    const format = request.body?.format === "pptx" ? "pptx" : "pdf";

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "WORKSPACE_ID_REQUIRED",
        detail: "导出文件时缺少工作区 ID",
        field: "workspaceId"
      });
    }

    if (!sourcePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PRESENTATION_SOURCE_PATH_REQUIRED",
        detail: "导出文件时缺少源文件路径",
        field: "path"
      });
    }

    if (typeof htmlContent !== "string") {
      throw new AppError({
        statusCode: 400,
        errorCode: "PRESENTATION_HTML_REQUIRED",
        detail: "导出文件时缺少 HTML 内容",
        field: "htmlContent"
      });
    }

    reply.status(202).send(await this.presentationExportTaskService.createExportTask({
      workspaceId,
      path: sourcePath,
      htmlContent,
      format
    }));
  };

  readonly getExportTask = async (
    request: FastifyRequest<{ Params: PresentationExportTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);
    reply.send(this.presentationExportTaskService.getTask(request.params.taskId));
  };

  readonly downloadExportTask = async (
    request: FastifyRequest<{ Params: PresentationExportTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    ensureAuthenticated(request);

    const download = this.presentationExportTaskService.getDownload(request.params.taskId);

    reply
      .header("Cache-Control", "private, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(download.fileName)}"`)
      .type(download.contentType)
      .send(readFileSync(download.absolutePath));
  };
}

function ensureAuthenticated(request: FastifyRequest): void {
  if (request.auth?.user.userId) {
    return;
  }

  throw new AppError({
    statusCode: 401,
    errorCode: "UNAUTHORIZED",
    detail: "当前请求缺少有效登录态"
  });
}
