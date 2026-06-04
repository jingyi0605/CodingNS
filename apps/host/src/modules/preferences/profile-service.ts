import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  DebugPortPoolConfig,
  DebugPortPoolRole,
  PreferenceProviderId,
  UserPreferenceAffairsDashboardStatesByWorkspace,
  UserPreferenceLanguage,
  UserPreferencePermissionMode,
  UserPreferenceProfile,
  UserPreferenceProfileRecord,
  UserPreferenceProviderProfile,
  UserPreferenceProviders,
  UserPreferenceTheme
} from "../../types/domain.js";
import type { UserPreferenceProfileRepository } from "../../storage/repositories/user-preference-profile-repository.js";

const SUPPORTED_LANGUAGES: UserPreferenceLanguage[] = ["zh-CN", "en-US"];
const SUPPORTED_THEMES: UserPreferenceTheme[] = ["light", "dark", "sky-blue", "eye-green"];
const SUPPORTED_PERMISSION_MODES: UserPreferencePermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions"
];
const SUPPORTED_REASONING_LEVELS = new Set(["low", "medium", "high", "xhigh"]);
const PROVIDER_IDS: PreferenceProviderId[] = [
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "kimi"
];

const DEFAULT_LANGUAGE: UserPreferenceLanguage = "zh-CN";
const DEFAULT_THEME: UserPreferenceTheme = "light";
const DEFAULT_PERMISSION_MODE: UserPreferencePermissionMode = "default";
export const DEFAULT_DEBUG_PORT_POOLS: DebugPortPoolConfig = {
  start: 43000,
  end: 47999
};
const LEGACY_DEBUG_PORT_POOL_ROLES: DebugPortPoolRole[] = [
  "frontend",
  "backend",
  "worker",
  "mock",
  "custom"
];
const DEFAULT_PROVIDER_PROFILE: UserPreferenceProviderProfile = {
  defaultModel: null,
  defaultReasoningLevel: null
};

interface ProviderPreferencePatch {
  defaultModel?: string | null;
  defaultReasoningLevel?: string | null;
}

export interface PreferenceProfilePatchInput {
  language?: string;
  theme?: string;
  autoTheme?: boolean;
  defaultPermissionMode?: string;
  providers?: unknown;
  debugPortPools?: unknown;
  affairsDashboardStatesByWorkspace?: unknown;
}

type PreferenceProvidersPatch = Partial<Record<PreferenceProviderId, ProviderPreferencePatch>>;

export interface PreferenceProfileView extends UserPreferenceProfile {
  updatedAt: string | null;
}

export class PreferenceProfileService {
  constructor(private readonly repository: UserPreferenceProfileRepository) {}

  getProfile(userId: string): PreferenceProfileView {
    const record = this.repository.findByUserId(userId);

    if (!record) {
      return createDefaultProfileView();
    }

    return toProfileView(record);
  }

