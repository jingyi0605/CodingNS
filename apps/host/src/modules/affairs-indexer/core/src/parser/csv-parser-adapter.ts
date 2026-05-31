import path from "node:path";
import fs from "node:fs";
import { AppError, APP_ERROR_CODES } from "../../../contracts/src/index.js";
import { BaseComplexParserAdapter } from "./base-complex-parser-adapter.js";
import type { ParseInput, ParsedDocumentPayload, StructuredBlock } from "./parser-adapter.js";

const SUPPORTED_CSV_EXTENSIONS = new Set([".csv"]);

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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvContent(raw: string): string[][] {
  const normalized = raw.replace(/^\uFEFF/, "");
  const lines = normalized
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    throw new AppError(
      "CSV 内容为空或不可读",
      APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
    );
  }

  return lines.map(splitCsvLine);
}

export class CsvParserAdapter extends BaseComplexParserAdapter {
  readonly name = "csv_parser";

  supports(ext: string): boolean {
    return SUPPORTED_CSV_EXTENSIONS.has(ext.toLowerCase());
  }

  protected async parseComplex(input: ParseInput): Promise<ParsedDocumentPayload> {
    let raw: string;
    try {
      raw = fs.readFileSync(input.filePath, "utf-8");
    } catch (error) {
      throw new AppError(
        `CSV 文件读取失败：${path.basename(input.filePath)}`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
        { cause: error },
      );
    }

    const rows = parseCsvContent(raw);
    const blocks: StructuredBlock[] = [
      {
        kind: "sheet",
        text: rows.map(row => row.join(" ")).join("\n"),
        sheetName: path.basename(input.filePath, input.extension),
        metadata: {
          format: "csv",
        },
      },
      {
        kind: "table",
        cells: rows,
        metadata: {
          rowCount: rows.length,
          columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
        },
      },
    ];

    const text = rows.map(row => row.join(" ")).join("\n");
    const title = path.basename(input.filePath, input.extension);

    return {
      title,
      text,
      summary: shortSummary(text),
      parser: "csv",
      metadata: {
        adapter: this.name,
        rowCount: rows.length,
        columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
      },
      structured: {
        blocks,
        stats: {
          rowCount: rows.length,
          columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
        },
      },
    };
  }
}
