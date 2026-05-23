import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright-core";

import type { HostConfig } from "../../config/env.js";

const PRESENTATION_PAGE_SELECTORS = [
  ".reveal .slides > section",
  "body .deck > section.slide",
  "body .deck > .slide",
  "section.slide",
  ".deck > .slide",
  ".slide[data-title]",
  ".slide[data-slide]",
  "[data-slide]",
  "[data-title]",
  ".swiper-slide"
] as const;

export interface RenderPresentationDocumentInput {
  htmlContent: string;
  sourceFilePath: string;
  signal: AbortSignal;
}

export interface PresentationPageImage {
  index: number;
  dataUrl: string;
}

export interface PresentationEditablePage {
  index: number;
  backgroundColor: string;
  elements: PresentationEditableElement[];
}

export type PresentationEditableElement =
  | PresentationEditableShapeElement
  | PresentationEditableImageElement
  | PresentationEditableTextElement;

export interface PresentationEditableBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PresentationEditableShapeElement {
  type: "shape";
  box: PresentationEditableBox;
  style: {
    backgroundColor: string;
    backgroundImage: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    opacity: number;
  };
}

export interface PresentationEditableImageElement {
  type: "image";
  box: PresentationEditableBox;
  dataUrl: string;
  alt: string;
  style: {
    opacity: number;
    borderRadius: number;
  };
}

export interface PresentationEditableTextElement {
  type: "text";
  box: PresentationEditableBox;
  text: string;
  style: {
    color: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    lineHeight: number;
    textAlign: string;
    opacity: number;
  };
}

export interface PresentationRenderResult {
  pageCount: number;
  pageSize: {
    width: number;
    height: number;
  };
  renderPdf(outputFilePath: string): Promise<void>;
  renderPageImages(): Promise<PresentationPageImage[]>;
  renderEditablePages(): Promise<PresentationEditablePage[]>;
  close(): Promise<void>;
}

