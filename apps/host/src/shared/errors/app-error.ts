export interface AppErrorOptions {
  statusCode: number;
  errorCode: string;
  detail: string;
  field?: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly field?: string;

  constructor(options: AppErrorOptions) {
    super(options.detail);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.field = options.field;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
