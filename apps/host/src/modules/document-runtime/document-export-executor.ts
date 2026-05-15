import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { OfficeArtifactRepository } from "../../storage/repositories/office-artifact-repository.js";
import type { OfficeAuditEventRepository } from "../../storage/repositories/office-audit-event-repository.js";
import type { OfficeReceiptRepository } from "../../storage/repositories/office-receipt-repository.js";
import type { OfficeTaskRepository } from "../../storage/repositories/office-task-repository.js";
import type { OfficeTaskStepRepository } from "../../storage/repositories/office-task-step-repository.js";
import type {
  DocumentTemplate,
  OfficeArtifact,
  OfficeDocument,
  OfficeDocumentComment,
  OfficeDocumentRevision,
  OfficeReceipt,
  OfficeTask,
  OfficeTaskStep
} from "../../types/domain.js";
import { TaskCancelledError, type TaskRunContext } from "../tasks/task-types.js";

export interface ExecuteDocumentExportInput {
  task: OfficeTask;
  document: OfficeDocument;
  revision: OfficeDocumentRevision;
  comments: OfficeDocumentComment[];
  template: DocumentTemplate;
  format: "docx" | "pdf" | "md";
  runContext?: TaskRunContext;
}

export class DocumentExportExecutor {
  private readonly artifactRoot: string;
  private readonly docxFallbackRendererPath: string;

  constructor(
    private readonly config: HostConfig,
    private readonly officeTaskRepository: OfficeTaskRepository,
    private readonly officeTaskStepRepository: OfficeTaskStepRepository,
    private readonly officeArtifactRepository: OfficeArtifactRepository,
    private readonly officeReceiptRepository: OfficeReceiptRepository,
    private readonly officeAuditEventRepository: OfficeAuditEventRepository
  ) {
    this.artifactRoot = path.join(path.dirname(config.databasePath), "office-artifacts");
    this.docxFallbackRendererPath = resolveDocxFallbackRendererPath();
  }

