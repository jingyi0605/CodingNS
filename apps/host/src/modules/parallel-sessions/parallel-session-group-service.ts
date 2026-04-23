import { AppError, isAppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ParallelSessionGroupRecord,
  ParallelSessionMemberRecord,
  ParallelSessionWorkspaceIsolationMode,
  SessionIsolatedWorkspaceRecord,
  SessionListItem
} from "../../types/domain.js";
import type { ParallelSessionGroupRepository } from "../../storage/repositories/parallel-session-group-repository.js";
import type { ParallelSessionMemberRepository } from "../../storage/repositories/parallel-session-member-repository.js";
import type { SessionIsolatedWorkspaceRepository } from "../../storage/repositories/session-isolated-workspace-repository.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type {
  CleanupSessionIsolatedWorkspaceResult,
  PromoteSessionIsolatedWorkspaceResult,
  SessionIsolatedWorkspaceService
} from "./session-isolated-workspace-service.js";

export interface ParallelSessionMemberInput {
  provider: string;
  model?: string | null;
  memberPrompt?: string | null;
  workspaceIsolationMode?: ParallelSessionWorkspaceIsolationMode;
}

export interface CreateParallelGroupFromSessionInput {
  sourceSessionId: string;
  sourceMessageId?: string | null;
  sharedPrompt: string;
  members: ParallelSessionMemberInput[];
  userId: string;
}

export interface CreateParallelGroupFromWorkspaceInput {
  workspaceId: string;
  sharedPrompt: string;
  members: ParallelSessionMemberInput[];
  userId: string;
}

export interface AppendParallelGroupMembersInput {
  groupId: string;
  members: ParallelSessionMemberInput[];
  userId: string;
}

export interface ParallelSessionMemberFailure {
  ordinal: number;
  provider: string;
  model: string | null;
  workspaceIsolationMode: ParallelSessionWorkspaceIsolationMode;
  errorCode: string;
  detail: string;
}

export interface ParallelSessionGroupMemberView {
  member: ParallelSessionMemberRecord;
  session: SessionListItem;
  sessionIsolatedWorkspace: SessionIsolatedWorkspaceRecord | null;
}

interface ParallelSessionMemberCreateResult {
  session: SessionListItem;
  sessionIsolatedWorkspace: SessionIsolatedWorkspaceRecord | null;
}

export interface ParallelSessionGroupDetail {
  group: ParallelSessionGroupRecord;
  members: ParallelSessionGroupMemberView[];
  memberFailures: ParallelSessionMemberFailure[];
}

type SessionDeletedObserverInput = Parameters<
  SessionHistoryService["registerSessionDeletedObserver"]
>[0] extends (input: infer T) => unknown ? T : never;

export class ParallelSessionGroupService {
  constructor(
    private readonly parallelSessionGroupRepository: ParallelSessionGroupRepository,
    private readonly parallelSessionMemberRepository: ParallelSessionMemberRepository,
    private readonly sessionIsolatedWorkspaceRepository: SessionIsolatedWorkspaceRepository,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "forkSession" | "deleteSession" | "registerSessionDeletedObserver"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "startLiveSession" | "sendLiveMessage"
    >,
    private readonly sessionIsolatedWorkspaceService: Pick<
      SessionIsolatedWorkspaceService,
      "createForMember" | "cleanupByOwnerSessionId" | "promote"
    >
  ) {
    this.sessionHistoryService.registerSessionDeletedObserver(async (input) => {
      await this.handleSessionDeleted(input);
    });
  }

