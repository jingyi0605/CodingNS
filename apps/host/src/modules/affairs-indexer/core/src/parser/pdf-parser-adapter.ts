import fs from "node:fs";
import path from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { AppError, APP_ERROR_CODES } from "../../../contracts/src/index.js";
import { BaseComplexParserAdapter } from "./base-complex-parser-adapter.js";
import { shortSummary } from "./openxml-utils.js";
import type { ParseInput, ParsedDocumentPayload, StructuredBlock } from "./parser-adapter.js";

const SUPPORTED_PDF_EXTENSIONS = new Set([".pdf"]);

interface PdfObjectRecord {
  objectId: string;
  body: string;
}

interface PdfPageRecord {
  contentRefs: string[];
}

function decodePdfNameToken(token: string): string {
  return token.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractPdfObjects(pdfText: string): Map<string, PdfObjectRecord> {
  const objects = new Map<string, PdfObjectRecord>();
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  for (const match of pdfText.matchAll(objectPattern)) {
    const objectId = `${match[1]} ${match[2]}`;
    objects.set(objectId, {
      objectId,
      body: match[3].trim(),
    });
  }
  return objects;
}

function parsePageRecords(objects: Map<string, PdfObjectRecord>): PdfPageRecord[] {
  const pages: Array<{ objectNumber: number; record: PdfPageRecord }> = [];
  for (const [objectId, record] of objects.entries()) {
    if (!/\/Type\s*\/Page\b/.test(record.body)) {
      continue;
    }
    if (/\/Type\s*\/Pages\b/.test(record.body)) {
      continue;
    }

    const contentsRefs: string[] = [];
    const arrayMatch = record.body.match(/\/Contents\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      for (const refMatch of arrayMatch[1].matchAll(/(\d+)\s+(\d+)\s+R/g)) {
        contentsRefs.push(`${refMatch[1]} ${refMatch[2]}`);
      }
    } else {
      const singleMatch = record.body.match(/\/Contents\s+(\d+)\s+(\d+)\s+R/);
      if (singleMatch) {
        contentsRefs.push(`${singleMatch[1]} ${singleMatch[2]}`);
      }
    }

    pages.push({
      objectNumber: Number.parseInt(objectId.split(" ")[0] ?? "0", 10),
      record: {
        contentRefs: contentsRefs,
      },
    });
  }

  return pages
    .sort((left, right) => left.objectNumber - right.objectNumber)
    .map(item => item.record);
}

function extractStreamBuffer(objectBody: string): Buffer | null {
  const streamStart = objectBody.indexOf("stream");
  if (streamStart < 0) {
    return null;
  }

  let dataStart = streamStart + "stream".length;
  if (objectBody[dataStart] === "\r" && objectBody[dataStart + 1] === "\n") {
    dataStart += 2;
  } else if (objectBody[dataStart] === "\n") {
    dataStart += 1;
  } else if (objectBody[dataStart] === "\r") {
    dataStart += 1;
  }

  const streamEnd = objectBody.lastIndexOf("endstream");
  if (streamEnd < 0 || streamEnd <= dataStart) {
    return null;
  }

  let rawData = objectBody.slice(dataStart, streamEnd);
  rawData = rawData.replace(/[\r\n]+$/, "");
  return Buffer.from(rawData, "latin1");
}

function decodePdfStream(record: PdfObjectRecord): string | null {
  const rawStream = extractStreamBuffer(record.body);
  if (!rawStream) {
    return null;
  }

  const filters: string[] = [];
  const arrayFilterMatch = record.body.match(/\/Filter\s*\[([^\]]+)\]/);
  if (arrayFilterMatch) {
    for (const match of arrayFilterMatch[1].matchAll(/\/([A-Za-z0-9#]+)/g)) {
      filters.push(decodePdfNameToken(match[1]));
    }
  } else {
    const singleFilterMatch = record.body.match(/\/Filter\s*\/([A-Za-z0-9#]+)/);
    if (singleFilterMatch) {
      filters.push(decodePdfNameToken(singleFilterMatch[1]));
    }
  }

  let contentBuffer = rawStream;
  for (const filter of filters) {
    if (filter === "FlateDecode") {
      try {
        contentBuffer = inflateSync(contentBuffer);
      } catch {
        contentBuffer = inflateRawSync(contentBuffer);
      }
      continue;
    }

    throw new AppError(
      `PDF 当前未支持过滤器：${filter}`,
      APP_ERROR_CODES.PARSER_COMPLEX_FORMAT_UNSUPPORTED,
    );
  }

  return contentBuffer.toString("latin1");
}

function decodePdfEscapeSequence(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "(":
    case ")":
    case "\\":
      return char;
    default:
      return char;
  }
}

function decodePdfLiteralString(input: string): string {
  let result = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\\") {
      result += char;
      continue;
    }

    const next = input[index + 1];
    if (!next) {
      break;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && /[0-7]/.test(input[index + 1 + consumed] ?? "")) {
        octal += input[index + 1 + consumed];
        consumed += 1;
      }
      result += String.fromCharCode(Number.parseInt(octal, 8));
      index += consumed;
      continue;
    }

    result += decodePdfEscapeSequence(next);
    index += 1;
  }
  return result;
}

function decodePdfHexString(input: string): string {
  const normalized = input.replace(/\s+/g, "");
  const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  let result = "";
  for (let index = 0; index < padded.length; index += 2) {
    const value = Number.parseInt(padded.slice(index, index + 2), 16);
    if (!Number.isNaN(value)) {
      result += String.fromCharCode(value);
    }
  }
  return result;
}

function extractBalancedParentheses(text: string, startIndex: number): { value: string; endIndex: number } | null {
  let depth = 1;
  let current = "";
  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      current += char;
      if (index + 1 < text.length) {
        current += text[index + 1];
        index += 1;
      }
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: current,
          endIndex: index,
        };
      }
      current += char;
      continue;
    }
    current += char;
  }
  return null;
}

