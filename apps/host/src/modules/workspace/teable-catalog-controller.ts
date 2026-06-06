import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableCatalogService, TeableCreateFieldInputDto } from "./teable-catalog-service.js";

export class TeableCatalogController {
  constructor(private readonly service: TeableCatalogService) {}

  readonly getTableCatalog = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listTables(requireUserId(request)));
  };

  readonly getTableFields = async (
    request: FastifyRequest<{ Querystring: { tableId?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.listFields(requireUserId(request), request.query.tableId?.trim() ?? ""));
  };

  readonly createTableFields = async (
    request: FastifyRequest<{ Body: { tableId?: string; fields?: TeableCreateFieldInputDto[] } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.service.createFields(
      requireUserId(request),
      request.body?.tableId?.trim() ?? "",
      request.body?.fields ?? []
    ));
  };
}
