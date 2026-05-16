import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type {
  AddManagedSkillInput,
  AddManagedSkillFromMarkdownInput,
  ImportUnmanagedSkillInput,
  ScanSkillsOptions,
  SyncManagedSkillInput
} from "./skill-manager-service.js";
import { SkillManagerService } from "./skill-manager-service.js";

interface SkillOverviewQuery {
  targetCli?: string | string[];
}

interface WorkspaceSessionMcpStatusQuery {
  workspaceId?: string;
  sessionId?: string;
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
    request: FastifyRequest<{ Body: AddManagedSkillInput | AddManagedSkillFromMarkdownInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    const body = request.body;

    if (isMarkdownSkillInput(body)) {
      reply.send(this.skillManagerService.addManagedSkillFromMarkdown(body));
      return;
    }

    reply.send(this.skillManagerService.addManagedSkill(body ?? { sourcePath: "", targetCli: [], sourceType: "local-import" }));
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

  readonly getWorkspaceSessionMcpStatus = async (
    request: FastifyRequest<{ Querystring: WorkspaceSessionMcpStatusQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    reply.send(this.skillManagerService.getWorkspaceSessionMcpStatus({
      workspaceId: request.query.workspaceId ?? "",
      sessionId: request.query.sessionId ?? null
    }));
  };
}

function isMarkdownSkillInput(
  input: AddManagedSkillInput | AddManagedSkillFromMarkdownInput | undefined
): input is AddManagedSkillFromMarkdownInput {
  return Boolean(input && "markdownContent" in input && typeof input.markdownContent === "string");
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
