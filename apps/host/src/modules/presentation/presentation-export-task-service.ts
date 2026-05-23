import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import type { FileAccessGuard } from "../file/file-access-guard.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { PresentationPdfExportTaskDto } from "./presentation-export-types.js";
import type {
  ExportPresentationPdfResult,
  PresentationPdfExportService
} from "./presentation-pdf-export-service.js";
import type {
  ExportPresentationPptxResult,
  PresentationPptxExportService
} from "./presentation-pptx-export-service.js";

interface CreatePresentationPdfExportInput {
  workspaceId: string;
  path: string;
  htmlContent: string;
  format: "pdf" | "pptx";
}

interface PresentationPdfExportTaskInput {
  htmlContent: string;
  sourceFilePath: string;
  outputFilePath: string;
}

interface PresentationPdfExportTaskRecord {
  workspaceId: string;
  sourcePath: string;
  outputPath: string;
  fileName: string;
  key: string;
  format: "pdf" | "pptx";
}

export interface PresentationExportDownload {
  fileName: string;
  contentType: string;
  absolutePath: string;
}

export class PresentationExportTaskService {
  private readonly taskRecordById = new Map<string, PresentationPdfExportTaskRecord>();

  constructor(
    private readonly taskManager: TaskManager,
    private readonly presentationPdfExportService: PresentationPdfExportService,
    private readonly presentationPptxExportService: PresentationPptxExportService,
    private readonly fileAccessGuard: FileAccessGuard
  ) {
    this.registerTask();
  }

  async createExportTask(
    input: CreatePresentationPdfExportInput
  ): Promise<PresentationPdfExportTaskDto> {
    const htmlContent = input.htmlContent.trim();

    if (!htmlContent) {
      throw new AppError({
        statusCode: 400,
        errorCode: "PRESENTATION_HTML_REQUIRED",
        detail: "导出 PDF 时缺少 HTML 内容",
        field: "htmlContent"
      });
    }

    const sourceResolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.path, {
      kind: "file"
    });
    const outputFileName = buildOutputFileName(sourceResolved.relativePath, input.format);
    const outputAbsolutePath = buildTemporaryOutputPath(handleSafeWorkspaceId(input.workspaceId), outputFileName);
    const key = `${input.workspaceId}:${sourceResolved.relativePath}:${input.format}`;
    const taskType = input.format === "pptx"
      ? HOST_TASK_TYPES.presentationExportPptx
      : HOST_TASK_TYPES.presentationExportPdf;
    const handle = this.taskManager.enqueue<
      PresentationPdfExportTaskInput,
      ExportPresentationPdfResult | ExportPresentationPptxResult
    >(
      taskType,
      {
        key,
        source: `presentation.export_${input.format}`,
        input: {
          htmlContent,
          sourceFilePath: sourceResolved.absolutePath,
          outputFilePath: outputAbsolutePath
        }
      }
    );

    this.taskRecordById.set(handle.taskId, {
      workspaceId: input.workspaceId,
      sourcePath: sourceResolved.relativePath,
      outputPath: outputAbsolutePath,
      fileName: outputFileName,
      key,
      format: input.format
    });
    void handle.promise.catch(() => undefined);

    return this.getTask(handle.taskId);
  }

  getTask(taskId: string): PresentationPdfExportTaskDto {
    const record = this.taskRecordById.get(taskId);

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PRESENTATION_EXPORT_TASK_NOT_FOUND",
        detail: `未找到导出任务 ${taskId}`
      });
    }

    const taskType = record.format === "pptx"
      ? HOST_TASK_TYPES.presentationExportPptx
      : HOST_TASK_TYPES.presentationExportPdf;
    const snapshot = this.taskManager.peek<ExportPresentationPdfResult | ExportPresentationPptxResult>(
      taskType,
      record.key
    );

    if (!snapshot || snapshot.taskId !== taskId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PRESENTATION_EXPORT_TASK_NOT_FOUND",
        detail: `未找到导出任务 ${taskId}`
      });
    }

    return this.toTaskDto(record, snapshot);
  }

  getDownload(taskId: string): PresentationExportDownload {
    const task = this.getTask(taskId);
    const record = this.taskRecordById.get(taskId);

    if (!record) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PRESENTATION_EXPORT_TASK_NOT_FOUND",
        detail: `未找到导出任务 ${taskId}`
      });
    }

    if (task.status !== "succeeded") {
      throw new AppError({
        statusCode: 409,
        errorCode: "PRESENTATION_EXPORT_NOT_READY",
        detail: "导出文件还没有生成完成"
      });
    }

    if (!fs.existsSync(record.outputPath)) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PRESENTATION_EXPORT_FILE_NOT_FOUND",
        detail: "导出文件不存在，请重新导出"
      });
    }

    return {
      fileName: record.fileName,
      contentType: resolveExportContentType(record.format),
      absolutePath: record.outputPath
    };
  }

  private registerTask(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.presentationExportPdf)) {
      this.taskManager.register<
      PresentationPdfExportTaskInput,
      ExportPresentationPdfResult
      >({
        taskType: HOST_TASK_TYPES.presentationExportPdf,
        executionLane: "external_process",
        timeoutMs: 60_000,
        concurrency: 1,
        run: async (input, context) => {
          return await this.presentationPdfExportService.exportPdf({
            htmlContent: input.htmlContent,
            sourceFilePath: input.sourceFilePath,
            outputFilePath: input.outputFilePath,
            signal: context.signal
          });
        }
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.presentationExportPptx)) {
      this.taskManager.register<
        PresentationPdfExportTaskInput,
        ExportPresentationPptxResult
      >({
        taskType: HOST_TASK_TYPES.presentationExportPptx,
        executionLane: "external_process",
        timeoutMs: 120_000,
        concurrency: 1,
        run: async (input, context) => {
          return await this.presentationPptxExportService.exportPptx({
            htmlContent: input.htmlContent,
            sourceFilePath: input.sourceFilePath,
            outputFilePath: input.outputFilePath,
            signal: context.signal
          });
        }
      });
    }
  }

  private toTaskDto(
    record: PresentationPdfExportTaskRecord,
    snapshot: TaskSnapshot<ExportPresentationPdfResult | ExportPresentationPptxResult>
  ): PresentationPdfExportTaskDto {
    return {
      taskId: snapshot.taskId,
      workspaceId: record.workspaceId,
      sourcePath: record.sourcePath,
      format: record.format,
      status: snapshot.status,
      startedAt: toIsoTime(snapshot.startedAt),
      finishedAt: toIsoTime(snapshot.finishedAt),
      errorMessage: snapshot.errorMessage ?? null,
      outputPath: snapshot.result?.outputPath ?? record.outputPath
    };
  }
}

function buildOutputFileName(sourceRelativePath: string, format: "pdf" | "pptx"): string {
  const parsed = path.parse(sourceRelativePath);
  return `${parsed.name || "presentation"}.${format}`;
}

function buildTemporaryOutputPath(workspaceId: string, fileName: string): string {
  const exportDir = path.join(os.tmpdir(), "codingns-presentation-exports", workspaceId);
  fs.mkdirSync(exportDir, { recursive: true });
  return path.join(exportDir, `${Date.now()}-${fileName}`);
}

function handleSafeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_") || "workspace";
}

function resolveExportContentType(format: "pdf" | "pptx"): string {
  return format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function toIsoTime(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }

  return new Date(timestamp).toISOString();
}