export async function renderPresentationDocument(
  config: HostConfig,
  input: RenderPresentationDocumentInput
): Promise<PresentationRenderResult> {
  input.signal.throwIfAborted();

  const browser = await chromium.launch({
    headless: true,
    executablePath: resolvePreferredBrowserExecutablePath(config)
  });
  const closeBrowserOnAbort = () => {
    void browser.close().catch(() => undefined);
  };

  input.signal.addEventListener("abort", closeBrowserOnAbort, { once: true });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1600,
        height: 900
      }
    });
    await page.emulateMedia({ media: "screen" });
    input.signal.throwIfAborted();

    const sourceDirUrl = pathToFileURL(path.dirname(input.sourceFilePath)).href;
    const htmlContent = inlineLocalImageSources(
      injectBaseHref(input.htmlContent, sourceDirUrl),
      input.sourceFilePath
    );
    await page.setContent(
      htmlContent,
      {
        waitUntil: "load",
        timeout: 20_000
      }
    );
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    await waitForPresentationImages(page).catch(() => undefined);
    input.signal.throwIfAborted();

    const layout = await page.evaluate((selectors) => {
      const runtimeGlobal = globalThis as unknown as {
        document: {
          querySelectorAll: (selector: string) => ArrayLike<unknown>;
          body: {
            children: ArrayLike<unknown>;
          };
          documentElement: {
            clientWidth?: number;
          };
          getElementById: (id: string) => { remove?: () => void } | null;
          createElement: (tagName: string) => {
            id?: string;
            textContent?: string;
          };
          head: {
            appendChild: (node: unknown) => void;
          };
        };
        window: {
          innerHeight?: number;
        };
      };
      const doc = runtimeGlobal.document;
      const win = runtimeGlobal.window;
      const selectorList = [...selectors];
      let pageRoots: Array<{
        isConnected?: boolean;
        parentElement?: unknown;
        getBoundingClientRect?: () => { width?: number; height?: number };
        offsetWidth?: number;
        offsetHeight?: number;
        setAttribute?: (name: string, value: string) => void;
        removeAttribute?: (name: string) => void;
        style?: {
          setProperty?: (name: string, value: string, priority?: string) => void;
        };
      }> = [];

      for (const selector of selectorList) {
        const matched = Array.from(doc.querySelectorAll(selector))
          .filter((element) => {
            if (!element || typeof element !== "object") {
              return false;
            }

            return Boolean((element as { isConnected?: boolean }).isConnected);
          }) as typeof pageRoots;

        if (matched.length > 1) {
          pageRoots = matched;
          break;
        }

        if (matched.length === 1 && pageRoots.length === 0) {
          pageRoots = matched;
        }
      }

      if (pageRoots.length === 0) {
        const bodyChildren = Array.from(doc.body.children)
          .filter(Boolean);

        pageRoots = bodyChildren.length > 0
          ? bodyChildren as typeof pageRoots
          : [doc.body as unknown as (typeof pageRoots)[number]];
      }

      const firstPage = pageRoots[0] ?? doc.body as unknown as (typeof pageRoots)[number];
      const firstRect = firstPage.getBoundingClientRect?.() ?? {};
      const width = Math.max(
        1,
        Math.round(firstRect?.width || firstPage.offsetWidth || doc.documentElement.clientWidth || 1280)
      );
      const height = Math.max(
        1,
        Math.round(firstRect?.height || firstPage.offsetHeight || win.innerHeight || 720)
      );

      const sharedParent = pageRoots.every((element) => element.parentElement === pageRoots[0]?.parentElement)
        ? pageRoots[0]?.parentElement
        : null;

      doc.getElementById("cns-presentation-export-style")?.remove?.();

      if (sharedParent && typeof sharedParent === "object" && "setAttribute" in sharedParent) {
        (sharedParent as { setAttribute: (name: string, value: string) => void })
          .setAttribute("data-cns-export-page-list", "true");
      }

      pageRoots.forEach((element, index) => {
        element.setAttribute?.("data-cns-export-page", "true");
        element.setAttribute?.("data-cns-export-page-index", String(index));
        element.removeAttribute?.("hidden");
        element.setAttribute?.("aria-hidden", "false");
        (element as { classList?: { add?: (...classNames: string[]) => void } }).classList?.add?.("active");
        element.style?.setProperty?.("opacity", "1", "important");
        element.style?.setProperty?.("visibility", "visible", "important");
      });

      const style = doc.createElement("style");
      style.id = "cns-presentation-export-style";
      style.textContent = `
        @page {
          size: ${width}px ${height}px;
          margin: 0;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
        [class*="fade-"], [class*="reveal-"], [class*="animate-"],
        [data-animate], [data-animation] {
          opacity: 1 !important;
          transform: none !important;
          filter: none !important;
        }
        .toc, .controls, .progress {
          display: none !important;
        }
        [data-cns-export-page-list="true"] {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        [data-cns-export-page="true"] {
          opacity: 1 !important;
          visibility: visible !important;
        }
        [data-cns-export-page]:not([data-cns-export-active="true"]) {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
      `;
      doc.head.appendChild(style);

      return {
        width,
        height,
        pageCount: pageRoots.length
      };
    }, PRESENTATION_PAGE_SELECTORS);

    return {
      pageCount: layout.pageCount,
      pageSize: {
        width: layout.width,
        height: layout.height
      },
      renderPdf: async (outputFilePath: string) => {
        input.signal.throwIfAborted();
        fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
        const editablePages = await extractEditablePages(page, layout.pageCount, input.signal);
        await page.setContent(
          buildEditablePdfDocument(editablePages, layout.width, layout.height),
          {
            waitUntil: "load",
            timeout: 20_000
          }
        );
        await page.pdf({
          path: outputFilePath,
          printBackground: true,
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          margin: {
            top: "0",
            right: "0",
            bottom: "0",
            left: "0"
          },
          preferCSSPageSize: true
        });
      },
      renderPageImages: async () => {
        input.signal.throwIfAborted();
        return await capturePageImages(page, layout.pageCount, input.signal);
      },
      renderEditablePages: async () => {
        input.signal.throwIfAborted();
        return await extractEditablePages(page, layout.pageCount, input.signal);
      },
      close: async () => {
        input.signal.removeEventListener("abort", closeBrowserOnAbort);
        await browser.close().catch(() => undefined);
      }
    };
  } catch (error) {
    input.signal.removeEventListener("abort", closeBrowserOnAbort);
    await browser.close().catch(() => undefined);
    throw error;
  }
}

