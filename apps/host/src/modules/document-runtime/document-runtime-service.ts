import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { DocumentCommentRepository } from "../../storage/repositories/document-comment-repository.js";
import type { DocumentRepository, OfficeDocumentListFilters } from "../../storage/repositories/document-repository.js";
import type { DocumentRevisionRepository } from "../../storage/repositories/document-revision-repository.js";
import type { DocumentTemplateRepository } from "../../storage/repositories/document-template-repository.js";
import type {
  DocumentTemplate,
  DocumentTemplateStatus,
  OfficeDocument,
  OfficeDocumentComment,
  OfficeDocumentExportFormat,
  OfficeDocumentRevision
} from "../../types/domain.js";
import type { OfficeService } from "../office/office-service.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES, type TaskSnapshot } from "../tasks/task-types.js";
import type { DocumentExportExecutor } from "./document-export-executor.js";

export interface CreateDocumentInput {
  userId: string;
  workspaceId?: string | null;
  title: string;
  templateId?: string;
  templateKey?: string;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
}

export interface CreateDocumentTemplateInput {
  userId: string;
  templateKey: string;
  displayName: string;
  templateVersion: string;
  templateSourcePath?: string | null;
  schema: unknown;
  mapping: unknown;
  outputFormats: OfficeDocumentExportFormat[];
  status?: DocumentTemplateStatus;
}

export interface UpdateDocumentTemplateInput {
  templateId: string;
  displayName?: string;
  templateSourcePath?: string | null;
  schema?: unknown;
  mapping?: unknown;
  outputFormats?: OfficeDocumentExportFormat[];
  status?: DocumentTemplateStatus;
}

export interface UpdateDocumentInput {
  documentId: string;
  userId: string;
  title?: string;
  templateId?: string;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
  status?: OfficeDocument["status"];
}

export interface CreateDocumentCommentInput {
  documentId: string;
  userId: string;
  revisionId?: string | null;
  anchorType: string;
  anchorKey: string;
  body: string;
}

export interface ResolveDocumentCommentInput {
  documentId: string;
  commentId: string;
  userId: string;
}

export interface CreateDocumentExportTaskInput {
  documentId: string;
  userId: string;
  workspaceId?: string | null;
  format: OfficeDocumentExportFormat;
  riskLevel?: "low" | "medium" | "high";
}

export interface OfficeDocumentDetail {
  document: OfficeDocument;
  template: DocumentTemplate;
  currentRevision: OfficeDocumentRevision | null;
  revisions: OfficeDocumentRevision[];
  comments: OfficeDocumentComment[];
}

export class DocumentRuntimeService {
  constructor(
    private readonly templateRepository: DocumentTemplateRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly revisionRepository: DocumentRevisionRepository,
    private readonly commentRepository: DocumentCommentRepository,
    private readonly officeService: OfficeService,
    private readonly taskManager: TaskManager,
    private readonly documentExportExecutor: DocumentExportExecutor
  ) {
    this.registerBackgroundTask();
  }

  listTemplates(status: DocumentTemplateStatus = "active"): DocumentTemplate[] {
    return this.templateRepository.list(status);
  }

  getTemplate(templateId: string): DocumentTemplate {
    return this.requireTemplate(templateId);
  }