  updateProfile(userId: string, input: PreferenceProfilePatchInput): PreferenceProfileView {
    const record = this.repository.findByUserId(userId);
    const baseProfile = record ? toProfile(record) : createDefaultProfile();
    const providersPatch = normalizeProvidersPatch(input.providers);

    const nextProfile: UserPreferenceProfile = {
      language:
        input.language !== undefined ? normalizeLanguage(input.language) : baseProfile.language,
      theme: input.theme !== undefined ? normalizeTheme(input.theme) : baseProfile.theme,
      autoTheme:
        input.autoTheme !== undefined ? normalizeAutoTheme(input.autoTheme) : baseProfile.autoTheme,
      defaultPermissionMode:
        input.defaultPermissionMode !== undefined
          ? normalizePermissionMode(input.defaultPermissionMode)
          : baseProfile.defaultPermissionMode,
      providers: mergeProviders(baseProfile.providers, providersPatch),
      debugPortPools:
        input.debugPortPools !== undefined
          ? normalizeDebugPortPools(input.debugPortPools)
          : baseProfile.debugPortPools,
      affairsDashboardStatesByWorkspace:
        input.affairsDashboardStatesByWorkspace !== undefined
          ? normalizeAffairsDashboardStatesByWorkspace(input.affairsDashboardStatesByWorkspace)
          : baseProfile.affairsDashboardStatesByWorkspace
    };

    const timestamp = nowIso();
    const nextRecord: UserPreferenceProfileRecord = {
      userId,
      ...nextProfile,
      createdAt: record?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.repository.upsert(nextRecord);
    return toProfileView(nextRecord);
  }
}

function toProfile(record: UserPreferenceProfileRecord): UserPreferenceProfile {
  return {
    language: record.language,
    theme: record.theme,
    autoTheme: record.autoTheme,
    defaultPermissionMode: record.defaultPermissionMode,
    providers: buildProvidersRecord(record.providers),
    debugPortPools: normalizeDebugPortPools(record.debugPortPools),
    affairsDashboardStatesByWorkspace: normalizeAffairsDashboardStatesByWorkspace(
      record.affairsDashboardStatesByWorkspace
    )
  };
}

function toProfileView(record: UserPreferenceProfileRecord): PreferenceProfileView {
  return {
    ...toProfile(record),
    updatedAt: record.updatedAt
  };
}

function createDefaultProfile(): UserPreferenceProfile {
  return {
    language: DEFAULT_LANGUAGE,
    theme: DEFAULT_THEME,
    autoTheme: false,
    defaultPermissionMode: DEFAULT_PERMISSION_MODE,
    providers: buildProvidersRecord(),
    debugPortPools: cloneDebugPortPools(DEFAULT_DEBUG_PORT_POOLS),
    affairsDashboardStatesByWorkspace: {}
  };
}

function createDefaultProfileView(): PreferenceProfileView {
  return {
    ...createDefaultProfile(),
    updatedAt: null
  };
}

function buildProvidersRecord(source?: UserPreferenceProviders): UserPreferenceProviders {
  const result: UserPreferenceProviders = {} as UserPreferenceProviders;

  for (const providerId of PROVIDER_IDS) {
    const sourceEntry = source?.[providerId];

    result[providerId] = {
      defaultModel: sourceEntry?.defaultModel ?? DEFAULT_PROVIDER_PROFILE.defaultModel,
      defaultReasoningLevel:
        sourceEntry?.defaultReasoningLevel ?? DEFAULT_PROVIDER_PROFILE.defaultReasoningLevel
    };
  }

  return result;
}

function normalizeProvidersPatch(input: unknown): PreferenceProvidersPatch | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input !== "object" || input === null) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "providers 必须是对象",
      field: "providers"
    });
  }

  const patch: PreferenceProvidersPatch = {};
  let hasEntries = false;

  for (const [key, value] of Object.entries(input)) {
    if (!PROVIDER_IDS.includes(key as PreferenceProviderId)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "providers 只允许 claude-code、codex、opencode、gemini、kimi",
        field: "providers"
      });
    }

    if (typeof value !== "object" || value === null) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: `providers.${key} 必须是对象`,
        field: `providers.${key}`
      });
    }

    patch[key as PreferenceProviderId] = value as ProviderPreferencePatch;
    hasEntries = true;
  }

  return hasEntries ? patch : {};
}

function mergeProviders(
  current: UserPreferenceProviders,
  patch?: PreferenceProvidersPatch
): UserPreferenceProviders {
  const result: UserPreferenceProviders = {} as UserPreferenceProviders;

  for (const providerId of PROVIDER_IDS) {
    const previous = current[providerId] ?? DEFAULT_PROVIDER_PROFILE;
    const patchEntry = patch?.[providerId];
    let nextModel = previous.defaultModel;
    let nextReasoningLevel = previous.defaultReasoningLevel;

    if (patchEntry && Object.prototype.hasOwnProperty.call(patchEntry, "defaultModel")) {
      nextModel = normalizeProviderModel(patchEntry.defaultModel, providerId);
    }

    if (patchEntry && Object.prototype.hasOwnProperty.call(patchEntry, "defaultReasoningLevel")) {
      nextReasoningLevel = normalizeProviderReasoningLevel(
        patchEntry.defaultReasoningLevel,
        providerId
      );
    }

    result[providerId] = {
      defaultModel: nextModel,
      defaultReasoningLevel: nextReasoningLevel
    };
  }

  return result;
}

function normalizeDebugPortPools(input: unknown): DebugPortPoolConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidField("debugPortPools", "debugPortPools 必须是对象");
  }

  const directRange = tryNormalizePortPoolRange(input, "debugPortPools");

  if (directRange) {
    return directRange;
  }

  return normalizeLegacyDebugPortPools(input);
}

function normalizePortPoolBound(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw invalidField(field, `${field} 必须是整数`);
  }

  const port = Number(value);

  if (port < 1024 || port > 65535) {
    throw invalidField(field, `${field} 必须在 1024 到 65535 之间`);
  }

  return port;
}

function tryNormalizePortPoolRange(
  input: unknown,
  field: string
): DebugPortPoolConfig | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;

  if (
    !Object.prototype.hasOwnProperty.call(record, "start")
    && !Object.prototype.hasOwnProperty.call(record, "end")
  ) {
    return null;
  }

  const start = normalizePortPoolBound(record.start, `${field}.start`);
  const end = normalizePortPoolBound(record.end, `${field}.end`);

  if (start >= end) {
    throw invalidField(field, `${field} 的 start 必须小于 end`);
  }

  return { start, end };
}

