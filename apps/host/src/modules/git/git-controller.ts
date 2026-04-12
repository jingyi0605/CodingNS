import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import { requireUserId } from "../preferences/common.js";
import type { GitAuthInput } from "./git-auth.js";
import type { CommitOrchestrator } from "./commit-orchestrator.js";
import type { GitReadService } from "./git-read-service.js";
import type { GitWriteService } from "./git-write-service.js";
import type { CommitRuleLanguage } from "./types.js";

interface WorkspaceQuery {
  workspaceId?: string;
}

interface DiffQuery extends WorkspaceQuery {
  path?: string;
  staged?: string;
}

interface HistoryQuery extends WorkspaceQuery {
  cursor?: string;
  limit?: string;
}

interface BranchSwitchBody {
  workspaceId?: string;
  branchName?: string;
  create?: boolean;
}

interface TargetsBody {
  workspaceId?: string;
  targets?: string[];
}

interface CommitDraftBody {
  workspaceId?: string;
  mode?: "manual" | "ai";
}

interface CommitRuleBody {
  workspaceId?: string;
  name?: string;
  subjectPattern?: string;
  maxSubjectLength?: number;
  language?: CommitRuleLanguage;
  requireBody?: boolean;
  requireIssue?: boolean;
  issuePattern?: string | null;
}

interface CommitPayloadBody {
  workspaceId?: string;
  draft?: {
    subject?: string;
    body?: string | null;
    footer?: string | null;
    source?: "manual" | "ai";
  };
}

interface RemoteSyncBody {
  workspaceId?: string;
  action?: "fetch" | "pull" | "push" | "publish";
  remote?: string;
  auth?: GitAuthInput | null;
  remember?: boolean;
}

export class GitController {
  constructor(
    private readonly gitReadService: GitReadService,
    private readonly gitWriteService: GitWriteService,
    private readonly commitOrchestrator: CommitOrchestrator
  ) {}

  readonly getStatus = async (
    request: FastifyRequest<{ Querystring: WorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.gitReadService.getStatus(requireWorkspaceId(request.query.workspaceId)));
  };

  readonly getDiff = async (
    request: FastifyRequest<{ Querystring: DiffQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.query.workspaceId);
    const targetPath = request.query.path?.trim();

    if (!targetPath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查看 diff 必须提供文件路径",
        field: "path"
      });
    }

    reply.send(
      await this.gitReadService.getDiff(
        workspaceId,
        targetPath,
        request.query.staged === "true"
      )
    );
  };

  readonly stage = async (
    request: FastifyRequest<{ Body: TargetsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitWriteService.stage(
        requireWorkspaceId(request.body.workspaceId),
        request.body.targets ?? []
      )
    );
  };

  readonly unstage = async (
    request: FastifyRequest<{ Body: TargetsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitWriteService.unstage(
        requireWorkspaceId(request.body.workspaceId),
        request.body.targets ?? []
      )
    );
  };

  readonly discard = async (
    request: FastifyRequest<{ Body: TargetsBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitWriteService.discard(
        requireWorkspaceId(request.body.workspaceId),
        request.body.targets ?? []
      )
    );
  };

  readonly getRules = async (
    request: FastifyRequest<{ Querystring: WorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.commitOrchestrator.getRuleProfile(requireWorkspaceId(request.query.workspaceId)));
  };

  readonly saveRules = async (
    request: FastifyRequest<{ Body: CommitRuleBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.body.workspaceId);
    const maxSubjectLength = Number(request.body.maxSubjectLength ?? 72);

    if (!request.body.name?.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "规则名称不能为空",
        field: "name"
      });
    }

    if (!request.body.subjectPattern?.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "提交标题规则不能为空",
        field: "subjectPattern"
      });
    }

    if (!Number.isFinite(maxSubjectLength) || maxSubjectLength <= 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "提交标题最大长度必须是正整数",
        field: "maxSubjectLength"
      });
    }

    reply.send(
      this.commitOrchestrator.saveRuleProfile(workspaceId, {
        name: request.body.name,
        subjectPattern: request.body.subjectPattern,
        maxSubjectLength,
        language: request.body.language ?? "zh",
        requireBody: request.body.requireBody ?? false,
        requireIssue: request.body.requireIssue ?? false,
        issuePattern: request.body.issuePattern ?? null
      })
    );
  };

  readonly createCommitDraft = async (
    request: FastifyRequest<{ Body: CommitDraftBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = requireWorkspaceId(request.body.workspaceId);

    reply.send(await this.commitOrchestrator.createDraft(workspaceId, request.body.mode ?? "manual"));
  };

  readonly validateCommit = async (
    request: FastifyRequest<{ Body: CommitPayloadBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.commitOrchestrator.validate(
        requireWorkspaceId(request.body.workspaceId),
        requireDraft(request.body.draft)
      )
    );
  };

  readonly commit = async (
    request: FastifyRequest<{ Body: CommitPayloadBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.commitOrchestrator.commit(
        requireWorkspaceId(request.body.workspaceId),
        requireDraft(request.body.draft)
      )
    );
  };

  readonly getHistory = async (
    request: FastifyRequest<{ Querystring: HistoryQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitReadService.getHistory(
        requireWorkspaceId(request.query.workspaceId),
        request.query.cursor ?? null,
        Number(request.query.limit ?? "20")
      )
    );
  };

  readonly getBranches = async (
    request: FastifyRequest<{ Querystring: WorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.gitReadService.getBranches(requireWorkspaceId(request.query.workspaceId)));
  };

  readonly switchBranch = async (
    request: FastifyRequest<{ Body: BranchSwitchBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitWriteService.switchBranch(
        requireWorkspaceId(request.body.workspaceId),
        request.body.branchName?.trim() ?? "",
        request.body.create ?? false
      )
    );
  };

  readonly getRemotes = async (
    request: FastifyRequest<{ Querystring: WorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.gitReadService.getRemotes(requireWorkspaceId(request.query.workspaceId)));
  };

  readonly syncRemote = async (
    request: FastifyRequest<{ Body: RemoteSyncBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const action = request.body.action;

    if (!action) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "远程同步必须提供动作类型",
        field: "action"
      });
    }

    reply.send(
      await this.gitWriteService.syncRemote(
        requireWorkspaceId(request.body.workspaceId),
        action,
        request.body.remote,
        request.body.auth,
        request.body.remember === true,
        requireUserId(request)
      )
    );
  };

  readonly undoLastCommit = async (
    request: FastifyRequest<{ Body: WorkspaceQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.gitWriteService.undoLastCommit(requireWorkspaceId(request.body.workspaceId))
    );
  };
}

function requireWorkspaceId(workspaceId?: string): string {
  const value = workspaceId?.trim();

  if (!value) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "Git 请求必须提供 workspaceId",
      field: "workspaceId"
    });
  }

  return value;
}

function requireDraft(draft?: CommitPayloadBody["draft"]) {
  const subject = draft?.subject?.trim();

  if (!subject) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "提交草稿必须包含标题",
      field: "subject"
    });
  }

  return {
    subject,
    body: draft?.body?.trim() || null,
    footer: draft?.footer?.trim() || null,
    source: draft?.source ?? "manual"
  };
}
