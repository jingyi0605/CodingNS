import fs from "node:fs";
import path from "node:path";
import type {
  ParseInput,
  ParsedDocumentPayload,
  ParserAdapter,
  ParserAvailability,
} from "./parser-adapter.js";

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rtf",
  ".html",
  ".htm",
  ".xml",
  ".json",
  ".yaml",
  ".yml",
  ".tsv",
]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shortSummary(text: string, limit = 180): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

/**
 * 轻量文本解析适配器。
 */
export class PlainTextParserAdapter implements ParserAdapter {
  readonly name = "plain_text";

  supports(ext: string): boolean {
    return SUPPORTED_TEXT_EXTENSIONS.has(ext.toLowerCase());
  }

  async availability(): Promise<ParserAvailability> {
    return "available";
  }

  async parse(input: ParseInput): Promise<ParsedDocumentPayload> {
    const raw = fs.readFileSync(input.filePath, "utf-8");
    const title = path.basename(input.filePath, input.extension);

    return {
      title,
      text: raw,
      summary: shortSummary(raw),
      parser: input.extension === ".html" || input.extension === ".htm"
        ? "html_fallback"
        : input.extension === ".json" || input.extension === ".yaml" || input.extension === ".yml" || input.extension === ".xml"
          ? "structured_text_fallback"
          : "plain_text",
      metadata: {
        adapter: this.name,
      },
    };
  }
}
