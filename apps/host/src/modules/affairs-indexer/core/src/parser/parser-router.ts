import path from "node:path";
import { AppError, APP_ERROR_CODES } from "../../../contracts/src/index.js";
import type { ParserAdapter } from "./parser-adapter.js";
import { ComplexDocumentSkipAdapter } from "./complex-document-skip-adapter.js";
import { CsvParserAdapter } from "./csv-parser-adapter.js";
import { DocxParserAdapter } from "./docx-parser-adapter.js";
import { PdfParserAdapter } from "./pdf-parser-adapter.js";
import { PlainTextParserAdapter } from "./plain-text-parser-adapter.js";
import { PptxParserAdapter } from "./pptx-parser-adapter.js";
import { XlsxParserAdapter } from "./xlsx-parser-adapter.js";

function isFallbackAdapter(adapter: ParserAdapter): boolean {
  return adapter.routeKind === "fallback";
}

export function createDefaultParserAdapters(): ParserAdapter[] {
  return [
    new PlainTextParserAdapter(),
    new CsvParserAdapter(),
    new XlsxParserAdapter(),
    new DocxParserAdapter(),
    new PdfParserAdapter(),
    new PptxParserAdapter(),
    new ComplexDocumentSkipAdapter(),
  ];
}

/**
 * 解析器路由器。
 * 第二阶段把适配器选择逻辑从 DocumentParser 中拆出来，避免索引流程继续硬编码解析策略。
 */
export class ParserRouter {
  private readonly disabledExtensions: Set<string>;

  constructor(
    private readonly adapters: ParserAdapter[],
    options: {
      disabledExtensions?: string[];
    } = {},
  ) {
    this.disabledExtensions = new Set((options.disabledExtensions ?? []).map(item => item.toLowerCase()));
  }

  listAdapters(): ParserAdapter[] {
    return [...this.adapters];
  }

  async resolveForFile(filePath: string): Promise<{ adapter: ParserAdapter; extension: string }> {
    const extension = path.extname(filePath).toLowerCase();
    const primaryAdapter = this.disabledExtensions.has(extension)
      ? undefined
      : this.adapters.find(item => !isFallbackAdapter(item) && item.supports(extension));
    const fallbackAdapter = this.adapters.find(item => isFallbackAdapter(item) && item.supports(extension));
    const adapter = primaryAdapter ?? fallbackAdapter;

    if (!adapter) {
      throw new AppError(
        `当前没有可用解析器支持扩展名：${extension || "(无扩展名)"}`,
        APP_ERROR_CODES.PARSER_ROUTE_UNSUPPORTED,
        {
          details: {
            filePath,
            extension,
          },
        },
      );
    }

    return {
      adapter,
      extension,
    };
  }
}
