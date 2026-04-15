export interface AppErrorOptions {
  statusCode: number;
  errorCode: string;
  detail: string;
  field?: string;
  data?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly field?: string;
  readonly data?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.detail);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.field = options.field;
    this.data = options.data;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
