import { t } from "../../shared/i18n";
import type {
  DocumentAsset,
  DocumentNode,
  DocumentNodeContent,
  DocumentTextRun,
  DocumentNodeStyle,
  DocumentProject,
  PresentationProbePage,
  PresentationProbeResult,
  ProjectWarning,
  SourceRef
} from "./model";

const DEFAULT_VIEWPORT = {
  width: 1600,
  height: 900
} as const;

const PAGE_SELECTORS = [
  {
    strategy: "deck-section-slide",
    selector: "body .deck > section.slide"
  },
  {
    strategy: "deck-direct-slide",
    selector: "body .deck > .slide"
  },
  {
    strategy: "section-slide",
    selector: "section.slide"
  },
  {
    strategy: "slide-data-title",
    selector: ".slide[data-title]"
  },
  {
    strategy: "slide-data-slide",
    selector: ".slide[data-slide]"
  },
  {
    strategy: "deck-direct-child",
    selector: "body > .deck > *"
  }
] as const;

const MAIN_CONTENT_SELECTORS = [
  ".panel",
  ".slide-shell",
  ".content",
  ".hero-main",
  ".slide-inner"
];

const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "P", "LI", "SPAN", "BUTTON", "A"]);
const DECORATION_SELECTORS = [
  ".slide-progress",
  ".progress-bar",
  ".ctrl-btn",
  ".toc",
  ".particle",
  ".particles",
  ".bg-glow",
  ".bg-grid",
  ".page",
  "script"
].join(", ");

const BLOCK_KEYWORDS = [
  "card",
  "panel",
  "metric",
  "kpi",
  "module",
  "feature",
  "timeline",
  "diagram",
  "table",
  "grid",
  "shell",
  "content"
];

const STYLE_KEY_TO_CSS_PROPERTY: Record<keyof DocumentNodeStyle, string> = {
  position: "position",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  fontStyle: "font-style",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  color: "color",
  textAlign: "text-align",
  textDecoration: "text-decoration",
  textDecorationColor: "text-decoration-color",
  whiteSpace: "white-space",
  padding: "padding",
  margin: "margin",
  borderRadius: "border-radius",
  borderWidth: "border-width",
  borderColor: "border-color",
  backgroundColor: "background-color",
  opacity: "opacity"
};

interface ResolvedPageElements {
  strategy: string;
  elements: Element[];
}

export function inspectStaticHtmlPresentation(
  html: string,
  filePath: string
): PresentationProbeResult {
  if (!/\.(html?|HTML?)$/.test(filePath)) {
    return createUnsupportedProbeResult("unsupported-extension");
  }

  const document = parseHtml(html);

  if (!document?.documentElement || !document.querySelector("html")) {
    return createUnsupportedProbeResult("invalid-html");
  }

  const resolvedPages = resolvePageElements(document);

  if (!resolvedPages) {
    return createUnsupportedProbeResult("missing-page-structure");
  }

  const warnings: string[] = [];
  const pages = resolvedPages.elements.map((element, index) => {
    if (element.querySelector("svg")) {
      warnings.push(`第 ${index + 1} 页包含 SVG，只能先按只读节点导入。`);
    }

    if (element.querySelector(DECORATION_SELECTORS)) {
      warnings.push(`第 ${index + 1} 页包含展示壳或装饰层，导入时会过滤非内容节点。`);
    }

    const selector = buildPageSelector(element, index);

    return {
      index,
      title: resolvePageTitle(element, index),
      selector,
      sourceRef: {
        pageIndex: index,
        pageSelector: selector,
        nodePath: []
      }
    } satisfies PresentationProbePage;
  });

  return {
    supported: true,
    reason: null,
    mode: "presentation",
    strategy: resolvedPages.strategy,
    pages,
    warnings: dedupeStrings(warnings),
    viewport: resolveViewport(document, html)
  };
}

export function buildStaticHtmlDocumentProject(input: {
  html: string;
  filePath: string;
  sourceKind?: "codingns" | "desktop";
  version?: string | null;
}): DocumentProject | null {
  const probe = inspectStaticHtmlPresentation(input.html, input.filePath);

  if (!probe.supported) {
    return null;
  }

  const document = parseHtml(input.html);
  const resolvedPages = resolvePageElements(document, probe.strategy ?? undefined);

  if (!resolvedPages) {
    return null;
  }

  const warnings: ProjectWarning[] = probe.warnings.map((message, index) => ({
    code: `probe-warning-${index + 1}`,
    message
  }));
  const nodes: Record<string, DocumentNode> = {};
  const assets: DocumentAsset[] = [];

  const pages = resolvedPages.elements.map((pageElement, index) => {
    const pageId = `page-${index + 1}`;
    const rootNodeId = `${pageId}-root`;
    const mainContainer = resolveMainContentContainer(pageElement);
    const pageSelector = buildPageSelector(pageElement, index);
    const mainContainerPath = resolveElementPath(pageElement, mainContainer);

    nodes[rootNodeId] = createGroupNode({
      id: rootNodeId,
      name: probe.pages[index]?.title ?? `第 ${index + 1} 页`,
      sourceRef: {
        pageIndex: index,
        pageSelector,
        nodePath: mainContainerPath
      },
      runtimeFlags: mainContainer.hasAttribute("data-cns-layout-freeze")
        ? ["layout-freeze-container"]
        : []
    });

    collectChildNodes({
      pageElement,
      containerElement: mainContainer,
      pageIndex: index,
      pageSelector,
      containerPath: mainContainerPath,
      parentNodeId: rootNodeId,
      nodeIdPrefix: rootNodeId,
      nodes,
      assets
    });

    if (!nodes[rootNodeId].children.length) {
      const fallbackText = pageElement.textContent?.replace(/\s+/g, " ").trim() ?? "";

      if (fallbackText) {
        const fallbackNodeId = `${rootNodeId}-fallback-text`;
        nodes[fallbackNodeId] = createTextNode({
          id: fallbackNodeId,
          name: "正文",
          text: fallbackText,
          sourceRef: {
            pageIndex: index,
            pageSelector,
            nodePath: mainContainerPath
          }
        });
        nodes[rootNodeId].children.push(fallbackNodeId);
      }
    }

    return {
      id: pageId,
      order: index,
      title: probe.pages[index]?.title ?? `第 ${index + 1} 页`,
      frame: {
        width: probe.viewport.width,
        height: probe.viewport.height,
        background: null
      },
      rootNodeId,
      sourceRef: {
        pageIndex: index,
        pageSelector,
        nodePath: []
      },
      runtimeHints: {
        hasActiveStateClass: pageElement.classList.contains("active"),
        hasDeckShell: Boolean(pageElement.closest(".deck"))
      }
    };
  });

  return {
    id: buildProjectId(input.filePath),
    schemaVersion: 1,
    mode: "presentation",
    source: {
      kind: input.sourceKind ?? "codingns",
      path: input.filePath,
      version: input.version ?? null,
      entryHtmlHash: hashText(input.html)
    },
    canvas: {
      width: probe.viewport.width,
      height: probe.viewport.height,
      unit: "px",
      aspectRatioLocked: true
    },
    pages,
    nodes,
    assets: dedupeAssets(assets),
    warnings,
    meta: {
      originalTitle: document.title || null,
      pageDetectionStrategy: resolvedPages.strategy
    }
  };
}

export function buildStaticHtmlPresentationPreview(input: {
  html: string;
  pageIndex: number;
  baseHref?: string | null;
}): string | null {
  const project = buildStaticHtmlDocumentProject({
    html: input.html,
    filePath: "preview.html",
    sourceKind: "desktop"
  });

  if (!project) {
    return null;
  }

  return buildStaticHtmlPresentationPreviewFromProject({
    html: input.html,
    project,
    pageIndex: input.pageIndex,
    baseHref: input.baseHref ?? null
  });
}

export function buildStaticHtmlPresentationPreviewFromProject(input: {
  html: string;
  project: DocumentProject;
  pageIndex: number;
  selectedNodeId?: string | null;
  selectedRunIndex?: number | null;
  inlineEditingNodeId?: string | null;
  baseHref?: string | null;
}): string | null {
  return buildStaticHtmlDocumentFromProject({
    html: input.html,
    project: input.project,
    pageIndex: input.pageIndex,
    selectedNodeId: input.selectedNodeId ?? null,
    selectedRunIndex: input.selectedRunIndex ?? null,
    inlineEditingNodeId: input.inlineEditingNodeId ?? null,
    baseHref: input.baseHref ?? null,
    mode: "preview"
  });
}

export function writeStaticHtmlDocumentProject(input: {
  html: string;
  project: DocumentProject;
}): string | null {
  return buildStaticHtmlDocumentFromProject({
    html: input.html,
    project: input.project,
    pageIndex: 0,
    selectedNodeId: null,
    mode: "save"
  });
}