  async execute(input: ExecuteDocumentExportInput): Promise<DocumentExportExecutionResult> {
    const task = this.markTaskRunning(input.task);
    ensureNotCancelled(input.runContext);

    try {
      const prepareStep = this.startStep(
        this.createStep(task, 1, "prepare_export", "准备导出输入", {
          documentId: input.document.id,
          templateId: input.template.id,
          format: input.format
        })
      );
      const payload = buildTemplatePayload(input.document, input.revision, input.comments, input.template);
      this.finishStep(prepareStep, JSON.stringify({
        title: payload.title,
        sectionCount: payload.sections.length,
        format: input.format
      }));

      ensureNotCancelled(input.runContext);

      const exportStep = this.startStep(
        this.createStep(task, 2, "render_export", "生成导出文件", {
          format: input.format
        })
      );
      const artifact = await this.renderArtifact(task, exportStep, input, payload);
      this.finishStep(exportStep, JSON.stringify({
        artifactId: artifact.id,
        format: input.format
      }));

      const proof = buildExportProof(input, payload, artifact);
      const receipt = this.createReceipt(task, proof);
      const nextTask = this.markTaskSucceeded(task);

      return {
        task: nextTask,
        receipt,
        artifact
      };
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        this.markTaskCancelled(task, error.message);
        throw error;
      }

      const detail = error instanceof Error ? error.message : "文档导出执行失败";
      this.markTaskFailed(task, detail);
      throw error instanceof AppError ? error : new AppError({
        statusCode: 500,
        errorCode: "DOCUMENT_EXPORT_EXECUTION_FAILED",
        detail
      });
    }
  }

  private async renderArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: ExecuteDocumentExportInput,
    payload: DocumentTemplatePayload
  ): Promise<OfficeArtifact> {
    switch (input.format) {
      case "md":
        return this.createTextArtifact(
          task,
          step,
          "document_export",
          `${sanitizeFileName(input.document.title)}.md`,
          renderMarkdown(payload),
          "text/markdown",
          buildArtifactMetadata(input, payload, "md", "builtin-markdown")
        );
      case "docx":
        return await this.renderDocxArtifact(task, step, input, payload);
      case "pdf":
        return await this.renderPdfArtifact(task, step, input, payload);
      default:
        throw new AppError({
          statusCode: 400,
          errorCode: "DOCUMENT_EXPORT_FORMAT_NOT_SUPPORTED",
          detail: "暂不支持该导出格式"
        });
    }
  }

  private async renderDocxArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: ExecuteDocumentExportInput,
    payload: DocumentTemplatePayload
  ): Promise<OfficeArtifact> {
    if (canRenderViaDoct(this.config.doctCliPath, input.template)) {
      return await this.renderViaDoct(task, step, input, payload, "docx");
    }

    return await this.renderFallbackDocx(task, step, input, payload);
  }

  private async renderPdfArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: ExecuteDocumentExportInput,
    payload: DocumentTemplatePayload
  ): Promise<OfficeArtifact> {
    if (canRenderViaDoct(this.config.doctCliPath, input.template)) {
      return await this.renderViaDoct(task, step, input, payload, "pdf");
    }

    throw new AppError({
      statusCode: 501,
      errorCode: "DOCUMENT_EXPORT_PDF_BRIDGE_NOT_READY",
      detail: "当前模板没有可用 doct 模板源，或当前环境未安装 doct"
    });
  }

  private async renderViaDoct(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: ExecuteDocumentExportInput,
    payload: DocumentTemplatePayload,
    format: "docx" | "pdf"
  ): Promise<OfficeArtifact> {
    const taskDir = this.ensureArtifactDir(task.id);
    const payloadPath = path.join(taskDir, `${step.id}-payload.json`);
    const outputPath = path.join(taskDir, `${sanitizeFileName(input.document.title)}.${format}`);
    fs.writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    await runCommand({
      commandPath: this.config.doctCliPath,
      args: buildDoctRenderArgs(input.template, payloadPath, outputPath, format),
      signal: input.runContext?.signal
    });

    const stats = fs.statSync(outputPath);
    const artifact = this.officeArtifactRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: step.id,
      kind: "document_export",
      name: path.basename(outputPath),
      storagePath: outputPath,
      contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadataJson: JSON.stringify({
        ...buildArtifactMetadata(input, payload, format, "doct"),
        size: stats.size
      }),
      createdAt: nowIso()
    });
    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private async renderFallbackDocx(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: ExecuteDocumentExportInput,
    payload: DocumentTemplatePayload
  ): Promise<OfficeArtifact> {
    const pythonCommand = resolvePythonCommandPath();
    if (!pythonCommand) {
      throw new AppError({
        statusCode: 500,
        errorCode: "DOCUMENT_EXPORT_DOCX_FALLBACK_UNAVAILABLE",
        detail: "当前环境既没有 doct，也没有可用的 Python DOCX 导出桥接"
      });
    }

    if (!fs.existsSync(this.docxFallbackRendererPath)) {
      throw new AppError({
        statusCode: 500,
        errorCode: "DOCUMENT_EXPORT_DOCX_FALLBACK_SCRIPT_MISSING",
        detail: "DOCX 导出桥接脚本缺失"
      });
    }

    const taskDir = this.ensureArtifactDir(task.id);
    const payloadPath = path.join(taskDir, `${step.id}-docx-fallback-payload.json`);
    const outputPath = path.join(taskDir, `${sanitizeFileName(input.document.title)}.docx`);
    fs.writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    await runCommand({
      commandPath: pythonCommand,
      args: [
        this.docxFallbackRendererPath,
        payloadPath,
        outputPath
      ],
      signal: input.runContext?.signal
    });

    const stats = fs.statSync(outputPath);
    const artifact = this.officeArtifactRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: step.id,
      kind: "document_export",
      name: path.basename(outputPath),
      storagePath: outputPath,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadataJson: JSON.stringify({
        ...buildArtifactMetadata(input, payload, "docx", "python-docx-fallback"),
        size: stats.size
      }),
      createdAt: nowIso()
    });
    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private createStep(task: OfficeTask, stepSeq: number, stepType: string, title: string, inputValue: unknown): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.create({
      id: createId(),
      taskId: task.id,
      stepSeq,
      stepType,
      title,
      inputJson: JSON.stringify(inputValue),
      outputJson: null,
      status: "pending",
      retryCount: 0,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private startStep(step: OfficeTaskStep): OfficeTaskStep {
    const timestamp = nowIso();
    return this.officeTaskStepRepository.update({
      ...step,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp
    });
  }

  private finishStep(step: OfficeTaskStep, outputJson: string): OfficeTaskStep {
    const timestamp = nowIso();
    const next = this.officeTaskStepRepository.update({
      ...step,
      status: "succeeded",
      outputJson,
      finishedAt: timestamp,
      updatedAt: timestamp
    });

    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: step.taskId,
      stepId: step.id,
      eventKind: "task_updated",
      actorKind: "connector",
      actorId: "document.doct",
      summary: `文档导出步骤完成：${step.title}`,
      payloadJson: outputJson,
      createdAt: timestamp
    });

    return next;
  }

  private createTextArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    kind: OfficeArtifact["kind"],
    fileName: string,
    content: string,
    contentType: string,
    metadata: Record<string, unknown> | null = null
  ): OfficeArtifact {
    const targetDir = this.ensureArtifactDir(task.id);
    const artifactId = createId();
    const storagePath = path.join(targetDir, `${artifactId}-${fileName}`);
    fs.writeFileSync(storagePath, content, "utf8");
    const artifact = this.officeArtifactRepository.create({
      id: artifactId,
      taskId: task.id,
      stepId: step.id,
      kind,
      name: fileName,
      storagePath,
      contentType,
      metadataJson: JSON.stringify({
        ...(metadata ?? {}),
        size: Buffer.byteLength(content),
        stepSeq: step.stepSeq
      }),
      createdAt: nowIso()
    });
    this.recordArtifactAudit(task.id, step.id, artifact);
    return artifact;
  }

  private createReceipt(task: OfficeTask, payload: Record<string, unknown>): OfficeReceipt {
    return this.officeReceiptRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      receiptType: "document_export",
      summary: "文档导出完成",
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    });
  }

  private markTaskRunning(task: OfficeTask): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "running",
      startedAt: task.startedAt ?? timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_started",
      actorKind: "connector",
      actorId: "document.doct",
      summary: "文档导出任务开始执行",
      payloadJson: null,
      createdAt: timestamp
    });
    return next;
  }

  private markTaskSucceeded(task: OfficeTask): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "succeeded",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: "document.doct",
      summary: "文档导出任务执行成功",
      payloadJson: JSON.stringify({ status: "succeeded" }),
      createdAt: timestamp
    });
    return next;
  }

  private markTaskFailed(task: OfficeTask, reason: string): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "failed",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_finished",
      actorKind: "connector",
      actorId: "document.doct",
      summary: "文档导出任务执行失败",
      payloadJson: JSON.stringify({ status: "failed", reason }),
      createdAt: timestamp
    });
    return next;
  }

  private markTaskCancelled(task: OfficeTask, reason: string): OfficeTask {
    const timestamp = nowIso();
    const next = this.officeTaskRepository.update({
      ...task,
      status: "cancelled",
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId: task.id,
      stepId: null,
      eventKind: "task_cancelled",
      actorKind: "connector",
      actorId: "document.doct",
      summary: "文档导出任务已取消",
      payloadJson: JSON.stringify({ reason }),
      createdAt: timestamp
    });
    return next;
  }

  private recordArtifactAudit(taskId: string, stepId: string, artifact: OfficeArtifact): void {
    this.officeAuditEventRepository.create({
      id: createId(),
      taskId,
      stepId,
      eventKind: "artifact_created",
      actorKind: "connector",
      actorId: "document.doct",
      summary: `生成文档产物：${artifact.name}`,
      payloadJson: JSON.stringify({ artifactId: artifact.id, kind: artifact.kind }),
      createdAt: artifact.createdAt
    });
  }

  private ensureArtifactDir(taskId: string): string {
    const targetDir = path.join(this.artifactRoot, taskId);
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }
}

