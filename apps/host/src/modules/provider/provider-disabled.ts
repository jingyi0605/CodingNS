import type { ProviderCapabilities } from "@codingns/session-sync-core";

import { AppError } from "../../shared/errors/app-error.js";

export const PROVIDER_DISABLED_ERROR_CODE = "PROVIDER_DISABLED";
export const PROVIDER_DISABLED_LIMITATION = "当前 provider 已被禁用";

export function createProviderDisabledError(
  provider: string,
  field = "provider"
): AppError {
  return new AppError({
    statusCode: 409,
    errorCode: PROVIDER_DISABLED_ERROR_CODE,
    detail: `${provider} 已被项目禁用，请先重新启用后再继续`,
    field,
    data: {
      provider
    }
  });
}

export function applyProviderDisabledState(
  capabilities: ProviderCapabilities
): ProviderCapabilities {
  const limitations = capabilities.limitations.includes(PROVIDER_DISABLED_LIMITATION)
    ? capabilities.limitations
    : [PROVIDER_DISABLED_LIMITATION, ...capabilities.limitations];

  return {
    ...capabilities,
    canStartSession: false,
    canResumeSession: false,
    canSendMessage: false,
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsSessionFork: false,
    supportsNativeAgents: false,
    limitations
  };
}

export function isProviderDisabledCapabilities(
  capabilities: Pick<ProviderCapabilities, "limitations">
): boolean {
  return capabilities.limitations.includes(PROVIDER_DISABLED_LIMITATION);
}

export function createProviderCapabilityBlockedError(
  capabilities: ProviderCapabilities,
  field: string,
  fallbackDetail: string
): AppError {
  if (isProviderDisabledCapabilities(capabilities)) {
    return createProviderDisabledError(capabilities.provider, field);
  }

  return new AppError({
    statusCode: 409,
    errorCode: "PROVIDER_UNAVAILABLE",
    detail: capabilities.limitations[0] ?? fallbackDetail,
    field
  });
}
