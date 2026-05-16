import type { FastifyReply, FastifyRequest } from "fastify";

import type { DocumentTemplateStatus, OfficeDocumentCommentStatus, OfficeDocumentExportFormat, OfficeDocumentStatus, OfficeRiskLevel } from "../../types/domain.js";
import { requireUserId } from "../preferences/common.js";
import { DocumentRuntimeService } from "./document-runtime-service.js";

interface DocumentListQuery {
  workspaceId?: string;
  status?: OfficeDocumentStatus;
  templateId?: string;
}

interface TemplateListQuery {
  status?: DocumentTemplateStatus;
}

interface DocumentParams {
  documentId: string;
}

interface TemplateParams {
  templateId: string;
}

interface DocumentCommentParams extends DocumentParams {
  commentId: string;
}

interface DocumentTaskParams {
  taskId: string;
}

interface CreateDocumentBody {
  workspaceId?: string | null;
  title?: string;
  templateId?: string;
  templateKey?: string;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
}

interface CreateDocumentTemplateBody {
  templateKey?: string;
  displayName?: string;
  templateVersion?: string;
  templateSourcePath?: string | null;
  schema?: unknown;
  mapping?: unknown;
  outputFormats?: OfficeDocumentExportFormat[];
  status?: DocumentTemplateStatus;
}

interface ImportDocumentTemplateFileBody {
  fileName?: string;
  fileContentBase64?: string;
}

interface UpdateDocumentTemplateBody {
  displayName?: string;
  templateSourcePath?: string | null;
  schema?: unknown;
  mapping?: unknown;
  outputFormats?: OfficeDocumentExportFormat[];
  status?: DocumentTemplateStatus;
}

interface UpdateDocumentBody {
  title?: string;
  templateId?: string;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
  status?: OfficeDocumentStatus;
}

interface CreateDocumentCommentBody {
  revisionId?: string | null;
  anchorType?: string;
  anchorKey?: string;
  body?: string;
}

interface ExportDocumentBody {
  workspaceId?: string | null;
  format?: OfficeDocumentExportFormat;
  riskLevel?: OfficeRiskLevel;
}

export class DocumentRuntimeController {
  constructor(private readonly documentRuntimeService: DocumentRuntimeService) {}

  readonly listTemplates = async (
    request: FastifyRequest<{ Querystring: TemplateListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.documentRuntimeService.listTemplates(request.query.status ?? "active")
    });
  };

  readonly getTemplate = async (
    request: FastifyRequest<{ Params: TemplateParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.getTemplate(request.params.templateId)
    );
  };

  readonly createTemplate = async (
    request: FastifyRequest<{ Body: CreateDocumentTemplateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send(
      this.documentRuntimeService.createTemplate({
        userId: requireUserId(request),
        templateKey: request.body.templateKey?.trim() ?? "",
        displayName: request.body.displayName?.trim() ?? "",
        templateVersion: request.body.templateVersion?.trim() ?? "",
        templateSourcePath: request.body.templateSourcePath,
        schema: request.body.schema,
        mapping: request.body.mapping,
        outputFormats: Array.isArray(request.body.outputFormats) ? request.body.outputFormats : [],
        status: request.body.status
      })
    );
  };

  readonly importTemplateFile = async (
    request: FastifyRequest<{ Body: ImportDocumentTemplateFileBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.status(201).send(
      this.documentRuntimeService.importTemplateFile({
        userId: requireUserId(request),
        fileName: request.body.fileName?.trim() ?? "",
        fileContentBase64: request.body.fileContentBase64?.trim() ?? ""
      })
    );
  };

  readonly updateTemplate = async (
    request: FastifyRequest<{ Params: TemplateParams; Body: UpdateDocumentTemplateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.updateTemplate({
        templateId: request.params.templateId,
        displayName: request.body.displayName,
        templateSourcePath: request.body.templateSourcePath,
        schema: request.body.schema,
        mapping: request.body.mapping,
        outputFormats: Array.isArray(request.body.outputFormats) ? request.body.outputFormats : undefined,
        status: request.body.status
      })
    );
  };

  readonly listDocuments = async (
    request: FastifyRequest<{ Querystring: DocumentListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.documentRuntimeService.listDocuments({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.query.workspaceId),
        status: request.query.status,
        templateId: request.query.templateId
      })
    });
  };

  readonly createDocument = async (
    request: FastifyRequest<{ Body: CreateDocumentBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.createDocument({
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.body.workspaceId),
        title: request.body.title?.trim() ?? "",
        templateId: request.body.templateId?.trim() ?? "",
        templateKey: request.body.templateKey?.trim() ?? "",
        content: request.body.content,
        outline: request.body.outline,
        summary: request.body.summary
      })
    );
  };

  readonly getDocument = async (
    request: FastifyRequest<{ Params: DocumentParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.getDocumentDetail(request.params.documentId, requireUserId(request))
    );
  };

  readonly updateDocument = async (
    request: FastifyRequest<{ Params: DocumentParams; Body: UpdateDocumentBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.updateDocument({
        documentId: request.params.documentId,
        userId: requireUserId(request),
        title: request.body.title,
        templateId: request.body.templateId,
        content: request.body.content,
        outline: request.body.outline,
        summary: request.body.summary,
        status: request.body.status
      })
    );
  };

  readonly createComment = async (
    request: FastifyRequest<{ Params: DocumentParams; Body: CreateDocumentCommentBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.createComment({
        documentId: request.params.documentId,
        userId: requireUserId(request),
        revisionId: request.body.revisionId,
        anchorType: request.body.anchorType?.trim() ?? "",
        anchorKey: request.body.anchorKey?.trim() ?? "",
        body: request.body.body?.trim() ?? ""
      })
    );
  };

  readonly resolveComment = async (
    request: FastifyRequest<{ Params: DocumentCommentParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.resolveComment({
        documentId: request.params.documentId,
        commentId: request.params.commentId,
        userId: requireUserId(request)
      })
    );
  };

  readonly exportDocument = async (
    request: FastifyRequest<{ Params: DocumentParams; Body: ExportDocumentBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.createExportTask({
        documentId: request.params.documentId,
        userId: requireUserId(request),
        workspaceId: normalizeOptionalText(request.body.workspaceId),
        format: request.body.format ?? "docx",
        riskLevel: request.body.riskLevel
      })
    );
  };

  readonly executeExportTask = async (
    request: FastifyRequest<{ Params: DocumentTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.documentRuntimeService.executeExportTask(
        request.params.taskId,
        requireUserId(request)
      )
    );
  };

  readonly getExportExecution = async (
    request: FastifyRequest<{ Params: DocumentTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      task: this.documentRuntimeService.getExportExecutionSnapshot(
        request.params.taskId,
        requireUserId(request)
      )
    });
  };

  readonly cancelExportExecution = async (
    request: FastifyRequest<{ Params: DocumentTaskParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.documentRuntimeService.cancelExportExecution(
        request.params.taskId,
        requireUserId(request)
      )
    );
  };
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
