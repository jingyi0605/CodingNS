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

const SUPPORTED_PPTX_EXTENSIONS = new Set([".pptx"]);

interface ParsedSlide {
  slideIndex: number;
  text: string;
}

function resolvePresentationTarget(target: string): string {
  const normalized = path.posix.normalize(path.posix.join("ppt", target));
  return normalized.replace(/^\/+/, "");
}

function parsePresentationRelationships(relationshipXml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  const relationshipPattern = /<Relationship\b([^>]*)\/>/g;
  for (const match of relationshipXml.matchAll(relationshipPattern)) {
    const attributes = extractXmlAttributes(match[1]);
    const relationId = attributes.Id;
    const target = attributes.Target;
    if (!relationId || !target) {
      continue;
    }
    relationships.set(relationId, resolvePresentationTarget(target));
  }
  return relationships;
}

function parsePresentationSlidePaths(presentationXml: string, relationshipXml: string): string[] {
  const relationships = parsePresentationRelationships(relationshipXml);
  const slidePaths: string[] = [];
  const pattern = /<p:sldId\b([^>]*)\/>/g;
  for (const match of presentationXml.matchAll(pattern)) {
    const attributes = extractXmlAttributes(match[1]);
    const relationId = attributes["r:id"];
    if (!relationId) {
      continue;
    }
    const target = relationships.get(relationId);
    if (!target) {
      continue;
    }
    slidePaths.push(target);
  }
  return slidePaths;
}

function parseSlideText(slideXml: string): string {
  const texts: string[] = [];
  const textPattern = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  for (const match of slideXml.matchAll(textPattern)) {
    const text = decodeXmlEntities(match[1]).trim();
    if (text) {
      texts.push(text);
    }
  }

  return texts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseSlides(entries: Map<string, Buffer>, slidePaths: string[]): ParsedSlide[] {
  const slides: ParsedSlide[] = [];
  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index];
    const slideXml = readZipText(entries, slidePath, "PPTX", false);
    if (!slideXml) {
      continue;
    }
    const text = parseSlideText(slideXml);
    if (!text) {
      continue;
    }
    slides.push({
      slideIndex: index + 1,
      text,
    });
  }
  return slides;
}

export class PptxParserAdapter extends BaseComplexParserAdapter {
  readonly name = "pptx_parser";

  supports(ext: string): boolean {
    return SUPPORTED_PPTX_EXTENSIONS.has(ext.toLowerCase());
  }

  protected async parseComplex(input: ParseInput): Promise<ParsedDocumentPayload> {
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(input.filePath);
    } catch (error) {
      throw new AppError(
        `PPTX 文件读取失败：${path.basename(input.filePath)}`,
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
        { cause: error },
      );
    }

    const entries = readZipEntries(fileBuffer, "PPTX");
    const presentationXml = readZipText(entries, "ppt/presentation.xml", "PPTX");
    const relationshipXml = readZipText(entries, "ppt/_rels/presentation.xml.rels", "PPTX");
    const slidePaths = parsePresentationSlidePaths(presentationXml, relationshipXml);
    if (slidePaths.length === 0) {
      throw new AppError(
        "PPTX 中未发现 slide 列表",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const slides = parseSlides(entries, slidePaths);
    if (slides.length === 0) {
      throw new AppError(
        "PPTX 中没有可读取的 slide 文本",
        APP_ERROR_CODES.PARSER_COMPLEX_CONTENT_UNREADABLE,
      );
    }

    const blocks: StructuredBlock[] = slides.map(slide => ({
      kind: "slide",
      slideIndex: slide.slideIndex,
      text: slide.text,
      metadata: {
        slideIndex: slide.slideIndex,
      },
    }));

    const text = slides
      .map(slide => `Slide ${slide.slideIndex}\n${slide.text}`.trim())
      .join("\n\n")
      .trim();
    const title = path.basename(input.filePath, input.extension);

    return {
      title,
      text,
      summary: shortSummary(text),
      parser: "pptx",
      metadata: {
        adapter: this.name,
        slideCount: slidePaths.length,
        extractedSlideCount: slides.length,
      },
      structured: {
        blocks,
        stats: {
          slideCount: slidePaths.length,
          extractedSlideCount: slides.length,
        },
      },
    };
  }
}
