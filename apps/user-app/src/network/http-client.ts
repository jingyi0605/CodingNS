import { getHostBaseUrl, getHostRequestUrl } from "../config/env";
import { getAuthClientHeaders } from "../features/auth/store/client-device";
import { ApiError, type ApiErrorPayload } from "../shared/network/api-error";
import { authStore } from "../features/auth/store/auth-store";
import { resolveHostTransport } from "./host-transport-registry";

interface RequestOptions extends RequestInit {
  baseUrl?: string;
  skipAuth?: boolean;
  retryAfterRefresh?: boolean;
  omitCompatibilityHeaders?: boolean;
}

class HttpClient {
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.performRequest(path, options);

    if (response.status === 204 || response.status === 205) {
      return undefined as T;
    }

    const raw = await response.text();

    if (!raw) {
      return undefined as T;
    }

    return JSON.parse(raw) as T;
  }

  async requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
    const response = await this.performRequest(path, options);
    return response.blob();
  }

  private async performRequest(path: string, options: RequestOptions): Promise<Response> {
    const headers = new Headers(options.headers);
    const hasRequestBody = options.body !== undefined && options.body !== null;
    const baseUrl = options.baseUrl ?? getHostBaseUrl();
    const requestUrl = getHostRequestUrl(path, baseUrl);
    const transport = resolveHostTransport(baseUrl);
    const shouldOmitCompatibilityHeaders =
      options.omitCompatibilityHeaders || shouldUseLegacyCorsCompatibility(baseUrl);

    if (shouldOmitCompatibilityHeaders) {
      stripCompatibilityHeaders(headers);
    }

    if (hasRequestBody && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (!shouldOmitCompatibilityHeaders) {
      for (const [headerName, headerValue] of Object.entries(getAuthClientHeaders())) {
        if (!headers.has(headerName)) {
          headers.set(headerName, headerValue);
        }
      }
    }

    if (!options.skipAuth) {
      const accessToken = authStore.getState().session?.accessToken;

      if (!accessToken) {
        authStore.clear();
        throw new ApiError(401, {
          detail: "当前没有可用的登录态",
          error_code: "UNAUTHORIZED"
        });
      }

      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    let response: Response;

    try {
      response = await transport.fetch({
        path,
        baseUrl,
        url: requestUrl,
        init: {
          ...options,
          headers
        }
      });
    } catch (error) {
      if (!shouldOmitCompatibilityHeaders) {
        if (isLikelyCorsPreflightFailure(error)) {
          const retryable = await this.performRequest(path, {
            ...options,
            omitCompatibilityHeaders: true
          }).catch(() => null);

          if (retryable) {
            legacyCorsCompatibilityHosts.add(baseUrl);
            return retryable;
          }
        }
      }

      const detail = error instanceof Error ? error.message : "未知网络错误";

      throw new ApiError(0, {
        detail: `请求 ${requestUrl} 失败：${detail}`,
        error_code: "NETWORK_ERROR"
      });
    }

    if (!response.ok) {
      const payload = await parseApiErrorPayload(response);

      if (
        shouldAttemptRefresh(response.status, payload.error_code) &&
        !options.skipAuth &&
        !options.retryAfterRefresh
      ) {
        const refreshed = await authStore.refresh();

        if (refreshed.status === "refreshed") {
          return this.performRequest(path, {
            ...options,
            retryAfterRefresh: true
          });
        }

        if (refreshed.status === "invalid") {
          throw new ApiError(401, {
            detail: "登录态已经失效，请重新登录",
            error_code: "UNAUTHORIZED"
          });
        }

        throw new ApiError(0, {
          detail: "登录态暂时无法恢复，请稍后重试",
          error_code: "AUTH_REFRESH_UNAVAILABLE"
        });
      }

      // Host 被重置、数据库被替换，或者 bootstrap 状态回退时，
      // 本地残留的旧登录态已经不可信，继续待在工作台里只会无限打 401/403。
      if (!options.skipAuth && shouldClearAuthState(response.status, payload.error_code)) {
        sessionStorage.setItem(AUTH_EXPIRED_KEY, String(Date.now()));
        authStore.clear();
      }

      throw new ApiError(response.status, payload);
    }

    return response;
  }
}

export const httpClient = new HttpClient();

const legacyCorsCompatibilityHosts = new Set<string>();

function shouldUseLegacyCorsCompatibility(baseUrl: string): boolean {
  return legacyCorsCompatibilityHosts.has(baseUrl);
}

function stripCompatibilityHeaders(headers: Headers): void {
  for (const headerName of Array.from(headers.keys())) {
    if (headerName.toLowerCase().startsWith("x-codingns-")) {
      headers.delete(headerName);
    }
  }
}

function isLikelyCorsPreflightFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return message === "load failed" || message === "failed to fetch";
}

export function resetLegacyCorsCompatibilityHostsForTesting(): void {
  legacyCorsCompatibilityHosts.clear();
}

async function parseApiErrorPayload(response: Response): Promise<ApiErrorPayload> {
  const raw = await response.text();

  if (!raw) {
    return buildFallbackApiErrorPayload(response.status);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ApiErrorPayload>;

    if (typeof parsed.detail === "string" && typeof parsed.error_code === "string") {
      return {
        detail: parsed.detail,
        error_code: parsed.error_code,
        field: typeof parsed.field === "string" ? parsed.field : undefined,
        data: isApiErrorData(parsed.data) ? parsed.data : undefined,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined
      };
    }
  } catch {
    // 代理层或上游服务偶尔会返回纯文本，这里退回到可读错误即可。
  }

  return buildFallbackApiErrorPayload(response.status, raw);
}

function buildFallbackApiErrorPayload(status: number, rawDetail?: string): ApiErrorPayload {
  const normalizedDetail = rawDetail?.trim();

  return {
    detail: normalizedDetail || `请求失败（HTTP ${status}）`,
    error_code: status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR"
  };
}

function isApiErrorData(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldAttemptRefresh(status: number, errorCode: string): boolean {
  if (status !== 401) {
    return false;
  }

  return (
    errorCode === "UNAUTHORIZED" ||
    errorCode === "TOKEN_EXPIRED" ||
    errorCode === "TOKEN_INVALID"
  );
}

function shouldClearAuthState(status: number, errorCode: string): boolean {
  if (status === 403 && errorCode === "BOOTSTRAP_REQUIRED") {
    return true;
  }

  return shouldAttemptRefresh(status, errorCode);
}

const AUTH_EXPIRED_KEY = "codingns.auth_expired_at";

export function consumeAuthExpiredFlag(): boolean {
  const raw = sessionStorage.getItem(AUTH_EXPIRED_KEY);

  if (!raw) return false;

  sessionStorage.removeItem(AUTH_EXPIRED_KEY);

  // 只认可 5 秒内的标记，避免过期误判
  return Date.now() - Number(raw) < 5000;
}