  async createFromSession(input: CreateParallelGroupFromSessionInput): Promise<ParallelSessionGroupDetail> {
    const sharedPrompt = normalizeRequiredText(input.sharedPrompt, "sharedPrompt");
    const members = normalizeMembers(input.members, {
      minCount: 2,
      maxCount: 4,
      detail: "并行成员数量必须在 2 到 4 之间"
    });
    const sourceSession = this.sessionHistoryService.getSession(input.sourceSessionId, input.userId);
    const timestamp = nowIso();
    const group = this.parallelSessionGroupRepository.create({
      id: createId(),
      workspaceId: sourceSession.workspaceId,
      sourceType: "fork",
      sourceSessionId: sourceSession.sessionId,
      sourceMessageId: normalizeOptionalText(input.sourceMessageId),
      sharedPrompt,
      requestedCount: members.length,
      anchorSessionId: null,
      status: "active",
      createdByUserId: input.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });

    return await this.createMembers({
      group,
      members,
      userId: input.userId,
      startingOrdinal: 0,
      initialAnchorSessionId: null,
      deleteGroupWhenNoAnchor: true,
      createMember: async (member) => {
        if (member.workspaceIsolationMode === "temporary_worktree") {
          const created = await this.sessionIsolatedWorkspaceService.createForMember({
            groupId: group.id,
            sourceWorkspaceId: sourceSession.workspaceId,
            createSession: async (workspaceId) => {
              return await this.createForkedSessionMember({
                sourceSessionId: sourceSession.sessionId,
                sourceMessageId: group.sourceMessageId,
                provider: member.provider,
                model: member.model ?? null,
                sharedPrompt,
                memberPrompt: member.memberPrompt ?? null,
                targetWorkspaceId: workspaceId,
                userId: input.userId
              });
            }
          });

          return {
            session: created.session,
            sessionIsolatedWorkspace: created.record
          };
        }

        return {
          session: await this.createForkedSessionMember({
            sourceSessionId: sourceSession.sessionId,
            sourceMessageId: group.sourceMessageId,
            provider: member.provider,
            model: member.model ?? null,
            sharedPrompt,
            memberPrompt: member.memberPrompt ?? null,
            targetWorkspaceId: null,
            userId: input.userId
          }),
          sessionIsolatedWorkspace: null
        };
      }
    });
  }

  async createFromWorkspace(input: CreateParallelGroupFromWorkspaceInput): Promise<ParallelSessionGroupDetail> {
    const sharedPrompt = normalizeRequiredText(input.sharedPrompt, "sharedPrompt");
    const members = normalizeMembers(input.members, {
      minCount: 2,
      maxCount: 4,
      detail: "并行成员数量必须在 2 到 4 之间"
    });
    const timestamp = nowIso();
    const group = this.parallelSessionGroupRepository.create({
      id: createId(),
      workspaceId: normalizeRequiredText(input.workspaceId, "workspaceId"),
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt,
      requestedCount: members.length,
      anchorSessionId: null,
      status: "active",
      createdByUserId: input.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    });

    return await this.createMembers({
      group,
      members,
      userId: input.userId,
      startingOrdinal: 0,
      initialAnchorSessionId: null,
      deleteGroupWhenNoAnchor: true,
      createMember: async (member) => {
        if (member.workspaceIsolationMode === "temporary_worktree") {
          const created = await this.sessionIsolatedWorkspaceService.createForMember({
            groupId: group.id,
            sourceWorkspaceId: group.workspaceId,
            createSession: async (workspaceId) => {
              return await this.createRootSessionMember({
                workspaceId,
                provider: member.provider,
                model: member.model ?? null,
                sharedPrompt,
                memberPrompt: member.memberPrompt ?? null,
                userId: input.userId
              });
            }
          });

          return {
            session: created.session,
            sessionIsolatedWorkspace: created.record
          };
        }

        return {
          session: await this.createRootSessionMember({
            workspaceId: group.workspaceId,
            provider: member.provider,
            model: member.model ?? null,
            sharedPrompt,
            memberPrompt: member.memberPrompt ?? null,
            userId: input.userId
          }),
          sessionIsolatedWorkspace: null
        };
      }
    });
  }

