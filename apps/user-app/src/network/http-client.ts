import { getHostBaseUrl } from "../config/env";
import { ApiError, type ApiErrorPayload } from "../shared/network/api-error";
import { authStore } from "../features/auth/store/auth-store";

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  retryAfterRefresh?: boolean;
}

class HttpClient {
  private readonly baseUrl = getHostBaseUrl();

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);

    headers.set("Content-Type", "application/json");

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

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const payload = (await response.json()) as ApiErrorPayload;

      if (
        response.status === 401 &&
        payload.error_code === "UNAUTHORIZED" &&
        !options.skipAuth &&
        !options.retryAfterRefresh
      ) {
        const refreshed = await authStore.refresh();

        if (!refreshed) {
          throw new ApiError(401, {
            detail: "登录态已经失效，请重新登录",
            error_code: "UNAUTHORIZED"
          });
        }

        return this.request<T>(path, {
          ...options,
          retryAfterRefresh: true
        });
      }

      throw new ApiError(response.status, payload);
    }

    return (await response.json()) as T;
  }
}

export const httpClient = new HttpClient();
