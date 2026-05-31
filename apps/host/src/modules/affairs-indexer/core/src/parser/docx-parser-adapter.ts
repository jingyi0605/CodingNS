import fs from "node:fs";
import path from "node:path";
import { AppError, APP_ERROR_CODES } from "../../../contracts/src/index.js";
import { BaseComplexParserAdapter } from "./base-complex-parser-adapter.js";
import {
  decodeXmlEntities,
  extractXmlAttributes,
  readZipEntries,
  readZipText,
  shortSummary,
} from "./openxml-utils.js";
import type { ParseInput, ParsedDocumentPayload, StructuredBlock } from "./parser-adapter.js";

const SUPPORTED_DOCX_EXTENSIONS = new Set([".docx"]);

interface ParagraphBlock {
  kind: "heading" | "paragraph";
  text: string;
  metadata?: Record<string, unknown>;
}

function stripXmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, "");
}

function parseParagraphText(paragraphXml: string): string {
  const parts: string[] = [];
  const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  for (const match of paragraphXml.matchAll(textPattern)) {
    parts.push(decodeXmlEntities(match[1]));
  }

  const tabCount = [...paragraphXml.matchAll(/<w:tab\b[^>]*\/>/g)].length;
  for (let index = 0; index < tabCount; index += 1) {
    parts.push("\t");
  }

  const breakCount = [...paragraphXml.matchAll(/<w:br\b[^>]*\/>/g)].length;
  for (let index = 0; index < breakCount; index += 1) {
    parts.push("\n");
  }

  return parts.join("").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").trim();
}

function parseParagraphStyle(paragraphXml: string): string | null {
  const match = paragraphXml.match(/<w:pStyle\b([^>]*)\/>/);
  if (!match) {
    return null;
  }
  const attributes = extractXmlAttributes(match[1]);
  return attributes["w:val"] ?? null;
}

function isHeadingStyle(style: string | null): boolean {
  return Boolean(style && /^Heading[1-6]$/i.test(style));
}

function parseDocumentBlocks(documentXml: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  for (const match of documentXml.matchAll(paragraphPattern)) {
    const rawParagraphXml = match[0];
    const text = parseParagraphText(rawParagraphXml);
    if (!text) {
      continue;
    }
    const style = parseParagraphStyle(rawParagraphXml);
    const kind = isHeadingStyle(style) ? "heading" : "paragraph";
    blocks.push({
      kind,
      text,
      metadata: style
        ? {
          style,
        }
        : undefined,
    });
  }
  return blocks;
}

function parseCoreTitle(coreXml: string | null): string | null {
  if (!coreXml) {
    return null;
  }
  const match = coreXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/);
  if (!match) {
    return null;
  }
  const title = decodeXmlEntities(stripXmlTags(match[1])).trim();
  return title || null;
}

export class DocxParserAdapter extends BaseComplexParserAdapter {
  readonly name = "docx_parser";

  supports(ext: string): boolean {
    return SUPPORTED_DOCX_EXTENSIONS.has(ext.toLowerCase());
  }

  protected async parseComplex(input: ParseInput): Promise<ParsedDocumentPayload> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(input.filePath);
    } catch (error) {
      throw new AppError(
        `DOCX 文件读取失败：${path.basename(input.filePath)}`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
        { cause: error },
      );
    }

    const entries = readZipEntries(fileBuffer, "DOCX");
    const documentXml = readZipText(entries, "word/document.xml", "DOCX");
    const coreXml = readZipText(entries, "docProps/core.xml", "DOCX", false);
    const blocks = parseDocumentBlocks(documentXml);

    if (blocks.length === 0) {
      throw new AppError(
        "DOCX 中没有可读取的正文段落",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const text = blocks.map(block => block.text).join("\n\n").trim();
    if (!text) {
      throw new AppError(
        "DOCX 文本内容为空",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const headingCount = blocks.filter(block => block.kind === "heading").length;
    const structuredBlocks: StructuredBlock[] = blocks.map(block => ({
      kind: block.kind,
      text: block.text,
      metadata: block.metadata,
    }));
    const title = parseCoreTitle(coreXml) ?? blocks.find(block => block.kind === "heading")?.text
      ?? path.basename(input.filePath, input.extension);

    return {
      title,
      text,
      summary: shortSummary(text),
      parser: "docx",
      metadata: {
        adapter: this.name,
        paragraphCount: blocks.length,
        headingCount,
      },
      structured: {
        blocks: structuredBlocks,
        stats: {
          paragraphCount: blocks.length,
          headingCount,
        },
      },
    };
  }
}