function inlineLocalImageSources(htmlContent: string, sourceFilePath: string): string {
  const sourceDir = path.dirname(sourceFilePath);

  return htmlContent.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (fullMatch: string, prefix: string, quote: string, rawSrc: string) => {
      const imageFilePath = resolveLocalImagePath(rawSrc, sourceDir);

      if (!imageFilePath || !fs.existsSync(imageFilePath)) {
        return fullMatch;
      }

      const stat = fs.statSync(imageFilePath);
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024) {
        return fullMatch;
      }

      const mimeType = resolveImageMimeType(imageFilePath);
      if (!mimeType) {
        return fullMatch;
      }

      const dataUrl = `data:${mimeType};base64,${fs.readFileSync(imageFilePath).toString("base64")}`;
      return `${prefix}${quote}${escapeHtmlAttribute(dataUrl)}${quote}`;
    }
  );
}

function resolveLocalImagePath(rawSrc: string, sourceDir: string): string | null {
  const trimmed = rawSrc.trim();

  if (!trimmed || trimmed.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !trimmed.startsWith("file:")) {
    return null;
  }

  try {
    if (trimmed.startsWith("file:")) {
      return fileURLToPath(trimmed);
    }

    const cleanSrc = trimmed.split(/[?#]/, 1)[0] ?? "";
    if (!cleanSrc || path.isAbsolute(cleanSrc)) {
      return cleanSrc || null;
    }

    return path.resolve(sourceDir, decodeURIComponent(cleanSrc));
  } catch {
    return null;
  }
}

function resolveImageMimeType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".apng":
    case ".png":
      return "image/png";
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function injectBaseHref(htmlContent: string, baseHref: string): string {
  const baseTag = `<base href="${escapeHtmlAttribute(baseHref)}">`;

  if (/<base[\s>]/i.test(htmlContent)) {
    return htmlContent;
  }

  if (/<head[^>]*>/i.test(htmlContent)) {
    return htmlContent.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  if (/<html[^>]*>/i.test(htmlContent)) {
    return htmlContent.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }

  return `<!doctype html><html><head>${baseTag}</head><body>${htmlContent}</body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
}

function resolvePreferredBrowserExecutablePath(config: HostConfig): string | undefined {
  if (config.chromeExecutablePath && fs.existsSync(config.chromeExecutablePath)) {
    return config.chromeExecutablePath;
  }

  if (config.edgeExecutablePath && fs.existsSync(config.edgeExecutablePath)) {
    return config.edgeExecutablePath;
  }

  return undefined;
}

async function capturePageImages(
  page: Page,
  pageCount: number,
  signal: AbortSignal
): Promise<PresentationPageImage[]> {
  const pageImages: PresentationPageImage[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    signal.throwIfAborted();
    await setActiveExportPage(page, index);
    await waitForPresentationImages(page).catch(() => undefined);
    await page.waitForTimeout(50).catch(() => undefined);
    const locator = page.locator(`[data-cns-export-page-index="${index}"]`);
    const imageBase64 = await locator.screenshot({
      type: "png",
      timeout: 15_000
    });

    pageImages.push({
      index,
      dataUrl: `data:image/png;base64,${imageBase64.toString("base64")}`
    });
  }

  return pageImages;
}

async function waitForPresentationImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const runtimeGlobal = globalThis as unknown as {
      document: {
        images: ArrayLike<{
          complete: boolean;
          naturalWidth: number;
          decode?: () => Promise<void>;
          addEventListener?: (
            type: "load" | "error",
            listener: () => void,
            options?: { once?: boolean }
          ) => void;
        }>;
      };
      Promise: PromiseConstructor;
      setTimeout: (callback: () => void, timeout: number) => unknown;
    };
    const images = Array.from(runtimeGlobal.document.images);

    await runtimeGlobal.Promise.all(images.map(async (image) => {
      if (image.complete && image.naturalWidth > 0) {
        return;
      }

      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }

      if (image.complete) {
        return;
      }

      await new runtimeGlobal.Promise<void>((resolve) => {
        image.addEventListener?.("load", resolve, { once: true });
        image.addEventListener?.("error", resolve, { once: true });
        runtimeGlobal.setTimeout(resolve, 3000);
      });
    }));
  });
}

async function setActiveExportPage(page: Page, index: number): Promise<void> {
  await page.evaluate((activeIndex) => {
    const doc = (globalThis as unknown as {
      document: {
        querySelectorAll: (selector: string) => ArrayLike<{
          getAttribute: (name: string) => string | null;
          setAttribute: (name: string, value: string) => void;
          removeAttribute: (name: string) => void;
        }>;
      };
    }).document;

    Array.from(doc.querySelectorAll("[data-cns-export-page]"))
      .forEach((element) => {
        if (element.getAttribute("data-cns-export-page-index") === String(activeIndex)) {
          element.setAttribute("data-cns-export-active", "true");
          return;
        }

        element.removeAttribute("data-cns-export-active");
      });
  }, index);
}

async function extractEditablePages(
  page: Page,
  pageCount: number,
  signal: AbortSignal
): Promise<PresentationEditablePage[]> {
  const pages: PresentationEditablePage[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    signal.throwIfAborted();
    await setActiveExportPage(page, index);
    await waitForPresentationImages(page).catch(() => undefined);
    await page.waitForTimeout(50).catch(() => undefined);
    pages.push(await extractActiveEditablePage(page, index));
  }

  return pages;
}

async function extractActiveEditablePage(page: Page, index: number): Promise<PresentationEditablePage> {
  const script = `(() => {
    const root = document.querySelector('[data-cns-export-page-index="${index}"]');
    if (!root) {
      return { index: ${index}, backgroundColor: 'rgb(255, 255, 255)', elements: [] };
    }
    const rootRect = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    const elements = [];
    const walk = Array.from(root.querySelectorAll('*'));
    const roundNumber = (value) => Number(value.toFixed(3));
    const parseCssPixels = (value) => {
      const parsed = Number.parseFloat(value || '0');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const parseLineHeight = (value, fontSize) => {
      if (!value || value === 'normal') return fontSize * 1.2;
      return parseCssPixels(value) || fontSize * 1.2;
    };
    const hasVisiblePaint = (value) => {
      if (!value || value === 'transparent') return false;
      const rgba = value.match(/rgba?\\(([^)]+)\\)/i);
      if (!rgba) return true;
      const parts = (rgba[1] || '').split(',').map((part) => part.trim());
      const alpha = parts.length >= 4 ? Number.parseFloat(parts[3] || '1') : 1;
      return !Number.isFinite(alpha) || alpha > 0.01;
    };
    const normalizeFontFamily = (value) => {
      const first = (value.split(',')[0] || '').trim() || 'Arial';
      return first.replace(/^['\"]|['\"]$/g, '');
    };
    const toBox = (rect) => ({
      x: roundNumber(rect.left - rootRect.left),
      y: roundNumber(rect.top - rootRect.top),
      width: roundNumber(rect.width),
      height: roundNumber(rect.height)
    });
    const isVisible = (style, rect) => {
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01;
    };
    const readDirectText = (element) => {
      const text = Array.from(element.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      if (text) return text;
      if ((element.children?.length || 0) === 0) {
        return (element.textContent || '').replace(/\\s+/g, ' ').trim();
      }
      return '';
    };

    for (const element of walk) {
      const tagName = String(element.tagName || '').toLowerCase();
      if (['script', 'style', 'noscript', 'template'].includes(tagName)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!isVisible(style, rect)) continue;
      const box = toBox(rect);
      const borderWidth = parseCssPixels(style.borderTopWidth);
      const backgroundColor = style.backgroundColor;
      const backgroundImage = style.backgroundImage === 'none' ? '' : style.backgroundImage;
      const borderColor = style.borderTopColor;
      const borderRadius = parseCssPixels(style.borderTopLeftRadius);
      const opacity = Number(style.opacity || '1');
      const hasFill = hasVisiblePaint(backgroundColor) || backgroundImage.length > 0;
      const hasBorder = borderWidth > 0.2 && hasVisiblePaint(borderColor);
      if ((hasFill || hasBorder) && box.width > 2 && box.height > 2) {
        elements.push({
          type: 'shape',
          box,
          style: {
            backgroundColor,
            backgroundImage,
            borderColor,
            borderWidth: roundNumber(borderWidth),
            borderRadius: roundNumber(borderRadius),
            opacity: roundNumber(opacity)
          }
        });
      }
      if (tagName === 'img') {
        const dataUrl = element.currentSrc || element.src || element.getAttribute('src') || '';
        if (dataUrl) {
          elements.push({
            type: 'image',
            box,
            dataUrl,
            alt: element.alt || '',
            style: {
              opacity: roundNumber(opacity),
              borderRadius: roundNumber(borderRadius)
            }
          });
        }
      }
      const directText = readDirectText(element);
      if (directText) {
        const fontSize = parseCssPixels(style.fontSize);
        elements.push({
          type: 'text',
          box,
          text: directText,
          style: {
            color: style.color,
            fontFamily: normalizeFontFamily(style.fontFamily),
            fontSize: roundNumber(fontSize),
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            lineHeight: roundNumber(parseLineHeight(style.lineHeight, fontSize)),
            textAlign: style.textAlign,
            opacity: roundNumber(opacity)
          }
        });
      }
    }
    return {
      index: ${index},
      backgroundColor: rootStyle.backgroundColor || 'rgb(255, 255, 255)',
      elements
    };
  })()`;

  return await page.evaluate(script) as PresentationEditablePage;
}

function buildEditablePdfDocument(
  pages: PresentationEditablePage[] | unknown,
  width: number,
  height: number
): string {
  const normalizedPages = normalizeEditablePages(pages);
  const pageHtml = normalizedPages
    .map((presentationPage) => {
      const elements = (presentationPage.elements ?? [])
        .map((element) => buildEditablePdfElement(element))
        .join("");

      return `<section class="cns-export-page" style="background:${escapeHtmlAttribute(presentationPage.backgroundColor || "#fff")}">${elements}</section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: ${width}px ${height}px;
      margin: 0;
    }
    html,
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    * {
      box-sizing: border-box;
    }
    .cns-export-page {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cns-export-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .cns-export-el {
      position: absolute;
      overflow: hidden;
    }
    .cns-export-text {
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    .cns-export-image {
      object-fit: fill;
    }
  </style>
</head>
<body>${pageHtml}</body>
</html>`;
}

function normalizeEditablePages(pages: PresentationEditablePage[] | unknown): PresentationEditablePage[] {
  return Array.isArray(pages) ? pages as PresentationEditablePage[] : [];
}

function buildEditablePdfElement(element: PresentationEditableElement): string {
  const boxStyle = `left:${element.box.x}px;top:${element.box.y}px;width:${element.box.width}px;height:${element.box.height}px;`;

  if (element.type === "shape") {
    const backgroundStyle = element.style.backgroundImage
      ? `background-image:${element.style.backgroundImage};background-color:${element.style.backgroundColor};`
      : `background:${element.style.backgroundColor};`;
    const borderStyle = element.style.borderWidth > 0
      ? `border:${element.style.borderWidth}px solid ${element.style.borderColor};`
      : "border:0;";

    return `<div class="cns-export-el" style="${boxStyle}${backgroundStyle}${borderStyle}border-radius:${element.style.borderRadius}px;opacity:${element.style.opacity};"></div>`;
  }

  if (element.type === "image") {
    return `<img class="cns-export-el cns-export-image" src="${escapeHtmlAttribute(element.dataUrl)}" alt="${escapeHtmlAttribute(element.alt)}" style="${boxStyle}opacity:${element.style.opacity};border-radius:${element.style.borderRadius}px;">`;
  }

  return `<div class="cns-export-el cns-export-text" style="${boxStyle}color:${element.style.color};font-family:${escapeHtmlAttribute(element.style.fontFamily)};font-size:${element.style.fontSize}px;font-weight:${element.style.fontWeight};font-style:${element.style.fontStyle};line-height:${element.style.lineHeight}px;text-align:${element.style.textAlign};opacity:${element.style.opacity};">${escapeHtmlText(element.text)}</div>`;
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildImagePdfDocument(
  pageImages: PresentationPageImage[],
  width: number,
  height: number
): string {
  const pages = pageImages
    .map((image) => `
      <section class="cns-export-page">
        <img src="${escapeHtmlAttribute(image.dataUrl)}" alt="Slide ${image.index + 1}">
      </section>
    `)
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: ${width}px ${height}px;
      margin: 0;
    }
    html,
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    .cns-export-page {
      width: ${width}px;
      height: ${height}px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }
    .cns-export-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .cns-export-page img {
      display: block;
      width: ${width}px;
      height: ${height}px;
      object-fit: fill;
    }
  </style>
</head>
<body>${pages}</body>
</html>`;
}