  createTemplate(input: CreateDocumentTemplateInput): DocumentTemplate {
    const templateKey = input.templateKey.trim();
    const displayName = input.displayName.trim();
    const templateVersion = input.templateVersion.trim();

    if (!templateKey || !displayName || !templateVersion) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_DOCUMENT_TEMPLATE",
        detail: "模板 key、名称和版本不能为空"
      });
    }

    if (this.templateRepository.findByKeyAndVersion(templateKey, templateVersion)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DOCUMENT_TEMPLATE_VERSION_EXISTS",
        detail: "同一个模板 key 和版本已经存在"
      });
    }

    const normalized = normalizeTemplateDefinition(input.schema, input.mapping, input.outputFormats);

    const timestamp = nowIso();
    return this.templateRepository.create({
      id: `${templateKey}@${templateVersion}`,
      templateKey,
      displayName,
      engine: "doct",
      templateVersion,
      templateSourcePath: normalizeNullableText(input.templateSourcePath),
      schemaJson: JSON.stringify(normalized.schema),
      mappingJson: JSON.stringify(normalized.mapping),
      outputFormatsJson: JSON.stringify(normalized.outputFormats),
      status: input.status ?? "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  updateTemplate(input: UpdateDocumentTemplateInput): DocumentTemplate {
    const current = this.requireTemplate(input.templateId);
    const nextDisplayName = input.displayName === undefined
      ? current.displayName
      : input.displayName.trim();

    if (!nextDisplayName) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_DOCUMENT_TEMPLATE",
        detail: "模板名称不能为空"
      });
    }

    const currentSchema = JSON.parse(current.schemaJson) as unknown;
    const currentMapping = JSON.parse(current.mappingJson) as unknown;
    const currentOutputFormats = parseOutputFormats(current.outputFormatsJson);
    const normalized = normalizeTemplateDefinition(
      input.schema ?? currentSchema,
      input.mapping ?? currentMapping,
      input.outputFormats ?? currentOutputFormats
    );

    return this.templateRepository.update({
      ...current,
      displayName: nextDisplayName,
      templateSourcePath: input.templateSourcePath === undefined
        ? current.templateSourcePath
        : normalizeNullableText(input.templateSourcePath),
      schemaJson: JSON.stringify(normalized.schema),
      mappingJson: JSON.stringify(normalized.mapping),
      outputFormatsJson: JSON.stringify(normalized.outputFormats),
      status: input.status ?? current.status,
      updatedAt: nowIso()
    });
  }

  listDocuments(filters: OfficeDocumentListFilters): OfficeDocument[] {
    return this.documentRepository.list(filters);
  }

  getDocumentDetail(documentId: string, userId: string): OfficeDocumentDetail {
    const document = this.requireOwnedDocument(documentId, userId);
    const template = this.requireTemplate(document.templateId);
    const revisions = this.revisionRepository.listByDocumentId(document.id);
    const currentRevision = document.currentRevisionId
      ? revisions.find((item) => item.id === document.currentRevisionId) ?? null
      : null;

    return {
      document,
      template,
      currentRevision,
      revisions,
      comments: this.commentRepository.listByDocumentId(document.id)
    };
  }

  createDocument(input: CreateDocumentInput): OfficeDocumentDetail {
    const title = input.title.trim();
    if (!title) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_DOCUMENT_TITLE",
        detail: "文档标题不能为空",
        field: "title"
      });
    }

    const template = this.resolveTemplateSelection({
      templateId: normalizeNullableText(input.templateId),
      templateKey: normalizeNullableText(input.templateKey)
    });
    const timestamp = nowIso();
    const documentId = createId();
    const revisionId = createId();

    const revision: OfficeDocumentRevision = {
      id: revisionId,
      documentId,
      revisionSeq: 1,
      baseRevisionId: null,
      contentJson: JSON.stringify(input.content ?? {}),
      outlineJson: input.outline === undefined ? null : JSON.stringify(input.outline),
      summary: normalizeNullableText(input.summary) ?? "初始化文档",
      createdBy: input.userId,
      createdAt: timestamp
    };

    const document: OfficeDocument = {
      id: documentId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      title,
      templateId: template.id,
      currentRevisionId: revisionId,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.documentRepository.create(document);
    this.revisionRepository.create(revision);

    return {
      document,
      template,
      currentRevision: revision,
      revisions: [revision],
      comments: []
    };
  }

  updateDocument(input: UpdateDocumentInput): OfficeDocumentDetail {
    const current = this.requireOwnedDocument(input.documentId, input.userId);
    const timestamp = nowIso();
    const nextTitle = input.title === undefined ? current.title : input.title.trim();

    if (!nextTitle) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_DOCUMENT_TITLE",
        detail: "文档标题不能为空",
        field: "title"
      });
    }

    const nextTemplate = input.templateId === undefined
      ? this.requireTemplate(current.templateId)
      : this.requireActiveTemplate(input.templateId);

    if (nextTemplate.templateKey !== this.requireTemplate(current.templateId).templateKey) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DOCUMENT_TEMPLATE_KEY_SWITCH_NOT_ALLOWED",
        detail: "当前阶段不允许把文档切换到另一个模板 key"
      });
    }

    let nextDocument = current;
    const shouldCreateRevision = input.content !== undefined || input.outline !== undefined || input.summary !== undefined;

    if (shouldCreateRevision) {
      const nextRevision: OfficeDocumentRevision = {
        id: createId(),
        documentId: current.id,
        revisionSeq: this.revisionRepository.getNextRevisionSeq(current.id),
        baseRevisionId: current.currentRevisionId,
        contentJson: JSON.stringify(input.content ?? {}),
        outlineJson: input.outline === undefined ? null : JSON.stringify(input.outline),
        summary: normalizeNullableText(input.summary),
        createdBy: input.userId,
        createdAt: timestamp
      };
      this.revisionRepository.create(nextRevision);
      nextDocument = {
        ...nextDocument,
        currentRevisionId: nextRevision.id
      };
    }

    nextDocument = {
      ...nextDocument,
      title: nextTitle,
      templateId: nextTemplate.id,
      status: input.status ?? nextDocument.status,
      updatedAt: timestamp
    };
    this.documentRepository.update(nextDocument);

    return this.getDocumentDetail(nextDocument.id, input.userId);
  }

  createComment(input: CreateDocumentCommentInput): OfficeDocumentComment {
    const document = this.requireOwnedDocument(input.documentId, input.userId);
    const anchorType = input.anchorType.trim();
    const anchorKey = input.anchorKey.trim();
    const body = input.body.trim();

    if (!anchorType || !anchorKey || !body) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_DOCUMENT_COMMENT",
        detail: "批注锚点和内容不能为空"
      });
    }

    if (input.revisionId) {
      const revision = this.revisionRepository.findById(input.revisionId.trim());
      if (!revision || revision.documentId !== document.id) {
        throw new AppError({
          statusCode: 404,
          errorCode: "DOCUMENT_REVISION_NOT_FOUND",
          detail: "未找到对应文档修订"
        });
      }
    }

    const timestamp = nowIso();
    return this.commentRepository.create({
      id: createId(),
      documentId: document.id,
      revisionId: normalizeNullableText(input.revisionId),
      anchorType,
      anchorKey,
      body,
      status: "open",
      createdBy: input.userId,
      resolvedBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null
    });
  }

  resolveComment(input: ResolveDocumentCommentInput): OfficeDocumentComment {
    const document = this.requireOwnedDocument(input.documentId, input.userId);
    const current = this.commentRepository.findById(input.commentId.trim());
    if (!current || current.documentId !== document.id) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DOCUMENT_COMMENT_NOT_FOUND",
        detail: "未找到对应批注"
      });
    }

    const timestamp = nowIso();
    return this.commentRepository.update({
      ...current,
      status: "resolved",
      resolvedBy: input.userId,
      resolvedAt: timestamp,
      updatedAt: timestamp
    });
  }

  createExportTask(input: CreateDocumentExportTaskInput) {
    const document = this.requireOwnedDocument(input.documentId, input.userId);
    const template = this.requireTemplate(document.templateId);
    const allowedFormats = parseOutputFormats(template.outputFormatsJson);

    if (!allowedFormats.includes(input.format)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "DOCUMENT_EXPORT_FORMAT_NOT_SUPPORTED",
        detail: "当前模板不支持该导出格式",
        field: "format"
      });
    }

    return this.officeService.createTask({
      userId: input.userId,
      workspaceId: input.workspaceId ?? document.workspaceId,
      taskType: "document",
      title: `导出文档：${document.title}`,
      connectorId: "document.doct",
      targetRefKind: "document_template",
      targetRefId: template.id,
      input: {
        documentId: document.id,
        templateId: template.id,
        format: input.format,
        currentRevisionId: document.currentRevisionId
      },
      riskLevel: input.riskLevel ?? "low"
    });
  }

  async executeExportTask(taskId: string, userId: string): Promise<{
    taskId: string;
    executionTaskId: string;
    deduped: boolean;
  }> {
    const task = this.requireExecutableExportTask(taskId, userId);
    const handle = this.taskManager.enqueue<{ taskId: string; userId: string }, Awaited<ReturnType<DocumentExportExecutor["execute"]>>>(
      HOST_TASK_TYPES.officeDocumentExportExecute,
      {
        key: task.id,
        source: "office.document_export.execute",
        input: {
          taskId: task.id,
          userId
        }
      }
    );

    void handle.promise.catch(() => undefined);
    return {
      taskId: task.id,
      executionTaskId: handle.taskId,
      deduped: handle.deduped
    };
  }

  getExportExecutionSnapshot(taskId: string, userId: string): TaskSnapshot | null {
    this.requireOwnedDocumentExportTask(taskId, userId);
    return this.taskManager.peek(HOST_TASK_TYPES.officeDocumentExportExecute, taskId.trim());
  }

  cancelExportExecution(taskId: string, userId: string): { taskId: string; cancelled: boolean } {
    const task = this.requireOwnedDocumentExportTask(taskId, userId);
    this.taskManager.cancel(
      HOST_TASK_TYPES.officeDocumentExportExecute,
      task.id,
      "office_document_export_cancelled"
    );
    return {
      taskId: task.id,
      cancelled: true
    };
  }

  private registerBackgroundTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.officeDocumentExportExecute)) {
      return;
    }

    this.taskManager.register<{ taskId: string; userId: string }, Awaited<ReturnType<DocumentExportExecutor["execute"]>>>({
      taskType: HOST_TASK_TYPES.officeDocumentExportExecute,
      executionLane: "host_background",
      timeoutMs: 180_000,
      concurrency: 1,
      run: async (input, context) => {
        const task = this.requireExecutableExportTask(input.taskId, input.userId);
        const payload = parseDocumentExportTaskPayload(task.inputJson);
        const document = this.requireOwnedDocument(payload.documentId, input.userId);
        const template = this.requireTemplate(payload.templateId);
        const revision = this.requireRevision(document.id, payload.currentRevisionId ?? document.currentRevisionId);

        return await this.documentExportExecutor.execute({
          task,
          document,
          revision,
          comments: this.commentRepository.listByDocumentId(document.id),
          template,
          format: payload.format,
          runContext: context
        });
      }
    });
  }

  private requireExecutableExportTask(taskId: string, userId: string) {
    const task = this.requireOwnedDocumentExportTask(taskId, userId);
    if (task.status !== "ready" && task.status !== "failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "DOCUMENT_EXPORT_EXECUTION_NOT_ALLOWED",
        detail: "当前导出任务状态不允许执行"
      });
    }

    return task;
  }

  private requireOwnedDocumentExportTask(taskId: string, userId: string) {
    const detail = this.officeService.getTaskDetail(taskId.trim(), userId);
    if (detail.task.taskType !== "document" || detail.task.connectorId !== "document.doct") {
      throw new AppError({
        statusCode: 404,
        errorCode: "DOCUMENT_EXPORT_TASK_NOT_FOUND",
        detail: "未找到对应文档导出任务"
      });
    }

    return detail.task;
  }

  private requireOwnedDocument(documentId: string, userId: string): OfficeDocument {
    const document = this.documentRepository.findById(documentId.trim());
    if (!document || document.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DOCUMENT_NOT_FOUND",
        detail: "未找到对应文档"
      });
    }

    return document;
  }

  private requireActiveTemplate(templateId: string): DocumentTemplate {
    const template = this.requireTemplate(templateId);
    if (template.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "DOCUMENT_TEMPLATE_NOT_ACTIVE",
        detail: "当前模板不可用"
      });
    }

    return template;
  }

  private resolveTemplateSelection(input: {
    templateId: string | null;
    templateKey: string | null;
  }): DocumentTemplate {
    if (input.templateId) {
      return this.requireActiveTemplate(input.templateId);
    }

    if (input.templateKey) {
      const template = this.templateRepository.findActiveByKey(input.templateKey);
      if (!template) {
        throw new AppError({
          statusCode: 404,
          errorCode: "DOCUMENT_TEMPLATE_NOT_FOUND",
          detail: "未找到可用的模板版本"
        });
      }

      return template;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_TEMPLATE_SELECTION",
      detail: "创建文档时必须提供 templateId 或 templateKey"
    });
  }

  private requireTemplate(templateId: string): DocumentTemplate {
    const template = this.templateRepository.findById(templateId.trim());
    if (!template) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DOCUMENT_TEMPLATE_NOT_FOUND",
        detail: "未找到对应模板"
      });
    }

    return template;
  }

  private requireRevision(documentId: string, revisionId: string | null): OfficeDocumentRevision {
    if (!revisionId?.trim()) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DOCUMENT_REVISION_NOT_READY",
        detail: "当前文档没有可导出的修订版本"
      });
    }

    const revision = this.revisionRepository.findById(revisionId.trim());
    if (!revision || revision.documentId !== documentId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DOCUMENT_REVISION_NOT_FOUND",
        detail: "未找到对应文档修订"
      });
    }

    return revision;
  }
}

