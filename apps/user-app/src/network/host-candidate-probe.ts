import { getHostRequestUrl } from "../config/env";

export type HostCandidateProbeStatus =
  | "verified"
  | "unreachable"
  | "mismatch"
  | "unauthorized";

export interface HostCandidateProbeResult {
  status: HostCandidateProbeStatus;
  checkedAt: string;
  errorCode: string | null;
  errorDetail: string | null;
  responseHostBaseUrl: string | null;
  responseBindingId: string | null;
  responseHostFingerprint: string | null;
}

interface CandidateRuntimeConfigView {
  hostBaseUrl: string;
  relayTunnel: {
    bindingId: string | null;
    hostFingerprint: string | null;
  } | null;
}

export async function probeAuthenticatedHostCandidateEndpoint(input: {
  baseUrl: string;
  accessToken: string;
  platform: "desktop" | "web";
  expectedBindingId: string;
  expectedHostFingerprint: string;
}): Promise<HostCandidateProbeResult> {
  const checkedAt = new Date().toISOString();
  const requestUrl = getHostRequestUrl(
    `/api/client/runtime-config?platform=${encodeURIComponent(input.platform)}`,
    input.baseUrl
  );

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`
      }
    });

    const payload = await readJson(response);

    if (!response.ok) {
      const errorCode = normalizeString(payload?.error_code);
      const errorDetail = normalizeString(payload?.detail) ?? `HTTP ${response.status}`;

      if (response.status === 401 || response.status === 403) {
        return {
          status: "unauthorized",
          checkedAt,
          errorCode: errorCode ?? "UNAUTHORIZED",
          errorDetail,
          responseHostBaseUrl: null,
          responseBindingId: null,
          responseHostFingerprint: null
        };
      }

      return {
        status: "mismatch",
        checkedAt,
        errorCode: errorCode ?? "HTTP_ERROR",
        errorDetail,
        responseHostBaseUrl: null,
        responseBindingId: null,
        responseHostFingerprint: null
      };
    }

    const runtimeConfig = payload as CandidateRuntimeConfigView | null;
    const responseBindingId = normalizeString(runtimeConfig?.relayTunnel?.bindingId);
    const responseHostFingerprint = normalizeString(runtimeConfig?.relayTunnel?.hostFingerprint);
    const responseHostBaseUrl = normalizeString(runtimeConfig?.hostBaseUrl);

    if (
      responseBindingId
      && responseHostFingerprint
      && responseBindingId === input.expectedBindingId
      && responseHostFingerprint === input.expectedHostFingerprint
    ) {
      return {
        status: "verified",
        checkedAt,
        errorCode: null,
        errorDetail: null,
        responseHostBaseUrl,
        responseBindingId,
        responseHostFingerprint
      };
    }

    return {
      status: "mismatch",
      checkedAt,
      errorCode: "HOST_IDENTITY_MISMATCH",
      errorDetail: "候选入口返回的 Host 身份与当前激活 Host 不一致",
      responseHostBaseUrl,
      responseBindingId,
      responseHostFingerprint
    };
  } catch (error) {
    return {
      status: "unreachable",
      checkedAt,
      errorCode: "NETWORK_ERROR",
      errorDetail: error instanceof Error ? error.message : "未知网络错误",
      responseHostBaseUrl: null,
      responseBindingId: null,
      responseHostFingerprint: null
    };
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text();

  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
