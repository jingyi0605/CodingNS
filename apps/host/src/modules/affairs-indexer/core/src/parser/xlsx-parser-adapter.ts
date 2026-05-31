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

const SUPPORTED_XLSX_EXTENSIONS = new Set([".xlsx"]);

interface WorkbookSheet {
  name: string;
  target: string;
}

interface ParsedWorksheet {
  sheetName: string;
  rows: string[][];
  text: string;
  rowCount: number;
  columnCount: number;
}

function resolveWorkbookTarget(target: string): string {
  const normalized = path.posix.normalize(path.posix.join("xl", target));
  return normalized.replace(/^\/+/, "");
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  const relations = new Map<string, string>();
  const relationshipPattern = /<Relationship\b([^>]*)\/>/g;
  for (const match of xml.matchAll(relationshipPattern)) {
    const attributes = extractXmlAttributes(match[1]);
    const relationId = attributes.Id;
    const target = attributes.Target;
    if (!relationId || !target) {
      continue;
    }
    relations.set(relationId, resolveWorkbookTarget(target));
  }
  return relations;
}

function parseWorkbookSheets(workbookXml: string, relationshipXml: string): WorkbookSheet[] {
  const relationships = parseWorkbookRelationships(relationshipXml);
  const sheets: WorkbookSheet[] = [];
  const sheetPattern = /<sheet\b([^>]*)\/>/g;
  for (const match of workbookXml.matchAll(sheetPattern)) {
    const attributes = extractXmlAttributes(match[1]);
    const relationId = attributes["r:id"];
    const name = attributes.name?.trim();
    if (!relationId || !name) {
      continue;
    }
    const target = relationships.get(relationId);
    if (!target) {
      continue;
    }
    sheets.push({
      name,
      target,
    });
  }

  if (sheets.length === 0) {
    throw new AppError(
      "XLSX 中未发现可读取的 sheet",
      APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
    );
  }

  return sheets;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) {
    return [];
  }

  const items: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  for (const match of xml.matchAll(itemPattern)) {
    const rawItem = match[1];
    const textParts = [...rawItem.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(item => decodeXmlEntities(item[1]));
    items.push(textParts.join(""));
  }
  return items;
}

function columnLettersToIndex(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase()) {
    value = (value * 26) + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

function getCellColumnIndex(cellRef: string | undefined, fallbackIndex: number): number {
  if (!cellRef) {
    return fallbackIndex;
  }
  const match = cellRef.match(/[A-Z]+/i);
  if (!match) {
    return fallbackIndex;
  }
  return columnLettersToIndex(match[0]);
}

function readCellValue(rawCellXml: string, type: string | undefined, sharedStrings: string[]): string {
  if (type === "inlineStr") {
    const inlineTexts = [...rawCellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(match => decodeXmlEntities(match[1]));
    return inlineTexts.join("").trim();
  }

  const rawValue = rawCellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (type === "s") {
    const index = Number(rawValue ?? "-1");
    return sharedStrings[index] ?? "";
  }
  if (type === "b") {
    return rawValue === "1" ? "TRUE" : "FALSE";
  }
  if (type === "str" || type === "e") {
    return decodeXmlEntities(rawValue ?? "").trim();
  }
  if (rawValue && rawValue.length > 0) {
    return decodeXmlEntities(rawValue).trim();
  }

  const formulaValue = rawCellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
  return formulaValue ? `=${decodeXmlEntities(formulaValue).trim()}` : "";
}

function trimTrailingEmptyCells(row: string[]): string[] {
  const result = [...row];
  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }
  return result;
}

function parseWorksheet(sheetName: string, xml: string, sharedStrings: string[]): ParsedWorksheet {
  const rows: string[][] = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;

  for (const rowMatch of xml.matchAll(rowPattern)) {
    const rawRow = rowMatch[1];
    const row: string[] = [];
    let fallbackColumnIndex = 0;
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;

    for (const cellMatch of rawRow.matchAll(cellPattern)) {
      const rawAttributes = cellMatch[1] ?? cellMatch[3] ?? "";
      const rawCellXml = cellMatch[2] ?? "";
      const attributes = extractXmlAttributes(rawAttributes);
      const columnIndex = getCellColumnIndex(attributes.r, fallbackColumnIndex);
      const cellValue = readCellValue(rawCellXml, attributes.t, sharedStrings);
      while (row.length < columnIndex) {
        row.push("");
      }
      row[columnIndex] = cellValue;
      fallbackColumnIndex = columnIndex + 1;
    }

    const normalizedRow = trimTrailingEmptyCells(row);
    if (normalizedRow.length > 0) {
      rows.push(normalizedRow);
    }
  }

  const text = rows.map(row => row.filter(cell => cell.length > 0).join(" ")).filter(Boolean).join("\n");
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    sheetName,
    rows,
    text,
    rowCount: rows.length,
    columnCount,
  };
}

export class XlsxParserAdapter extends BaseComplexParserAdapter {
  readonly name = "xlsx_parser";

  supports(ext: string): boolean {
    return SUPPORTED_XLSX_EXTENSIONS.has(ext.toLowerCase());
  }

  protected async parseComplex(input: ParseInput): Promise<ParsedDocumentPayload> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(input.filePath);
    } catch (error) {
      throw new AppError(
        `XLSX 文件读取失败：${path.basename(input.filePath)}`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
        { cause: error },
      );
    }

    const entries = readZipEntries(fileBuffer, "XLSX");
    const workbookXml = readZipText(entries, "xl/workbook.xml", "XLSX");
    const relationshipXml = readZipText(entries, "xl/_rels/workbook.xml.rels", "XLSX");
    const sharedStrings = parseSharedStrings(readZipText(entries, "xl/sharedStrings.xml", "XLSX", false));
    const workbookSheets = parseWorkbookSheets(workbookXml, relationshipXml);
    const parsedSheets = workbookSheets
      .map(sheet => ({
        sheet,
        worksheetXml: readZipText(entries, sheet.target, "XLSX", false),
      }))
      .filter(item => item.worksheetXml)
      .map(item => parseWorksheet(item.sheet.name, item.worksheetXml ?? "", sharedStrings))
      .filter(item => item.rowCount > 0 || item.text.length > 0);

    if (parsedSheets.length === 0) {
      throw new AppError(
        "XLSX 中没有可读取的 sheet 内容",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const blocks: StructuredBlock[] = [];
    for (const sheet of parsedSheets) {
      blocks.push({
        kind: "sheet",
        sheetName: sheet.sheetName,
        text: sheet.text,
        metadata: {
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
        },
      });
      blocks.push({
        kind: "table",
        sheetName: sheet.sheetName,
        cells: sheet.rows,
        metadata: {
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
        },
      });
    }

    const text = parsedSheets
      .map(sheet => `${sheet.sheetName}\n${sheet.text}`.trim())
      .join("\n\n")
      .trim();

    if (!text) {
      throw new AppError(
        "XLSX 文本内容为空",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const totalRows = parsedSheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
    const maxColumnCount = parsedSheets.reduce((max, sheet) => Math.max(max, sheet.columnCount), 0);
    const title = path.basename(input.filePath, input.extension);

    return {
      title,
      text,
      summary: shortSummary(text),
      parser: "xlsx",
      metadata: {
        adapter: this.name,
        sheetCount: parsedSheets.length,
        rowCount: totalRows,
        columnCount: maxColumnCount,
      },
      structured: {
        blocks,
        stats: {
          sheetCount: parsedSheets.length,
          rowCount: totalRows,
          columnCount: maxColumnCount,
        },
      },
    };
  }
}
