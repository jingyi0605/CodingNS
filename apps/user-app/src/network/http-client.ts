import { getHostBaseUrl, getHostRequestUrl } from "../config/env";
import { ApiError, type ApiErrorPayload } from "../shared/network/api-error";
import { authStore } from "../features/auth/store/auth-store";

interface RequestOptions extends RequestInit {
  baseUrl?: string;
  skipAuth?: boolean;
  retryAfterRefresh?: boolean;
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
    const requestUrl = getHostRequestUrl(path, options.baseUrl ?? getHostBaseUrl());

    if (hasRequestBody && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
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
      response = await fetch(requestUrl, {
        ...options,
        headers
      });
    } catch (error) {
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
        authStore.clear();
      }

      throw new ApiError(response.status, payload);
    }

    return response;
  }
}

export const httpClient = new HttpClient();

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
