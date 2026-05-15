import { t } from "../../shared/i18n";
import type {
  DocumentAsset,
  DocumentNode,
  DocumentNodeContent,
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
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  color: "color",
  textAlign: "text-align",
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
      }
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
    pageIndex: input.pageIndex
  });
}

export function buildStaticHtmlPresentationPreviewFromProject(input: {
  html: string;
  project: DocumentProject;
  pageIndex: number;
  selectedNodeId?: string | null;
  inlineEditingNodeId?: string | null;
}): string | null {
  return buildStaticHtmlDocumentFromProject({
    html: input.html,
    project: input.project,
    pageIndex: input.pageIndex,
    selectedNodeId: input.selectedNodeId ?? null,
    inlineEditingNodeId: input.inlineEditingNodeId ?? null,
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
  inlineEditingNodeId?: string | null;
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
        selected: input.selectedNodeId === node.id
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
    const styleTag = document.createElement("style");
    styleTag.textContent = `
    [data-cns-page-root="true"] {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    [data-cns-page-root="true"][data-cns-active-page="true"] {
      display: block !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      transform: none !important;
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
      transform: none !important;
    }

    body {
      overflow: auto !important;
    }
  `;
    document.head.appendChild(styleTag);

    const bridgeScript = document.createElement("script");
    bridgeScript.setAttribute("data-cns-preview-bridge", "true");
    bridgeScript.textContent = `
    (() => {
      const eventTypes = ["pointerdown", "click", "dblclick"];
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

        if (!nodeId) {
          return;
        }

        const computedStyle = window.getComputedStyle ? window.getComputedStyle(matched) : null;
        const editableRect = resolveEditableRect(matched, computedStyle);
        const payload = {
          type: "codingns-static-html-node-select",
          nodeId,
          eventType: event.type,
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
      };

      eventTypes.forEach((eventType) => {
        document.addEventListener(eventType, handler, true);
      });
    })();
  `;
    document.body.appendChild(bridgeScript);
  } else {
    clearPreviewArtifacts(document);
  }

  return document.documentElement.outerHTML;
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
      pageSelector: "",
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

  const fallbackWidth = resolveSizeFromCss(html, "width");
  const fallbackHeight = resolveSizeFromCss(html, "height");

  if (fallbackWidth && fallbackHeight) {
    return {
      width: fallbackWidth,
      height: fallbackHeight
    };
  }

  return {
    width: DEFAULT_VIEWPORT.width,
    height: DEFAULT_VIEWPORT.height
  };
}

function resolveSizeFromCss(source: string, propertyName: string): number | null {
  const matched = new RegExp(`${escapeRegExp(propertyName)}\\s*:\\s*(\\d{3,5})px`, "i").exec(source);
  return matched ? Number(matched[1]) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveMainContentContainer(pageElement: Element): Element {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const matched = pageElement.querySelector(selector);
    if (matched) {
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

    nodes[childNode.id] = childNode;
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
  const relevantChildren = Array.from(element.children).filter((child) => !shouldSkipElement(child));

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
  const text = normalizeTextContent(element.textContent ?? "");

  if (!text) {
    return null;
  }

  return createTextNode({
    id: nodeId,
    name: text.slice(0, 20),
    text,
    sourceRef,
    style: readInlineStyle(element),
    box: readElementBox(element)
  });
}

function createGroupNode(input: {
  id: string;
  name: string;
  sourceRef: SourceRef | null;
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
    runtimeFlags: []
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
    const matched = Array.from(document.querySelectorAll(pageSelector)).find((element) => pageElements.includes(element));

    if (matched instanceof Element) {
      return matched;
    }

    return pageElements[page.sourceRef.pageIndex] ?? null;
  }

  return null;
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
  sourceRef: SourceRef;
  style?: DocumentNodeStyle;
  box?: DocumentNode["box"];
}): DocumentNode {
  return {
    id: input.id,
    type: "text",
    name: input.name,
    editable: true,
    lockedReason: null,
    box: input.box ?? createDefaultBox(),
    style: input.style ?? {},
    content: {
      text: input.text
    },
    children: [],
    sourceRef: input.sourceRef,
    patchStrategy: "text_and_style",
    runtimeFlags: []
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
    fontFamily: styleMap.get("font-family") ?? null,
    fontSize: parsePixelValue(styleMap.get("font-size")),
    fontWeight: styleMap.get("font-weight") ?? null,
    lineHeight: styleMap.get("line-height") ?? null,
    letterSpacing: styleMap.get("letter-spacing") ?? null,
    color: styleMap.get("color") ?? null,
    textAlign: styleMap.get("text-align") ?? null,
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
      if (typeof node.content.text === "string") {
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
}

function mountPreviewTextProxy(
  element: Element,
  node: DocumentNode,
  options: {
    selected: boolean;
  }
) {
  if (node.type !== "text") {
    return;
  }

  if (!shouldUsePreviewTextProxy(element, node)) {
    return;
  }

  const text = typeof node.content.text === "string" ? node.content.text : normalizeTextContent(element.textContent ?? "");

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
  element.removeAttribute("data-cns-node-id");

  if (options.selected) {
    proxy.setAttribute("data-cns-node-selected", "true");
    element.removeAttribute("data-cns-node-selected");
  }

  proxy.textContent = text;
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
