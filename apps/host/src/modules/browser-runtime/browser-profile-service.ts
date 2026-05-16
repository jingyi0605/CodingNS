import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { BrowserProfileRepository } from "../../storage/repositories/browser-profile-repository.js";
import type { BrowserEngine, BrowserProfile, BrowserProfileMode, BrowserProfileOwnershipScope } from "../../types/domain.js";

export interface CreateBrowserProfileInput {
  userId: string;
  workspaceId?: string | null;
  engine: BrowserEngine;
  mode?: BrowserProfileMode;
  displayName?: string | null;
  ownershipScope?: BrowserProfileOwnershipScope;
  cdpEndpoint?: string | null;
}

export interface UpdateBrowserProfileInput {
  userId: string;
  profileId: string;
  ownershipScope?: BrowserProfileOwnershipScope;
}

export class BrowserProfileService {
  private readonly browserProfileRoot: string;

  constructor(
    private readonly repository: BrowserProfileRepository,
    databasePath: string
  ) {
    this.browserProfileRoot = path.resolve(path.dirname(databasePath), "browser-profiles");
  }

  listProfiles(userId: string, workspaceId?: string | null): BrowserProfile[] {
    return this.repository.list({
      userId,
      workspaceId: workspaceId === undefined ? undefined : workspaceId
    });
  }

  getProfile(profileId: string, userId: string): BrowserProfile {
    const profile = this.repository.findById(profileId.trim());
    if (!profile || profile.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BROWSER_PROFILE_NOT_FOUND",
        detail: "未找到对应浏览器 Profile"
      });
    }

    return profile;
  }

  createProfile(input: CreateBrowserProfileInput): BrowserProfile {
    const timestamp = nowIso();
    const id = createId();
    const mode = input.mode ?? "persistent";
    const ownershipScope = input.ownershipScope ?? (input.workspaceId ? "workspace" : "user");
    const displayName = input.displayName?.trim() || buildDefaultDisplayName(input.engine, mode);

    if (mode === "cdp_attached" && !input.cdpEndpoint?.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "BROWSER_CDP_ENDPOINT_REQUIRED",
        detail: "CDP 接管模式必须提供 endpoint",
        field: "cdpEndpoint"
      });
    }

    const profile: BrowserProfile = {
      id,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      engine: input.engine,
      mode,
      displayName,
      userDataDir: mode === "persistent" ? path.join(this.browserProfileRoot, id) : null,
      cdpEndpoint: mode === "cdp_attached" ? input.cdpEndpoint?.trim() ?? null : null,
      ownershipScope,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return this.repository.create(profile);
  }

  updateProfile(input: UpdateBrowserProfileInput): BrowserProfile {
    const profile = this.getProfile(input.profileId, input.userId);
    const nextOwnershipScope = input.ownershipScope ?? profile.ownershipScope;

    if (nextOwnershipScope === "workspace" && !profile.workspaceId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BROWSER_PROFILE_WORKSPACE_SCOPE_NOT_ALLOWED",
        detail: "未绑定工作区的浏览器 Profile 不能切回工作区范围"
      });
    }

    const nextProfile: BrowserProfile = {
      ...profile,
      ownershipScope: nextOwnershipScope,
      updatedAt: nowIso()
    };

    return this.repository.update(nextProfile);
  }

  deleteProfile(profileId: string, userId: string): void {
    const profile = this.getProfile(profileId, userId);
    this.repository.deleteById(profile.id);
  }
}

function buildDefaultDisplayName(engine: BrowserEngine, mode: BrowserProfileMode): string {
  const engineName = engine === "chrome" ? "Chrome" : "Edge";
  return mode === "cdp_attached" ? `${engineName} 接管 Profile` : `${engineName} 独立 Profile`;
}