  async appendMembers(input: AppendParallelGroupMembersInput): Promise<ParallelSessionGroupDetail> {
    const group = this.getGroupOrThrow(input.groupId);

    if (group.status !== "active") {
      throw new AppError({
        statusCode: 409,
        errorCode: "PARALLEL_GROUP_NOT_ACTIVE",
        detail: "当前并行会话组不可追加成员",
        field: "groupId"
      });
    }

    const sharedPrompt = normalizeRequiredText(group.sharedPrompt ?? "", "sharedPrompt");
    const allMembers = this.parallelSessionMemberRepository.listByGroupId(group.id);
    const activeMembers = allMembers.filter((member) => member.deletedAt === null);

    if (activeMembers.length === 0 || !group.anchorSessionId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PARALLEL_GROUP_INVALID_STATE",
        detail: "当前并行会话组状态异常，无法继续追加成员",
        field: "groupId"
      });
    }

    const availableSlots = 4 - activeMembers.length;
    const members = normalizeMembers(input.members, {
      minCount: 1,
      maxCount: availableSlots,
      detail:
        availableSlots > 0
          ? `本组最多还能追加 ${availableSlots} 个并行成员`
          : "当前并行会话组已满，不能继续追加成员"
    });
    const startingOrdinal = allMembers.reduce(
      (maxOrdinal, member) => Math.max(maxOrdinal, member.ordinal),
      -1
    ) + 1;
    const updatedGroup = this.parallelSessionGroupRepository.update({
      ...group,
      requestedCount: group.requestedCount + members.length,
      updatedAt: nowIso()
    }) ?? group;

    return await this.createMembers({
      group: updatedGroup,
      members,
      userId: input.userId,
      startingOrdinal,
      initialAnchorSessionId: updatedGroup.anchorSessionId,
      deleteGroupWhenNoAnchor: false,
      createMember: async (member) => {
        if (group.sourceType === "fork") {
          const sourceSessionId = normalizeRequiredText(group.sourceSessionId ?? "", "sourceSessionId");

          if (member.workspaceIsolationMode === "temporary_worktree") {
            const created = await this.sessionIsolatedWorkspaceService.createForMember({
              groupId: group.id,
              sourceWorkspaceId: group.workspaceId,
              createSession: async (workspaceId) => {
                return await this.createForkedSessionMember({
                  sourceSessionId,
                  sourceMessageId: group.sourceMessageId,
                  provider: member.provider,
                  model: member.model ?? null,
                  sharedPrompt,
                  memberPrompt: member.memberPrompt ?? null,
                  targetWorkspaceId: workspaceId,
                  userId: input.userId
                });
              }
            });

            return {
              session: created.session,
              sessionIsolatedWorkspace: created.record
            };
          }

          return {
            session: await this.createForkedSessionMember({
              sourceSessionId,
              sourceMessageId: group.sourceMessageId,
              provider: member.provider,
              model: member.model ?? null,
              sharedPrompt,
              memberPrompt: member.memberPrompt ?? null,
              targetWorkspaceId: null,
              userId: input.userId
            }),
            sessionIsolatedWorkspace: null
          };
        }

        if (member.workspaceIsolationMode === "temporary_worktree") {
          const created = await this.sessionIsolatedWorkspaceService.createForMember({
            groupId: group.id,
            sourceWorkspaceId: group.workspaceId,
            createSession: async (workspaceId) => {
              return await this.createRootSessionMember({
                workspaceId,
                provider: member.provider,
                model: member.model ?? null,
                sharedPrompt,
                memberPrompt: member.memberPrompt ?? null,
                userId: input.userId
              });
            }
          });

          return {
            session: created.session,
            sessionIsolatedWorkspace: created.record
          };
        }

        return {
          session: await this.createRootSessionMember({
            workspaceId: group.workspaceId,
            provider: member.provider,
            model: member.model ?? null,
            sharedPrompt,
            memberPrompt: member.memberPrompt ?? null,
            userId: input.userId
          }),
          sessionIsolatedWorkspace: null
        };
      }
    });
  }

  getGroup(groupId: string, userId: string): ParallelSessionGroupDetail {
    return this.buildGroupDetail(this.getGroupOrThrow(groupId), userId, []);
  }

  promoteSessionIsolatedWorkspace(workspaceRecordId: string): PromoteSessionIsolatedWorkspaceResult {
    return this.sessionIsolatedWorkspaceService.promote(workspaceRecordId);
  }

  async deleteGroup(groupId: string, userId: string): Promise<{
    group: ParallelSessionGroupRecord;
    deletedSessionIds: string[];
    failedSessionIds: Array<{ sessionId: string; detail: string }>;
    isolatedWorkspaceCleanupResults: CleanupSessionIsolatedWorkspaceResult[];
  }> {
    const group = this.getGroupOrThrow(groupId);
    const deletingGroup = this.parallelSessionGroupRepository.update({
      ...group,
      status: "deleting",
      updatedAt: nowIso()
    });

    if (!deletingGroup) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PARALLEL_GROUP_UPDATE_FAILED",
        detail: "更新并行组状态失败"
      });
    }

    const activeMembers = this.parallelSessionMemberRepository
      .listByGroupId(groupId)
      .filter((member) => member.deletedAt === null);
    const deletedSessionIds: string[] = [];
    const failedSessionIds: Array<{ sessionId: string; detail: string }> = [];
    const isolatedWorkspaceCleanupResults: CleanupSessionIsolatedWorkspaceResult[] = [];

    for (const member of activeMembers) {
      const isolatedWorkspaceId = member.temporaryWorkspaceId;

      try {
        await this.sessionHistoryService.deleteSession(member.sessionId, userId);
        deletedSessionIds.push(member.sessionId);
        if (isolatedWorkspaceId) {
          const isolatedWorkspace = this.sessionIsolatedWorkspaceRepository.findById(isolatedWorkspaceId);

          if (isolatedWorkspace) {
            isolatedWorkspaceCleanupResults.push({
              record: isolatedWorkspace,
              removed: isolatedWorkspace.lifecycleStatus === "removed",
              branchDeleted: false,
              deletedBranchName: null,
              detail:
                isolatedWorkspace.lifecycleStatus === "removed"
                  ? null
                  : isolatedWorkspace.lifecycleStatus === "promoted"
                    ? "临时工作区已升级为正式子工作区，删除整组时不会自动清理"
                    : "临时工作区清理未完成"
            });
          }
        }
      } catch (error) {
        failedSessionIds.push({
          sessionId: member.sessionId,
          detail: error instanceof Error ? error.message : "删除并行成员失败"
        });
      }
    }

    if (failedSessionIds.length > 0) {
      this.parallelSessionGroupRepository.update({
        ...deletingGroup,
        status: "active",
        updatedAt: nowIso()
      });
    }

    return {
      group: this.getGroupOrThrow(groupId),
      deletedSessionIds,
      failedSessionIds,
      isolatedWorkspaceCleanupResults
    };
  }

  async handleSessionDeleted(input: SessionDeletedObserverInput): Promise<void> {
    const member = this.parallelSessionMemberRepository.findBySessionId(input.sessionId);

    if (!member || member.deletedAt) {
      return;
    }

    try {
      await this.sessionIsolatedWorkspaceService.cleanupByOwnerSessionId(input.sessionId);
    } catch {
      // 单会话删除是旧主链路，不能因为并行临时工作区清理失败而阻断删除。
    }

    this.parallelSessionMemberRepository.update({
      ...member,
      deletedAt: nowIso(),
      updatedAt: nowIso()
    });

    await this.reselectAnchorIfNeeded(member.groupId, input.sessionId);
  }

  private async createMembers(input: {
    group: ParallelSessionGroupRecord;
    members: ParallelSessionMemberInput[];
    userId: string;
    startingOrdinal: number;
    initialAnchorSessionId: string | null;
    deleteGroupWhenNoAnchor: boolean;
    createMember: (
      member: ParallelSessionMemberInput,
      ordinal: number
    ) => Promise<ParallelSessionMemberCreateResult>;
  }): Promise<ParallelSessionGroupDetail> {
    const memberFailures: ParallelSessionMemberFailure[] = [];
    let currentGroup = input.group;
    let anchorSessionId: string | null = input.initialAnchorSessionId;

    for (const [ordinal, member] of input.members.entries()) {
      try {
        const createdMember = await input.createMember(member, ordinal);
        const session = createdMember.session;
        const role = anchorSessionId ? "member" : "anchor";
        const memberOrdinal = input.startingOrdinal + ordinal;

        this.parallelSessionMemberRepository.create({
          groupId: currentGroup.id,
          sessionId: session.sessionId,
          ordinal: memberOrdinal,
          role,
          provider: session.provider,
          model: member.model ?? null,
          memberPrompt: member.memberPrompt ?? null,
          workspaceIsolationMode: member.workspaceIsolationMode ?? "none",
          temporaryWorkspaceId: createdMember.sessionIsolatedWorkspace?.id ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          deletedAt: null
        });

        if (!anchorSessionId) {
          anchorSessionId = session.sessionId;
          currentGroup = this.parallelSessionGroupRepository.update({
            ...currentGroup,
            anchorSessionId,
            updatedAt: nowIso()
          }) ?? currentGroup;
        }
      } catch (error) {
        memberFailures.push({
          ordinal,
          provider: member.provider,
          model: member.model ?? null,
          workspaceIsolationMode: member.workspaceIsolationMode ?? "none",
          errorCode:
            isAppError(error) && typeof error.errorCode === "string"
              ? error.errorCode
              : "PARALLEL_MEMBER_CREATE_FAILED",
          detail: error instanceof Error ? error.message : "并行成员创建失败"
        });
      }
    }

    if (!anchorSessionId && input.deleteGroupWhenNoAnchor) {
      currentGroup = this.parallelSessionGroupRepository.update({
        ...currentGroup,
        status: "deleted",
        deletedAt: nowIso(),
        updatedAt: nowIso()
      }) ?? currentGroup;
    }

    return this.buildGroupDetail(currentGroup, input.userId, memberFailures);
  }

  private buildGroupDetail(
    group: ParallelSessionGroupRecord,
    userId: string,
    memberFailures: ParallelSessionMemberFailure[]
  ): ParallelSessionGroupDetail {
    const members = this.parallelSessionMemberRepository
      .listByGroupId(group.id)
      .filter((member) => member.deletedAt === null)
      .map((member) => ({
        member,
        session: this.sessionHistoryService.getSession(member.sessionId, userId),
        sessionIsolatedWorkspace:
          this.sessionIsolatedWorkspaceRepository.findByOwnerSessionId(member.sessionId)
      }));

    return {
      group,
      members,
      memberFailures
    };
  }

  private async reselectAnchorIfNeeded(groupId: string, deletedSessionId: string): Promise<void> {
    const group = this.parallelSessionGroupRepository.findById(groupId);

    if (!group) {
      return;
    }

    const remainingMembers = this.parallelSessionMemberRepository
      .listByGroupId(groupId)
      .filter((member) => member.deletedAt === null);

    if (remainingMembers.length === 0) {
      this.parallelSessionGroupRepository.update({
        ...group,
        anchorSessionId: null,
        status: "deleted",
        deletedAt: group.deletedAt ?? nowIso(),
        updatedAt: nowIso()
      });
      return;
    }

    const nextAnchorSessionId =
      group.anchorSessionId === deletedSessionId
        ? remainingMembers[0]?.sessionId ?? null
        : group.anchorSessionId;

    this.parallelSessionGroupRepository.update({
      ...group,
      anchorSessionId: nextAnchorSessionId,
      updatedAt: nowIso()
    });

    for (const member of remainingMembers) {
      const nextRole = member.sessionId === nextAnchorSessionId ? "anchor" : "member";

      if (member.role === nextRole) {
        continue;
      }

      this.parallelSessionMemberRepository.update({
        ...member,
        role: nextRole,
        updatedAt: nowIso()
      });
    }
  }

  private getGroupOrThrow(groupId: string): ParallelSessionGroupRecord {
    const group = this.parallelSessionGroupRepository.findById(groupId.trim());

    if (!group) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PARALLEL_GROUP_NOT_FOUND",
        detail: "并行会话组不存在",
        field: "groupId"
      });
    }

    return group;
  }

  private async createForkedSessionMember(input: {
    sourceSessionId: string;
    sourceMessageId: string | null;
    provider: string;
    model: string | null;
    sharedPrompt: string;
    memberPrompt: string | null;
    targetWorkspaceId: string | null;
    userId: string;
  }): Promise<SessionListItem> {
    let forkedSessionId: string | null = null;

    try {
      const forkedSession = await this.sessionHistoryService.forkSession({
        sessionId: input.sourceSessionId,
        userId: input.userId,
        sourceType: input.sourceMessageId ? "message" : "session",
        sourceMessageId: input.sourceMessageId,
        strategy: "auto",
        targetProvider: input.provider,
        targetWorkspaceId: input.targetWorkspaceId
      });
      forkedSessionId = forkedSession.sessionId;

      await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: forkedSession.sessionId,
        userId: input.userId,
        content: buildComposedPrompt(input.sharedPrompt, input.memberPrompt),
        clientRequestId: null,
        runtimeOptions: {
          model: input.model
        }
      });

      return this.sessionHistoryService.getSession(forkedSession.sessionId, input.userId);
    } catch (error) {
      if (forkedSessionId) {
        await this.sessionHistoryService.deleteSession(forkedSessionId, input.userId).catch(() => {
          return;
        });
      }

      throw error;
    }
  }

  private async createRootSessionMember(input: {
    workspaceId: string;
    provider: string;
    model: string | null;
    sharedPrompt: string;
    memberPrompt: string | null;
    userId: string;
  }): Promise<SessionListItem> {
    const startedSession = await this.sessionLiveRuntimeService.startLiveSession({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      content: buildComposedPrompt(input.sharedPrompt, input.memberPrompt),
      clientRequestId: null,
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      runtimeOptions: {
        model: input.model
      }
    });

    return (
      startedSession.session
      ?? this.sessionHistoryService.getSession(startedSession.sessionId, input.userId)
    );
  }
}

