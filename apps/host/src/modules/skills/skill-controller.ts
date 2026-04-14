import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  AddManagedSkillInput,
  ImportUnmanagedSkillInput,
  ScanSkillsOptions,
  SyncManagedSkillInput
} from "./skill-manager-service.js";
import { SkillManagerService } from "./skill-manager-service.js";

interface SkillOverviewQuery {
  targetCli?: string | string[];
}

export class SkillController {
  constructor(private readonly skillManagerService: SkillManagerService) {}

  readonly getOverview = async (
    request: FastifyRequest<{ Querystring: SkillOverviewQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.skillManagerService.getOverview(normalizeTargetCliQuery(request.query)));
  };

  readonly add = async (
    request: FastifyRequest<{ Body: AddManagedSkillInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.skillManagerService.addManagedSkill(request.body ?? { sourcePath: "", targetCli: [], sourceType: "local-import" }));
  };

  readonly import = async (
    request: FastifyRequest<{ Body: ImportUnmanagedSkillInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.skillManagerService.importUnmanagedSkill(request.body ?? { targetCli: "codex", directoryPath: "" }));
  };

  readonly sync = async (
    request: FastifyRequest<{ Body: SyncManagedSkillInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.skillManagerService.syncManagedSkill(request.body ?? { skillId: "", targetCli: [] }));
  };
}

function normalizeTargetCliQuery(query: SkillOverviewQuery | undefined): ScanSkillsOptions {
  if (!query?.targetCli) {
    return {};
  }

  const targetCli = Array.isArray(query.targetCli)
    ? query.targetCli
    : query.targetCli.split(",").map((item) => item.trim()).filter(Boolean);

  return {
    targetCli: targetCli as ScanSkillsOptions["targetCli"]
  };
}
