import type { StructuredDocument } from "./parser-adapter.js";

export interface ParsedDocument {
  title: string;
  text: string;
  summary: string;
  parser: string;
  metadata?: Record<string, unknown>;
  structured?: StructuredDocument;
}