function normalizeLegacyDebugPortPools(input: unknown): DebugPortPoolConfig {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const role of LEGACY_DEBUG_PORT_POOL_ROLES) {
    const range = tryNormalizePortPoolRange(
      (input as Record<string, unknown>)[role],
      `debugPortPools.${role}`
    );

    if (!range) {
      throw invalidField(`debugPortPools.${role}`, `${role} 端口池必须提供 start 和 end`);
    }

    start = Math.min(start, range.start);
    end = Math.max(end, range.end);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw invalidField("debugPortPools", "debugPortPools 必须提供合法的端口范围");
  }

  return { start, end };
}

function cloneDebugPortPools(config: DebugPortPoolConfig): DebugPortPoolConfig {
  return { ...config };
}

function normalizeAffairsDashboardStatesByWorkspace(
  input: unknown
): UserPreferenceAffairsDashboardStatesByWorkspace {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidField(
      "affairsDashboardStatesByWorkspace",
      "affairsDashboardStatesByWorkspace 必须是对象"
    );
  }

  const result: UserPreferenceAffairsDashboardStatesByWorkspace = {};

  for (const [workspaceId, rawState] of Object.entries(input)) {
    const normalizedWorkspaceId = workspaceId.trim();

    if (!normalizedWorkspaceId) {
      throw invalidField(
        "affairsDashboardStatesByWorkspace",
        "affairsDashboardStatesByWorkspace 的工作区 ID 不能为空"
      );
    }

    if (typeof rawState !== "object" || rawState === null || Array.isArray(rawState)) {
      throw invalidField(
        `affairsDashboardStatesByWorkspace.${normalizedWorkspaceId}`,
        "工作台状态必须是对象"
      );
    }

    result[normalizedWorkspaceId] = {
      ...rawState
    };
  }

  return result;
}

function normalizeLanguage(value: unknown): UserPreferenceLanguage {
  if (typeof value !== "string") {
    throw invalidField("language", "language 只允许为 zh-CN 或 en-US");
  }

  const normalized = value.trim();

  if (!SUPPORTED_LANGUAGES.includes(normalized as UserPreferenceLanguage)) {
    throw invalidField("language", "language 只允许为 zh-CN 或 en-US");
  }

  return normalized as UserPreferenceLanguage;
}

function normalizeTheme(value: unknown): UserPreferenceTheme {
  if (typeof value !== "string") {
    throw invalidField("theme", "theme 只允许为 light、dark、sky-blue 或 eye-green");
  }

  const normalized = value.trim();

  if (!SUPPORTED_THEMES.includes(normalized as UserPreferenceTheme)) {
    throw invalidField("theme", "theme 只允许为 light、dark、sky-blue 或 eye-green");
  }

  return normalized as UserPreferenceTheme;
}

function normalizeAutoTheme(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw invalidField("autoTheme", "autoTheme 只允许为 boolean");
  }

  return value;
}

function normalizePermissionMode(value: unknown): UserPreferencePermissionMode {
  if (typeof value !== "string") {
    throw invalidField(
      "defaultPermissionMode",
      "defaultPermissionMode 只允许为 default、acceptEdits 或 bypassPermissions"
    );
  }

  const normalized = value.trim();

  if (!SUPPORTED_PERMISSION_MODES.includes(normalized as UserPreferencePermissionMode)) {
    throw invalidField(
      "defaultPermissionMode",
      "defaultPermissionMode 只允许为 default、acceptEdits 或 bypassPermissions"
    );
  }

  return normalized as UserPreferencePermissionMode;
}

function normalizeProviderModel(
  value: unknown,
  providerId: PreferenceProviderId
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidField(
      `providers.${providerId}.defaultModel`,
      `providers.${providerId}.defaultModel 只允许为字符串或 null`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw invalidField(
      `providers.${providerId}.defaultModel`,
      `providers.${providerId}.defaultModel 不能为空`
    );
  }

  return normalized;
}

function normalizeProviderReasoningLevel(
  value: unknown,
  providerId: PreferenceProviderId
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidField(
      `providers.${providerId}.defaultReasoningLevel`,
      `providers.${providerId}.defaultReasoningLevel 只允许为字符串或 null`
    );
  }

  const normalized = value.trim();

  if (!SUPPORTED_REASONING_LEVELS.has(normalized)) {
    throw invalidField(
      `providers.${providerId}.defaultReasoningLevel`,
      `providers.${providerId}.defaultReasoningLevel 只允许为 low、medium、high 或 xhigh`
    );
  }

  return normalized;
}

function invalidField(field: string, detail: string): AppError {
  return new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail,
    field
  });
}