function parseOutputFormats(raw: string): OfficeDocumentExportFormat[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isOfficeDocumentExportFormat);
}

function isOfficeDocumentExportFormat(value: unknown): value is OfficeDocumentExportFormat {
  return value === "docx" || value === "pdf" || value === "md";
}

function parseDocumentExportTaskPayload(raw: string): {
  documentId: string;
  templateId: string;
  format: OfficeDocumentExportFormat;
  currentRevisionId: string | null;
} {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_EXPORT_TASK_INPUT",
      detail: "文档导出任务输入格式不合法"
    });
  }

  const record = parsed as Record<string, unknown>;
  const format = record.format;
  if (!isOfficeDocumentExportFormat(format)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_EXPORT_TASK_INPUT",
      detail: "文档导出格式不合法"
    });
  }

  const documentId = typeof record.documentId === "string" ? record.documentId.trim() : "";
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  const currentRevisionId = typeof record.currentRevisionId === "string"
    ? record.currentRevisionId.trim()
    : null;

  if (!documentId || !templateId) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_EXPORT_TASK_INPUT",
      detail: "文档导出任务缺少 documentId 或 templateId"
    });
  }

  return {
    documentId,
    templateId,
    format,
    currentRevisionId: currentRevisionId && currentRevisionId.length > 0 ? currentRevisionId : null
  };
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTemplateDefinition(
  schemaInput: unknown,
  mappingInput: unknown,
  outputFormats: OfficeDocumentExportFormat[]
): {
  schema: {
    requiredFields: string[];
    optionalFields: string[];
  };
  mapping: {
    title: string | null;
    summary: string | null;
    sections: string | null;
    references: string | null;
    annotations: string | null;
  };
  outputFormats: OfficeDocumentExportFormat[];
} {
  const schema = normalizeTemplateSchema(schemaInput);
  const mapping = normalizeTemplateMapping(mappingInput);
  validateTemplateMapping(schema, mapping);

  if (outputFormats.length === 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_TEMPLATE_FORMATS",
      detail: "模板至少要声明一种导出格式"
    });
  }

  return {
    schema,
    mapping,
    outputFormats
  };
}

