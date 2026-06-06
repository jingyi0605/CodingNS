import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { UserTeableGlobalSettingRepository } from "../../storage/repositories/user-teable-global-setting-repository.js";
import type { TeableMirrorMode, UserTeableGlobalSettingRecord } from "../../types/domain.js";
import type { TeableCredentialService } from "./teable-credential-service.js";

export interface TeableGlobalBindingDto {
  baseUrl: string;
  spaceId: string;
  baseId: string;
  authRef: string;
  enabled: boolean;
  mirrorMode: TeableMirrorMode;
  updatedAt: string;
}

export interface SaveTeableGlobalBindingInput {
  baseUrl: string;
  spaceId: string;
  baseId: string;
  authRef: string;
  authToken?: string;
  enabled: boolean;
  mirrorMode: TeableMirrorMode;
}

export interface TeableGlobalBindingOverviewDto {
  binding: TeableGlobalBindingDto | null;
  status: "unbound" | "ready" | "disabled" | "config_invalid";
  summary: string;
  updatedAt: string | null;
}

const ALLOWED_MIRROR_MODES: ReadonlySet<TeableMirrorMode> = new Set([
  "manual",
  "scheduled",
  "event_driven"
]);

export class TeableGlobalBindingService {
  constructor(
    private readonly userTeableGlobalSettingRepository: UserTeableGlobalSettingRepository,
    private readonly teableCredentialService: TeableCredentialService
  ) {}

  getGlobalBinding(userId: string): TeableGlobalBindingDto | null {
    const record = this.userTeableGlobalSettingRepository.findByUserId(userId);
    return mapRecordToDto(record);
  }

  getOverview(userId: string): TeableGlobalBindingOverviewDto {
    const record = this.userTeableGlobalSettingRepository.findByUserId(userId);
    if (!record) {
      return {
        binding: null,
        status: "unbound",
        summary: "当前事务工作台还没有绑定 Teable 实例。",
        updatedAt: null
      };
    }

    const binding = mapRecordToDto(record);
    const configValid = Boolean(
      record.baseUrl?.trim()
      && record.spaceId?.trim()
      && record.baseId?.trim()
      && record.authRef?.trim()
    );

    if (!configValid) {
      return {
        binding,
        status: "config_invalid",
        summary: "当前 Teable 配置不完整，请补齐站点、空间和认证引用。",
        updatedAt: record.updatedAt
      };
    }

    if (!record.enabled) {
      return {
        binding,
        status: "disabled",
        summary: "当前已保存 Teable 配置，但还没有启用同步。",
        updatedAt: record.updatedAt
      };
    }

    return {
      binding,
      status: "ready",
      summary: "当前事务工作台已经绑定 Teable，可继续配置推送范围和表单。",
      updatedAt: record.updatedAt
    };
  }

  saveGlobalBinding(userId: string, input: SaveTeableGlobalBindingInput): TeableGlobalBindingDto {
    const baseUrl = normalizeTeableBaseUrl(input.baseUrl);
    const spaceId = normalizeRequiredText(input.spaceId, "spaceId", "目标空间 ID 不能为空");
    const baseId = normalizeRequiredText(input.baseId, "baseId", "目标 baseId 不能为空");
    const authRef = normalizeRequiredText(input.authRef, "authRef", "认证引用不能为空");
    const mirrorMode = normalizeMirrorMode(input.mirrorMode);
    const current = this.userTeableGlobalSettingRepository.findByUserId(userId);
    const updatedAt = nowIso();

    if (input.authToken?.trim()) {
      this.teableCredentialService.saveToken(userId, authRef, input.authToken.trim());
    }

    const record: UserTeableGlobalSettingRecord = {
      userId,
      baseUrl,
      spaceId,
      baseId,
      authRef,
      enabled: input.enabled === true,
      mirrorMode,
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt
    };

    return mapRecordToDto(this.userTeableGlobalSettingRepository.upsert(record))!;
  }
}

function mapRecordToDto(record: UserTeableGlobalSettingRecord | null): TeableGlobalBindingDto | null {
  if (!record?.baseUrl?.trim() || !record.spaceId?.trim() || !record.baseId?.trim() || !record.authRef?.trim()) {
    return null;
  }

  return {
    baseUrl: record.baseUrl,
    spaceId: record.spaceId,
    baseId: record.baseId,
    authRef: record.authRef,
    enabled: record.enabled,
    mirrorMode: record.mirrorMode,
    updatedAt: record.updatedAt
  };
}

function normalizeRequiredText(value: string, field: string, detail: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field,
      detail
    });
  }
  return normalized;
}

function normalizeTeableBaseUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field: "baseUrl",
      detail: "Teable 站点地址不能为空"
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field: "baseUrl",
      detail: "Teable 站点地址不是合法 URL"
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      field: "baseUrl",
      detail: "Teable 站点地址只支持 HTTP 或 HTTPS"
    });
  }

  return parsed.toString().replace(/\/$/, "");
}

function normalizeMirrorMode(value: TeableMirrorMode): TeableMirrorMode {
  if (ALLOWED_MIRROR_MODES.has(value)) {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    field: "mirrorMode",
    detail: "mirrorMode 只允许 manual、scheduled、event_driven"
  });
}
