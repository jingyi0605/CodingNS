import { AppError } from "../../shared/errors/app-error.js";
import type { ButlerFollowUpService, ButlerFollowUpTaskView } from "./butler-follow-up-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type { ButlerProjectSessionView, ButlerSessionService } from "./butler-session-service.js";

const ACTION_CONTEXT_CACHE_TTL_MS = 15_000;

export interface ButlerSessionActionContextProjectView {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  lifecycleStatus: "active" | "paused" | "archived";
  riskLevel: "low" | "medium" | "high";
}

export interface ButlerSessionActionContextView {
  workspaceId: string;
  project: ButlerSessionActionContextProjectView;
  session: ButlerProjectSessionView;
  latestFollowUpTask: ButlerFollowUpTaskView | null;
}

interface ButlerSessionActionContextCacheEntry {
  value: ButlerSessionActionContextView | null;
  promise: Promise<ButlerSessionActionContextView> | null;
  updatedAt: number;
}

export class ButlerActionContextService {
  private readonly cache = new Map<string, ButlerSessionActionContextCacheEntry>();

  constructor(
    private readonly butlerProjectService: Pick<ButlerProjectService, "resolveWorkspaceActionProject">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "getSessionWorkspaceId" | "resolveActionTarget"
    >,
    private readonly butlerFollowUpService: Pick<ButlerFollowUpService, "listTasks">
  ) {}

  async getSessionActionContext(
    sessionId: string,
    userId: string,
    options: {
      force?: boolean;
    } = {}
  ): Promise<ButlerSessionActionContextView> {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const cacheKey = buildCacheKey(userId, normalizedSessionId);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (!options.force && cached) {
      if (cached.promise) {
        return cached.promise;
      }

      if (cached.value && now - cached.updatedAt < ACTION_CONTEXT_CACHE_TTL_MS) {
        return cached.value;
      }
    }

    const promise = this.buildSessionActionContext(normalizedSessionId, userId)
      .then((context) => {
        this.cache.set(cacheKey, {
          value: context,
          promise: null,
          updatedAt: Date.now()
        });
        return context;
      })
      .catch((error) => {
        const latest = this.cache.get(cacheKey);

        if (latest?.promise === promise) {
          if (latest.value) {
            this.cache.set(cacheKey, {
              value: latest.value,
              promise: null,
              updatedAt: latest.updatedAt
            });
          } else {
            this.cache.delete(cacheKey);
          }
        }

        throw error;
      });

    this.cache.set(cacheKey, {
      value: cached?.value ?? null,
      promise,
      updatedAt: cached?.updatedAt ?? 0
    });

    return promise;
  }

  preloadSessionActionContext(sessionId: string, userId: string): void {
    void this.getSessionActionContext(sessionId, userId).catch(() => undefined);
  }

  invalidateSessionActionContext(sessionId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);

    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.endsWith(`:${normalizedSessionId}`)) {
        this.cache.delete(cacheKey);
      }
    }
  }

  private async buildSessionActionContext(
    sessionId: string,
    userId: string
  ): Promise<ButlerSessionActionContextView> {
    // 这里故意先按 workspace 解析项目，再走原来的 target 逻辑，避免改坏现有会话归属判断。
    const workspaceId = this.butlerSessionService.getSessionWorkspaceId(sessionId);
    const project = this.butlerProjectService.resolveWorkspaceActionProject(workspaceId);
    const target = await this.butlerSessionService.resolveActionTarget(project.id, sessionId, userId);
    const latestFollowUpTask = this.butlerFollowUpService.listTasks({
      sessionId,
      limit: 1
    })[0] ?? null;

    return {
      workspaceId: target.workspaceId,
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        repoRoot: project.repoRoot,
        lifecycleStatus: project.lifecycleStatus,
        riskLevel: project.riskLevel
      },
      session: target.session,
      latestFollowUpTask
    };
  }
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "sessionId 不能为空",
      field: "sessionId"
    });
  }

  return normalized;
}

function buildCacheKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}