function normalizeMembers(
  members: readonly ParallelSessionMemberInput[],
  limits: {
    minCount: number;
    maxCount: number;
    detail: string;
  }
): ParallelSessionMemberInput[] {
  if (!Array.isArray(members) || members.length < limits.minCount || members.length > limits.maxCount) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: limits.detail,
      field: "members"
    });
  }

  return members.map((member, index) => ({
    provider: normalizeRequiredText(member.provider, `members[${index}].provider`),
    model: normalizeOptionalText(member.model),
    memberPrompt: normalizeOptionalText(member.memberPrompt),
    workspaceIsolationMode:
      member.workspaceIsolationMode === "temporary_worktree"
        ? "temporary_worktree"
        : "none"
  }));
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能为空`,
      field
    });
  }

  return normalized;
}

function normalizeOptionalText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildComposedPrompt(sharedPrompt: string, memberPrompt: string | null | undefined): string {
  return [sharedPrompt.trim(), normalizeOptionalText(memberPrompt)]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

export function buildParallelGroupColorToken(groupId: string): string {
  const paletteSize = 6;
  let hash = 0;

  for (const char of groupId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647;
  }

  return `parallel-group-${(hash % paletteSize) + 1}`;
}

export function resolveParallelDisplayParentSessionId(
  group: Pick<ParallelSessionGroupRecord, "sourceType" | "sourceSessionId" | "anchorSessionId">,
  member: Pick<ParallelSessionMemberRecord, "sessionId">
): string | null {
  if (group.sourceType === "fork") {
    if (member.sessionId === group.anchorSessionId) {
      return group.sourceSessionId ?? null;
    }

    return group.anchorSessionId ?? group.sourceSessionId ?? null;
  }

  if (member.sessionId === group.anchorSessionId) {
    return null;
  }

  return group.anchorSessionId ?? null;
}