export interface DocumentExportExecutionResult {
  task: OfficeTask;
  receipt: OfficeReceipt;
  artifact: OfficeArtifact;
}

interface DocumentTemplatePayload {
  title: string;
  summary: string | null;
  templateKey: string;
  templateVersion: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
  references: Array<{
    title: string;
    sourceRef: string | null;
    quoteText: string | null;
    targetAnchorKey: string | null;
  }>;
  annotations: Array<{
    anchorType: string;
    anchorKey: string;
    body: string;
    status: OfficeDocumentComment["status"];
    createdBy: string;
  }>;
}

function buildArtifactMetadata(
  input: ExecuteDocumentExportInput,
  payload: DocumentTemplatePayload,
  format: "docx" | "pdf" | "md",
  engine: "doct" | "python-docx-fallback" | "builtin-markdown"
): Record<string, unknown> {
  return {
    proofVersion: 1,
    documentId: input.document.id,
    revisionId: input.revision.id,
    revisionSeq: input.revision.revisionSeq,
    templateId: input.template.id,
    templateKey: input.template.templateKey,
    templateVersion: input.template.templateVersion,
    format,
    engine,
    payloadSha256: hashPayload(payload),
    payloadSummary: {
      title: payload.title,
      sectionCount: payload.sections.length,
      referenceCount: payload.references.length,
      annotationCount: payload.annotations.length
    }
  };
}