function readArrayTokens(raw: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      const literal = extractBalancedParentheses(raw, index);
      if (!literal) {
        break;
      }
      tokens.push(decodePdfLiteralString(literal.value));
      index = literal.endIndex + 1;
      continue;
    }
    if (char === "<") {
      const endIndex = raw.indexOf(">", index + 1);
      if (endIndex < 0) {
        break;
      }
      tokens.push(decodePdfHexString(raw.slice(index + 1, endIndex)));
      index = endIndex + 1;
      continue;
    }

    const nextWhitespace = raw.slice(index).search(/\s/);
    if (nextWhitespace < 0) {
      break;
    }
    index += nextWhitespace + 1;
  }
  return tokens;
}

function extractTextFromPdfOperators(content: string): string {
  const parts: string[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "(") {
      const literal = extractBalancedParentheses(content, index);
      if (!literal) {
        continue;
      }

      const operatorSegment = content.slice(literal.endIndex + 1, literal.endIndex + 6);
      if (/\s*Tj\b/.test(operatorSegment) || /\s*'/.test(operatorSegment) || /\s*"/.test(operatorSegment)) {
        parts.push(decodePdfLiteralString(literal.value));
      }
      index = literal.endIndex;
      continue;
    }

    if (char === "<" && content[index + 1] !== "<") {
      const endIndex = content.indexOf(">", index + 1);
      if (endIndex < 0) {
        continue;
      }
      const operatorSegment = content.slice(endIndex + 1, endIndex + 6);
      if (/\s*Tj\b/.test(operatorSegment)) {
        parts.push(decodePdfHexString(content.slice(index + 1, endIndex)));
      }
      index = endIndex;
      continue;
    }
  }

  const arrayPattern = /\[(.*?)\]\s*TJ\b/gs;
  for (const match of content.matchAll(arrayPattern)) {
    const tokens = readArrayTokens(match[1]);
    if (tokens.length > 0) {
      parts.push(tokens.join(""));
    }
  }

  return normalizePdfText(parts.join("\n"));
}

function extractPageText(page: PdfPageRecord, objects: Map<string, PdfObjectRecord>): string {
  const fragments: string[] = [];
  for (const contentRef of page.contentRefs) {
    const objectRecord = objects.get(contentRef);
    if (!objectRecord) {
      continue;
    }
    const streamText = decodePdfStream(objectRecord);
    if (!streamText) {
      continue;
    }
    const text = extractTextFromPdfOperators(streamText);
    if (text) {
      fragments.push(text);
    }
  }
  return normalizePdfText(fragments.join("\n\n"));
}

export class PdfParserAdapter extends BaseComplexParserAdapter {
  readonly name = "pdf_parser";

  supports(ext: string): boolean {
    return SUPPORTED_PDF_EXTENSIONS.has(ext.toLowerCase());
  }

  protected async parseComplex(input: ParseInput): Promise<ParsedDocumentPayload> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(input.filePath);
    } catch (error) {
      throw new AppError(
        `PDF 文件读取失败：${path.basename(input.filePath)}`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
        { cause: error },
      );
    }

    const pdfText = fileBuffer.toString("latin1");
    if (!pdfText.startsWith("%PDF-")) {
      throw new AppError(
        "PDF 文件头非法或内容不可读",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const objects = extractPdfObjects(pdfText);
    if (objects.size === 0) {
      throw new AppError(
        "PDF 中未发现可读取对象",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const pages = parsePageRecords(objects);
    if (pages.length === 0) {
      throw new AppError(
        "PDF 中未发现页面对象",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const blocks: StructuredBlock[] = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const pageNumber = pageIndex + 1;
      const pageText = extractPageText(pages[pageIndex], objects);
      if (!pageText) {
        continue;
      }
      blocks.push({
        kind: "page",
        page: pageNumber,
        text: pageText,
        metadata: {
          pageNumber,
        },
      });
    }

    if (blocks.length === 0) {
      throw new AppError(
        "PDF 中没有可提取的文本内容",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const text = blocks.map(block => block.text ?? "").filter(Boolean).join("\n\n").trim();
    const title = path.basename(input.filePath, input.extension);

    return {
      title,
      text,
      summary: shortSummary(text),
      parser: "pdf",
      metadata: {
        adapter: this.name,
        pageCount: pages.length,
        extractedPageCount: blocks.length,
      },
      structured: {
        blocks,
        stats: {
          pageCount: pages.length,
          extractedPageCount: blocks.length,
        },
      },
    };
  }
}
