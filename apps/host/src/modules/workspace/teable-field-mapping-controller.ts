import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { TeableSyncSourceType } from "../../types/domain.js";
import type { TeableFieldMappingService } from "./teable-field-mapping-service.js";

interface SaveTeableFieldMappingBody {
  items?: Array<{
    configId?: string;
    sourceType?: TeableSyncSourceType;
    targetTableId?: string;
    items?: Array<{
      sourceField?: string;
      targetFieldId?: string;
      targetFieldName?: string;
      required?: boolean;
    }>;
  }>;
}

export class TeableFieldMappingController {
  constructor(private readonly service: TeableFieldMappingService) {}

  readonly getMappings = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      mappings: this.service.listMappings(requireUserId(request)),
      sourceFieldsByType: {
        tags: this.service.listSourceFields("tags"),
        sessions: this.service.listSourceFields("sessions"),
        todos: this.service.listSourceFields("todos")
      }
    });
  };

  readonly saveMappings = async (
    request: FastifyRequest<{ Body: SaveTeableFieldMappingBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.service.saveMappings(
      requireUserId(request),
      Array.isArray(request.body.items) ? request.body.items.map((item) => ({
        configId: item.configId?.trim() ?? "",
        sourceType: item.sourceType ?? "tags",
        targetTableId: item.targetTableId?.trim() ?? "",
        items: Array.isArray(item.items) ? item.items.map((mapping) => ({
          sourceField: mapping.sourceField?.trim() ?? "",
          targetFieldId: mapping.targetFieldId?.trim() ?? "",
          targetFieldName: mapping.targetFieldName?.trim() ?? "",
          required: mapping.required === true
        })) : []
      })) : []
    ));
  };
}