function buildExportProof(
  input: ExecuteDocumentExportInput,
  payload: DocumentTemplatePayload,
  artifact: OfficeArtifact
): Record<string, unknown> {
  const metadata = parseArtifactMetadata(artifact.metadataJson);

  return {
    proofVersion: 1,
    taskId: input.task.id,
    documentId: input.document.id,
    revisionId: input.revision.id,
    revisionSeq: input.revision.revisionSeq,
    templateId: input.template.id,
    templateKey: input.template.templateKey,
    templateVersion: input.template.templateVersion,
    format: metadata.format ?? input.format,
    engine: metadata.engine ?? "unknown",
    payloadSha256: metadata.payloadSha256 ?? hashPayload(payload),
    payloadSummary: metadata.payloadSummary ?? {
      title: payload.title,
      sectionCount: payload.sections.length,
      referenceCount: payload.references.length,
      annotationCount: payload.annotations.length
    },
    artifactId: artifact.id,
    artifactName: artifact.name,
    artifactContentType: artifact.contentType,
    exportedAt: artifact.createdAt
  };
}

function parseArtifactMetadata(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }

  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function hashPayload(payload: DocumentTemplatePayload): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function buildTemplatePayload(
  document: OfficeDocument,
  revision: OfficeDocumentRevision,
  comments: OfficeDocumentComment[],
  template: DocumentTemplate
): DocumentTemplatePayload {
  const rawContent = parseJsonObject(revision.contentJson);
  const rawOutline = revision.outlineJson ? parseJsonValue(revision.outlineJson) : null;
  const mapping = parseTemplateMapping(template.mappingJson);
  const sections = buildSectionsFromMapping(rawContent, rawOutline, mapping.sections);
  const references = buildReferencesFromMapping(rawContent, mapping.references);
  const annotations = buildAnnotationsFromMapping(comments, mapping.annotations);
  const title = resolveMappedTitle(document, rawContent, mapping.title);
  const summary = resolveMappedSummary(revision, rawContent, mapping.summary);

  if (sections.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_EXPORT_CONTENT_EMPTY",
      detail: "当前文档没有可导出的正文内容"
    });
  }

  const payload = {
    title,
    summary,
    templateKey: template.templateKey,
    templateVersion: template.templateVersion,
    sections,
    references,
    annotations
  };

  validateTemplatePayload(template, payload);
  return payload;
}

function buildSectionsFromMapping(
  content: Record<string, unknown>,
  outline: unknown,
  mappingPath: string | null
): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const mappedBlocks = mappingPath ? readMappedValue({ content, outline }, mappingPath) : null;
  const blocks = Array.isArray(mappedBlocks)
    ? mappedBlocks
    : Array.isArray(content.blocks)
      ? content.blocks
      : [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    const heading = typeof record.heading === "string" && record.heading.trim()
      ? record.heading.trim()
      : typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : "正文";
    const body = extractText(record.body) ?? extractText(record.content) ?? "";
    if (body.trim()) {
      sections.push({
        heading,
        body: body.trim()
      });
    }
  }

  if (sections.length > 0) {
    return sections;
  }

  const body = extractText(content.body) ?? extractText(content.content) ?? extractText(outline) ?? "";
  if (body.trim()) {
    return [{
      heading: "正文",
      body: body.trim()
    }];
  }

  return [];
}