function buildStaticHtmlDocumentFromProject(input: {
  html: string;
  project: DocumentProject;
  pageIndex: number;
  selectedNodeId: string | null;
  selectedRunIndex?: number | null;
  inlineEditingNodeId?: string | null;
  baseHref?: string | null;
  mode: "preview" | "save";
}): string | null {
  const document = parseHtml(input.html);
  const resolvedPages = resolvePageElements(document, input.project.meta.pageDetectionStrategy);

  if (!resolvedPages) {
    return null;
  }

  reconcilePageStructure({
    document,
    project: input.project,
    pageElements: resolvedPages.elements
  });
  const latestResolvedPages = resolvePageElements(document, input.project.meta.pageDetectionStrategy);

  if (!latestResolvedPages) {
    return null;
  }

  if (input.mode === "preview") {
    normalizePreviewViewportScaling(document, input.project);
    applyPreviewBaseHref(document, input.baseHref ?? null);
  }

  latestResolvedPages.elements.forEach((element, index) => {
    if (input.mode === "preview") {
      element.setAttribute("data-cns-page-root", "true");

      if (index === input.pageIndex) {
        element.setAttribute("data-cns-active-page", "true");
      } else {
        element.removeAttribute("data-cns-active-page");
      }

      element.classList.remove("prev", "next");
      element.classList.add("active");
    }
  });

  Object.values(input.project.nodes).forEach((node) => {
    if (hasRuntimeFlag(node, "draft-clone")) {
      return;
    }

    if (!node.sourceRef) {
      return;
    }

    const element = resolveElementBySourceRef(
      latestResolvedPages.elements,
      node.sourceRef
    );

    if (!element) {
      return;
    }

    if (input.mode === "preview") {
      element.setAttribute("data-cns-node-id", node.id);
      element.removeAttribute("data-cns-node-selected");
      element.removeAttribute("data-cns-inline-editing");

      if (input.selectedNodeId && node.id === input.selectedNodeId) {
        element.setAttribute("data-cns-node-selected", "true");
      }

      if (input.inlineEditingNodeId && node.id === input.inlineEditingNodeId) {
        element.setAttribute("data-cns-inline-editing", "true");
      }
    } else {
      element.removeAttribute("data-cns-node-id");
      element.removeAttribute("data-cns-node-selected");
      element.removeAttribute("data-cns-inline-editing");
    }

    applyDocumentNodeToElement(element, node);

    if (input.mode === "preview") {
      mountPreviewTextProxy(element, node, {
        selected: input.selectedNodeId === node.id,
        selectedRunIndex: input.selectedNodeId === node.id ? (input.selectedRunIndex ?? null) : null
      });
    }
  });

  Object.values(input.project.nodes).forEach((node) => {
    if (!hasRuntimeFlag(node, "draft-clone-root")) {
      return;
    }

    renderDraftCloneNode({
      project: input.project,
      pageElements: latestResolvedPages.elements,
      cloneRootNode: node,
      selectedNodeId: input.mode === "preview" ? input.selectedNodeId : null,
      mode: input.mode
    });
  });

  if (input.mode === "preview") {
    stripSourceScripts(document);

    const styleTag = document.createElement("style");
    styleTag.textContent = `
    [data-cns-page-root="true"]:not([data-cns-active-page="true"]) {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    [data-cns-page-root="true"][data-cns-active-page="true"] {
      opacity: 1 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      transform: none !important;
      transition: none !important;
      width: ${input.project.canvas.width}px !important;
      min-width: ${input.project.canvas.width}px !important;
      max-width: ${input.project.canvas.width}px !important;
      height: ${input.project.canvas.height}px !important;
      min-height: ${input.project.canvas.height}px !important;
      max-height: ${input.project.canvas.height}px !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }

    [data-cns-node-selected="true"] {
      outline: 2px solid #007aff !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.14) !important;
    }

    [data-cns-node-host="true"] {
      outline: none !important;
      box-shadow: none !important;
    }

    [data-cns-inline-editing="true"] {
      color: transparent !important;
      text-shadow: none !important;
      caret-color: transparent !important;
    }

    .deck {
      width: ${input.project.canvas.width}px !important;
      min-width: ${input.project.canvas.width}px !important;
      max-width: ${input.project.canvas.width}px !important;
      margin: 0 !important;
    }

    html,
    body {
      width: ${input.project.canvas.width}px !important;
      min-width: ${input.project.canvas.width}px !important;
      max-width: ${input.project.canvas.width}px !important;
      height: ${input.project.canvas.height}px !important;
      min-height: ${input.project.canvas.height}px !important;
      max-height: ${input.project.canvas.height}px !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }

    body {
      transform-origin: center center !important;
    }

    body[data-cns-preview-body-scale-reset="true"] {
      transform: none !important;
    }

    [data-cns-page-root="true"][data-cns-active-page="true"] .fade-up,
    [data-cns-page-root="true"][data-cns-active-page="true"] .roadmap-line,
    [data-cns-page-root="true"][data-cns-active-page="true"] [class*="fade-"],
    [data-cns-page-root="true"][data-cns-active-page="true"] [class*="reveal-"] {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
      transition-delay: 0s !important;
      animation-delay: 0s !important;
    }

    [data-cns-page-root="true"][data-cns-active-page="true"] .typing-cursor {
      opacity: 1 !important;
      animation: none !important;
    }
  `;
    document.head.appendChild(styleTag);

    const bridgeScript = document.createElement("script");
    bridgeScript.setAttribute("data-cns-preview-bridge", "true");
    bridgeScript.textContent = `
    (() => {
      const eventTypes = ["pointerdown", "click", "dblclick"];
      let layoutModeEnabled = false;
      let activeLayoutPointer = null;
      let layoutHoveredNodeId = null;
      const parsePixelValue = (value) => {
        if (!value) {
          return 0;
        }

        const matched = /-?\\d+(?:\\.\\d+)?/.exec(value);
        return matched ? Number(matched[0]) : 0;
      };
      const isTransparentColor = (value) => {
        if (!value) {
          return true;
        }

        const normalized = value.trim().toLowerCase();

        if (normalized === "transparent") {
          return true;
        }

        if (/rgba\\((?:\\d+\\s*,\\s*){3}0(?:\\.0+)?\\)/.test(normalized)) {
          return true;
        }

        return false;
      };
      const resolveTextNodes = (element) => {
        if (!element) {
          return [];
        }

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.textContent && node.textContent.trim()
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
        });
        const textNodes = [];
        let current = walker.nextNode();

        while (current) {
          textNodes.push(current);
          current = walker.nextNode();
        }

        return textNodes;
      };
      const resolveEditableRect = (element, computedStyle) => {
        if (!element || !element.getBoundingClientRect) {
          return {
            rect: null,
            useContentRect: false
          };
        }

        const elementRect = element.getBoundingClientRect();

        if (!computedStyle) {
          return {
            rect: elementRect,
            useContentRect: false
          };
        }

        const paddingLeft = parsePixelValue(computedStyle.paddingLeft);
        const paddingTop = parsePixelValue(computedStyle.paddingTop);
        const paddingRight = parsePixelValue(computedStyle.paddingRight);
        const paddingBottom = parsePixelValue(computedStyle.paddingBottom);
        const borderLeftWidth = parsePixelValue(computedStyle.borderLeftWidth);
        const borderTopWidth = parsePixelValue(computedStyle.borderTopWidth);
        const borderRightWidth = parsePixelValue(computedStyle.borderRightWidth);
        const borderBottomWidth = parsePixelValue(computedStyle.borderBottomWidth);
        const hasSurface = !isTransparentColor(computedStyle.backgroundColor)
          || borderLeftWidth > 0
          || borderTopWidth > 0
          || borderRightWidth > 0
          || borderBottomWidth > 0
          || paddingLeft > 0
          || paddingTop > 0
          || paddingRight > 0
          || paddingBottom > 0;

        if (!hasSurface) {
          return {
            rect: elementRect,
            useContentRect: false
          };
        }

        const textNodes = resolveTextNodes(element);

        if (textNodes.length > 0) {
          const range = document.createRange();
          range.setStart(textNodes[0], 0);
          range.setEnd(textNodes[textNodes.length - 1], textNodes[textNodes.length - 1].textContent.length);
          const textRect = range.getBoundingClientRect();

          if (textRect && textRect.width > 0 && textRect.height > 0) {
            return {
              rect: textRect,
              useContentRect: true
            };
          }
        }

        const innerWidth = Math.max(1, elementRect.width - paddingLeft - paddingRight - borderLeftWidth - borderRightWidth);
        const innerHeight = Math.max(1, elementRect.height - paddingTop - paddingBottom - borderTopWidth - borderBottomWidth);

        return {
          rect: {
            left: elementRect.left + paddingLeft + borderLeftWidth,
            top: elementRect.top + paddingTop + borderTopWidth,
            width: innerWidth,
            height: innerHeight
          },
          useContentRect: true
        };
      };
      const resolveElement = (target) => {
        if (!target || typeof target !== "object") {
          return null;
        }

        if (target.nodeType === Node.TEXT_NODE) {
          return target.parentElement;
        }

        if (target.nodeType === Node.ELEMENT_NODE) {
          return target;
        }

        return null;
      };
      const resolveLayoutMeasurementElement = (nodeId) => {
        const hostElement = document.querySelector('[data-cns-node-host-id="' + CSS.escape(nodeId) + '"]');

        if (hostElement instanceof HTMLElement) {
          return hostElement;
        }

        const element = document.querySelector('[data-cns-node-id="' + CSS.escape(nodeId) + '"]');

        if (!(element instanceof HTMLElement)) {
          return null;
        }

        if (element.parentElement?.getAttribute("data-cns-node-host") === "true") {
          return element.parentElement;
        }

        const hostParent = element.closest('[data-cns-node-host="true"]');
        return hostParent instanceof HTMLElement ? hostParent : element;
      };
      const resolveLayoutParentElement = (element) => {
        if (!(element instanceof HTMLElement)) {
          return document.body instanceof HTMLElement ? document.body : null;
        }

        const positionedParent = element.offsetParent;

        if (positionedParent instanceof HTMLElement) {
          return positionedParent;
        }

        return document.body instanceof HTMLElement ? document.body : null;
      };

      const handler = (event) => {
        const element = resolveElement(event.target);

        if (!element) {
          return;
        }

        const matched = element.closest("[data-cns-node-id]");

        if (!matched) {
          return;
        }

        const nodeId = matched.getAttribute("data-cns-node-id");
        const runIndexValue = matched.getAttribute("data-cns-run-index");
        const runIndex = runIndexValue !== null ? Number.parseInt(runIndexValue, 10) : null;

        if (!nodeId) {
          return;
        }

        const computedStyle = window.getComputedStyle ? window.getComputedStyle(matched) : null;
        const editableRect = resolveEditableRect(matched, computedStyle);
        const payload = {
          type: "codingns-static-html-node-select",
          nodeId,
          runIndex: Number.isInteger(runIndex) ? runIndex : null,
          eventType: event.type,
          metaKey: Boolean(event.metaKey),
          ctrlKey: Boolean(event.ctrlKey),
          rect: editableRect.rect
            ? {
                left: editableRect.rect.left,
                top: editableRect.rect.top,
                width: editableRect.rect.width,
                height: editableRect.rect.height
              }
            : matched.getBoundingClientRect
            ? {
                left: matched.getBoundingClientRect().left,
                top: matched.getBoundingClientRect().top,
                width: matched.getBoundingClientRect().width,
                height: matched.getBoundingClientRect().height
              }
            : null,
          appearance: computedStyle
            ? {
                fontFamily: computedStyle.fontFamily || null,
                fontSize: computedStyle.fontSize || null,
                fontWeight: computedStyle.fontWeight || null,
                fontStyle: computedStyle.fontStyle || null,
                lineHeight: computedStyle.lineHeight || null,
                letterSpacing: computedStyle.letterSpacing || null,
                color: computedStyle.color || null,
                textAlign: computedStyle.textAlign || null,
                whiteSpace: computedStyle.whiteSpace || null,
                padding: editableRect.useContentRect ? "0px" : (computedStyle.padding || null),
                textTransform: computedStyle.textTransform || null
              }
            : null
        };

        window.parent?.postMessage(payload, "*");

        if (layoutModeEnabled && event.type === "pointerdown") {
          if (typeof matched.setPointerCapture === "function" && typeof event.pointerId === "number") {
            try {
              matched.setPointerCapture(event.pointerId);
            } catch {
              // ignore setPointerCapture failures
            }
          }

          activeLayoutPointer = {
            pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
            nodeId
          };

          window.parent?.postMessage({
            type: "codingns-static-html-layout-pointer",
            phase: "start",
            nodeId,
            clientX: event.clientX,
            clientY: event.clientY,
            metaKey: Boolean(event.metaKey),
            ctrlKey: Boolean(event.ctrlKey)
          }, "*");

          event.preventDefault();
        }
      };

      const handlePointerOver = (event) => {
        if (!layoutModeEnabled) {
          return;
        }

        const element = resolveElement(event.target);
        const matched = element?.closest ? element.closest("[data-cns-node-id]") : null;
        const nodeId = matched?.getAttribute("data-cns-node-id")?.trim() || null;

        if (nodeId === layoutHoveredNodeId) {
          return;
        }

        layoutHoveredNodeId = nodeId;
        window.parent?.postMessage({
          type: "codingns-static-html-layout-hover",
          nodeId: nodeId || ""
        }, "*");
      };

      const handlePointerLeaveViewport = () => {
        if (!layoutModeEnabled || !layoutHoveredNodeId) {
          return;
        }

        layoutHoveredNodeId = null;
        window.parent?.postMessage({
          type: "codingns-static-html-layout-hover",
          nodeId: ""
        }, "*");
      };

      const syncSelectionState = (payload) => {
        layoutModeEnabled = Boolean(payload?.layoutModeEnabled);
        layoutHoveredNodeId = typeof payload?.layoutHoveredNodeId === "string" && payload.layoutHoveredNodeId.trim()
          ? payload.layoutHoveredNodeId.trim()
          : null;
        if (!layoutModeEnabled) {
          activeLayoutPointer = null;
          layoutHoveredNodeId = null;
        }

        const selectedNodeId = typeof payload?.selectedNodeId === "string" && payload.selectedNodeId.trim()
          ? payload.selectedNodeId.trim()
          : null;
        const selectedRunIndex = typeof payload?.selectedRunIndex === "number" && Number.isInteger(payload.selectedRunIndex)
          ? payload.selectedRunIndex
          : null;
        const inlineEditingNodeId = typeof payload?.inlineEditingNodeId === "string" && payload.inlineEditingNodeId.trim()
          ? payload.inlineEditingNodeId.trim()
          : null;
        const layoutSelectedNodeIds = Array.isArray(payload?.layoutSelectedNodeIds)
          ? payload.layoutSelectedNodeIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
          : [];

        document.querySelectorAll("[data-cns-node-selected]").forEach((element) => {
          if (element.getAttribute("data-cns-node-id") !== selectedNodeId) {
            element.removeAttribute("data-cns-node-selected");
          }
        });

        document.querySelectorAll("[data-cns-inline-editing]").forEach((element) => {
          if (element.getAttribute("data-cns-node-id") !== inlineEditingNodeId) {
            element.removeAttribute("data-cns-inline-editing");
          }
        });

        if (selectedNodeId) {
          if (selectedRunIndex !== null) {
            const selectedRunElement = document.querySelector(
              '[data-cns-node-id="' + CSS.escape(selectedNodeId) + '"][data-cns-run-index="' + String(selectedRunIndex) + '"]'
            );

            if (selectedRunElement) {
              selectedRunElement.setAttribute("data-cns-node-selected", "true");
            }
          } else {
            const selectedElement = document.querySelector('[data-cns-node-id="' + CSS.escape(selectedNodeId) + '"]');

            if (selectedElement) {
              selectedElement.setAttribute("data-cns-node-selected", "true");
            }
          }
        }

        document.querySelectorAll("[data-cns-layout-selected]").forEach((element) => {
          if (!layoutSelectedNodeIds.includes(element.getAttribute("data-cns-node-id") || "")) {
            element.removeAttribute("data-cns-layout-selected");
          }
        });

        document.querySelectorAll("[data-cns-layout-hovered]").forEach((element) => {
          if (element.getAttribute("data-cns-node-id") !== layoutHoveredNodeId) {
            element.removeAttribute("data-cns-layout-hovered");
          }
        });

        layoutSelectedNodeIds.forEach((nodeId) => {
          const layoutElement = resolveLayoutMeasurementElement(nodeId);

          if (layoutElement) {
            layoutElement.setAttribute("data-cns-layout-selected", "true");
          }
        });

        if (layoutHoveredNodeId) {
          const hoveredElement = resolveLayoutMeasurementElement(layoutHoveredNodeId);

          if (hoveredElement) {
            hoveredElement.setAttribute("data-cns-layout-hovered", "true");
          }
        }

        if (inlineEditingNodeId) {
          const editingElement = document.querySelector('[data-cns-node-id="' + CSS.escape(inlineEditingNodeId) + '"]');

          if (editingElement) {
            editingElement.setAttribute("data-cns-inline-editing", "true");
          }
        }
      };

      const postLayoutMeasurements = (payload) => {
        const nodeIds = Array.isArray(payload?.nodeIds)
          ? payload.nodeIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
          : [];

        const measurements = nodeIds
          .map((nodeId) => {
            const element = resolveLayoutMeasurementElement(nodeId);

            if (!(element instanceof HTMLElement)) {
              return null;
            }

            const rect = element.getBoundingClientRect();
            const parentElement = resolveLayoutParentElement(element);
            const parentRect = parentElement?.getBoundingClientRect?.() ?? null;
            const viewportRect = document.documentElement?.getBoundingClientRect?.() ?? null;
            const localLeft = element.offsetLeft;
            const localTop = element.offsetTop;
            const absoluteLeft = viewportRect ? rect.left - viewportRect.left : rect.left;
            const absoluteTop = viewportRect ? rect.top - viewportRect.top : rect.top;
            const parentLeft = parentRect ? rect.left - parentRect.left : localLeft;
            const parentTop = parentRect ? rect.top - parentRect.top : localTop;

            return {
              nodeId,
              left: absoluteLeft,
              top: absoluteTop,
              width: rect.width,
              height: rect.height,
              localLeft: Number.isFinite(localLeft) ? localLeft : parentLeft,
              localTop: Number.isFinite(localTop) ? localTop : parentTop
            };
          })
          .filter(Boolean);

        window.parent?.postMessage({
          type: "codingns-static-html-layout-measurements",
          measurements
        }, "*");
      };

      eventTypes.forEach((eventType) => {
        document.addEventListener(eventType, handler, true);
      });

      document.addEventListener("pointerover", handlePointerOver, true);
      document.addEventListener("pointerleave", handlePointerLeaveViewport, true);

      document.addEventListener("pointermove", (event) => {
        if (!layoutModeEnabled || !activeLayoutPointer) {
          return;
        }

        if (typeof activeLayoutPointer.pointerId === "number" && event.pointerId !== activeLayoutPointer.pointerId) {
          return;
        }

        window.parent?.postMessage({
          type: "codingns-static-html-layout-pointer",
          phase: "move",
          nodeId: activeLayoutPointer.nodeId,
          clientX: event.clientX,
          clientY: event.clientY
        }, "*");
      }, true);

      const finishLayoutPointer = (event, phase) => {
        if (!activeLayoutPointer) {
          return;
        }

        if (typeof activeLayoutPointer.pointerId === "number" && event.pointerId !== activeLayoutPointer.pointerId) {
          return;
        }

        window.parent?.postMessage({
          type: "codingns-static-html-layout-pointer",
          phase,
          nodeId: activeLayoutPointer.nodeId,
          clientX: event.clientX,
          clientY: event.clientY
        }, "*");

        activeLayoutPointer = null;
      };

      document.addEventListener("pointerup", (event) => {
        finishLayoutPointer(event, "end");
      }, true);

      document.addEventListener("pointercancel", (event) => {
        finishLayoutPointer(event, "cancel");
      }, true);

      window.addEventListener("message", (event) => {
        const payload = event.data;

        if (!payload || typeof payload !== "object") {
          return;
        }

        if (payload.type !== "codingns-static-html-selection-sync") {
          if (payload.type === "codingns-static-html-layout-measure-request") {
            postLayoutMeasurements(payload);
          }

          return;
        }

        syncSelectionState(payload);
      });
    })();
  `;
    document.body.appendChild(bridgeScript);
  } else {
    clearPreviewArtifacts(document);
  }

  return document.documentElement.outerHTML;
}

