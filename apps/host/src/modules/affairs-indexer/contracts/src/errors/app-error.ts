import type { AppErrorCode } from "./error-codes.js";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    public readonly errorCode: AppErrorCode,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = "AppError";
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
