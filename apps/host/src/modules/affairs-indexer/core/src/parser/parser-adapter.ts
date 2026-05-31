export type ParserAvailability = "available" | "degraded" | "unavailable";

export interface ParseInput {
  filePath: string;
  extension: string;
}

export type StructuredBlockKind =
  | "paragraph"
  | "table"
  | "page"
  | "sheet"
  | "slide"
  | "heading";

export interface StructuredBlock {
  kind: StructuredBlockKind;
  text?: string;
  page?: number;
  sheetName?: string;
  slideIndex?: number;
  cells?: string[][];
  metadata?: Record<string, unknown>;
}

export interface StructuredDocument {
  blocks: StructuredBlock[];
  stats?: Record<string, number>;
}

export interface ParseSkip {
  kind: "skip";
  adapter: string;
  reasonCode: string;
  extension: string;
  message: string;
}

export interface ParsedDocumentPayload {
  title: string;
  text: string;
  summary: string;
  parser: string;
  metadata?: Record<string, unknown>;
  structured?: StructuredDocument;
}

export type ParserRouteKind = "primary" | "fallback";

export interface ParserAdapter {
  name: string;
  routeKind?: ParserRouteKind;
  supports(ext: string): boolean;
  availability(): Promise<ParserAvailability>;
  parse(input: ParseInput): Promise<ParsedDocumentPayload | ParseSkip>;
}
