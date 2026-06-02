export interface ApiErrorPayload {
  detail: string;
  error_code: string;
  field?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly field?: string;
  readonly data?: Record<string, unknown>;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.detail);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = payload.error_code;
    this.field = payload.field;
    this.data = payload.data;
  }
}

export function isProviderDisabledApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.errorCode === "PROVIDER_DISABLED";
}

export function isNetworkApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.errorCode === "NETWORK_ERROR";
}
