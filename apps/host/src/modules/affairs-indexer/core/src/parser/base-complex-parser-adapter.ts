import { AppError, APP_ERROR_CODES, type AppErrorCode } from "../../../contracts/src/index.js";
import type {
  ParseInput,
  ParseSkip,
  ParsedDocumentPayload,
  ParserAdapter,
  ParserAvailability,
} from "./parser-adapter.js";

const COMPLEX_REASON_CODES = new Set<AppErrorCode>([
  APP_ERROR_CODES.PARSER_COMPLEX_FORMAT_UNSUPPORTED,
  APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
  APP_ERROR_CODES.PARSER_COMPLEX_LIBRARY_FAILED,
  APP_ERROR_CODES.PARSER_COMPLEX_OUTPUT_INVALID,
  APP_ERROR_CODES.PARSER_COMPLEX_SKIPPED,
]);

/**
 * 复杂文档解析适配器骨架。
 * 未来所有复杂格式 parser 都应优先继承这里，统一成功契约和异常到 skip 的收敛策略。
 */
export abstract class BaseComplexParserAdapter implements ParserAdapter {
  abstract readonly name: string;
  readonly routeKind = "primary" as const;

  abstract supports(ext: string): boolean;

  async availability(): Promise<ParserAvailability> {
    return "available";
  }

  async parse(input: ParseInput): Promise<ParsedDocumentPayload | ParseSkip> {
    try {
      const payload = await this.parseComplex(input);
      return this.validatePayload(input, payload);
    } catch (error) {
      return this.mapErrorToSkip(input, error);
    }
  }

  protected abstract parseComplex(input: ParseInput): Promise<ParsedDocumentPayload>;

  protected createSkip(input: ParseInput, reasonCode: AppErrorCode, message: string): ParseSkip {
    return {
      kind: "skip",
      adapter: this.name,
      reasonCode,
      extension: input.extension,
      message,
    };
  }

  protected mapErrorToSkip(input: ParseInput, error: unknown): ParseSkip {
    if (error instanceof AppError && COMPLEX_REASON_CODES.has(error.errorCode)) {
      return this.createSkip(input, error.errorCode, error.message);
    }

    if (error instanceof AppError && error.errorCode === APP_ERROR_CODES.PARSER_ADAPTER_UNAVAILABLE) {
      return this.createSkip(input, APP_ERROR_CODES.PARSER_COMPLEX_LIBRARY_FAILED, error.message);
    }

    if (error instanceof Error) {
      return this.createSkip(
        input,
        APP_ERROR_CODES.PARSER_COMPLEX_LIBRARY_FAILED,
        `${this.name} 解析失败：${error.message}`,
      );
    }

    return this.createSkip(
      input,
      APP_ERROR_CODES.PARSER_COMPLEX_LIBRARY_FAILED,
      `${this.name} 解析失败：unknown error`,
    );
  }

  private validatePayload(input: ParseInput, payload: ParsedDocumentPayload): ParsedDocumentPayload | ParseSkip {
    if (typeof payload.title !== "string"
      || typeof payload.text !== "string"
      || typeof payload.summary !== "string"
      || typeof payload.parser !== "string") {
      return this.createSkip(
        input,
        APP_ERROR_CODES.PARSER_COMPLEX_OUTPUT_INVALID,
        `${this.name} 返回了不合法的解析结果`,
      );
    }

    if (payload.structured) {
      if (!Array.isArray(payload.structured.blocks)) {
        return this.createSkip(
          input,
          APP_ERROR_CODES.PARSER_COMPLEX_OUTPUT_INVALID,
          `${this.name} 返回的 structured.blocks 非法`,
        );
      }
    }

    return payload;
  }
}