function normalizeTemplateSchema(input: unknown): {
  requiredFields: string[];
  optionalFields: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_TEMPLATE_SCHEMA",
      detail: "模板 schema 格式不合法"
    });
  }

  const record = input as Record<string, unknown>;
  return {
    requiredFields: normalizeTemplateFieldArray(record.requiredFields),
    optionalFields: normalizeTemplateFieldArray(record.optionalFields)
  };
}

function normalizeTemplateMapping(input: unknown): {
  title: string | null;
  summary: string | null;
  sections: string | null;
  references: string | null;
  annotations: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_DOCUMENT_TEMPLATE_MAPPING",
      detail: "模板 mapping 格式不合法"
    });
  }

  const record = input as Record<string, unknown>;
  return {
    title: normalizeTemplateMappingPath(record.title),
    summary: normalizeTemplateMappingPath(record.summary),
    sections: normalizeTemplateMappingPath(record.sections),
    references: normalizeTemplateMappingPath(record.references),
    annotations: normalizeTemplateMappingPath(record.annotations)
  };
}

function normalizeTemplateFieldArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTemplateMappingPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateTemplateMapping(
  schema: { requiredFields: string[]; optionalFields: string[] },
  mapping: {
    title: string | null;
    summary: string | null;
    sections: string | null;
    references: string | null;
    annotations: string | null;
  }
): void {
  const requiredFields = new Set(schema.requiredFields);

  if (requiredFields.has("title") && !mapping.title) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING",
      detail: "模板 mapping 缺少 title"
    });
  }

  if (requiredFields.has("body") && !mapping.sections) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING",
      detail: "模板 mapping 缺少 sections"
    });
  }

  if (requiredFields.has("summary") && !mapping.summary) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING",
      detail: "模板 mapping 缺少 summary"
    });
  }

  if (requiredFields.has("references") && !mapping.references) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING",
      detail: "模板 mapping 缺少 references"
    });
  }

  if (requiredFields.has("annotations") && !mapping.annotations) {
    throw new AppError({
      statusCode: 400,
      errorCode: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING",
      detail: "模板 mapping 缺少 annotations"
    });
  }
}
