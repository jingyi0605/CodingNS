import type { RuntimeConfig } from "../../../contracts/src/index.js";
import type { ParsedDocument as ParsedDocumentResult } from "./plain-text-parser.js";
import type { ParseSkip } from "./parser-adapter.js";
import { ParserRouter, createDefaultParserAdapters } from "./parser-router.js";
import type { ParserAdapter } from "./parser-adapter.js";

/**
 * 统一解析入口。
 * 第二阶段改为依赖 ParserRouter，避免解析策略继续散在索引流程里。
 */
export class DocumentParser {
  private readonly router: ParserRouter;

  constructor(options: { config: RuntimeConfig; router?: ParserRouter; adapters?: ParserAdapter[] }) {
    this.router = options.router ?? new ParserRouter(options.adapters ?? createDefaultParserAdapters(), {
      disabledExtensions: options.config.disabledParserExtensions,
    });
  }

  async parse(filePath: string): Promise<ParsedDocumentResult> {
    const { adapter, extension } = await this.router.resolveForFile(filePath);
    const result = await adapter.parse({
      filePath,
      extension,
    });
    if ("kind" in result && result.kind === "skip") {
      throw new Error("parse() 不支持 skip 结果，请改用 parseWithOutcome()");
    }
    return result as ParsedDocumentResult;
  }

  async parseWithOutcome(filePath: string): Promise<ParsedDocumentResult | ParseSkip> {
    const { adapter, extension } = await this.router.resolveForFile(filePath);
    return await adapter.parse({
      filePath,
      extension,
    }) as ParsedDocumentResult | ParseSkip;
  }
}
