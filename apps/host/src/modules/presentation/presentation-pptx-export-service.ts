import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as PptxGenJSImport from "pptxgenjs";

import type { HostConfig } from "../../config/env.js";
import {
  renderPresentationDocument,
  type PresentationEditableElement,
  type PresentationEditableImageElement,
  type PresentationEditablePage,
  type PresentationEditableShapeElement,
  type PresentationEditableTextElement
} from "./presentation-renderer.js";

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
      const editablePages = await rendered.renderEditablePages();
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

      for (const editablePage of editablePages) {
        input.signal.throwIfAborted();
        const slide = pptx.addSlide();
        slide.background = { color: toHexColor(editablePage.backgroundColor) ?? "FFFFFF" };
        addEditablePageToSlide(slide, editablePage);
      }

      if (editablePages.length === 0) {
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

function addEditablePageToSlide(slide: PptxSlide, editablePage: PresentationEditablePage): void {
  for (const element of editablePage.elements ?? []) {
    addEditableElementToSlide(slide, element);
  }
}

function addEditableElementToSlide(slide: PptxSlide, element: PresentationEditableElement): void {
  if (element.type === "shape") {
    addShapeElementToSlide(slide, element);
    return;
  }

  if (element.type === "image") {
    addImageElementToSlide(slide, element);
    return;
  }

  addTextElementToSlide(slide, element);
}

function addShapeElementToSlide(slide: PptxSlide, element: PresentationEditableShapeElement): void {
  const fillColor = toHexColor(element.style.backgroundColor);
  const borderColor = toHexColor(element.style.borderColor);

  slide.addShape("roundRect", {
    ...toPptxBox(element.box),
    fill: fillColor
      ? { color: fillColor, transparency: toTransparency(element.style.opacity) }
      : { color: "FFFFFF", transparency: 100 },
    line: borderColor && element.style.borderWidth > 0
      ? {
        color: borderColor,
        transparency: toTransparency(element.style.opacity),
        width: pxToPt(element.style.borderWidth)
      }
      : { color: "FFFFFF", transparency: 100 },
    radius: pxToInches(Math.min(element.style.borderRadius, element.box.width / 2, element.box.height / 2))
  });
}

function addImageElementToSlide(slide: PptxSlide, element: PresentationEditableImageElement): void {
  if (!element.dataUrl) {
    return;
  }

  slide.addImage({
    data: element.dataUrl,
    ...toPptxBox(element.box),
    transparency: toTransparency(element.style.opacity ?? 1)
  });
}

function addTextElementToSlide(slide: PptxSlide, element: PresentationEditableTextElement): void {
  const color = toHexColor(element.style.color) ?? "222222";

  slide.addText(element.text, {
    ...toPptxBox(element.box),
    color,
    fontFace: element.style.fontFamily || "Arial",
    fontSize: pxToPt(element.style.fontSize || 16),
    bold: isBoldFontWeight(element.style.fontWeight),
    italic: element.style.fontStyle === "italic" || element.style.fontStyle === "oblique",
    align: toPptxTextAlign(element.style.textAlign),
    margin: 0,
    breakLine: false,
    fit: "shrink",
    isTextBox: true,
    valign: "top",
    transparency: toTransparency(element.style.opacity ?? 1)
  });
}

function toPptxBox(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: pxToInches(box.x),
    y: pxToInches(box.y),
    w: pxToInches(box.width),
    h: pxToInches(box.height)
  };
}

function pxToInches(value: number): number {
  return Number((value / 96).toFixed(4));
}

function pxToPt(value: number): number {
  return Number((value * 0.75).toFixed(2));
}

function toHexColor(value: string | undefined | null): string | null {
  const rgba = parseCssColor(value ?? "");

  if (!rgba || rgba.alpha <= 0.01) {
    return null;
  }

  return [rgba.red, rgba.green, rgba.blue]
    .map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function parseCssColor(value: string): { red: number; green: number; blue: number; alpha: number } | null {
  const normalized = value.trim();

  if (!normalized || normalized === "transparent") {
    return null;
  }

  const rgba = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1]?.split(",").map((part) => part.trim()) ?? [];
    const red = Number.parseFloat(parts[0] ?? "0");
    const green = Number.parseFloat(parts[1] ?? "0");
    const blue = Number.parseFloat(parts[2] ?? "0");
    const alpha = parts.length >= 4 ? Number.parseFloat(parts[3] ?? "1") : 1;

    if ([red, green, blue, alpha].every(Number.isFinite)) {
      return { red: Math.round(red), green: Math.round(green), blue: Math.round(blue), alpha };
    }
  }

  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1] ?? "";
    const full = raw.length === 3
      ? raw.split("").map((char) => `${char}${char}`).join("")
      : raw;
    return {
      red: Number.parseInt(full.slice(0, 2), 16),
      green: Number.parseInt(full.slice(2, 4), 16),
      blue: Number.parseInt(full.slice(4, 6), 16),
      alpha: 1
    };
  }

  return null;
}

function toTransparency(opacity: number): number {
  const clamped = Math.max(0, Math.min(1, opacity));
  return Number(((1 - clamped) * 100).toFixed(2));
}

function isBoldFontWeight(value: string | undefined): boolean {
  const numeric = Number.parseInt(value ?? "", 10);
  return Number.isFinite(numeric) ? numeric >= 600 : value === "bold" || value === "bolder";
}

function toPptxTextAlign(value: string | undefined): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "right" || value === "justify") {
    return value;
  }

  return "left";
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
    transparency?: number;
  }) => void;
  addShape: (shapeName: string, input: {
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: { color: string; transparency?: number };
    line?: { color: string; transparency?: number; width?: number };
    radius?: number;
  }) => void;
  addText: (text: string, input: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    fontFace: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    align: "left" | "center" | "right" | "justify";
    margin: number;
    breakLine: boolean;
    fit: "shrink";
    isTextBox: boolean;
    valign: "top";
    transparency?: number;
  }) => void;
}
