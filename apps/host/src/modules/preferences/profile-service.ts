import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  PreferenceProviderId,
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
const PROVIDER_IDS: PreferenceProviderId[] = ["claude-code", "codex", "opencode"];

const DEFAULT_LANGUAGE: UserPreferenceLanguage = "zh-CN";
const DEFAULT_THEME: UserPreferenceTheme = "light";
const DEFAULT_PERMISSION_MODE: UserPreferencePermissionMode = "default";
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
  defaultPermissionMode?: string;
  providers?: unknown;
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
      defaultPermissionMode:
        input.defaultPermissionMode !== undefined
          ? normalizePermissionMode(input.defaultPermissionMode)
          : baseProfile.defaultPermissionMode,
      providers: mergeProviders(baseProfile.providers, providersPatch)
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
    defaultPermissionMode: record.defaultPermissionMode,
    providers: buildProvidersRecord(record.providers)
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
    defaultPermissionMode: DEFAULT_PERMISSION_MODE,
    providers: buildProvidersRecord()
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
        detail: "providers 只允许 claude-code、codex、opencode",
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
