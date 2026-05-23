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

export interface PresentationRenderResult {
  pageCount: number;
  pageSize: {
    width: number;
    height: number;
  };
  renderPdf(outputFilePath: string): Promise<void>;
  renderPageImages(): Promise<PresentationPageImage[]>;
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
        const pageImages = await capturePageImages(page, layout.pageCount, input.signal);
        await page.setContent(
          buildImagePdfDocument(pageImages, layout.width, layout.height),
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
