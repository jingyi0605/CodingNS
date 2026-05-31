import { APP_ERROR_CODES } from "../../../contracts/src/index.js";
import type {
  ParseInput,
  ParseSkip,
  ParserAdapter,
  ParserAvailability,
} from "./parser-adapter.js";

const SUPPORTED_COMPLEX_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".wps",
  ".ppt",
  ".pptx",
  ".odp",
  ".key",
  ".xlsx",
  ".xls",
  ".ods",
  ".et",
  ".numbers",
  ".csv",
]);

/**
 * 纯 Node 复杂文档占位适配器。
 * 当前版本不再桥接 Python；复杂格式统一走 skip 聚合，避免回到 failed 风暴。
 */
export class ComplexDocumentSkipAdapter implements ParserAdapter {
  readonly name = "complex_document_skip";
  readonly routeKind = "fallback" as const;

  supports(ext: string): boolean {
    return SUPPORTED_COMPLEX_EXTENSIONS.has(ext.toLowerCase());
  }

  async availability(): Promise<ParserAvailability> {
    return "degraded";
  }

  async parse(input: ParseInput): Promise<ParseSkip> {
    return {
      kind: "skip",
      adapter: this.name,
      reasonCode: APP_ERROR_CODES.PARSER_COMPLEX_SKIPPED,
      extension: input.extension,
      message: `复杂文档解析已跳过：当前 Node 版本未启用 ${input.extension} 解析能力`,
    };
  }
}