function applyPreviewBaseHref(document: Document, baseHref: string | null): void {
  const trimmedBaseHref = baseHref?.trim() ?? "";

  if (!trimmedBaseHref) {
    return;
  }

  const head = document.head ?? document.querySelector("head");

  if (!(head instanceof HTMLHeadElement)) {
    return;
  }

  const existingBase = head.querySelector("base");

  if (existingBase) {
    existingBase.setAttribute("href", trimmedBaseHref);
    return;
  }

  const baseElement = document.createElement("base");
  baseElement.setAttribute("href", trimmedBaseHref);
  head.insertBefore(baseElement, head.firstChild);
}

function stripSourceScripts(document: Document): void {
  document.querySelectorAll("script").forEach((element) => {
    element.remove();
  });
}

function normalizePreviewViewportScaling(document: Document, project: DocumentProject): void {
  const body = document.body;

  if (!body || !body.getAttribute) {
    return;
  }

  body.style.width = `${project.canvas.width}px`;
  body.style.minWidth = `${project.canvas.width}px`;
  body.style.maxWidth = `${project.canvas.width}px`;
  body.style.height = `${project.canvas.height}px`;
  body.style.minHeight = `${project.canvas.height}px`;
  body.style.maxHeight = `${project.canvas.height}px`;

  const currentTransform = body.style.transform?.trim() ?? "";
  const hasBodyScaleRule = Array.from(document.querySelectorAll("style")).some((styleElement) => {
    const content = styleElement.textContent ?? "";
    return /body\s*\{[\s\S]*?transform\s*:\s*scale\(/i.test(content);
  });

  if (/scale\(/i.test(currentTransform) && !/translate\(/i.test(currentTransform)) {
    body.style.transform = "none";
  }

  if (hasBodyScaleRule) {
    body.setAttribute("data-cns-preview-body-scale-reset", "true");
  } else {
    body.removeAttribute("data-cns-preview-body-scale-reset");
  }
}

export function updateProjectNode(
  project: DocumentProject,
  nodeId: string,
  updater: (node: DocumentNode) => DocumentNode
): DocumentProject {
  const currentNode = project.nodes[nodeId];

  if (!currentNode) {
    return project;
  }

  return {
    ...project,
    nodes: {
      ...project.nodes,
      [nodeId]: updater(currentNode)
    }
  };
}

export function updateProjectNodes(
  project: DocumentProject,
  nodeIds: string[],
  updater: (node: DocumentNode, nodeId: string) => DocumentNode
): DocumentProject {
  if (nodeIds.length === 0) {
    return project;
  }

  const nextNodes = {
    ...project.nodes
  };
  let changed = false;

  nodeIds.forEach((nodeId) => {
    const currentNode = nextNodes[nodeId];

    if (!currentNode) {
      return;
    }

    nextNodes[nodeId] = updater(currentNode, nodeId);
    changed = true;
  });

  if (!changed) {
    return project;
  }

  return {
    ...project,
    nodes: nextNodes
  };
}

export function duplicateProjectNode(
  project: DocumentProject,
  nodeId: string
): { project: DocumentProject; duplicatedNodeId: string | null } {
  const sourceNode = project.nodes[nodeId];

  if (!sourceNode) {
    return {
      project,
      duplicatedNodeId: null
    };
  }

  const parentNodeId = findParentNodeId(project, nodeId);

  if (!parentNodeId) {
    return {
      project,
      duplicatedNodeId: null
    };
  }

  const nextNodes = {
    ...project.nodes
  };
  const idCounter = createNodeIdCounter(project.nodes);
  const rootDuplicateId = cloneProjectNodeTree({
    project,
    sourceNodeId: nodeId,
    nextNodes,
    idCounter,
    isRoot: true
  });
  const parentNode = nextNodes[parentNodeId];

  if (!parentNode) {
    return {
      project,
      duplicatedNodeId: null
    };
  }

  const sourceIndex = parentNode.children.indexOf(nodeId);
  const nextChildren = [...parentNode.children];
  nextChildren.splice(sourceIndex >= 0 ? sourceIndex + 1 : nextChildren.length, 0, rootDuplicateId);
  nextNodes[parentNodeId] = {
    ...parentNode,
    children: nextChildren
  };

  return {
    project: {
      ...project,
      nodes: nextNodes
    },
    duplicatedNodeId: rootDuplicateId
  };
}

export function appendProjectPage(
  project: DocumentProject,
  options?: {
    insertAfterPageId?: string | null;
  }
): {
  project: DocumentProject;
  pageId: string;
} {
  const currentPageIndex = options?.insertAfterPageId
    ? project.pages.findIndex((page) => page.id === options.insertAfterPageId)
    : -1;
  const insertIndex = currentPageIndex >= 0 ? currentPageIndex + 1 : project.pages.length;
  const pageId = createNextPageId(project);
  const rootNodeId = `${pageId}-root`;
  const previousPage = project.pages[Math.max(0, insertIndex - 1)] ?? project.pages[project.pages.length - 1] ?? null;

  const nextRootNode = createGroupNode({
    id: rootNodeId,
    name: t("conversation.fileViewerPresentationUntitled"),
    sourceRef: null
  });

  const nextPage = {
    id: pageId,
    order: insertIndex,
    title: t("conversation.fileViewerPresentationUntitled"),
    frame: previousPage?.frame ?? {
      width: project.canvas.width,
      height: project.canvas.height,
      background: null
    },
    rootNodeId,
    sourceRef: {
      pageIndex: insertIndex,
      pageSelector: `[data-cns-page-id="${pageId}"]`,
      nodePath: []
    },
    runtimeHints: previousPage?.runtimeHints ?? {
      hasActiveStateClass: false,
      hasDeckShell: true
    }
  };
  const nextPages = [...project.pages];
  nextPages.splice(insertIndex, 0, nextPage);

  return {
    pageId,
    project: normalizeProjectPages({
      ...project,
      pages: nextPages,
      nodes: {
        ...project.nodes,
        [rootNodeId]: nextRootNode
      }
    })
  };
}

export function duplicateProjectPage(
  project: DocumentProject,
  pageId: string
): { project: DocumentProject; pageId: string | null } {
  const sourcePage = project.pages.find((page) => page.id === pageId);

  if (!sourcePage) {
    return {
      project,
      pageId: null
    };
  }

  const sourceIndex = project.pages.findIndex((page) => page.id === pageId);
  const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : project.pages.length;
  const nextPageId = createNextPageId(project);
  const nextRootNodeId = `${nextPageId}-root`;
  const nextNodes = {
    ...project.nodes
  };
  const sourcePageIndex = sourcePage.sourceRef.pageIndex;

  cloneProjectPageNodeTree({
    project,
    sourceNodeId: sourcePage.rootNodeId,
    targetNodeId: nextRootNodeId,
    nextPageId,
    sourcePageIndex,
    nextNodes,
    isRoot: true
  });

  const nextPages = [...project.pages];
  nextPages.splice(insertIndex, 0, {
    ...sourcePage,
    id: nextPageId,
    order: insertIndex,
    title: sourcePage.title,
    rootNodeId: nextRootNodeId,
    sourceRef: {
      ...sourcePage.sourceRef
    }
  });

  return {
    pageId: nextPageId,
    project: normalizeProjectPages({
      ...project,
      pages: nextPages,
      nodes: nextNodes
    })
  };
}

export function removeProjectPage(
  project: DocumentProject,
  pageId: string
): { project: DocumentProject; nextPageId: string | null } {
  if (project.pages.length <= 1) {
    return {
      project,
      nextPageId: project.pages[0]?.id ?? null
    };
  }

  const targetPage = project.pages.find((page) => page.id === pageId);

  if (!targetPage) {
    return {
      project,
      nextPageId: project.pages[0]?.id ?? null
    };
  }

  const pageIndex = project.pages.findIndex((page) => page.id === pageId);
  const nextPages = project.pages.filter((page) => page.id !== pageId);
  const nextNodes = {
    ...project.nodes
  };
  deleteNodeTree(nextNodes, targetPage.rootNodeId);
  const nextProject = normalizeProjectPages({
    ...project,
    pages: nextPages,
    nodes: nextNodes
  });
  const fallbackPage = nextProject.pages[Math.min(pageIndex, nextProject.pages.length - 1)] ?? null;

  return {
    project: nextProject,
    nextPageId: fallbackPage?.id ?? null
  };
}

export function moveProjectPage(
  project: DocumentProject,
  pageId: string,
  direction: "up" | "down"
): { project: DocumentProject; pageId: string | null } {
  const currentIndex = project.pages.findIndex((page) => page.id === pageId);

  if (currentIndex < 0) {
    return {
      project,
      pageId: null
    };
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= project.pages.length) {
    return {
      project,
      pageId
    };
  }

  const nextPages = [...project.pages];
  const currentPage = nextPages[currentIndex]!;
  nextPages[currentIndex] = nextPages[targetIndex]!;
  nextPages[targetIndex] = currentPage;

  return {
    project: normalizeProjectPages({
      ...project,
      pages: nextPages
    }),
    pageId
  };
}

export function moveProjectPageToIndex(
  project: DocumentProject,
  pageId: string,
  targetIndex: number
): { project: DocumentProject; pageId: string | null } {
  const sourceIndex = project.pages.findIndex((page) => page.id === pageId);

  if (sourceIndex < 0) {
    return {
      project,
      pageId: null
    };
  }

  const safeTargetIndex = Math.max(0, Math.min(targetIndex, project.pages.length - 1));

  if (sourceIndex === safeTargetIndex) {
    return {
      project,
      pageId
    };
  }

  const nextPages = [...project.pages];
  const [movedPage] = nextPages.splice(sourceIndex, 1);

  if (!movedPage) {
    return {
      project,
      pageId: null
    };
  }

  nextPages.splice(safeTargetIndex, 0, movedPage);

  return {
    project: normalizeProjectPages({
      ...project,
      pages: nextPages
    }),
    pageId
  };
}

export function listPageNodeIds(
  project: DocumentProject,
  pageId: string
): string[] {
  const page = project.pages.find((item) => item.id === pageId);

  if (!page) {
    return [];
  }

  const result: string[] = [];
  traverseNodeIds(project, page.rootNodeId, result, true);
  return result;
}

function traverseNodeIds(
  project: DocumentProject,
  nodeId: string,
  result: string[],
  skipRoot = false
) {
  const node = project.nodes[nodeId];

  if (!node) {
    return;
  }

  if (!skipRoot) {
    result.push(nodeId);
  }

  node.children.forEach((childNodeId) => {
    traverseNodeIds(project, childNodeId, result);
  });
}

function findParentNodeId(
  project: DocumentProject,
  targetNodeId: string
): string | null {
  return Object.values(project.nodes).find((node) => node.children.includes(targetNodeId))?.id ?? null;
}

function reconcilePageStructure(input: {
  document: Document;
  project: DocumentProject;
  pageElements: Element[];
}): void {
  const { document, project } = input;
  const currentPageElements = [...input.pageElements];
  const pageParent = currentPageElements[0]?.parentElement;

  if (!pageParent) {
    return;
  }

  const templateElement = currentPageElements[currentPageElements.length - 1] ?? document.body.firstElementChild;
  const usedElements = new Set<Element>();
  const orderedElements = project.pages
    .map((page, index) => {
      const matchedElement = resolveProjectPageElement(document, currentPageElements, page);

      if (matchedElement && !usedElements.has(matchedElement)) {
        usedElements.add(matchedElement);
        syncPageElementTitle(matchedElement, page, false, index);
        return matchedElement;
      }

      const createdElement = createProjectPageElement(
        document,
        matchedElement ?? templateElement,
        page,
        index,
        Boolean(matchedElement)
      );

      if (!createdElement) {
        return null;
      }

      syncPageElementTitle(createdElement, page, true, index);
      return createdElement;
    })
    .filter((element): element is Element => element instanceof Element);

  orderedElements.forEach((element) => {
    pageParent.appendChild(element);
  });

  currentPageElements.forEach((element) => {
    if (!usedElements.has(element)) {
      element.remove();
    }
  });
}

function deleteNodeTree(
  nodes: Record<string, DocumentNode>,
  nodeId: string
): void {
  const node = nodes[nodeId];

  if (!node) {
    return;
  }

  node.children.forEach((childNodeId) => {
    deleteNodeTree(nodes, childNodeId);
  });

  delete nodes[nodeId];
}

function normalizeProjectPages(project: DocumentProject): DocumentProject {
  return reindexProjectPageRefs(project);
}

function reindexProjectPageRefs(project: DocumentProject): DocumentProject {
  const nextNodes = {
    ...project.nodes
  };

  return {
    ...project,
    pages: project.pages.map((page, index) => {
      reindexNodePageRefs(nextNodes, page.rootNodeId, index);

      return {
        ...page,
        order: index,
        title: page.title?.trim() ? page.title : t("conversation.fileViewerPresentationUntitled"),
        sourceRef: {
          ...page.sourceRef,
          pageIndex: index
        }
      };
    }),
    nodes: nextNodes
  };
}

function reindexNodePageRefs(
  nodes: Record<string, DocumentNode>,
  nodeId: string,
  pageIndex: number
): void {
  const node = nodes[nodeId];

  if (!node) {
    return;
  }

  if (node.sourceRef) {
    nodes[nodeId] = {
      ...node,
      sourceRef: {
        ...node.sourceRef,
        pageIndex
      }
    };
  }

  node.children.forEach((childNodeId) => {
    reindexNodePageRefs(nodes, childNodeId, pageIndex);
  });
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function resolvePageElements(
  document: Document,
  preferredStrategy?: string
): ResolvedPageElements | null {
  if (preferredStrategy) {
    const selector = resolveSelectorFromStrategy(preferredStrategy);
    const elements = Array.from(document.querySelectorAll(selector));

    if (elements.length > 0) {
      return {
        strategy: preferredStrategy,
        elements
      };
    }
  }

  return PAGE_SELECTORS
    .map((rule) => ({
      strategy: rule.strategy,
      elements: Array.from(document.querySelectorAll(rule.selector))
    }))
    .find((item) => item.elements.length > 0) ?? null;
}

function createUnsupportedProbeResult(reason: string): PresentationProbeResult {
  return {
    supported: false,
    reason,
    mode: "presentation",
    strategy: null,
    pages: [],
    warnings: [],
    viewport: {
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height
    }
  };
}

function resolveSelectorFromStrategy(strategy: string): string {
  return PAGE_SELECTORS.find((item) => item.strategy === strategy)?.selector ?? "section.slide";
}

function resolvePageTitle(element: Element, index: number): string {
  const dataTitle = element.getAttribute("data-title")?.trim();

  if (dataTitle) {
    return dataTitle;
  }

  const heading = element.querySelector("h1, h2, h3, .slide-title, .title, .page-title");
  const headingText = heading?.textContent?.replace(/\s+/g, " ").trim();

  if (headingText) {
    return headingText;
  }

  return `第 ${index + 1} 页`;
}

function buildPageSelector(element: Element, index: number): string {
  const dataTitle = element.getAttribute("data-title");

  if (dataTitle) {
    return `.slide[data-title="${escapeAttributeValue(dataTitle)}"]`;
  }

  if (element.id) {
    return `#${escapeAttributeValue(element.id)}`;
  }

  return `.slide:nth-of-type(${index + 1})`;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function resolveViewport(document: Document, html: string): { width: number; height: number } {
  const styles = Array.from(document.querySelectorAll("style"))
    .map((element) => element.textContent ?? "")
    .join("\n");
  const deckWidth = resolveSizeFromCss(styles, "--deck-width");
  const deckHeight = resolveSizeFromCss(styles, "--deck-height");

  if (deckWidth && deckHeight) {
    return {
      width: deckWidth,
      height: deckHeight
    };
  }

  const inferredViewport = inferViewportFromPresentationCss(styles);

  if (inferredViewport) {
    return inferredViewport;
  }

  return {
    width: DEFAULT_VIEWPORT.width,
    height: DEFAULT_VIEWPORT.height
  };
}

function inferViewportFromPresentationCss(
  styles: string
): { width: number; height: number } | null {
  const slideAspectRatio = resolveAspectRatioFromRule(styles, ".slide");
  const slideWidth = resolvePropertySizeFromRule(styles, ".slide", "width");
  const slideHeight = resolvePropertySizeFromRule(styles, ".slide", "height");
  const slideMaxHeight = resolvePropertySizeFromRule(styles, ".slide", "max-height");

  if (slideWidth && slideHeight) {
    return {
      width: slideWidth,
      height: slideHeight
    };
  }

  if (slideWidth && slideAspectRatio) {
    return {
      width: slideWidth,
      height: Math.round(slideWidth / slideAspectRatio)
    };
  }

  if (slideMaxHeight && slideAspectRatio) {
    return {
      width: Math.round(slideMaxHeight * slideAspectRatio),
      height: slideMaxHeight
    };
  }

  const deckWidth = resolvePropertySizeFromRule(styles, ".deck", "width");
  const deckHeight = resolvePropertySizeFromRule(styles, ".deck", "height");

  if (deckWidth && deckHeight) {
    return {
      width: deckWidth,
      height: deckHeight
    };
  }

  return null;
}

function resolveSizeFromCss(source: string, propertyName: string): number | null {
  const matched = new RegExp(`(?:^|[\\s;{])${escapeRegExp(propertyName)}\\s*:\\s*(\\d{3,5})px`, "i").exec(source);
  return matched ? Number(matched[1]) : null;
}

function resolvePropertySizeFromRule(
  styles: string,
  selector: string,
  propertyName: string
): number | null {
  const block = resolveCssRuleBlock(styles, selector);

  if (!block) {
    return null;
  }

  const directPx = new RegExp(`(?:^|[\\s;])${escapeRegExp(propertyName)}\\s*:\\s*(\\d{3,5})px`, "i").exec(block);

  if (directPx) {
    return Number(directPx[1]);
  }

  const minPx = new RegExp(`(?:^|[\\s;])${escapeRegExp(propertyName)}\\s*:\\s*min\\(\\s*(\\d{3,5})px\\s*,`, "i").exec(block);

  if (minPx) {
    return Number(minPx[1]);
  }

  const calcViewportPx = new RegExp(`(?:^|[\\s;])${escapeRegExp(propertyName)}\\s*:\\s*calc\\(\\s*100v[wh]\\s*-\\s*(\\d{1,4})px\\s*\\)`, "i").exec(block);

  if (calcViewportPx) {
    return propertyName.includes("height")
      ? DEFAULT_VIEWPORT.height - Number(calcViewportPx[1])
      : DEFAULT_VIEWPORT.width - Number(calcViewportPx[1]);
  }

  return null;
}

function resolveAspectRatioFromRule(styles: string, selector: string): number | null {
  const block = resolveCssRuleBlock(styles, selector);

  if (!block) {
    return null;
  }

  const matched = /aspect-ratio\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i.exec(block);

  if (!matched) {
    return null;
  }

  const width = Number(matched[1]);
  const height = Number(matched[2]);

  if (!width || !height) {
    return null;
  }

  return width / height;
}

function resolveCssRuleBlock(styles: string, selector: string): string | null {
  const matched = new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\}`, "i").exec(styles);
  return matched?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveMainContentContainer(pageElement: Element): Element {
  const relevantChildren = getRelevantChildren(pageElement);

  // 只有唯一内容壳时才下钻，避免像 slide-header + content 这种结构把页标题漏掉。
  if (relevantChildren.length === 1) {
    const onlyChild = relevantChildren[0];

    if (onlyChild && !isTextOwnerElement(onlyChild)) {
      return onlyChild;
    }
  }

  for (const selector of MAIN_CONTENT_SELECTORS) {
    const matched = pageElement.querySelector(selector);
    if (matched) {
      if (matched.parentElement === pageElement && relevantChildren.length > 1) {
        return pageElement;
      }

      return matched;
    }
  }

  const headContent = pageElement.querySelector(".head + .content");
  if (headContent) {
    return headContent;
  }

  return pageElement;
}

function resolveElementPath(root: Element, target: Element): number[] {
  if (root === target) {
    return [];
  }

  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== root) {
    const parent: Element | null = current.parentElement;

    if (!parent) {
      return [];
    }

    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(current);

    if (index < 0) {
      return [];
    }

    path.unshift(index);
    current = parent;
  }

  return path;
}

function shouldSkipElement(element: Element): boolean {
  if (element.matches(DECORATION_SELECTORS)) {
    return true;
  }

  if (element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const className = typeof element.className === "string" ? element.className : "";
  return /(^|\s)(page|progress|ctrl|nav|particle|glow)(\s|$)/i.test(className);
}

function collectChildNodes(input: {
  pageElement: Element;
  containerElement: Element;
  pageIndex: number;
  pageSelector: string;
  containerPath: number[];
  parentNodeId: string;
  nodeIdPrefix: string;
  nodes: Record<string, DocumentNode>;
  assets: DocumentAsset[];
}) {
  const { containerElement, containerPath, pageIndex, pageSelector, parentNodeId, nodeIdPrefix, nodes, assets } = input;
  const childElements = Array.from(containerElement.children);

  childElements.forEach((childElement, childIndex) => {
    if (shouldSkipElement(childElement)) {
      return;
    }

    const childPath = [...containerPath, childIndex];

    if (shouldDeduplicateContainer(childElement)) {
      collectChildNodes({
        ...input,
        containerElement: childElement,
        containerPath: childPath,
        parentNodeId,
        nodeIdPrefix
      });
      return;
    }

    const childNodeId = `${nodeIdPrefix}-node-${childPath.join("-") || "root"}`;
    const childNode = createNodeFromElement({
      element: childElement,
      pageIndex,
      pageSelector,
      nodePath: childPath,
      nodeId: childNodeId,
      assets
    });

    if (!childNode) {
      return;
    }

    const nextRuntimeFlags = [...childNode.runtimeFlags];

    if (containerElement.hasAttribute("data-cns-layout-freeze") && !nextRuntimeFlags.includes("layout-freeze-child")) {
      nextRuntimeFlags.push("layout-freeze-child");
    }

    if (childElement.hasAttribute("data-cns-layout-freeze") && !nextRuntimeFlags.includes("layout-freeze-container")) {
      nextRuntimeFlags.push("layout-freeze-container");
    }

    nodes[childNode.id] = nextRuntimeFlags.length === childNode.runtimeFlags.length
      ? childNode
      : {
          ...childNode,
          runtimeFlags: nextRuntimeFlags
        };
    nodes[parentNodeId]?.children.push(childNode.id);

    if (childNode.type === "group") {
      collectChildNodes({
        ...input,
        containerElement: childElement,
        containerPath: childPath,
        parentNodeId: childNode.id,
        nodeIdPrefix: childNode.id
      });
    }
  });
}

function createNodeFromElement(input: {
  element: Element;
  pageIndex: number;
  pageSelector: string;
  nodePath: number[];
  nodeId: string;
  assets: DocumentAsset[];
}): DocumentNode | null {
  const { element, pageIndex, pageSelector, nodePath, nodeId, assets } = input;
  const sourceRef: SourceRef = {
    pageIndex,
    pageSelector,
    nodePath
  };
  const relevantChildren = getRelevantChildren(element);

  if (element.tagName === "IMG") {
    const src = element.getAttribute("src") ?? "";
    const alt = element.getAttribute("alt") ?? "";

    if (src) {
      assets.push({
        id: `asset-${hashText(src)}`,
        type: "image",
        src
      });
    }

    return {
      id: nodeId,
      type: "image",
      name: alt || "图片",
      editable: true,
      lockedReason: null,
      box: readElementBox(element),
      style: readInlineStyle(element),
      content: {
        src,
        alt
      },
      children: [],
      sourceRef,
      patchStrategy: "replace_node",
      runtimeFlags: []
    };
  }

  if (element.tagName === "SVG" || element.querySelector(":scope > svg")) {
    return {
      id: nodeId,
      type: "svg",
      name: "SVG",
      editable: false,
      lockedReason: "复杂 SVG 先按只读节点导入",
      box: readElementBox(element),
      style: readInlineStyle(element),
      content: {
        html: element.outerHTML
      },
      children: [],
      sourceRef,
      patchStrategy: "replace_node",
      runtimeFlags: ["readonly"]
    };
  }

  if (TEXT_TAGS.has(element.tagName) || isStandaloneTextElement(element)) {
    return createTextLeafNode(nodeId, element, sourceRef);
  }

  if (isCompositeTextElement(element, relevantChildren)) {
    return createTextLeafNode(nodeId, element, sourceRef);
  }

  if (!relevantChildren.length) {
    const textLeaf = createTextLeafNode(nodeId, element, sourceRef);

    if (textLeaf) {
      return textLeaf;
    }
  }

  if (relevantChildren.length > 0 || isBlockLikeElement(element)) {
    return {
      id: nodeId,
      type: "group",
      name: resolveElementName(element),
      editable: true,
      lockedReason: null,
      box: readElementBox(element),
      style: readInlineStyle(element),
      content: {},
      children: [],
      sourceRef,
      patchStrategy: "style_only",
      runtimeFlags: []
    };
  }

  const html = element.outerHTML.trim();

  if (!html) {
    return null;
  }

  return {
    id: nodeId,
    type: "html",
    name: resolveElementName(element),
    editable: false,
    lockedReason: "复杂 HTML 片段先按只读节点导入",
    box: readElementBox(element),
    style: readInlineStyle(element),
    content: {
      html
    },
    children: [],
    sourceRef,
    patchStrategy: "replace_node",
    runtimeFlags: ["readonly"]
  };
}

function createTextLeafNode(
  nodeId: string,
  element: Element,
  sourceRef: SourceRef
): DocumentNode | null {
  const runs = extractTextRuns(element);
  const text = normalizeTextRunsText(runs);

  if (!text) {
    return null;
  }

  return createTextNode({
    id: nodeId,
    name: text.slice(0, 20),
    text,
    runs,
    sourceRef,
    style: readInlineStyle(element),
    box: readElementBox(element),
    preserveStructure: shouldPreserveTextStructure(element)
  });
}

function createGroupNode(input: {
  id: string;
  name: string;
  sourceRef: SourceRef | null;
  runtimeFlags?: string[];
}): DocumentNode {
  return {
    id: input.id,
    type: "group",
    name: input.name,
    editable: true,
    lockedReason: null,
    box: createDefaultBox(),
    style: {},
    content: {},
    children: [],
    sourceRef: input.sourceRef,
    patchStrategy: "style_only",
    runtimeFlags: input.runtimeFlags ?? []
  };
}

function createNextPageId(project: DocumentProject): string {
  const nextIndex = project.pages.reduce((maxValue, page) => {
    const matched = /^page-(\d+)$/.exec(page.id);

    if (!matched) {
      return maxValue;
    }

    return Math.max(maxValue, Number.parseInt(matched[1] ?? "0", 10));
  }, 0) + 1;

  return `page-${nextIndex}`;
}

function resolveProjectPageElement(
  document: Document,
  pageElements: Element[],
  page: DocumentProject["pages"][number]
): Element | null {
  const pageSelector = page.sourceRef.pageSelector?.trim();

  if (pageSelector) {
    const matchedElements = Array.from(document.querySelectorAll(pageSelector))
      .filter((element) => pageElements.includes(element));

    if (matchedElements.length === 1 && matchedElements[0] instanceof Element) {
      return matchedElements[0];
    }

    if (/^\[data-cns-page-id=/.test(pageSelector)) {
      return null;
    }
  }

  const indexedElement = pageElements[page.sourceRef.pageIndex] ?? null;
  return indexedElement instanceof Element ? indexedElement : null;
}

function createProjectPageElement(
  document: Document,
  templateElement: Element | null,
  page: DocumentProject["pages"][number],
  index: number,
  cloneTemplateContent = false
): Element | null {
  if (cloneTemplateContent && templateElement instanceof Element) {
    const clonedPage = templateElement.cloneNode(true);

    if (clonedPage instanceof Element) {
      return clonedPage;
    }
  }

  const emptyPage = document.createElement(templateElement?.tagName?.toLowerCase() || "section");

  if (templateElement instanceof Element) {
    copyPageFrameAttributes(templateElement, emptyPage);
  } else {
    emptyPage.className = "slide";
  }

  const shell = document.createElement("div");
  shell.className = resolveEmptyPageShellClass(templateElement);

  const titleElement = document.createElement("h1");
  titleElement.textContent = page.title?.trim() || t("conversation.fileViewerPresentationUntitled");
  shell.appendChild(titleElement);
  emptyPage.appendChild(shell);
  return emptyPage;
}

function syncPageElementTitle(
  element: Element,
  page: DocumentProject["pages"][number],
  forceHeadingText: boolean,
  index: number
): void {
  const pageTitle = page.title?.trim() || t("conversation.fileViewerPresentationUntitled");
  element.setAttribute("data-title", pageTitle);
  element.setAttribute("data-cns-page-id", page.id);
  element.setAttribute("data-cns-page-order", String(index));

  const titleElement = element.querySelector("h1, h2, h3, .slide-title, .title, .page-title");

  if (titleElement && (forceHeadingText || !titleElement.textContent?.trim())) {
    titleElement.textContent = pageTitle;
  }
}

function copyPageFrameAttributes(sourceElement: Element, targetElement: Element): void {
  Array.from(sourceElement.attributes).forEach((attribute) => {
    if (attribute.name === "data-title" || attribute.name.startsWith("data-cns-")) {
      return;
    }

    targetElement.setAttribute(attribute.name, attribute.value);
  });
}

function resolveEmptyPageShellClass(templateElement: Element | null): string {
  const shellElement = templateElement?.querySelector(".slide-shell, .panel, .content, .slide-inner");
  const className = typeof shellElement?.className === "string" ? shellElement.className.trim() : "";
  return className || "slide-shell";
}

function createTextNode(input: {
  id: string;
  name: string;
  text: string;
  runs?: DocumentTextRun[] | null;
  sourceRef: SourceRef;
  style?: DocumentNodeStyle;
  box?: DocumentNode["box"];
  preserveStructure?: boolean;
}): DocumentNode {
  const hasStructuredRuns = Boolean(input.preserveStructure) || (
    Array.isArray(input.runs)
      && input.runs.some((run) => run.tagName || run.className || run.sourceKind === "element")
  );

  return {
    id: input.id,
    type: "text",
    name: input.name,
    editable: true,
    lockedReason: null,
    box: input.box ?? createDefaultBox(),
    style: input.style ?? {},
    content: {
      text: input.text,
      runs: input.runs ?? null
    },
    children: [],
    sourceRef: input.sourceRef,
    patchStrategy: "text_and_style",
    runtimeFlags: hasStructuredRuns ? ["preserve-text-structure"] : []
  };
}

function createDefaultBox() {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    zIndex: 0
  };
}

function readInlineStyle(element: Element): DocumentNodeStyle {
  const styleMap = readInlineStyleMap(element);

  return {
    position: styleMap.get("position") ?? null,
    fontFamily: styleMap.get("font-family") ?? null,
    fontSize: parsePixelValue(styleMap.get("font-size")),
    fontWeight: styleMap.get("font-weight") ?? null,
    fontStyle: styleMap.get("font-style") ?? null,
    lineHeight: styleMap.get("line-height") ?? null,
    letterSpacing: styleMap.get("letter-spacing") ?? null,
    color: styleMap.get("color") ?? null,
    textAlign: styleMap.get("text-align") ?? null,
    textDecoration: styleMap.get("text-decoration") ?? null,
    textDecorationColor: styleMap.get("text-decoration-color") ?? null,
    whiteSpace: styleMap.get("white-space") ?? null,
    padding: styleMap.get("padding") ?? null,
    margin: styleMap.get("margin") ?? null,
    borderRadius: styleMap.get("border-radius") ?? null,
    borderWidth: styleMap.get("border-width") ?? null,
    borderColor: styleMap.get("border-color") ?? null,
    backgroundColor: styleMap.get("background-color") ?? null,
    opacity: parseFloatValue(styleMap.get("opacity"))
  };
}

function readElementBox(element: Element): DocumentNode["box"] {
  const styleMap = readInlineStyleMap(element);

  return {
    x: parsePixelValue(styleMap.get("left")) ?? 0,
    y: parsePixelValue(styleMap.get("top")) ?? 0,
    width: parsePixelValue(styleMap.get("width")) ?? 0,
    height: parsePixelValue(styleMap.get("height")) ?? 0,
    zIndex: parseIntegerValue(styleMap.get("z-index")) ?? 0
  };
}

function readInlineStyleMap(element: Element): Map<string, string> {
  const inlineStyle = (element.getAttribute("style") ?? "").trim();
  const styleMap = new Map<string, string>();

  if (!inlineStyle) {
    return styleMap;
  }

  inlineStyle.split(";").forEach((item) => {
    const [rawKey, rawValue] = item.split(":");

    if (!rawKey || !rawValue) {
      return;
    }

    styleMap.set(rawKey.trim(), rawValue.trim());
  });

  return styleMap;
}

function parsePixelValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const matched = /(-?\d+(?:\.\d+)?)px/i.exec(value);
  return matched ? Number(matched[1]) : null;
}

function parseFloatValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStandaloneTextElement(element: Element): boolean {
  if (element.tagName !== "SPAN") {
    return false;
  }

  const text = normalizeTextContent(element.textContent ?? "");
  return Boolean(text) && element.children.length === 0;
}

function getRelevantChildren(element: Element): Element[] {
  return Array.from(element.children).filter((child) => !shouldSkipElement(child));
}

function hasMeaningfulDirectText(element: Element): boolean {
  return Array.from(element.childNodes).some((node) => {
    if (node.nodeType !== Node.TEXT_NODE) {
      return false;
    }

    return Boolean(normalizeInlineTextContent(node.textContent ?? ""));
  });
}

const INLINE_TEXT_CONTAINER_TAGS = new Set([
  "SPAN",
  "STRONG",
  "B",
  "I",
  "EM",
  "U",
  "SMALL",
  "MARK",
  "SUB",
  "SUP",
  "CODE",
  "A",
  "BR"
]);

function isCompositeTextElement(
  element: Element,
  relevantChildren: Element[]
): boolean {
  return resolveTextOwnerPriority(element, relevantChildren) > 0;
}

function isTextOwnerElement(element: Element): boolean {
  return resolveTextOwnerPriority(element) > 0;
}

function resolveTextOwnerPriority(
  element: Element,
  presetRelevantChildren?: Element[]
): number {
  const text = normalizeTextContent(element.textContent ?? "");

  if (!text) {
    return 0;
  }

  if (TEXT_TAGS.has(element.tagName)) {
    return 500;
  }

  if (isStandaloneTextElement(element)) {
    return 460;
  }

  const relevantChildren = presetRelevantChildren ?? getRelevantChildren(element);

  if (relevantChildren.length === 0) {
    return 420;
  }

  if (!relevantChildren.every((child) => isInlineTextContainerChild(child))) {
    return 0;
  }

  const hasDirectText = hasMeaningfulDirectText(element);

  if (hasDirectText) {
    return 360;
  }

  return 0;
}

function shouldDeduplicateContainer(element: Element): boolean {
  if (shouldSkipElement(element)) {
    return false;
  }

  if (resolveTextOwnerPriority(element) > 0) {
    return false;
  }

  const relevantChildren = getRelevantChildren(element);

  if (relevantChildren.length !== 1 || hasMeaningfulDirectText(element)) {
    return false;
  }

  const onlyChild = relevantChildren[0];

  if (!onlyChild) {
    return false;
  }

  if (resolveTextOwnerPriority(onlyChild) > 0) {
    return true;
  }

  return shouldDeduplicateContainer(onlyChild);
}

function isInlineTextContainerChild(element: Element): boolean {
  if (INLINE_TEXT_CONTAINER_TAGS.has(element.tagName)) {
    return true;
  }

  if (element.tagName === "SPAN" && element.children.length === 0) {
    return true;
  }

  return false;
}

function extractTextRuns(element: Element): DocumentTextRun[] {
  const runs: DocumentTextRun[] = [];
  collectTextRuns(element, runs, element);
  return normalizeTextRuns(runs);
}

function collectTextRuns(
  rootElement: Element,
  runs: DocumentTextRun[],
  currentNode: Node
): void {
  if (currentNode.nodeType === Node.TEXT_NODE) {
    const rawText = currentNode.textContent ?? "";

    if (!hasMeaningfulInlineText(rawText)) {
      return;
    }

    const text = normalizeInlineTextContent(rawText);

    if (text) {
      runs.push({
        text,
        sourceKind: "text"
      });
    }
    return;
  }

  if (!(currentNode instanceof Element)) {
    return;
  }

  if (shouldSkipElement(currentNode) && currentNode !== rootElement) {
    return;
  }

  if (currentNode !== rootElement && isInlineTextContainerChild(currentNode)) {
    const text = normalizeInlineTextContent(currentNode.textContent ?? "");

    if (text) {
      runs.push({
        text,
        tagName: currentNode.tagName.toLowerCase(),
        className: typeof currentNode.className === "string" && currentNode.className.trim()
          ? currentNode.className.trim()
          : null,
        style: readInlineStyle(currentNode),
        sourceKind: "element"
      });
    }

    return;
  }

  currentNode.childNodes.forEach((childNode) => {
    collectTextRuns(rootElement, runs, childNode);
  });
}

function normalizeTextRuns(runs: DocumentTextRun[]): DocumentTextRun[] {
  const normalizedRuns = runs
    .map((run): DocumentTextRun | null => {
      const text = normalizeInlineTextContent(run.text);

      if (!text) {
        return null;
      }

      return {
        text,
        tagName: run.tagName ?? null,
        className: run.className ?? null,
        style: run.style ?? null,
        sourceKind: run.sourceKind ?? null
      } satisfies DocumentTextRun;
    });

  return normalizedRuns.filter((run): run is DocumentTextRun => run !== null);
}

function normalizeTextRunsText(runs: DocumentTextRun[]): string {
  return normalizeTextContent(runs.map((run) => run.text).join(" "));
}

function shouldPreserveTextStructure(element: Element): boolean {
  if (element.querySelector("br")) {
    return true;
  }

  let meaningfulSegmentCount = 0;

  element.childNodes.forEach((childNode) => {
    if (childNode.nodeType === Node.TEXT_NODE) {
      if (hasMeaningfulInlineText(childNode.textContent ?? "")) {
        meaningfulSegmentCount += 1;
      }
      return;
    }

    if (!(childNode instanceof Element)) {
      return;
    }

    if (childNode.tagName === "BR") {
      return;
    }

    if (isInlineTextContainerChild(childNode) && normalizeInlineTextContent(childNode.textContent ?? "")) {
      meaningfulSegmentCount += 1;
    }
  });

  return meaningfulSegmentCount > 1;
}

function isBlockLikeElement(element: Element): boolean {
  const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
  return BLOCK_KEYWORDS.some((keyword) => className.includes(keyword));
}

function resolveElementName(element: Element): string {
  const className = typeof element.className === "string" ? element.className.trim() : "";

  if (className) {
    return className.split(/\s+/)[0] ?? element.tagName.toLowerCase();
  }

  return element.tagName.toLowerCase();
}

function normalizeTextContent(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeInlineTextContent(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\r\n]+/g, " ");
}

function hasMeaningfulInlineText(value: string): boolean {
  if (!value) {
    return false;
  }

  if (!/\S/.test(value)) {
    return false;
  }

  return !/^[\n\r\t ]+$/.test(value);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function dedupeAssets(assets: DocumentAsset[]): DocumentAsset[] {
  const map = new Map<string, DocumentAsset>();
  assets.forEach((asset) => {
    map.set(asset.id, asset);
  });
  return Array.from(map.values());
}

function buildProjectId(filePath: string): string {
  return `static-html-${hashText(filePath)}`;
}

function resolveElementBySourceRef(
  pageElements: Element[],
  sourceRef: SourceRef
): Element | null {
  const pageElement = pageElements[sourceRef.pageIndex];

  if (!pageElement) {
    return null;
  }

  let current: Element = pageElement;

  for (const childIndex of sourceRef.nodePath) {
    const nextElement = current.children.item(childIndex);

    if (!(nextElement instanceof Element)) {
      return null;
    }

    current = nextElement;
  }

  return current;
}

function applyDocumentNodeToElement(element: Element, node: DocumentNode) {
  switch (node.type) {
    case "text":
      if (Array.isArray(node.content.runs) && node.content.runs.length > 0) {
        applyTextRunsToElement(element, node.content.runs, {
          preserveStructure: hasRuntimeFlag(node, "preserve-text-structure")
        });
      } else if (typeof node.content.text === "string") {
        element.textContent = node.content.text;
      }
      break;
    case "image":
      if (typeof node.content.src === "string" && node.content.src) {
        element.setAttribute("src", node.content.src);
      }
      if (typeof node.content.alt === "string") {
        element.setAttribute("alt", node.content.alt);
      }
      break;
    default:
      if (!node.children.length && typeof node.content.text === "string" && node.content.text) {
        element.textContent = node.content.text;
      }
      break;
  }

  applyNodeStyleToElement(element, node.style);
  applyNodeBoxToElement(element, node);
  applyNodeRuntimeAttributes(element, node);
}

function applyTextRunsToElement(
  element: Element,
  runs: DocumentTextRun[],
  options?: {
    preserveStructure?: boolean;
  }
): void {
  if (options?.preserveStructure && patchTextRunsInPlace(element, runs)) {
    return;
  }

  const ownerDocument = element.ownerDocument;

  if (!ownerDocument) {
    element.textContent = normalizeTextRunsText(runs);
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  runs.forEach((run) => {
    if (!run.text) {
      return;
    }

    if (!run.tagName) {
      element.appendChild(ownerDocument.createTextNode(run.text));
      return;
    }

    const childElement = ownerDocument.createElement(run.tagName);

    if (run.className) {
      childElement.setAttribute("class", run.className);
    }

    childElement.textContent = run.text;
    applyNodeStyleToElement(childElement, run.style ?? {});
    element.appendChild(childElement);
  });
}

function patchTextRunsInPlace(
  element: Element,
  runs: DocumentTextRun[]
): boolean {
  if (normalizeTextContent(element.textContent ?? "") === normalizeTextRunsText(runs)) {
    return true;
  }

  const targetSegments = flattenTextRunSegments(runs);

  if (!targetSegments.length) {
    return false;
  }

  const sourceSegments = collectElementTextSegments(element);

  if (!sourceSegments.length || sourceSegments.length !== targetSegments.length) {
    return false;
  }

  for (let index = 0; index < sourceSegments.length; index += 1) {
    const sourceSegment = sourceSegments[index];
    const targetSegment = targetSegments[index];

    if (!sourceSegment || !targetSegment) {
      return false;
    }

    if (sourceSegment.kind !== targetSegment.kind) {
      return false;
    }

    if (sourceSegment.kind === "element") {
      if (
        (sourceSegment.tagName ?? null) !== (targetSegment.tagName ?? null)
        || (sourceSegment.className ?? null) !== (targetSegment.className ?? null)
      ) {
        return false;
      }
    }
  }

  sourceSegments.forEach((segment, index) => {
    const targetSegment = targetSegments[index];

    if (!targetSegment) {
      return;
    }

    if (segment.kind === "text" && segment.node.nodeType === Node.TEXT_NODE) {
      segment.node.textContent = targetSegment.text;
      return;
    }

    if (segment.node instanceof Element) {
      segment.node.textContent = targetSegment.text;
      applyNodeStyleToElement(segment.node, targetSegment.style ?? {});
    }
  });

  return true;
}

function flattenTextRunSegments(runs: DocumentTextRun[]): Array<{
  kind: "text" | "element";
  text: string;
  tagName: string | null;
  className: string | null;
  style: DocumentNodeStyle | null;
}> {
  return runs
    .map((run) => {
      const text = run.text ?? "";

      if (!text) {
        return null;
      }

      const kind = run.tagName || run.className || run.sourceKind === "element"
        ? "element"
        : "text";

      return {
        kind,
        text,
        tagName: run.tagName ?? null,
        className: run.className ?? null,
        style: run.style ?? null
      };
    })
    .filter((segment): segment is {
      kind: "text" | "element";
      text: string;
      tagName: string | null;
      className: string | null;
      style: DocumentNodeStyle | null;
    } => Boolean(segment));
}

function collectElementTextSegments(element: Element): Array<{
  kind: "text" | "element";
  node: Node;
  tagName: string | null;
  className: string | null;
}> {
  const segments: Array<{
    kind: "text" | "element";
    node: Node;
    tagName: string | null;
    className: string | null;
  }> = [];

  element.childNodes.forEach((childNode) => {
    if (childNode.nodeType === Node.TEXT_NODE) {
      const rawText = childNode.textContent ?? "";

      if (!hasMeaningfulInlineText(rawText)) {
        return;
      }

      segments.push({
        kind: "text",
        node: childNode,
        tagName: null,
        className: null
      });
      return;
    }

    if (!(childNode instanceof Element)) {
      return;
    }

    if (childNode.tagName === "BR") {
      return;
    }

    if (!isInlineTextContainerChild(childNode)) {
      return;
    }

    const text = normalizeInlineTextContent(childNode.textContent ?? "");

    if (!text) {
      return;
    }

    segments.push({
      kind: "element",
      node: childNode,
      tagName: childNode.tagName.toLowerCase(),
      className: typeof childNode.className === "string" && childNode.className.trim()
        ? childNode.className.trim()
        : null
    });
  });

  return segments;
}

function mountPreviewTextProxy(
  element: Element,
  node: DocumentNode,
  options: {
    selected: boolean;
    selectedRunIndex?: number | null;
  }
) {
  if (node.type !== "text") {
    return;
  }

  if (!shouldUsePreviewTextProxy(element, node)) {
    return;
  }

  const text = typeof node.content.text === "string" ? node.content.text : normalizeTextContent(element.textContent ?? "");
  const runs = Array.isArray(node.content.runs) ? node.content.runs : [];

  if (!text) {
    return;
  }

  const ownerDocument = element.ownerDocument;

  if (!ownerDocument) {
    return;
  }

  const proxy = ownerDocument.createElement("span");
  proxy.setAttribute("data-cns-text-proxy", "true");
  proxy.setAttribute("data-cns-node-id", node.id);
  element.setAttribute("data-cns-node-host", "true");
  element.setAttribute("data-cns-node-host-id", node.id);
  element.removeAttribute("data-cns-node-id");

  if (options.selected) {
    proxy.setAttribute("data-cns-node-selected", "true");
    element.removeAttribute("data-cns-node-selected");
  }
  proxy.setAttribute(
    "style",
    [
      "display: inline",
      "background: transparent",
      "border: none",
      "padding: 0",
      "margin: 0",
      "white-space: inherit",
      "color: inherit",
      "font: inherit",
      "letter-spacing: inherit",
      "line-height: inherit",
      "text-transform: inherit"
    ].join("; ")
  );

  if (runs.length > 1) {
    runs.forEach((run, index) => {
      const runElement = ownerDocument.createElement(run.tagName || "span");
      runElement.setAttribute("data-cns-node-id", node.id);
      runElement.setAttribute("data-cns-run-index", String(index));

      if (run.className) {
        runElement.setAttribute("class", run.className);
      }

      if (options.selected && options.selectedRunIndex === index) {
        runElement.setAttribute("data-cns-node-selected", "true");
      }

      runElement.textContent = run.text;
      applyNodeStyleToElement(runElement, run.style ?? {});
      proxy.appendChild(runElement);
    });
  } else {
    proxy.textContent = text;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  element.appendChild(proxy);
}

function shouldUsePreviewTextProxy(element: Element, node: DocumentNode): boolean {
  if (element.childElementCount > 0) {
    return false;
  }

  if (TEXT_TAGS.has(element.tagName)) {
    return false;
  }

  return hasSurfaceStyle(node.style);
}

function hasSurfaceStyle(style: DocumentNodeStyle): boolean {
  return Boolean(
    style.backgroundColor
    || style.padding
    || style.borderRadius
    || style.borderWidth
    || style.borderColor
  );
}

function applyNodeStyleToElement(
  element: Element,
  style: DocumentNodeStyle
) {
  for (const [styleKey, rawValue] of Object.entries(style) as Array<[keyof DocumentNodeStyle, DocumentNodeStyle[keyof DocumentNodeStyle]]>) {
    const cssProperty = STYLE_KEY_TO_CSS_PROPERTY[styleKey];

    if (!cssProperty) {
      continue;
    }

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      element instanceof HTMLElement
        ? element.style.removeProperty(cssProperty)
        : element.setAttribute("style", (element.getAttribute("style") ?? "").trim());
      continue;
    }

    element.setAttribute(
      "style",
      mergeInlineStyle(
        element.getAttribute("style") ?? "",
        cssProperty,
        formatStyleValue(styleKey, rawValue)
      )
    );
  }
}

function applyNodeBoxToElement(
  element: Element,
  node: DocumentNode
) {
  const shouldApplyBox = hasRuntimeFlag(node, "draft-clone")
    || hasRuntimeFlag(node, "draft-box");

  if (!shouldApplyBox) {
    return;
  }

  const styleTarget = element.getAttribute("style") ?? "";
  let nextStyle = mergeInlineStyle(styleTarget, "position", "absolute");
  nextStyle = mergeInlineStyle(nextStyle, "left", `${node.box.x}px`);
  nextStyle = mergeInlineStyle(nextStyle, "top", `${node.box.y}px`);

  if (node.box.width > 0) {
    nextStyle = mergeInlineStyle(nextStyle, "width", `${node.box.width}px`);
  }

  if (node.box.height > 0) {
    nextStyle = mergeInlineStyle(nextStyle, "height", `${node.box.height}px`);
  }

  if (node.box.zIndex !== 0) {
    nextStyle = mergeInlineStyle(nextStyle, "z-index", String(node.box.zIndex));
  }

  element.setAttribute("style", nextStyle);
}

function applyNodeRuntimeAttributes(
  element: Element,
  node: DocumentNode
) {
  if (hasRuntimeFlag(node, "layout-freeze-container")) {
    element.setAttribute("data-cns-layout-freeze", "true");
    return;
  }

  element.removeAttribute("data-cns-layout-freeze");
}

function mergeInlineStyle(
  existingStyle: string,
  propertyName: string,
  propertyValue: string
): string {
  const styleMap = new Map<string, string>();

  existingStyle.split(";").forEach((item) => {
    const [rawKey, rawValue] = item.split(":");

    if (!rawKey || !rawValue) {
      return;
    }

    styleMap.set(rawKey.trim(), rawValue.trim());
  });

  styleMap.set(propertyName, propertyValue);

  return Array.from(styleMap.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function formatStyleValue(
  styleKey: keyof DocumentNodeStyle,
  rawValue: NonNullable<DocumentNodeStyle[keyof DocumentNodeStyle]>
): string {
  if (styleKey === "fontSize" && typeof rawValue === "number") {
    return `${rawValue}px`;
  }

  if (styleKey === "opacity" && typeof rawValue === "number") {
    return String(rawValue);
  }

  return String(rawValue);
}

function hashText(source: string): string {
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function cloneProjectNodeTree(input: {
  project: DocumentProject;
  sourceNodeId: string;
  nextNodes: Record<string, DocumentNode>;
  idCounter: Record<string, number>;
  isRoot: boolean;
}): string {
  const sourceNode = input.project.nodes[input.sourceNodeId];

  if (!sourceNode) {
    return input.sourceNodeId;
  }

  const nextId = createDuplicatedNodeId(sourceNode.id, input.idCounter);
  const cloneSourceFlag = `clone-source:${sourceNode.id}`;
  const nextRuntimeFlags = dedupeStrings([
    ...sourceNode.runtimeFlags.filter((flag) => !flag.startsWith("clone-source:")),
    "draft-clone",
    input.isRoot ? "draft-clone-root" : "draft-clone-child",
    cloneSourceFlag
  ]);

  const nextNode: DocumentNode = {
    ...sourceNode,
    id: nextId,
    name: `${sourceNode.name} 副本`,
    sourceRef: sourceNode.sourceRef,
    box: {
      ...sourceNode.box,
      x: sourceNode.box.x + 24,
      y: sourceNode.box.y + 24
    },
    children: [],
    runtimeFlags: nextRuntimeFlags
  };

  input.nextNodes[nextId] = nextNode;

  const nextChildIds = sourceNode.children.map((childNodeId) => cloneProjectNodeTree({
    project: input.project,
    sourceNodeId: childNodeId,
    nextNodes: input.nextNodes,
    idCounter: input.idCounter,
    isRoot: false
  }));

  input.nextNodes[nextId] = {
    ...nextNode,
    children: nextChildIds
  };

  return nextId;
}

function cloneProjectPageNodeTree(input: {
  project: DocumentProject;
  sourceNodeId: string;
  targetNodeId: string;
  nextPageId: string;
  sourcePageIndex: number;
  nextNodes: Record<string, DocumentNode>;
  isRoot: boolean;
}): string {
  const sourceNode = input.project.nodes[input.sourceNodeId];

  if (!sourceNode) {
    return input.targetNodeId;
  }

  const nextNode: DocumentNode = {
    ...sourceNode,
    id: input.targetNodeId,
    sourceRef: sourceNode.sourceRef
      ? {
          ...sourceNode.sourceRef,
          pageIndex: input.sourcePageIndex
        }
      : null,
    children: [],
    runtimeFlags: sourceNode.runtimeFlags.filter((flag) => (
      flag !== "draft-clone"
      && flag !== "draft-clone-root"
      && flag !== "draft-clone-child"
      && !flag.startsWith("clone-source:")
    ))
  };

  input.nextNodes[input.targetNodeId] = nextNode;

  const nextChildIds = sourceNode.children.map((childNodeId, childIndex) => cloneProjectPageNodeTree({
    project: input.project,
    sourceNodeId: childNodeId,
    targetNodeId: `${input.targetNodeId}-node-${childIndex}`,
    nextPageId: input.nextPageId,
    sourcePageIndex: input.sourcePageIndex,
    nextNodes: input.nextNodes,
    isRoot: false
  }));

  input.nextNodes[input.targetNodeId] = {
    ...nextNode,
    children: nextChildIds
  };

  return input.targetNodeId;
}

function createDuplicatedNodeId(
  baseNodeId: string,
  idCounter: Record<string, number>
): string {
  const nextCount = (idCounter[baseNodeId] ?? 0) + 1;
  idCounter[baseNodeId] = nextCount;
  return `${baseNodeId}-copy-${nextCount}`;
}

function createNodeIdCounter(
  nodes: Record<string, DocumentNode>
): Record<string, number> {
  const result: Record<string, number> = {};

  Object.keys(nodes).forEach((nodeId) => {
    const matched = /^(.*)-copy-(\d+)$/.exec(nodeId);

    if (!matched) {
      return;
    }

    const baseNodeId = matched[1];
    const count = Number.parseInt(matched[2] ?? "0", 10);

    if (!baseNodeId || !Number.isFinite(count)) {
      return;
    }

    result[baseNodeId] = Math.max(result[baseNodeId] ?? 0, count);
  });

  return result;
}

function renderDraftCloneNode(input: {
  project: DocumentProject;
  pageElements: Element[];
  cloneRootNode: DocumentNode;
  selectedNodeId: string | null;
  mode: "preview" | "save";
}) {
  const sourceNodeId = resolveCloneSourceNodeId(input.cloneRootNode);

  if (!sourceNodeId) {
    return;
  }

  const sourceNode = input.project.nodes[sourceNodeId];

  if (!sourceNode?.sourceRef) {
    return;
  }

  const sourceElement = resolveElementBySourceRef(input.pageElements, sourceNode.sourceRef);

  if (!sourceElement?.parentElement) {
    return;
  }

  const cloneElement = sourceElement.cloneNode(true);

  if (!(cloneElement instanceof Element)) {
    return;
  }

  sourceElement.parentElement.insertBefore(cloneElement, sourceElement.nextSibling);

  bindDraftCloneSubtree({
    project: input.project,
    cloneNodeId: input.cloneRootNode.id,
    cloneElement,
    sourceRootPath: sourceNode.sourceRef.nodePath,
    selectedNodeId: input.selectedNodeId,
    mode: input.mode
  });
}

function bindDraftCloneSubtree(input: {
  project: DocumentProject;
  cloneNodeId: string;
  cloneElement: Element;
  sourceRootPath: number[];
  selectedNodeId: string | null;
  mode: "preview" | "save";
}) {
  const cloneNode = input.project.nodes[input.cloneNodeId];

  if (!cloneNode) {
    return;
  }

  input.cloneElement.setAttribute("data-cns-node-id", cloneNode.id);

  if (input.mode === "preview") {
    input.cloneElement.removeAttribute("data-cns-node-selected");

    if (input.selectedNodeId && cloneNode.id === input.selectedNodeId) {
      input.cloneElement.setAttribute("data-cns-node-selected", "true");
    }
  } else {
    input.cloneElement.removeAttribute("data-cns-node-selected");
  }

  applyDocumentNodeToElement(input.cloneElement, cloneNode);

  cloneNode.children.forEach((childNodeId) => {
    const childNode = input.project.nodes[childNodeId];

    if (!childNode?.sourceRef) {
      return;
    }

    const relativePath = childNode.sourceRef.nodePath.slice(input.sourceRootPath.length);
    const childElement = resolveRelativeElement(input.cloneElement, relativePath);

    if (!childElement) {
      return;
    }

    bindDraftCloneSubtree({
      project: input.project,
      cloneNodeId: childNodeId,
      cloneElement: childElement,
      sourceRootPath: input.sourceRootPath,
      selectedNodeId: input.selectedNodeId,
      mode: input.mode
    });
  });
}

function resolveRelativeElement(
  rootElement: Element,
  nodePath: number[]
): Element | null {
  let current: Element = rootElement;

  for (const childIndex of nodePath) {
    const nextElement = current.children.item(childIndex);

    if (!(nextElement instanceof Element)) {
      return null;
    }

    current = nextElement;
  }

  return current;
}

function hasRuntimeFlag(
  node: DocumentNode,
  flag: string
): boolean {
  return node.runtimeFlags.includes(flag);
}

function resolveCloneSourceNodeId(node: DocumentNode): string | null {
  const sourceFlag = node.runtimeFlags.find((flag) => flag.startsWith("clone-source:"));
  return sourceFlag ? sourceFlag.slice("clone-source:".length) : null;
}

function clearPreviewArtifacts(document: Document) {
  document.querySelectorAll("[data-cns-page-root]").forEach((element) => {
    element.removeAttribute("data-cns-page-root");
    element.removeAttribute("data-cns-active-page");
  });

  document.querySelectorAll("[data-cns-text-proxy]").forEach((element) => {
    const parent = element.parentElement;

    if (!parent) {
      element.remove();
      return;
    }

    parent.textContent = element.textContent ?? "";
    parent.removeAttribute("data-cns-node-host");
    parent.removeAttribute("data-cns-node-host-id");
  });

  document.querySelectorAll("[data-cns-node-id]").forEach((element) => {
    element.removeAttribute("data-cns-node-id");
  });

  document.querySelectorAll("[data-cns-node-selected]").forEach((element) => {
    element.removeAttribute("data-cns-node-selected");
  });

  document.querySelectorAll("[data-cns-inline-editing]").forEach((element) => {
    element.removeAttribute("data-cns-inline-editing");
  });

  document.querySelectorAll("[data-cns-node-host]").forEach((element) => {
    element.removeAttribute("data-cns-node-host");
    element.removeAttribute("data-cns-node-host-id");
  });

  document.querySelectorAll("[data-cns-page-id]").forEach((element) => {
    element.removeAttribute("data-cns-page-id");
    element.removeAttribute("data-cns-page-order");
  });

  document.querySelectorAll("style").forEach((element) => {
    if (element.textContent?.includes("[data-cns-page-root")) {
      element.remove();
    }
  });

  document.querySelectorAll("script[data-cns-preview-bridge=\"true\"]").forEach((element) => {
    element.remove();
  });
}
