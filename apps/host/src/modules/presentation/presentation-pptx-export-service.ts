import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as PptxGenJSImport from "pptxgenjs";

import type { HostConfig } from "../../config/env.js";
import { renderPresentationDocument } from "./presentation-renderer.js";

const nodeRequire = createRequire(import.meta.url);

export interface ExportPresentationPptxInput {
  htmlContent: string;
  sourceFilePath: string;
  outputFilePath: string;
  signal: AbortSignal;
}

export interface ExportPresentationPptxResult {
  outputPath: string;
  pageCount: number;
  pageSize: {
    width: number;
    height: number;
  };
}

export class PresentationPptxExportService {
  constructor(private readonly config: HostConfig) {}

  async exportPptx(input: ExportPresentationPptxInput): Promise<ExportPresentationPptxResult> {
    const rendered = await renderPresentationDocument(this.config, {
      htmlContent: input.htmlContent,
      sourceFilePath: input.sourceFilePath,
      signal: input.signal
    });

    try {
      const pageImages = await rendered.renderPageImages();
      const PptxGenJS = resolvePptxGenJsConstructor();
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "CodingNS";
      pptx.company = "CodingNS";
      pptx.subject = "Static HTML Presentation Export";
      pptx.title = path.basename(input.sourceFilePath);
      pptx.lang = "zh-CN";

      const slideWidthInches = pixelsToInches(rendered.pageSize.width);
      const slideHeightInches = pixelsToInches(rendered.pageSize.height);
      pptx.defineLayout({
        name: "CODINGNS_PRESENTATION",
        width: slideWidthInches,
        height: slideHeightInches
      });
      pptx.layout = "CODINGNS_PRESENTATION";

      for (const pageImage of pageImages) {
        input.signal.throwIfAborted();
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addImage({
          data: pageImage.dataUrl,
          x: 0,
          y: 0,
          w: slideWidthInches,
          h: slideHeightInches
        });
      }

      if (pageImages.length === 0) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
      }

      fs.mkdirSync(path.dirname(input.outputFilePath), { recursive: true });
      await pptx.writeFile({ fileName: input.outputFilePath });

      return {
        outputPath: input.outputFilePath,
        pageCount: rendered.pageCount,
        pageSize: {
          width: rendered.pageSize.width,
          height: rendered.pageSize.height
        }
      };
    } finally {
      await rendered.close();
    }
  }
}

function pixelsToInches(value: number): number {
  return Number((value / 96).toFixed(4));
}

function resolvePptxGenJsConstructor(): PptxGenJsConstructor {
  const candidates = [
    ...collectPptxGenJsCandidates(PptxGenJSImport),
    ...collectPptxGenJsCandidates(nodeRequire("pptxgenjs"))
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as PptxGenJsConstructor;
    }
  }

  throw new Error("PptxGenJS constructor is unavailable");
}

function collectPptxGenJsCandidates(value: unknown): unknown[] {
  const candidates: unknown[] = [];
  const visited = new Set<unknown>();

  const visit = (candidate: unknown) => {
    if (!candidate || visited.has(candidate)) {
      return;
    }

    visited.add(candidate);
    candidates.push(candidate);

    if (typeof candidate !== "object" && typeof candidate !== "function") {
      return;
    }

    const shaped = candidate as {
      default?: unknown;
      PptxGenJS?: unknown;
      pptxgenjs?: unknown;
    };

    visit(readOptionalExport(shaped, "default"));
    visit(readOptionalExport(shaped, "PptxGenJS"));
    visit(readOptionalExport(shaped, "pptxgenjs"));
  };

  visit(value);
  return candidates;
}

function readOptionalExport(
  value: { default?: unknown; PptxGenJS?: unknown; pptxgenjs?: unknown },
  key: "default" | "PptxGenJS" | "pptxgenjs"
): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

interface PptxGenJsInstance {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  defineLayout: (input: { name: string; width: number; height: number }) => void;
  addSlide: () => PptxSlide;
  writeFile: (input: { fileName: string }) => Promise<string>;
}

interface PptxGenJsConstructor {
  new (): PptxGenJsInstance;
}

interface PptxSlide {
  background: { color: string };
  addImage: (input: {
    data: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }) => void;
}