function buildReferencesFromMapping(
  content: Record<string, unknown>,
  mappingPath: string | null
): DocumentTemplatePayload["references"] {
  const mappedReferences = mappingPath ? readMappedValue({ content }, mappingPath) : null;
  const references = Array.isArray(mappedReferences)
    ? mappedReferences
    : Array.isArray(content.references)
      ? content.references
      : [];

  return references
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = extractText(record.title) ?? extractText(record.sourceTitle) ?? "";
      if (!title.trim()) {
        return null;
      }

      return {
        title: title.trim(),
        sourceRef: normalizeOptionalPayloadText(extractText(record.sourceRef) ?? extractText(record.url)),
        quoteText: normalizeOptionalPayloadText(extractText(record.quoteText) ?? extractText(record.quote)),
        targetAnchorKey: normalizeOptionalPayloadText(
          extractText(record.targetAnchorKey) ?? extractText(record.anchorKey)
        )
      };
    })
    .filter((item): item is DocumentTemplatePayload["references"][number] => item !== null);
}

function buildAnnotationsFromMapping(
  comments: OfficeDocumentComment[],
  mappingPath: string | null
): DocumentTemplatePayload["annotations"] {
  if (mappingPath && mappingPath !== "document.comments") {
    return [];
  }

  return comments.map((comment) => ({
    anchorType: comment.anchorType,
    anchorKey: comment.anchorKey,
    body: comment.body,
    status: comment.status,
    createdBy: comment.createdBy
  }));
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item) ?? "")
      .filter((item) => item.trim().length > 0)
      .join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = ["text", "content", "value", "body"];
    for (const key of candidates) {
      const candidate = extractText(record[key]);
      if (candidate?.trim()) {
        return candidate;
      }
    }
  }

  return null;
}

function renderMarkdown(payload: DocumentTemplatePayload): string {
  const lines = [`# ${payload.title}`, ""];
  if (payload.summary?.trim()) {
    lines.push(payload.summary.trim(), "");
  }

  for (const section of payload.sections) {
    lines.push(`## ${section.heading}`, "", section.body, "");
  }

  if (payload.references.length > 0) {
    lines.push("## 引用来源", "");
    for (const reference of payload.references) {
      const parts = [reference.title];
      if (reference.sourceRef) {
        parts.push(`来源：${reference.sourceRef}`);
      }
      if (reference.targetAnchorKey) {
        parts.push(`锚点：${reference.targetAnchorKey}`);
      }
      lines.push(`- ${parts.join(" | ")}`);
      if (reference.quoteText) {
        lines.push(`  引文：${reference.quoteText}`);
      }
    }
    lines.push("");
  }

  if (payload.annotations.length > 0) {
    lines.push("## 批注记录", "");
    for (const annotation of payload.annotations) {
      lines.push(
        `- [${annotation.status}] ${annotation.anchorType}:${annotation.anchorKey} - ${annotation.body}（${annotation.createdBy}）`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  return normalized.length > 0 ? normalized : "document-export";
}

function hasDoctCommand(commandPath: string): boolean {
  return resolveAvailableCommandPath(commandPath) !== null;
}

function canRenderViaDoct(commandPath: string, template: DocumentTemplate): boolean {
  if (!hasDoctCommand(commandPath)) {
    return false;
  }

  const templateSourcePath = template.templateSourcePath?.trim();
  if (!templateSourcePath) {
    return false;
  }

  return fs.existsSync(templateSourcePath);
}

function buildDoctRenderArgs(
  template: DocumentTemplate,
  payloadPath: string,
  outputPath: string,
  format: "docx" | "pdf"
): string[] {
  const templateSourcePath = template.templateSourcePath?.trim();
  if (!templateSourcePath) {
    throw new AppError({
      statusCode: 409,
      errorCode: "DOCUMENT_TEMPLATE_SOURCE_PATH_REQUIRED",
      detail: "当前模板未配置 doct 模板源路径"
    });
  }

  if (!fs.existsSync(templateSourcePath)) {
    throw new AppError({
      statusCode: 409,
      errorCode: "DOCUMENT_TEMPLATE_SOURCE_PATH_NOT_FOUND",
      detail: `未找到 doct 模板源文件：${templateSourcePath}`
    });
  }

  return [
    "render",
    "--template-file",
    templateSourcePath,
    "--input",
    payloadPath,
    "--output",
    outputPath,
    "--format",
    format
  ];
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function validateTemplatePayload(template: DocumentTemplate, payload: DocumentTemplatePayload): void {
  const schema = parseTemplateSchema(template.schemaJson);
  for (const fieldName of schema.requiredFields) {
    switch (fieldName) {
      case "title":
        if (!payload.title.trim()) {
          throwMissingTemplateField(fieldName);
        }
        break;
      case "body":
        if (payload.sections.length === 0 || !payload.sections.some((section) => section.body.trim())) {
          throwMissingTemplateField(fieldName);
        }
        break;
      case "summary":
        if (!payload.summary?.trim()) {
          throwMissingTemplateField(fieldName);
        }
        break;
      case "references":
        if (payload.references.length === 0) {
          throwMissingTemplateField(fieldName);
        }
        break;
      case "annotations":
        if (payload.annotations.length === 0) {
          throwMissingTemplateField(fieldName);
        }
        break;
      default:
        break;
    }
  }
}

function parseTemplateSchema(raw: string): {
  requiredFields: string[];
  optionalFields: string[];
} {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      requiredFields: [],
      optionalFields: []
    };
  }

  const record = parsed as Record<string, unknown>;
  return {
    requiredFields: normalizeTemplateFieldList(record.requiredFields),
    optionalFields: normalizeTemplateFieldList(record.optionalFields)
  };
}

function normalizeTemplateFieldList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function throwMissingTemplateField(fieldName: string): never {
  throw new AppError({
    statusCode: 400,
    errorCode: "DOCUMENT_TEMPLATE_REQUIRED_FIELD_MISSING",
    detail: `模板必填字段缺失：${fieldName}`
  });
}

function normalizeOptionalPayloadText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTemplateMapping(raw: string): {
  title: string | null;
  summary: string | null;
  sections: string | null;
  references: string | null;
  annotations: string | null;
} {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      title: null,
      summary: null,
      sections: null,
      references: null,
      annotations: null
    };
  }

  const record = parsed as Record<string, unknown>;
  return {
    title: normalizeMappingPath(record.title),
    summary: normalizeMappingPath(record.summary),
    sections: normalizeMappingPath(record.sections),
    references: normalizeMappingPath(record.references),
    annotations: normalizeMappingPath(record.annotations)
  };
}

function normalizeMappingPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveMappedTitle(
  document: OfficeDocument,
  content: Record<string, unknown>,
  mappingPath: string | null
): string {
  const mapped = mappingPath ? extractText(readMappedValue({ document, content }, mappingPath)) : null;
  return mapped?.trim() || document.title;
}

function resolveMappedSummary(
  revision: OfficeDocumentRevision,
  content: Record<string, unknown>,
  mappingPath: string | null
): string | null {
  const mapped = mappingPath ? extractText(readMappedValue({ revision, content }, mappingPath)) : null;
  return normalizeOptionalPayloadText(mapped ?? revision.summary);
}

function readMappedValue(scope: Record<string, unknown>, pathValue: string): unknown {
  const segments = pathValue
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);

  let current: unknown = scope;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

async function runCommand(input: {
  commandPath: string;
  args: string[];
  signal?: AbortSignal;
}): Promise<void> {
  const launch = resolveCommandLaunch(input.commandPath, input.args);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      shell: launch.shell,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    let onAbort: (() => void) | null = null;
    if (input.signal) {
      onAbort = () => {
        child.kill("SIGTERM");
        reject(input.signal?.reason ?? new TaskCancelledError("文档导出任务已取消"));
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (onAbort && input.signal) {
        input.signal.removeEventListener("abort", onAbort);
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new AppError({
        statusCode: 500,
        errorCode: "DOCUMENT_EXPORT_COMMAND_FAILED",
        detail: stderr.trim() || `文档导出命令退出码 ${code ?? "unknown"}`
      }));
    });
  });
}

function ensureNotCancelled(runContext?: TaskRunContext): void {
  if (!runContext?.signal.aborted) {
    return;
  }

  const reason = runContext.signal.reason;
  if (reason instanceof TaskCancelledError) {
    throw reason;
  }

  throw new TaskCancelledError(
    reason instanceof Error ? reason.message : "文档导出任务已取消"
  );
}

function resolvePythonCommandPath(): string | null {
  return resolveAvailableCommandPath("python3", ["python"]);
}

function resolveDocxFallbackRendererPath(): string {
  return fileURLToPath(new URL("./document-docx-fallback-renderer.py", import.meta.url));
}
