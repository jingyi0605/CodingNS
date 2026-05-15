import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright-core";

import type { HostConfig } from "../../config/env.js";

const PRESENTATION_PAGE_SELECTORS = [
  "section.slide",
  ".deck > .slide",
  ".slide[data-title]",
  ".slide[data-slide]"
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
    await page.setContent(
      injectBaseHref(input.htmlContent, sourceDirUrl),
      {
        waitUntil: "load",
        timeout: 20_000
      }
    );
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
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
        element.style?.setProperty?.("position", "relative", "important");
        element.style?.setProperty?.("left", "auto", "important");
        element.style?.setProperty?.("top", "auto", "important");
        element.style?.setProperty?.("transform", "none", "important");
        element.style?.setProperty?.("overflow", "hidden", "important");
        element.style?.setProperty?.("width", `${width}px`, "important");
        element.style?.setProperty?.("height", `${height}px`, "important");
        element.style?.setProperty?.("margin", "0", "important");
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
        [data-cns-export-page-list="true"] {
          display: block !important;
          width: auto !important;
          height: auto !important;
          transform: none !important;
        }
        [data-cns-export-page="true"] {
          display: block !important;
          break-after: page;
          page-break-after: always;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        [data-cns-export-page="true"]:last-child {
          break-after: auto;
          page-break-after: auto;
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
        const pageImages: PresentationPageImage[] = [];

        for (let index = 0; index < layout.pageCount; index += 1) {
          input.signal.throwIfAborted();
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
