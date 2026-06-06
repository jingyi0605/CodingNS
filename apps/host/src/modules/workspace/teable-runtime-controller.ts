import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableRuntimeService, TeableRuntimeRecordWriteInput } from "./teable-runtime-service.js";

export class TeableRuntimeController {
  constructor(private readonly service: TeableRuntimeService) {}

  readonly listTables = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(await this.service.listTables(requireUserId(request)));
  };

  readonly listViews = async (
    request: FastifyRequest<{ Params: { tableId?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listViews(requireUserId(request), request.params.tableId?.trim() ?? ""));
  };

  readonly listFields = async (
    request: FastifyRequest<{ Params: { tableId?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listFields(requireUserId(request), request.params.tableId?.trim() ?? ""));
  };

  readonly listRecords = async (
    request: FastifyRequest<{ Params: { tableId?: string }; Querystring: RuntimeRecordsQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listRecords(requireUserId(request), request.params.tableId?.trim() ?? "", {
      viewId: request.query.viewId?.trim(),
      take: parseOptionalNumber(request.query.take),
      skip: parseOptionalNumber(request.query.skip),
      search: request.query.search?.trim()
    }));
  };

  readonly createRecord = async (
    request: FastifyRequest<{ Params: { tableId?: string }; Body: TeableRuntimeRecordWriteInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.createRecord(
      requireUserId(request),
      request.params.tableId?.trim() ?? "",
      request.body ?? {}
    ));
  };

  readonly updateRecord = async (
    request: FastifyRequest<{ Params: { tableId?: string; recordId?: string }; Body: TeableRuntimeRecordWriteInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.updateRecord(
      requireUserId(request),
      request.params.tableId?.trim() ?? "",
      request.params.recordId?.trim() ?? "",
      request.body ?? {}
    ));
  };

  readonly deleteRecords = async (
    request: FastifyRequest<{ Params: { tableId?: string }; Querystring: { recordIds?: string | string[] } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.deleteRecords(
      requireUserId(request),
      request.params.tableId?.trim() ?? "",
      normalizeRecordIds(request.query.recordIds)
    ));
  };

  readonly listLinkedRecordOptions = async (
    request: FastifyRequest<{ Params: { tableId?: string; fieldId?: string }; Querystring: RuntimeRecordsQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listLinkedRecordOptions(requireUserId(request), request.params.tableId?.trim() ?? "", request.params.fieldId?.trim() ?? "", {
      take: parseOptionalNumber(request.query.take),
      skip: parseOptionalNumber(request.query.skip),
      search: request.query.search?.trim()
    }));
  };
}

interface RuntimeRecordsQuery {
  viewId?: string;
  take?: string | number;
  skip?: string | number;
  search?: string;
}

function parseOptionalNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRecordIds(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}
