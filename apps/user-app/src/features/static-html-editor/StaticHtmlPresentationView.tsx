import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../shared/i18n";
import type { DocumentNode, DocumentNodeBox, DocumentNodeStyle, DocumentProject, DocumentTextRun } from "./model";
import { alignBoxes, applyBoxesToProject, clampLayoutBox, resolveBoundingBox, resolveBoxAnchorPoints } from "./layout";
import {
  appendProjectPage,
  buildStaticHtmlDocumentProject,
  buildStaticHtmlPresentationPreviewFromProject,
  duplicateProjectNode,
  duplicateProjectPage,
  inspectStaticHtmlPresentation,
  listPageNodeIds,
  moveProjectPageToIndex,
  removeProjectPage,
  updateProjectNode,
  updateProjectNodes
} from "./parser";

interface EditorHistoryEntry {
  project: DocumentProject;
  currentPageIndex: number;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface DragPreviewState {
  pageId: string;
  position: "before" | "after";
}

interface InlineEditorState {
  nodeId: string;
  text: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  appearance: {
    fontFamily: string | null;
    fontSize: string | null;
    fontWeight: string | null;
    fontStyle: string | null;
    lineHeight: string | null;
    letterSpacing: string | null;
    color: string | null;
    textAlign: string | null;
    whiteSpace: string | null;
    padding: string | null;
    textTransform: string | null;
  };
}

interface TopTextEditorChange {
  text: string;
  runs: DocumentTextRun[] | null;
}

interface RunsSelectionOffsets {
  start: number;
  end: number;
}

type EditorInteractionMode = "content" | "layout";

interface LayoutCapability {
  movable: boolean;
  resizable: boolean;
  alignable: boolean;
  reason: string | null;
  strictModeLocked: boolean;
}

interface LayoutNodeMeasurement {
  left: number;
  top: number;
  width: number;
  height: number;
  localLeft: number;
  localTop: number;
}

interface LayoutGuideLine {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

type LayoutGestureHandle = "move" | "resize-se";

interface LayoutGestureState {
  source: "overlay" | "iframe";
  handle: LayoutGestureHandle;
  nodeIds: string[];
  pointerStartX: number;
  pointerStartY: number;
  activated: boolean;
  startProject: DocumentProject;
  startPageIndex: number;
  pageNodeIds: string[];
  referenceBoxes: Record<string, DocumentNodeBox>;
  startSelectedNodeId: string | null;
  startSelectedNodeIds: string[];
  originBoxes: Record<string, {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
  }>;
}

const LAYOUT_DRAG_ACTIVATION_DISTANCE = 4;

export function StaticHtmlPresentationView({
  filePath,
  html,
  baseHref,
  onProjectChange,
  onSave,
  canSave = false,
  saving = false
}: {
  filePath: string;
  html: string;
  baseHref?: string | null;
  onProjectChange?: (project: DocumentProject | null) => void;
  onSave?: () => void;
  canSave?: boolean;
  saving?: boolean;
}) {
  const probe = useMemo(() => inspectStaticHtmlPresentation(html, filePath), [filePath, html]);
  const initialProject = useMemo(
    () => buildStaticHtmlDocumentProject({ html, filePath }),
    [filePath, html]
  );
  const [draftProject, setDraftProject] = useState(initialProject);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [interactionMode, setInteractionMode] = useState<EditorInteractionMode>("content");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorHistoryEntry[]>([]);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameStageRef = useRef<HTMLDivElement | null>(null);
  const frameShellRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<HTMLDivElement | null>(null);
  const toolbarViewportRef = useRef<HTMLDivElement | null>(null);
  const toolbarContentRef = useRef<HTMLDivElement | null>(null);
  const projectRef = useRef<DocumentProject | null>(initialProject);
  const frameScaleRef = useRef(1);
  const layoutGestureRef = useRef<LayoutGestureState | null>(null);
  const layoutPreviewBoxesRef = useRef<Record<string, DocumentNodeBox>>({});
  const historyCoalesceKeyRef = useRef<string | null>(null);
  const [frameScale, setFrameScale] = useState(1);
  const [toolbarScale, setToolbarScale] = useState(1);
  const [layoutMeasurements, setLayoutMeasurements] = useState<Record<string, LayoutNodeMeasurement>>({});
  const [layoutPreviewBoxes, setLayoutPreviewBoxes] = useState<Record<string, DocumentNodeBox>>({});
  const [layoutGuideLines, setLayoutGuideLines] = useState<LayoutGuideLine[]>([]);
  const [layoutGesture, setLayoutGesture] = useState<LayoutGestureState | null>(null);
  const currentProject = draftProject;
  const currentPage = currentProject?.pages[currentPageIndex] ?? currentProject?.pages[0] ?? null;
  const pageNodeIds = useMemo(() => {
    if (!currentProject || !currentPage) {
      return [];
    }

    return listPageNodeIds(currentProject, currentPage.id);
  }, [currentPage, currentProject]);

  useEffect(() => {
    setDraftProject(initialProject);
    setCurrentPageIndex(0);
    setInteractionMode("content");
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setHoveredNodeId(null);
    setSelectedRunIndex(null);
    setHistory([]);
    setDraggingPageId(null);
    setDragPreview(null);
    setInlineEditor(null);
    setLayoutMeasurements({});
    setLayoutPreviewBoxes({});
    setLayoutGuideLines([]);
    setLayoutGesture(null);
    historyCoalesceKeyRef.current = null;
  }, [initialProject]);

  useEffect(() => {
    onProjectChange?.(draftProject);
  }, [draftProject, onProjectChange]);

  useEffect(() => {
    projectRef.current = draftProject;
  }, [draftProject]);

  useEffect(() => {
    frameScaleRef.current = frameScale;
  }, [frameScale]);

  useEffect(() => {
    const viewport = toolbarViewportRef.current;
    const content = toolbarContentRef.current;

    if (!viewport || !content) {
      setToolbarScale(1);
      return;
    }

    const updateToolbarScale = () => {
      const viewportWidth = viewport.clientWidth;
      const viewportHeight = viewport.clientHeight;
      const contentWidth = content.scrollWidth;
      const contentHeight = content.scrollHeight;

      if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
        setToolbarScale(1);
        return;
      }

      const widthScale = viewportWidth / contentWidth;
      const heightScale = viewportHeight / contentHeight;
      const nextScale = Math.min(1, widthScale, heightScale);
      setToolbarScale((current) => Math.abs(current - nextScale) < 0.01 ? current : nextScale);
    };

    updateToolbarScale();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateToolbarScale();
    });

    observer.observe(viewport);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [interactionMode, selectedNodeId, selectedNodeIds, selectedRunIndex]);

  useEffect(() => {
    layoutGestureRef.current = layoutGesture;
  }, [layoutGesture]);

  useEffect(() => {
    layoutPreviewBoxesRef.current = layoutPreviewBoxes;
  }, [layoutPreviewBoxes]);

  useEffect(() => {
    if (!currentProject || !currentPage) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setHoveredNodeId(null);
      setSelectedRunIndex(null);
      return;
    }

    const firstEditableNodeId = pageNodeIds.find((nodeId) => currentProject.nodes[nodeId]?.editable) ?? null;
    const safeSelectedNodeIds = selectedNodeIds.filter((nodeId) => pageNodeIds.includes(nodeId));

    if (safeSelectedNodeIds.length !== selectedNodeIds.length) {
      setSelectedNodeIds(safeSelectedNodeIds);
    }

    if (hoveredNodeId && !pageNodeIds.includes(hoveredNodeId)) {
      setHoveredNodeId(null);
    }

    if (selectedNodeId && pageNodeIds.includes(selectedNodeId)) {
      return;
    }

    setSelectedNodeId(firstEditableNodeId);
    setSelectedNodeIds(firstEditableNodeId ? [firstEditableNodeId] : []);
    setSelectedRunIndex(null);
  }, [currentPage, currentProject, hoveredNodeId, pageNodeIds, selectedNodeId, selectedNodeIds]);

  const selectedNode = selectedNodeId && currentProject
    ? currentProject.nodes[selectedNodeId] ?? null
    : null;
  const inspectorNode = interactionMode === "content" && selectedNode?.type === "html"
    ? null
    : selectedNode;
  const selectedNodes = useMemo(() => (
    selectedNodeIds
      .map((nodeId) => currentProject?.nodes[nodeId] ?? null)
      .filter((node): node is DocumentNode => Boolean(node))
  ), [currentProject, selectedNodeIds]);
  const previewHtml = useMemo(() => {
    if (!currentProject) {
      return null;
    }

    return buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: currentProject,
      pageIndex: currentPageIndex,
      baseHref: baseHref ?? null
    });
  }, [baseHref, currentPageIndex, currentProject, html]);

  useEffect(() => {
    if (!inlineEditorRef.current || !inlineEditor) {
      return;
    }

    syncInlineEditorDomText(inlineEditorRef.current, inlineEditor.text);
    focusInlineEditorAtEnd(inlineEditorRef.current);
  }, [inlineEditor?.nodeId]);

  useEffect(() => {
    if (!inlineEditorRef.current || !inlineEditor) {
      return;
    }

    syncInlineEditorDomText(inlineEditorRef.current, inlineEditor.text);
  }, [inlineEditor?.text]);

  useEffect(() => {
    if (!previewHtml || !currentProject) {
      return;
    }

    const handleWindowMessage = (event: MessageEvent) => {
      const payload = event.data;

      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type === "codingns-static-html-layout-pointer") {
        const phase = typeof payload.phase === "string" ? payload.phase : "";
        const nodeId = typeof payload.nodeId === "string" ? payload.nodeId.trim() : "";
        const clientX = typeof payload.clientX === "number" ? payload.clientX : Number.NaN;
        const clientY = typeof payload.clientY === "number" ? payload.clientY : Number.NaN;

        if (!nodeId || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
          return;
        }

        if (phase === "start") {
          if (interactionMode !== "layout") {
            return;
          }

          const node = currentProject.nodes[nodeId];
          const capability = resolveLayoutCapability(node);
          const additive = Boolean(payload.metaKey) || Boolean(payload.ctrlKey);
          const activeNodeIds = additive
            ? (selectedNodeIds.includes(nodeId) ? selectedNodeIds : [...selectedNodeIds, nodeId])
            : [nodeId];

          setSelectedNodeId(nodeId);
          setSelectedNodeIds(activeNodeIds);
          setSelectedRunIndex(null);
          setInlineEditor(null);

          if (!capability.movable) {
            return;
          }

          const originBoxes = Object.fromEntries(
            activeNodeIds
              .map((activeNodeId) => {
                const activeNode = currentProject.nodes[activeNodeId];
                return activeNode
                  ? [activeNodeId, resolveNodeAbsoluteLayoutBox(activeNode, layoutMeasurements[activeNodeId])]
                  : null;
              })
              .filter((entry): entry is [string, DocumentNodeBox] => Boolean(entry))
          );
          const referenceBoxes = Object.fromEntries(
            pageNodeIds
              .map((pageNodeId) => {
                const pageNode = currentProject.nodes[pageNodeId];
                return pageNode
                  ? [pageNodeId, resolveNodeAbsoluteLayoutBox(pageNode, layoutMeasurements[pageNodeId])]
                  : null;
              })
              .filter((entry): entry is [string, DocumentNodeBox] => Boolean(entry))
          );

          setLayoutGesture({
            source: "iframe",
            handle: "move",
            nodeIds: activeNodeIds,
            pointerStartX: clientX,
            pointerStartY: clientY,
            activated: false,
            startProject: currentProject,
            startPageIndex: currentPageIndex,
            pageNodeIds,
            referenceBoxes,
            startSelectedNodeId: selectedNodeId,
            startSelectedNodeIds: selectedNodeIds,
            originBoxes
          });
          return;
        }

        const currentGesture = layoutGestureRef.current;

        if (!currentGesture || currentGesture.source !== "iframe") {
          return;
        }

        if (phase === "move") {
          applyLayoutGestureDelta(currentGesture, clientX, clientY);
          return;
        }

        if (phase === "end" || phase === "cancel") {
          finishLayoutGesture(currentGesture);
          return;
        }

        return;
      }

      if (payload.type === "codingns-static-html-layout-hover") {
        if (interactionMode !== "layout") {
          return;
        }

        const nodeId = typeof payload.nodeId === "string" ? payload.nodeId.trim() : "";
        setHoveredNodeId(nodeId || null);
        return;
      }

      if (payload.type !== "codingns-static-html-node-select") {
        return;
      }

      const nodeId = typeof payload.nodeId === "string" ? payload.nodeId.trim() : "";
      const runIndex = typeof payload.runIndex === "number" && Number.isInteger(payload.runIndex)
        ? payload.runIndex
        : null;

      if (!nodeId || !currentProject.nodes[nodeId]) {
        return;
      }

      const matchedPageIndex = currentProject.pages.findIndex((page) =>
        listPageNodeIds(currentProject, page.id).includes(nodeId)
      );

      if (matchedPageIndex >= 0 && matchedPageIndex !== currentPageIndex) {
        setCurrentPageIndex(matchedPageIndex);
      }

      const node = currentProject.nodes[nodeId];

      if (!node) {
        return;
      }

      if (interactionMode === "layout") {
        if (node.type === "html") {
          return;
        }

        const capability = resolveLayoutCapability(node);
        if (capability.movable || capability.resizable || capability.alignable) {
          const additive = payload.eventType === "click" && (Boolean(payload.metaKey) || Boolean(payload.ctrlKey));
          setSelectedNodeIds((current) => {
            if (!additive) {
              return [nodeId];
            }

            if (current.includes(nodeId)) {
              const filtered = current.filter((item) => item !== nodeId);
              return filtered.length > 0 ? filtered : [nodeId];
            }

            return [...current, nodeId];
          });
        }
        setSelectedNodeId(nodeId);
        setSelectedRunIndex(null);
        setInlineEditor(null);
        return;
      }

      if (node.type === "html") {
        return;
      }

      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
      setSelectedRunIndex(runIndex);

      if (payload.eventType === "dblclick") {
        const hasMultipleRuns = Array.isArray(node?.content.runs) && node.content.runs.length > 1;
        const isInlineEditable = node?.editable && (node.type === "text" || typeof node.content.text === "string");
        const rect = isMessageRect(payload.rect) ? payload.rect : null;

        if (isInlineEditable && rect && !hasMultipleRuns && runIndex === null) {
          const nextInlineEditor = {
            nodeId,
            text: node.content.text ?? "",
            rect,
            appearance: resolveInlineEditorAppearance(payload.appearance, node.style)
          };

          setInlineEditor(nextInlineEditor);
          return;
        }
      }

      setInlineEditor(null);
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, [currentPageIndex, currentProject, interactionMode, layoutMeasurements, previewHtml, selectedNodeId, selectedNodeIds]);

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;

    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage(
      {
        type: "codingns-static-html-selection-sync",
        selectedNodeId,
        selectedRunIndex,
        inlineEditingNodeId: inlineEditor?.nodeId ?? null,
        layoutModeEnabled: interactionMode === "layout",
        layoutHoveredNodeId: interactionMode === "layout" ? hoveredNodeId : null,
        layoutSelectedNodeIds: interactionMode === "layout" ? selectedNodeIds : []
      },
      "*"
    );
  }, [hoveredNodeId, inlineEditor?.nodeId, interactionMode, previewHtml, selectedNodeId, selectedNodeIds, selectedRunIndex]);

  const currentPageId = currentPage?.id ?? null;
  const canUndo = history.length > 0;

  function handleUndo() {
    const previousEntry = history[history.length - 1];

    if (!previousEntry) {
      return;
    }

    historyCoalesceKeyRef.current = null;
    setHistory((current) => current.slice(0, -1));
    setDraftProject(previousEntry.project);
    setLayoutPreviewBoxes({});
    setLayoutGuideLines([]);
    setCurrentPageIndex(previousEntry.currentPageIndex);
    setSelectedNodeId(previousEntry.selectedNodeId);
    setSelectedNodeIds(previousEntry.selectedNodeId ? [previousEntry.selectedNodeId] : previousEntry.selectedNodeIds);
    setSelectedRunIndex(null);
    setInlineEditor(null);
    setLayoutGesture(null);
  }

  useEffect(() => {
    if (!currentProject || !frameShellRef.current) {
      setFrameScale(1);
      return;
    }

    const shell = frameShellRef.current;

    const updateScale = () => {
      const shellRect = shell.getBoundingClientRect();
      const safePadding = 24;
      const shellWidth = Math.max(1, shellRect.width - safePadding);
      const shellHeight = Math.max(1, shellRect.height - safePadding);
      const widthScale = shellWidth / currentProject.canvas.width;
      const heightScale = shellHeight / currentProject.canvas.height;
      const nextScale = Math.min(widthScale, heightScale, 1);
      setFrameScale(nextScale > 0 ? nextScale : 1);
    };

    updateScale();
    window.addEventListener("resize", updateScale);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", updateScale);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateScale();
    });
    resizeObserver.observe(shell);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [currentProject]);

  const frameStageStyle = useMemo<CSSProperties | undefined>(() => {
    if (!currentProject) {
      return undefined;
    }

    const scaledWidth = currentProject.canvas.width * frameScale;
    const scaledHeight = currentProject.canvas.height * frameScale;

    return {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      width: `${scaledWidth}px`,
      height: `${scaledHeight}px`
    };
  }, [currentProject, frameScale]);

  const frameStyle = useMemo<CSSProperties | undefined>(() => {
    if (!currentProject) {
      return undefined;
    }

    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: `${currentProject.canvas.width}px`,
      height: `${currentProject.canvas.height}px`,
      transform: `scale(${frameScale})`,
      transformOrigin: "top left"
    };
  }, [currentProject, frameScale]);

  const inlineEditorOverlayStyle = useMemo(() => {
    if (!inlineEditor) {
      return null;
    }

    const iframeRect = frameRef.current?.getBoundingClientRect();
    const stageRect = frameStageRef.current?.getBoundingClientRect();

    if (!iframeRect || !stageRect) {
      return {
        left: Math.max(0, inlineEditor.rect.left),
        top: Math.max(0, inlineEditor.rect.top),
        width: Math.max(120, inlineEditor.rect.width),
        minHeight: Math.max(48, inlineEditor.rect.height)
      };
    }

    const left = iframeRect.left - stageRect.left + (inlineEditor.rect.left * frameScale);
    const top = iframeRect.top - stageRect.top + (inlineEditor.rect.top * frameScale);

    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.max(120, inlineEditor.rect.width * frameScale),
      minHeight: Math.max(48, inlineEditor.rect.height * frameScale)
    };
  }, [frameScale, inlineEditor]);

  useEffect(() => {
    if (!inlineEditorRef.current || !inlineEditorOverlayStyle) {
      return;
    }

    inlineEditorRef.current.style.height = `${inlineEditorOverlayStyle.minHeight}px`;
    inlineEditorRef.current.style.height = `${Math.max(
      inlineEditorOverlayStyle.minHeight,
      inlineEditorRef.current.scrollHeight
    )}px`;
  }, [inlineEditor?.nodeId, inlineEditor?.text, inlineEditorOverlayStyle]);

  const inlineEditorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!inlineEditor || !inlineEditorOverlayStyle) {
      return undefined;
    }

    return {
      left: `${inlineEditorOverlayStyle.left}px`,
      top: `${inlineEditorOverlayStyle.top}px`,
      width: `${inlineEditorOverlayStyle.width}px`,
      minHeight: `${inlineEditorOverlayStyle.minHeight}px`,
      fontFamily: inlineEditor.appearance.fontFamily ?? undefined,
      fontSize: inlineEditor.appearance.fontSize ?? undefined,
      fontWeight: inlineEditor.appearance.fontWeight ?? undefined,
      fontStyle: inlineEditor.appearance.fontStyle ?? undefined,
      lineHeight: inlineEditor.appearance.lineHeight ?? undefined,
      letterSpacing: inlineEditor.appearance.letterSpacing ?? undefined,
      color: inlineEditor.appearance.color ?? undefined,
      caretColor: inlineEditor.appearance.color ?? undefined,
      textAlign: normalizeTextAlign(inlineEditor.appearance.textAlign),
      whiteSpace: normalizeWhiteSpace(inlineEditor.appearance.whiteSpace),
      padding: inlineEditor.appearance.padding ?? undefined,
      textTransform: normalizeTextTransform(inlineEditor.appearance.textTransform)
    };
  }, [inlineEditor, inlineEditorOverlayStyle]);

  function resolveFocusStateByPageId(nextPageId: string | null, nextProject: DocumentProject) {
    if (!nextPageId) {
      return {
        nextIndex: 0,
        nextSelectedNodeId: null
      };
    }

    const nextIndex = nextProject.pages.findIndex((page) => page.id === nextPageId);
    const safeIndex = nextIndex >= 0 ? nextIndex : 0;
    const targetPage = nextProject.pages[safeIndex] ?? null;
    const targetNodeIds = targetPage ? listPageNodeIds(nextProject, targetPage.id) : [];
    return {
      nextIndex: safeIndex,
      nextSelectedNodeId:
        targetNodeIds.find((nodeId) => nextProject.nodes[nodeId]?.editable) ?? null
    };
  }

  function applyProjectState(
    nextProject: DocumentProject,
    options?: {
      focusPageId?: string | null;
      selectedNodeId?: string | null;
      selectedNodeIds?: string[];
    }
  ) {
    setDraftProject(nextProject);
    setLayoutPreviewBoxes({});
    setLayoutGuideLines([]);

    if (options?.focusPageId !== undefined) {
      const focusState = resolveFocusStateByPageId(options.focusPageId, nextProject);
      setCurrentPageIndex(focusState.nextIndex);
      setSelectedNodeId(options.selectedNodeId ?? focusState.nextSelectedNodeId);
      setSelectedNodeIds(
        options.selectedNodeIds
          ?? (options.selectedNodeId
            ? [options.selectedNodeId]
            : (focusState.nextSelectedNodeId ? [focusState.nextSelectedNodeId] : []))
      );
      return;
    }

    if (options?.selectedNodeId !== undefined) {
      setSelectedNodeId(options.selectedNodeId);
    }

    if (options?.selectedNodeIds !== undefined) {
      setSelectedNodeIds(options.selectedNodeIds);
    }
  }

  function commitProjectChange(input: {
    nextProject: DocumentProject;
    focusPageId?: string | null;
    selectedNodeId?: string | null;
    selectedNodeIds?: string[];
    historyKey?: string | null;
    preserveInlineEditor?: boolean;
  }) {
    if (!currentProject) {
      return;
    }

    if (!input.historyKey || historyCoalesceKeyRef.current !== input.historyKey) {
      setHistory((current) => [
        ...current,
        {
          project: currentProject,
          currentPageIndex,
          selectedNodeId,
          selectedNodeIds
        }
      ].slice(-10));
    }

    historyCoalesceKeyRef.current = input.historyKey ?? null;
    applyProjectState(input.nextProject, {
      focusPageId: input.focusPageId,
      selectedNodeId: input.selectedNodeId,
      selectedNodeIds: input.selectedNodeIds
    });

    if (!input.preserveInlineEditor) {
      setInlineEditor(null);
    }
  }

  function pushHistoryEntry(entry: EditorHistoryEntry) {
    setHistory((current) => [
      ...current,
      entry
    ].slice(-10));
  }

  function applyLayoutGestureDelta(gesture: LayoutGestureState, clientX: number, clientY: number) {
    const scale = frameScaleRef.current;
    const deltaX = scale > 0 ? (clientX - gesture.pointerStartX) / scale : 0;
    const deltaY = scale > 0 ? (clientY - gesture.pointerStartY) / scale : 0;
    const distance = Math.hypot(deltaX, deltaY);

    if (!gesture.activated && gesture.handle === "move" && distance < LAYOUT_DRAG_ACTIVATION_DISTANCE) {
      return;
    }

    if (!gesture.activated) {
      setLayoutGesture((current) => current
        ? {
            ...current,
            activated: true
          }
        : current);
    }

    const resolved = resolveGesturePreview(gesture, deltaX, deltaY);
    setLayoutPreviewBoxes(resolved.previewBoxes);
    setLayoutGuideLines(resolved.guideLines);
  }

  function finishLayoutGesture(gesture: LayoutGestureState) {
    const latestProject = projectRef.current;
    const previewBoxes = layoutPreviewBoxesRef.current;

    if (latestProject && gesture.activated && Object.keys(previewBoxes).length > 0) {
      const localBoxes = Object.fromEntries(
        Object.entries(previewBoxes)
          .map(([nodeId, previewBox]) => {
            const node = latestProject.nodes[nodeId];
            const measurement = layoutMeasurements[nodeId];

            if (!node) {
              return null;
            }

            const fallbackLocalBox = resolveNodeLayoutBox(node, measurement);
            const currentAbsoluteBox = resolveNodeAbsoluteLayoutBox(node, measurement);
            const offsetX = currentAbsoluteBox.x - fallbackLocalBox.x;
            const offsetY = currentAbsoluteBox.y - fallbackLocalBox.y;

            return [
              nodeId,
              clampLayoutBox({
                ...previewBox,
                x: previewBox.x - offsetX,
                y: previewBox.y - offsetY
              })
            ] as const;
          })
          .filter((entry): entry is readonly [string, DocumentNodeBox] => Boolean(entry))
      );
      const committedProject = applyBoxesToProject(latestProject, localBoxes);
      historyCoalesceKeyRef.current = null;
      pushHistoryEntry({
        project: gesture.startProject,
        currentPageIndex: gesture.startPageIndex,
        selectedNodeId: gesture.startSelectedNodeId,
        selectedNodeIds: gesture.startSelectedNodeIds
      });
      setDraftProject(committedProject);
    }

    setLayoutPreviewBoxes({});
    setLayoutGuideLines([]);
    setLayoutGesture(null);
  }

  function selectNode(nodeId: string, options?: { additive?: boolean; switchToLayout?: boolean }) {
    if (!currentProject) {
      return;
    }

    const node = currentProject.nodes[nodeId];

    if (!node) {
      return;
    }

    const additive = options?.additive ?? false;

    setSelectedNodeId(nodeId);
    setSelectedRunIndex(null);

    if (options?.switchToLayout) {
      setInteractionMode("layout");
    }

    setSelectedNodeIds((current) => {
      if (!additive) {
        return [nodeId];
      }

      if (current.includes(nodeId)) {
        const filtered = current.filter((item) => item !== nodeId);
        return filtered.length > 0 ? filtered : [nodeId];
      }

      return [...current, nodeId];
    });
  }

  function resolveParentNodeId(targetNodeId: string): string | null {
    if (!currentProject) {
      return null;
    }

    return Object.values(currentProject.nodes).find((node) => node.children.includes(targetNodeId))?.id ?? null;
  }

  function resolveLayoutFreezeContainerNodeId(targetNodeId: string | null): string | null {
    if (!currentProject) {
      return null;
    }

    if (!targetNodeId) {
      return null;
    }

    const parentNodeId = resolveParentNodeId(targetNodeId);

    if (!parentNodeId) {
      return null;
    }

    const parentNode = currentProject.nodes[parentNodeId];

    if (!parentNode || parentNode.runtimeFlags.includes("layout-freeze-container") || !parentNode.sourceRef) {
      return null;
    }

    return parentNodeId;
  }

  function canFreezeLayoutContainer(targetNodeId: string | null): boolean {
    if (!currentProject) {
      return false;
    }

    const containerNodeId = resolveLayoutFreezeContainerNodeId(targetNodeId);

    if (!containerNodeId) {
      return false;
    }

    const containerNode = currentProject.nodes[containerNodeId];

    if (!containerNode) {
      return false;
    }

    const targetNode = currentProject.nodes[targetNodeId ?? ""];

    if (!targetNode) {
      return false;
    }

    const containerAbsoluteBox = resolveLayoutFreezeContainerAbsoluteBox(containerNodeId, containerNode);

    if (!containerAbsoluteBox) {
      return false;
    }

    return Boolean(resolveLayoutFreezeChildBox(targetNode, containerAbsoluteBox));
  }

  function freezeSelectedNodeContainer() {
    if (!currentProject || !selectedNodeId) {
      return;
    }

    if (!canFreezeLayoutContainer(selectedNodeId)) {
      return;
    }

    const containerNodeId = resolveLayoutFreezeContainerNodeId(selectedNodeId);

    if (!containerNodeId) {
      return;
    }

    const containerNode = currentProject.nodes[containerNodeId];

    if (!containerNode) {
      return;
    }

    const containerAbsoluteBox = resolveLayoutFreezeContainerAbsoluteBox(containerNodeId, containerNode);

    if (!containerAbsoluteBox) {
      return;
    }

    const nextProject = updateProjectNodes(
      currentProject,
      [containerNodeId, ...containerNode.children],
      (node, nodeId) => {
        if (nodeId === containerNodeId) {
          const nextRuntimeFlags = node.runtimeFlags.includes("layout-freeze-container")
            ? node.runtimeFlags
            : [...node.runtimeFlags, "layout-freeze-container"];

          return {
            ...node,
            style: {
              ...node.style,
              position: isFreeLayoutPosition(node.style.position) ? node.style.position : "relative"
            },
            runtimeFlags: nextRuntimeFlags
          };
        }

        const nextBox = resolveLayoutFreezeChildBox(node, containerAbsoluteBox);

        if (!nextBox) {
          return node;
        }
        const nextRuntimeFlags = node.runtimeFlags
          .filter((flag) => flag !== "layout-freeze-container")
          .concat(
            node.runtimeFlags.includes("layout-freeze-child") ? [] : ["layout-freeze-child"],
            node.runtimeFlags.includes("draft-box") ? [] : ["draft-box"]
          );

        return {
          ...node,
          box: nextBox,
          style: {
            ...node.style,
            position: "absolute",
            margin: "0px"
          },
          runtimeFlags: nextRuntimeFlags
        };
      }
    );

    commitProjectChange({
      nextProject,
      selectedNodeId,
      selectedNodeIds: [selectedNodeId],
      historyKey: `layout-freeze:${containerNodeId}`
    });
    setInteractionMode("layout");
  }

  function resolveLayoutFreezeContainerAbsoluteBox(
    containerNodeId: string,
    containerNode: DocumentNode
  ): DocumentNodeBox | null {
    const containerMeasurement = layoutMeasurements[containerNodeId];

    if (containerMeasurement) {
      return resolveNodeAbsoluteLayoutBox(containerNode, containerMeasurement);
    }

    if (containerNodeId === currentPage?.rootNodeId) {
      return clampLayoutBox({
        x: 0,
        y: 0,
        width: currentProject?.canvas.width ?? containerNode.box.width,
        height: currentProject?.canvas.height ?? containerNode.box.height,
        zIndex: containerNode.box.zIndex
      });
    }

    for (const childNodeId of containerNode.children) {
      const childNode = currentProject?.nodes[childNodeId];
      const childMeasurement = layoutMeasurements[childNodeId];

      if (!childNode || !childMeasurement) {
        continue;
      }

      const inferredX = childMeasurement.left - childMeasurement.localLeft;
      const inferredY = childMeasurement.top - childMeasurement.localTop;
      const inferredSize = resolveLayoutFreezeContainerSize(containerNode);

      return clampLayoutBox({
        x: inferredX,
        y: inferredY,
        width: inferredSize.width,
        height: inferredSize.height,
        zIndex: containerNode.box.zIndex
      });
    }

    const fallbackSize = resolveLayoutFreezeContainerSize(containerNode);
    return clampLayoutBox({
      x: containerNode.box.x,
      y: containerNode.box.y,
      width: fallbackSize.width,
      height: fallbackSize.height,
      zIndex: containerNode.box.zIndex
    });
  }

  function resolveLayoutFreezeContainerSize(
    containerNode: DocumentNode
  ): Pick<DocumentNodeBox, "width" | "height"> {
    const measuredChildren = containerNode.children
      .map((childNodeId) => resolveLayoutFreezeChildLocalBox(currentProject?.nodes[childNodeId] ?? null))
      .filter((box): box is DocumentNodeBox => Boolean(box));

    const fallbackWidth = containerNode.box.width;
    const fallbackHeight = containerNode.box.height;

    if (!measuredChildren.length) {
      return {
        width: fallbackWidth,
        height: fallbackHeight
      };
    }

    const inferredWidth = measuredChildren.reduce((maxWidth, box) => Math.max(maxWidth, box.x + box.width), 0);
    const inferredHeight = measuredChildren.reduce((maxHeight, box) => Math.max(maxHeight, box.y + box.height), 0);

    return {
      width: Math.max(fallbackWidth, inferredWidth),
      height: Math.max(fallbackHeight, inferredHeight)
    };
  }

  function resolveLayoutFreezeChildLocalBox(
    node: DocumentNode | null
  ): DocumentNodeBox | null {
    if (!node) {
      return null;
    }

    const measurement = layoutMeasurements[node.id];

    if (measurement) {
      return clampLayoutBox({
        x: measurement.localLeft,
        y: measurement.localTop,
        width: measurement.width,
        height: measurement.height,
        zIndex: node.box.zIndex
      });
    }

    return clampLayoutBox(node.box);
  }

  function resolveLayoutFreezeChildBox(
    node: DocumentNode,
    containerAbsoluteBox: DocumentNodeBox
  ): DocumentNodeBox | null {
    const measurement = layoutMeasurements[node.id];

    if (measurement) {
      const absoluteBox = resolveNodeAbsoluteLayoutBox(node, measurement);
      return clampLayoutBox({
        x: absoluteBox.x - containerAbsoluteBox.x,
        y: absoluteBox.y - containerAbsoluteBox.y,
        width: absoluteBox.width,
        height: absoluteBox.height,
        zIndex: absoluteBox.zIndex
      });
    }

    const fallbackLocalBox = resolveLayoutFreezeChildLocalBox(node);

    if (!fallbackLocalBox) {
      return null;
    }

    return clampLayoutBox(fallbackLocalBox);
  }

  function duplicateSelectedNode() {
    if (!currentProject || !selectedNodeId) {
      return;
    }

    const duplicated = duplicateProjectNode(currentProject, selectedNodeId);

    if (!duplicated.duplicatedNodeId) {
      return;
    }

    commitProjectChange({
      nextProject: duplicated.project,
      selectedNodeId: duplicated.duplicatedNodeId,
      selectedNodeIds: [duplicated.duplicatedNodeId],
      historyKey: `duplicate:${selectedNodeId}`
    });
    setInteractionMode("layout");
  }

  function updateSelectedNodeBox(nextBox: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) {
    if (!currentProject || !selectedNodeId) {
      return;
    }

    const currentNode = currentProject.nodes[selectedNodeId];

    if (!currentNode) {
      return;
    }

    const baseBox = resolveNodeLayoutBox(currentNode, layoutMeasurements[selectedNodeId]);
    const patchedBox = clampLayoutBox({
      ...baseBox,
      x: nextBox.x ?? baseBox.x,
      y: nextBox.y ?? baseBox.y,
      width: nextBox.width ?? baseBox.width,
      height: nextBox.height ?? baseBox.height,
      zIndex: baseBox.zIndex
    });
    const nextProject = applyBoxesToProject(currentProject, {
      [selectedNodeId]: patchedBox
    });

    commitProjectChange({
      nextProject,
      selectedNodeId,
      selectedNodeIds,
      historyKey: `layout-box:${selectedNodeId}`
    });
  }

  function applyLayoutAlignment(command: "left" | "right" | "top" | "bottom") {
    if (!currentProject) {
      return;
    }

    const alignableNodeIds = selectedNodeIds.filter((nodeId) => resolveLayoutCapability(currentProject.nodes[nodeId]).alignable);

    if (alignableNodeIds.length < 2) {
      return;
    }

    const nextBoxes = alignBoxes(
      Object.fromEntries(
        alignableNodeIds
          .map((nodeId) => {
            const node = currentProject.nodes[nodeId];

            if (!node) {
              return null;
            }

            return [nodeId, resolveNodeLayoutBox(node, layoutMeasurements[nodeId])] as const;
          })
          .filter((entry): entry is readonly [string, DocumentNodeBox] => Boolean(entry))
      ),
      command
    );
    const nextProject = applyBoxesToProject(currentProject, nextBoxes);

    commitProjectChange({
      nextProject,
      selectedNodeId,
      selectedNodeIds: alignableNodeIds,
      historyKey: `layout-align:${command}:${alignableNodeIds.join(",")}`
    });
  }

  useEffect(() => {
    if (!previewHtml || interactionMode !== "layout") {
      setLayoutMeasurements({});
      return;
    }

    const handleWindowMessage = (event: MessageEvent) => {
      const payload = event.data;

      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type !== "codingns-static-html-layout-measurements") {
        return;
      }

      if (!Array.isArray(payload.measurements)) {
        return;
      }

      const nextMeasurements: Record<string, LayoutNodeMeasurement> = {};

      payload.measurements.forEach((item: unknown) => {
        if (!item || typeof item !== "object") {
          return;
        }

        const measurement = item as Record<string, unknown>;

        const nodeId = typeof measurement.nodeId === "string" ? measurement.nodeId.trim() : "";
        const left = typeof measurement.left === "number" ? measurement.left : Number.NaN;
        const top = typeof measurement.top === "number" ? measurement.top : Number.NaN;
        const width = typeof measurement.width === "number" ? measurement.width : Number.NaN;
        const height = typeof measurement.height === "number" ? measurement.height : Number.NaN;
        const localLeft = typeof measurement.localLeft === "number" ? measurement.localLeft : left;
        const localTop = typeof measurement.localTop === "number" ? measurement.localTop : top;

        if (!nodeId || !Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
          return;
        }

        nextMeasurements[nodeId] = {
          left,
          top,
          width,
          height,
          localLeft,
          localTop
        };
      });

      setLayoutMeasurements(nextMeasurements);
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, [interactionMode, previewHtml]);

  useEffect(() => {
    if (interactionMode !== "layout" || !previewHtml) {
      return;
    }

    const frameWindow = frameRef.current?.contentWindow;

    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage(
      {
        type: "codingns-static-html-layout-measure-request",
        nodeIds: Array.from(new Set([
          currentPage?.rootNodeId ?? "",
          ...pageNodeIds
        ].filter((nodeId) => nodeId && currentProject?.nodes[nodeId])))
      },
      "*"
    );
  }, [currentPage?.rootNodeId, currentProject, interactionMode, pageNodeIds, previewHtml]);

  useEffect(() => {
    if (!layoutGesture || layoutGesture.source !== "overlay") {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      applyLayoutGestureDelta(layoutGesture, event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      finishLayoutGesture(layoutGesture);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [layoutGesture]);

  if (!probe.supported || !currentProject) {
    return (
      <div className="static-html-presentation-empty">
        <p className="status-text">{t("conversation.fileViewerPresentationUnsupported")}</p>
        {probe.reason ? (
          <p className="status-text">
            {t("conversation.fileViewerPresentationUnsupportedReason").replace("{reason}", probe.reason)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="static-html-presentation-shell"
      data-testid="static-html-presentation-view"
    >
      <aside className="static-html-presentation-sidebar">
        <div className="static-html-presentation-sidebar-actions">
          <button
            type="button"
            className="secondary-button static-html-presentation-sidebar-action-button"
            onClick={handleUndo}
            disabled={!canUndo}
          >
            {t("conversation.fileViewerPresentationUndoAction")}
          </button>
          <button
            type="button"
            className="primary-button static-html-presentation-sidebar-action-button"
            onClick={onSave}
            disabled={!canSave || saving}
          >
            {saving ? t("conversation.filePanelSaving") : t("conversation.filePanelSave")}
          </button>
        </div>
        <div className="static-html-presentation-page-toolbar">
          <button
            type="button"
            className="secondary-button static-html-presentation-page-toolbar-button"
            onClick={() => {
              const appended = appendProjectPage(currentProject, {
                insertAfterPageId: currentPageId
              });
              commitProjectChange({
                nextProject: appended.project,
                focusPageId: appended.pageId
              });
            }}
          >
            {t("conversation.fileViewerPresentationAddPage")}
          </button>
        </div>
        <div className="static-html-presentation-page-list" role="list">
          {currentProject.pages.map((page, index) => (
            <div
              key={page.id}
              className="static-html-presentation-page-item"
              data-active={page.id === currentPageId ? "true" : undefined}
              data-dragging={draggingPageId === page.id ? "true" : undefined}
              data-drop-target={dragPreview?.pageId === page.id ? "true" : undefined}
              data-drop-position={dragPreview?.pageId === page.id ? dragPreview.position : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", page.id);
                setDraggingPageId(page.id);
                setDragPreview(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const previewPosition = resolveDragPreviewPosition(event);
                setDragPreview((current) => {
                  if (current?.pageId === page.id && current.position === previewPosition) {
                    return current;
                  }

                  return {
                    pageId: page.id,
                    position: previewPosition
                  };
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourcePageId = event.dataTransfer.getData("text/plain") || draggingPageId;

                if (!sourcePageId || !dragPreview) {
                  return;
                }

                const targetIndex = resolveDragInsertIndex(
                  currentProject.pages,
                  sourcePageId,
                  dragPreview
                );

                if (targetIndex === null) {
                  setDraggingPageId(null);
                  setDragPreview(null);
                  return;
                }

                const moved = moveProjectPageToIndex(currentProject, sourcePageId, targetIndex);
                commitProjectChange({
                  nextProject: moved.project,
                  focusPageId: moved.pageId
                });
                setDraggingPageId(null);
                setDragPreview(null);
              }}
              onDragEnd={() => {
                setDraggingPageId(null);
                setDragPreview(null);
              }}
            >
              {dragPreview?.pageId === page.id && dragPreview.position === "before" ? (
                <div className="static-html-presentation-page-drop-indicator" data-position="before" />
              ) : null}
              <button
                type="button"
                className="static-html-presentation-page-main"
                onClick={() => {
                  const nextIndex = currentProject.pages.findIndex((item) => item.id === page.id);
                  setCurrentPageIndex(nextIndex >= 0 ? nextIndex : 0);
                }}
              >
                <span className="static-html-presentation-page-no">{String(index + 1).padStart(2, "0")}</span>
                <span className="static-html-presentation-page-title">{page.title ?? `第 ${index + 1} 页`}</span>
              </button>
              <div
                className="static-html-presentation-page-actions"
                aria-label={t("conversation.fileViewerPresentationPageActions")}
              >
                <span className="static-html-presentation-page-drag-hint">
                  {t("conversation.fileViewerPresentationDragToSort")}
                </span>
                <button
                  type="button"
                  className="static-html-presentation-page-action"
                  onClick={() => {
                    const duplicated = duplicateProjectPage(currentProject, page.id);

                    if (!duplicated.pageId) {
                      return;
                    }

                    commitProjectChange({
                      nextProject: duplicated.project,
                      focusPageId: duplicated.pageId
                    });
                  }}
                  aria-label={t("conversation.fileViewerPresentationDuplicatePage")}
                  title={t("conversation.fileViewerPresentationDuplicatePage")}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <rect x="5" y="5" width="7" height="7" rx="1.5" />
                    <path d="M4 10H3.5A1.5 1.5 0 0 1 2 8.5v-5A1.5 1.5 0 0 1 3.5 2h5A1.5 1.5 0 0 1 10 3.5V4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="static-html-presentation-page-action"
                  onClick={() => {
                    const removed = removeProjectPage(currentProject, page.id);
                    commitProjectChange({
                      nextProject: removed.project,
                      focusPageId: removed.nextPageId ?? currentPageId
                    });
                  }}
                  disabled={currentProject.pages.length <= 1}
                  aria-label={t("conversation.fileViewerPresentationDeletePage")}
                  title={t("conversation.fileViewerPresentationDeletePage")}
                >
                  ×
                </button>
              </div>
              {dragPreview?.pageId === page.id && dragPreview.position === "after" ? (
                <div className="static-html-presentation-page-drop-indicator" data-position="after" />
              ) : null}
            </div>
          ))}
        </div>
      </aside>

      <section className="static-html-presentation-stage">
        <section className="static-html-presentation-toolbar-panel">
          <div className="static-html-presentation-toolbar-panel-header">
            <div className="static-html-presentation-mode-switch" role="group" aria-label={t("conversation.fileViewerModeLabel")}>
              <button
                type="button"
                className="static-html-presentation-mode-button"
                data-active={interactionMode === "content" ? "true" : undefined}
                onClick={() => setInteractionMode("content")}
              >
                {t("conversation.fileViewerPresentationTextMode")}
              </button>
              <button
                type="button"
                className="static-html-presentation-mode-button"
                data-active={interactionMode === "layout" ? "true" : undefined}
                onClick={() => {
                  setInteractionMode("layout");
                  if (selectedNodeId) {
                    setSelectedNodeIds([selectedNodeId]);
                  }
                }}
              >
                {t("conversation.fileViewerPresentationLayoutMode")}
              </button>
            </div>
          </div>
          <div className="static-html-presentation-toolbar-panel-body">
            <div ref={toolbarViewportRef} className="static-html-presentation-toolbar-viewport">
              <div
                ref={toolbarContentRef}
                className="static-html-presentation-toolbar-scale-shell"
                style={{
                  transform: `scale(${toolbarScale})`,
                  width: toolbarScale < 1 ? `${100 / toolbarScale}%` : "100%"
                }}
              >
                <div className="static-html-presentation-toolbar static-html-presentation-inspector">
                  {interactionMode === "layout" ? (
                    <LayoutInspector
                      selectedNode={selectedNode}
                      selectedLayoutBox={selectedNode ? resolveNodeLayoutBox(selectedNode, selectedNodeId ? layoutMeasurements[selectedNodeId] : undefined) : null}
                      selectedNodes={selectedNodes}
                      showFreezeContainerAction={Boolean(selectedNodeId && resolveLayoutFreezeContainerNodeId(selectedNodeId))}
                      canFreezeContainer={canFreezeLayoutContainer(selectedNodeId)}
                      onDuplicate={duplicateSelectedNode}
                      onFreezeContainer={freezeSelectedNodeContainer}
                      onAlignLeft={() => applyLayoutAlignment("left")}
                      onAlignRight={() => applyLayoutAlignment("right")}
                      onAlignTop={() => applyLayoutAlignment("top")}
                      onAlignBottom={() => applyLayoutAlignment("bottom")}
                      onBoxChange={updateSelectedNodeBox}
                    />
                  ) : inspectorNode ? (
                    <NodeInspector
                      node={inspectorNode}
                      selectedRunIndex={selectedRunIndex}
                      onSelectedRunChange={setSelectedRunIndex}
                      compact
                      onTextChange={({ text: nextText, runs: nextRuns }) => {
                        if (!selectedNodeId) {
                          return;
                        }

                        const nextProject = updateProjectNode(currentProject, selectedNodeId, (node) => ({
                          ...node,
                          content: {
                            ...node.content,
                            text: nextText,
                            runs: nextRuns ?? updateNodeTextRuns(node, nextText)
                          }
                        }));
                        commitProjectChange({
                          nextProject,
                          historyKey: `text:${selectedNodeId}`
                        });
                      }}
                      onStyleChange={(stylePatch) => {
                        if (!selectedNodeId) {
                          return;
                        }

                        const nextProject = updateProjectNode(currentProject, selectedNodeId, (node) => ({
                          ...node,
                          style: {
                            ...node.style,
                            ...stylePatch
                          }
                        }));
                        commitProjectChange({
                          nextProject,
                          historyKey: `style:${selectedNodeId}`
                        });
                      }}
                    />
                  ) : (
                    <div className="static-html-presentation-toolbar-empty static-html-presentation-inspector-empty">
                      <p className="status-text">{t("conversation.fileViewerPresentationSelectNode")}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="static-html-presentation-content-panel">
          <div className="static-html-presentation-workarea">
            <div className="static-html-presentation-canvas-panel">
              <div ref={frameShellRef} className="static-html-presentation-frame-shell">
                {previewHtml ? (
                  <div
                    ref={frameStageRef}
                    className="static-html-presentation-frame-stage"
                    style={frameStageStyle}
                  >
                    <iframe
                      ref={frameRef}
                      className="static-html-presentation-frame"
                      data-testid="static-html-presentation-frame"
                      title={currentPage?.title ?? filePath}
                      srcDoc={previewHtml}
                      sandbox="allow-forms allow-modals allow-scripts"
                      style={frameStyle}
                      onLoad={() => {
                        frameRef.current?.contentWindow?.postMessage(
                          {
                            type: "codingns-static-html-selection-sync",
                            selectedNodeId,
                            inlineEditingNodeId: inlineEditor?.nodeId ?? null,
                            layoutModeEnabled: interactionMode === "layout",
                            layoutHoveredNodeId: interactionMode === "layout" ? hoveredNodeId : null,
                            layoutSelectedNodeIds: interactionMode === "layout" ? selectedNodeIds : []
                          },
                          "*"
                        );
                      }}
                    />
                    {interactionMode === "layout" ? (
                      <div className="static-html-presentation-layout-overlay" data-testid="static-html-presentation-layout-overlay">
                        {layoutGuideLines.map((guideLine, index) => (
                          <div
                            key={`${guideLine.orientation}-${guideLine.position}-${index}`}
                            className="static-html-presentation-layout-guide"
                            data-orientation={guideLine.orientation}
                            style={resolveLayoutGuideStyle(guideLine, frameScale)}
                          />
                        ))}
                        {hoveredNodeId && !selectedNodeIds.includes(hoveredNodeId) && layoutMeasurements[hoveredNodeId] ? (
                          <div
                            className="static-html-presentation-layout-box static-html-presentation-layout-box-hover"
                            data-hovered="true"
                            style={resolveLayoutBoxStyle(layoutMeasurements[hoveredNodeId]!, frameScale)}
                          />
                        ) : null}
                        {selectedNodeIds.map((nodeId) => {
                      const previewBox = layoutPreviewBoxes[nodeId];
                      const measurement = layoutMeasurements[nodeId];
                      const node = currentProject.nodes[nodeId];
                      const capability = resolveLayoutCapability(node);
                      const boxStyle = previewBox
                        ? resolveLayoutBoxStyle(
                            {
                              left: previewBox.x,
                              top: previewBox.y,
                              width: previewBox.width,
                              height: previewBox.height,
                              localLeft: previewBox.x,
                              localTop: previewBox.y
                            },
                            frameScale
                          )
                        : (measurement ? resolveLayoutBoxStyle(measurement, frameScale) : undefined);

                      if (!boxStyle || !node) {
                        return null;
                      }

                          return (
                            <div
                              key={nodeId}
                          className="static-html-presentation-layout-box"
                          data-primary={nodeId === selectedNodeId ? "true" : undefined}
                          data-disabled={capability.movable ? undefined : "true"}
                          style={boxStyle}
                              onPointerEnter={() => {
                                setHoveredNodeId(nodeId);
                              }}
                              onPointerLeave={() => {
                                setHoveredNodeId((current) => current === nodeId ? null : current);
                              }}
                              onPointerDown={(event) => {
                                if (!capability.movable) {
                                  return;
                                }

                                event.preventDefault();
                                event.stopPropagation();
                                selectNode(nodeId, {
                                  additive: event.metaKey || event.ctrlKey,
                                  switchToLayout: true
                                });

                                const activeNodeIds = (event.metaKey || event.ctrlKey)
                                  ? (selectedNodeIds.includes(nodeId) ? selectedNodeIds : [...selectedNodeIds, nodeId])
                                  : [nodeId];
                                const originBoxes = Object.fromEntries(
                                  activeNodeIds
                                    .map((activeNodeId) => {
                                      const activeNode = currentProject.nodes[activeNodeId];
                                      return activeNode
                                        ? [activeNodeId, resolveNodeAbsoluteLayoutBox(activeNode, layoutMeasurements[activeNodeId])]
                                        : null;
                                    })
                                    .filter((entry): entry is [string, DocumentNode["box"]] => Boolean(entry))
                                );
                                const referenceBoxes = Object.fromEntries(
                                  pageNodeIds
                                    .map((pageNodeId) => {
                                      const pageNode = currentProject.nodes[pageNodeId];
                                      return pageNode
                                        ? [pageNodeId, resolveNodeAbsoluteLayoutBox(pageNode, layoutMeasurements[pageNodeId])]
                                        : null;
                                    })
                                    .filter((entry): entry is [string, DocumentNodeBox] => Boolean(entry))
                                );

                                setLayoutGesture({
                                  source: "overlay",
                                  handle: "move",
                                  nodeIds: activeNodeIds,
                                  pointerStartX: event.clientX,
                                  pointerStartY: event.clientY,
                                  startProject: currentProject,
                                  startPageIndex: currentPageIndex,
                                  pageNodeIds,
                                  referenceBoxes,
                                  startSelectedNodeId: selectedNodeId,
                                  startSelectedNodeIds: selectedNodeIds,
                                  activated: false,
                                  originBoxes
                                });
                              }}
                            >
                              {capability.resizable ? (
                                <button
                                  type="button"
                                  className="static-html-presentation-layout-resize-handle"
                                  aria-label={t("conversation.fileViewerPresentationResizeHandle")}
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    selectNode(nodeId, {
                                      switchToLayout: true
                                    });

                                    setLayoutGesture({
                                      source: "overlay",
                                      handle: "resize-se",
                                      nodeIds: [nodeId],
                                      pointerStartX: event.clientX,
                                      pointerStartY: event.clientY,
                                      startProject: currentProject,
                                      startPageIndex: currentPageIndex,
                                      pageNodeIds,
                                      referenceBoxes: Object.fromEntries(
                                        pageNodeIds
                                          .map((pageNodeId) => {
                                            const pageNode = currentProject.nodes[pageNodeId];
                                            return pageNode
                                              ? [pageNodeId, resolveNodeAbsoluteLayoutBox(pageNode, layoutMeasurements[pageNodeId])]
                                              : null;
                                          })
                                          .filter((entry): entry is [string, DocumentNodeBox] => Boolean(entry))
                                      ),
                                      startSelectedNodeId: selectedNodeId,
                                      startSelectedNodeIds: selectedNodeIds,
                                      activated: true,
                                      originBoxes: {
                                        [nodeId]: resolveNodeAbsoluteLayoutBox(
                                          currentProject.nodes[nodeId]!,
                                          layoutMeasurements[nodeId]
                                        )
                                      }
                                    });
                                  }}
                                >
                                  <span />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {inlineEditor ? (
                      <div
                        ref={inlineEditorRef}
                        className="static-html-presentation-inline-editor"
                        data-testid="static-html-presentation-inline-editor"
                        role="textbox"
                        aria-multiline="true"
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        style={inlineEditorStyle}
                        onInput={(event) => {
                          const nextText = readInlineEditorDomText(event.currentTarget);
                          const currentInlineEditor = inlineEditor;

                          setInlineEditor((current) => current
                            ? {
                                ...current,
                                text: nextText
                              }
                            : current);

                          if (!currentInlineEditor || !currentProject.nodes[currentInlineEditor.nodeId]) {
                            return;
                          }

                          const nextProject = updateProjectNode(currentProject, currentInlineEditor.nodeId, (node) => ({
                            ...node,
                            content: {
                              ...node.content,
                              text: nextText,
                              runs: updateNodeTextRuns(node, nextText)
                            }
                          }));
                          commitProjectChange({
                            nextProject,
                            selectedNodeId: currentInlineEditor.nodeId,
                            historyKey: `inline-text:${currentInlineEditor.nodeId}`,
                            preserveInlineEditor: true
                          });
                        }}
                        onBlur={() => {
                          setInlineEditor(null);
                        }}
                        onPaste={(event) => {
                          event.preventDefault();
                          const pastedText = event.clipboardData.getData("text/plain");
                          insertPlainTextIntoInlineEditor(pastedText);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setInlineEditor(null);
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="status-text">{t("conversation.fileViewerHtmlPreviewUnavailable")}</p>
                )}
              </div>
            </div>

            <aside className="static-html-presentation-node-sidebar">
              <div className="static-html-presentation-node-sidebar-header">
                <p className="static-html-presentation-node-sidebar-kicker">
                  {t("conversation.fileViewerPresentationComponentList")}
                </p>
              </div>
              <div className="static-html-presentation-node-strip" role="list">
                {pageNodeIds.map((nodeId) => {
                  const node = currentProject.nodes[nodeId];

                  if (!node) {
                    return null;
                  }

                  return (
                    <button
                      key={nodeId}
                      type="button"
                      className="static-html-presentation-node-chip"
                      data-active={nodeId === selectedNodeId ? "true" : undefined}
                      data-selected={selectedNodeIds.includes(nodeId) ? "true" : undefined}
                      data-locked={node.editable ? undefined : "true"}
                      title={interactionMode === "layout" ? (resolveLayoutCapability(node).reason ?? undefined) : undefined}
                      onClick={(event) => {
                        selectNode(nodeId, {
                          additive: interactionMode === "layout" && (event.metaKey || event.ctrlKey),
                          switchToLayout: interactionMode === "layout"
                        });
                      }}
                    >
                      <span className="static-html-presentation-node-chip-type">{node.type}</span>
                      <span className="static-html-presentation-node-chip-name">
                        {node.name || node.id}
                      </span>
                      {interactionMode === "layout" ? (
                        <span className="static-html-presentation-node-chip-status">
                          {resolveLayoutCapability(node).reason
                            ? t("conversation.fileViewerPresentationLayoutLocked")
                            : t("conversation.fileViewerPresentationLayoutEditable")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </section>
      </section>
    </div>
  );
}

function isMessageRect(value: unknown): value is InlineEditorState["rect"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const rect = value as Record<string, unknown>;
  return ["left", "top", "width", "height"].every((key) => typeof rect[key] === "number");
}

function resolveInlineEditorAppearance(
  value: unknown,
  nodeStyle: DocumentNodeStyle
): InlineEditorState["appearance"] {
  const fallback = {
    fontFamily: nodeStyle.fontFamily ?? null,
    fontSize: typeof nodeStyle.fontSize === "number" ? `${nodeStyle.fontSize}px` : null,
    fontWeight: nodeStyle.fontWeight ?? null,
    fontStyle: null,
    lineHeight: nodeStyle.lineHeight ?? null,
    letterSpacing: nodeStyle.letterSpacing ?? null,
    color: nodeStyle.color ?? null,
    textAlign: nodeStyle.textAlign ?? null,
    whiteSpace: nodeStyle.whiteSpace ?? null,
    padding: nodeStyle.padding ?? null,
    textTransform: null
  } satisfies InlineEditorState["appearance"];

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const appearance = value as Record<string, unknown>;
  return {
    fontFamily: readStringAppearanceValue(appearance.fontFamily, fallback.fontFamily),
    fontSize: readStringAppearanceValue(appearance.fontSize, fallback.fontSize),
    fontWeight: readStringAppearanceValue(appearance.fontWeight, fallback.fontWeight),
    fontStyle: readStringAppearanceValue(appearance.fontStyle, fallback.fontStyle),
    lineHeight: readStringAppearanceValue(appearance.lineHeight, fallback.lineHeight),
    letterSpacing: readStringAppearanceValue(appearance.letterSpacing, fallback.letterSpacing),
    color: readStringAppearanceValue(appearance.color, fallback.color),
    textAlign: readStringAppearanceValue(appearance.textAlign, fallback.textAlign),
    whiteSpace: readStringAppearanceValue(appearance.whiteSpace, fallback.whiteSpace),
    padding: readStringAppearanceValue(appearance.padding, fallback.padding),
    textTransform: readStringAppearanceValue(appearance.textTransform, fallback.textTransform)
  };
}

function readStringAppearanceValue(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function shouldDisableInlineEditorWrap(whiteSpace: string | null): boolean {
  if (!whiteSpace) {
    return false;
  }

  return whiteSpace.includes("nowrap") || whiteSpace.includes("pre");
}

function syncInlineEditorDomText(element: HTMLDivElement, text: string): void {
  const currentText = readInlineEditorDomText(element);

  if (currentText === text) {
    return;
  }

  element.textContent = text;
}

function focusInlineEditorAtEnd(element: HTMLDivElement): void {
  element.focus();
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function readInlineEditorDomText(element: HTMLDivElement): string {
  return normalizeInlineEditorText(
    typeof element.innerText === "string"
      ? element.innerText
      : (element.textContent ?? "")
  );
}

function normalizeInlineEditorText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ");
}

function insertPlainTextIntoInlineEditor(text: string): void {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalizeTextAlign(value: string | null): CSSProperties["textAlign"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "left" || normalized === "right" || normalized === "center" || normalized === "justify" || normalized === "start" || normalized === "end") {
    return normalized;
  }

  return undefined;
}

function normalizeWhiteSpace(value: string | null): CSSProperties["whiteSpace"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "normal"
    || normalized === "nowrap"
    || normalized === "pre"
    || normalized === "pre-wrap"
    || normalized === "pre-line"
    || normalized === "break-spaces"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeTextTransform(value: string | null): CSSProperties["textTransform"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "none"
    || normalized === "capitalize"
    || normalized === "uppercase"
    || normalized === "lowercase"
  ) {
    return normalized;
  }

  return undefined;
}

function resolveDragPreviewPosition(event: React.DragEvent<HTMLDivElement>): "before" | "after" {
  const rect = event.currentTarget.getBoundingClientRect();

  if (rect.height <= 0) {
    return "before";
  }

  const pointerOffset = event.clientY - rect.top;
  return pointerOffset < rect.height / 2 ? "before" : "after";
}

function resolveDragInsertIndex(
  pages: DocumentProject["pages"],
  draggingPageId: string,
  dragPreview: DragPreviewState
): number | null {
  const sourceIndex = pages.findIndex((page) => page.id === draggingPageId);
  const targetIndex = pages.findIndex((page) => page.id === dragPreview.pageId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return null;
  }

  const insertIndex = dragPreview.position === "before" ? targetIndex : targetIndex + 1;
  const normalizedIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  return Math.max(0, Math.min(normalizedIndex, pages.length - 1));
}

function resolveLayoutCapability(node: DocumentNode | null | undefined): LayoutCapability {
  if (!node) {
    return {
      movable: false,
      resizable: false,
      alignable: false,
      reason: t("conversation.fileViewerPresentationLayoutUnsupported"),
      strictModeLocked: false
    };
  }

  if (!node.editable) {
    return {
      movable: false,
      resizable: false,
      alignable: false,
      reason: node.lockedReason || t("conversation.fileViewerPresentationLayoutUnsupported"),
      strictModeLocked: false
    };
  }

  if (node.type === "svg" || node.type === "html" || node.type === "decoration") {
    return {
      movable: false,
      resizable: false,
      alignable: false,
      reason: t("conversation.fileViewerPresentationLayoutUnsupported"),
      strictModeLocked: false
    };
  }

  if (node.id.endsWith("-root")) {
    return {
      movable: false,
      resizable: false,
      alignable: false,
      reason: t("conversation.fileViewerPresentationLayoutRootLocked"),
      strictModeLocked: false
    };
  }

  if (!hasStableLayoutWriteback(node)) {
    return {
      movable: false,
      resizable: false,
      alignable: false,
      reason: t("conversation.fileViewerPresentationLayoutStrictLocked"),
      strictModeLocked: true
    };
  }

  return {
    movable: true,
    resizable: true,
    alignable: true,
    reason: null,
    strictModeLocked: false
  };
}

function resolveLayoutBoxStyle(
  measurement: LayoutNodeMeasurement,
  frameScale: number
): CSSProperties {
  return {
    left: `${measurement.left * frameScale}px`,
    top: `${measurement.top * frameScale}px`,
    width: `${measurement.width * frameScale}px`,
    height: `${measurement.height * frameScale}px`
  };
}

function resolveLayoutGuideStyle(
  guideLine: LayoutGuideLine,
  frameScale: number
): CSSProperties {
  if (guideLine.orientation === "vertical") {
    return {
      left: `${guideLine.position * frameScale}px`,
      top: `${guideLine.start * frameScale}px`,
      width: "1px",
      height: `${Math.max(0, (guideLine.end - guideLine.start) * frameScale)}px`
    };
  }

  return {
    left: `${guideLine.start * frameScale}px`,
    top: `${guideLine.position * frameScale}px`,
    width: `${Math.max(0, (guideLine.end - guideLine.start) * frameScale)}px`,
    height: "1px"
  };
}

function hasStableLayoutWriteback(node: DocumentNode): boolean {
  if (node.runtimeFlags.includes("draft-clone") || node.runtimeFlags.includes("draft-box")) {
    return true;
  }

  if (!node.sourceRef) {
    return false;
  }

  if (node.runtimeFlags.includes("layout-freeze-child")) {
    return true;
  }

  if (isFreeLayoutPosition(node.style.position)) {
    return true;
  }

  return false;
}

function isFreeLayoutPosition(position: string | null | undefined): boolean {
  const normalizedPosition = position?.trim().toLowerCase() ?? "";
  return normalizedPosition === "absolute" || normalizedPosition === "fixed";
}

function resolveNodeLayoutBox(
  node: DocumentNode,
  measurement: LayoutNodeMeasurement | undefined
): DocumentNodeBox {
  if (node.runtimeFlags.includes("draft-clone") || node.runtimeFlags.includes("draft-box")) {
    return clampLayoutBox(node.box);
  }

  if (measurement) {
    return clampLayoutBox({
      x: measurement.localLeft,
      y: measurement.localTop,
      width: measurement.width,
      height: measurement.height,
      zIndex: node.box.zIndex
    });
  }

  return clampLayoutBox(node.box);
}

function resolveNodeAbsoluteLayoutBox(
  node: DocumentNode,
  measurement: LayoutNodeMeasurement | undefined
): DocumentNodeBox {
  if (measurement) {
    return clampLayoutBox({
      x: measurement.left,
      y: measurement.top,
      width: measurement.width,
      height: measurement.height,
      zIndex: node.box.zIndex
    });
  }

  return clampLayoutBox(node.box);
}

function resolveLayoutGuideLines(
  gesture: LayoutGestureState,
  previewBoxes: Record<string, DocumentNodeBox>
): LayoutGuideLine[] {
  if (gesture.nodeIds.length !== 1) {
    return [];
  }

  const activeNodeId = gesture.nodeIds[0];
  const activeBox = previewBoxes[activeNodeId];

  if (!activeNodeId || !activeBox) {
    return [];
  }

  const verticalCandidates = [activeBox.x, activeBox.x + (activeBox.width / 2), activeBox.x + activeBox.width];
  const horizontalCandidates = [activeBox.y, activeBox.y + (activeBox.height / 2), activeBox.y + activeBox.height];
  const tolerance = 6;
  const guideLines: LayoutGuideLine[] = [];

  Object.entries(gesture.originBoxes).forEach(([nodeId]) => {
    if (nodeId === activeNodeId) {
      return;
    }
  });

  Object.entries(gesture.startProject.nodes).forEach(([nodeId, node]) => {
    if (nodeId === activeNodeId || gesture.nodeIds.includes(nodeId)) {
      return;
    }

    const box = gesture.startProject.nodes[nodeId]
      ? resolveNodeLayoutBox(node, undefined)
      : null;

    if (!box) {
      return;
    }

    const otherVerticals = [box.x, box.x + (box.width / 2), box.x + box.width];
    const otherHorizontals = [box.y, box.y + (box.height / 2), box.y + box.height];

    verticalCandidates.forEach((value) => {
      const matched = otherVerticals.find((candidate) => Math.abs(candidate - value) <= tolerance);

      if (matched === undefined) {
        return;
      }

      guideLines.push({
        orientation: "vertical",
        position: matched,
        start: Math.min(activeBox.y, box.y),
        end: Math.max(activeBox.y + activeBox.height, box.y + box.height)
      });
    });

    horizontalCandidates.forEach((value) => {
      const matched = otherHorizontals.find((candidate) => Math.abs(candidate - value) <= tolerance);

      if (matched === undefined) {
        return;
      }

      guideLines.push({
        orientation: "horizontal",
        position: matched,
        start: Math.min(activeBox.x, box.x),
        end: Math.max(activeBox.x + activeBox.width, box.x + box.width)
      });
    });
  });

  return dedupeGuideLines(guideLines);
}

function resolveGesturePreview(
  gesture: LayoutGestureState,
  deltaX: number,
  deltaY: number
): {
  previewBoxes: Record<string, DocumentNodeBox>;
  guideLines: LayoutGuideLine[];
} {
  const previewBoxes: Record<string, DocumentNodeBox> = {};

  gesture.nodeIds.forEach((nodeId) => {
    const originBox = gesture.originBoxes[nodeId];

    if (!originBox) {
      return;
    }

    if (gesture.handle === "move") {
      previewBoxes[nodeId] = clampLayoutBox({
        ...originBox,
        x: originBox.x + deltaX,
        y: originBox.y + deltaY
      });
      return;
    }

    previewBoxes[nodeId] = clampLayoutBox({
      ...originBox,
      width: originBox.width + deltaX,
      height: originBox.height + deltaY
    });
  });

  if (gesture.handle !== "move") {
    return {
      previewBoxes,
      guideLines: resolveLayoutGuideLines(gesture, previewBoxes)
    };
  }

  const snapped = snapSelectionPreview(gesture, previewBoxes);
  return {
    previewBoxes: snapped.previewBoxes,
    guideLines: snapped.guideLines
  };
}

function snapSelectionPreview(
  gesture: LayoutGestureState,
  previewBoxes: Record<string, DocumentNodeBox>
): {
  previewBoxes: Record<string, DocumentNodeBox>;
  guideLines: LayoutGuideLine[];
} {
  const selectionBoxes = gesture.nodeIds
    .map((nodeId) => previewBoxes[nodeId])
    .filter((box): box is DocumentNodeBox => Boolean(box));
  const selectionBox = resolveBoundingBox(selectionBoxes);

  if (!selectionBox) {
    return {
      previewBoxes,
      guideLines: []
    };
  }

  const snapTolerance = 6;
  const selectionAnchors = resolveBoxAnchorPoints(selectionBox);

  let snapDeltaX = 0;
  let snapDeltaY = 0;
  let bestVerticalDistance = snapTolerance + 1;
  let bestHorizontalDistance = snapTolerance + 1;
  const guideLines: LayoutGuideLine[] = [];

  const referenceBoxes = gesture.pageNodeIds
    .filter((nodeId) => !gesture.nodeIds.includes(nodeId))
    .map((nodeId) => gesture.referenceBoxes[nodeId])
    .filter((box): box is DocumentNodeBox => Boolean(box) && box.width > 0 && box.height > 0);
  const canvasBox = {
    x: 0,
    y: 0,
    width: gesture.startProject.canvas.width,
    height: gesture.startProject.canvas.height,
    zIndex: 0
  } satisfies DocumentNodeBox;

  [...referenceBoxes, canvasBox].forEach((box) => {
    const referenceAnchors = resolveBoxAnchorPoints(box);

    selectionAnchors.verticals.forEach((value) => {
      referenceAnchors.verticals.forEach((candidate) => {
        const distance = Math.abs(candidate - (value + snapDeltaX));

        if (distance > snapTolerance || distance >= bestVerticalDistance) {
          return;
        }

        bestVerticalDistance = distance;
        snapDeltaX = candidate - value;
        guideLines.push({
          orientation: "vertical",
          position: candidate,
          start: Math.min(selectionBox.y, box.y),
          end: Math.max(selectionBox.y + selectionBox.height, box.y + box.height)
        });
      });
    });

    selectionAnchors.horizontals.forEach((value) => {
      referenceAnchors.horizontals.forEach((candidate) => {
        const distance = Math.abs(candidate - (value + snapDeltaY));

        if (distance > snapTolerance || distance >= bestHorizontalDistance) {
          return;
        }

        bestHorizontalDistance = distance;
        snapDeltaY = candidate - value;
        guideLines.push({
          orientation: "horizontal",
          position: candidate,
          start: Math.min(selectionBox.x, box.x),
          end: Math.max(selectionBox.x + selectionBox.width, box.x + box.width)
        });
      });
    });
  });

  if (snapDeltaX !== 0 || snapDeltaY !== 0) {
    gesture.nodeIds.forEach((nodeId) => {
      const box = previewBoxes[nodeId];

      if (!box) {
        return;
      }

      previewBoxes[nodeId] = clampLayoutBox({
        ...box,
        x: box.x + snapDeltaX,
        y: box.y + snapDeltaY
      });
    });
  }

  return {
    previewBoxes,
    guideLines: dedupeGuideLines(guideLines)
  };
}

function dedupeGuideLines(guideLines: LayoutGuideLine[]): LayoutGuideLine[] {
  const map = new Map<string, LayoutGuideLine>();

  guideLines.forEach((guideLine) => {
    const key = `${guideLine.orientation}:${Math.round(guideLine.position)}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, guideLine);
      return;
    }

    map.set(key, {
      ...guideLine,
      start: Math.min(current.start, guideLine.start),
      end: Math.max(current.end, guideLine.end)
    });
  });

  return Array.from(map.values());
}

type LayoutFieldKey = "x" | "y" | "width" | "height";

interface LayoutFieldDraft {
  x: string;
  y: string;
  width: string;
  height: string;
}

function createLayoutFieldDraft(box: DocumentNodeBox | null): LayoutFieldDraft {
  return {
    x: box ? String(box.x) : "",
    y: box ? String(box.y) : "",
    width: box ? String(box.width) : "",
    height: box ? String(box.height) : ""
  };
}

function LayoutInspector({
  selectedNode,
  selectedLayoutBox,
  selectedNodes,
  showFreezeContainerAction,
  canFreezeContainer,
  onDuplicate,
  onFreezeContainer,
  onAlignLeft,
  onAlignRight,
  onAlignTop,
  onAlignBottom,
  onBoxChange
}: {
  selectedNode: DocumentNode | null;
  selectedLayoutBox: DocumentNodeBox | null;
  selectedNodes: DocumentNode[];
  showFreezeContainerAction: boolean;
  canFreezeContainer: boolean;
  onDuplicate: () => void;
  onFreezeContainer: () => void;
  onAlignLeft: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignBottom: () => void;
  onBoxChange: (nextBox: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => void;
}) {
  const capability = resolveLayoutCapability(selectedNode);
  const hasMultipleSelection = selectedNodes.length > 1;
  const canAlign = hasMultipleSelection && selectedNodes.every((node) => resolveLayoutCapability(node).alignable);
  const shouldShowFreezeAction = Boolean(selectedNode) && capability.strictModeLocked && showFreezeContainerAction;
  const [draftBox, setDraftBox] = useState<LayoutFieldDraft>(() => createLayoutFieldDraft(selectedLayoutBox));

  useEffect(() => {
    setDraftBox(createLayoutFieldDraft(selectedLayoutBox));
  }, [
    selectedNode?.id,
    selectedLayoutBox?.x,
    selectedLayoutBox?.y,
    selectedLayoutBox?.width,
    selectedLayoutBox?.height
  ]);

  function commitDraftField(field: LayoutFieldKey) {
    if (!selectedNode) {
      return;
    }

    const rawValue = draftBox[field].trim();

    if (!rawValue) {
      setDraftBox(createLayoutFieldDraft(selectedLayoutBox));
      return;
    }

    const parsedValue = Number(rawValue);

    if (!Number.isFinite(parsedValue)) {
      setDraftBox(createLayoutFieldDraft(selectedLayoutBox));
      return;
    }

    onBoxChange({
      [field]: parsedValue
    });
  }

  return (
    <div className="static-html-presentation-layout-toolbar">
      <div className="static-html-presentation-layout-toolbar-row">
        <span className="static-html-presentation-layout-badge">
          {selectedNodes.length > 1
            ? t("conversation.fileViewerPresentationLayoutSelectionCount").replace("{count}", String(selectedNodes.length))
            : t("conversation.fileViewerPresentationLayoutMode")}
        </span>
        <button
          type="button"
          className="secondary-button static-html-presentation-layout-action"
          onClick={onDuplicate}
          disabled={!selectedNode || !capability.movable}
        >
          {t("conversation.fileViewerPresentationDuplicateAction")}
        </button>
        <button
          type="button"
          className="secondary-button static-html-presentation-layout-action"
          onClick={onAlignLeft}
          disabled={!canAlign}
        >
          {t("conversation.fileViewerPresentationLayoutAlignLeft")}
        </button>
        <button
          type="button"
          className="secondary-button static-html-presentation-layout-action"
          onClick={onAlignRight}
          disabled={!canAlign}
        >
          {t("conversation.fileViewerPresentationLayoutAlignRight")}
        </button>
        <button
          type="button"
          className="secondary-button static-html-presentation-layout-action"
          onClick={onAlignTop}
          disabled={!canAlign}
        >
          {t("conversation.fileViewerPresentationLayoutAlignTop")}
        </button>
        <button
          type="button"
          className="secondary-button static-html-presentation-layout-action"
          onClick={onAlignBottom}
          disabled={!canAlign}
        >
          {t("conversation.fileViewerPresentationLayoutAlignBottom")}
        </button>
        {shouldShowFreezeAction ? (
          <button
            type="button"
            className="secondary-button static-html-presentation-layout-action"
            onClick={onFreezeContainer}
            disabled={!canFreezeContainer}
          >
            {t("conversation.fileViewerPresentationLayoutFreezeContainer")}
          </button>
        ) : null}
      </div>
      {selectedNode ? (
        <div className="static-html-presentation-layout-form">
          <label className="static-html-presentation-layout-field">
            <span>{t("conversation.fileViewerPresentationPositionXLabel")}</span>
            <input
              type="number"
              value={draftBox.x}
              onChange={(event) => setDraftBox((current) => ({ ...current, x: event.target.value }))}
              onBlur={() => commitDraftField("x")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraftField("x");
                }
              }}
              disabled={!capability.movable}
            />
          </label>
          <label className="static-html-presentation-layout-field">
            <span>{t("conversation.fileViewerPresentationPositionYLabel")}</span>
            <input
              type="number"
              value={draftBox.y}
              onChange={(event) => setDraftBox((current) => ({ ...current, y: event.target.value }))}
              onBlur={() => commitDraftField("y")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraftField("y");
                }
              }}
              disabled={!capability.movable}
            />
          </label>
          <label className="static-html-presentation-layout-field">
            <span>{t("conversation.fileViewerPresentationWidthLabel")}</span>
            <input
              type="number"
              value={draftBox.width}
              onChange={(event) => setDraftBox((current) => ({ ...current, width: event.target.value }))}
              onBlur={() => commitDraftField("width")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraftField("width");
                }
              }}
              disabled={!capability.resizable}
            />
          </label>
          <label className="static-html-presentation-layout-field">
            <span>{t("conversation.fileViewerPresentationHeightLabel")}</span>
            <input
              type="number"
              value={draftBox.height}
              onChange={(event) => setDraftBox((current) => ({ ...current, height: event.target.value }))}
              onBlur={() => commitDraftField("height")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraftField("height");
                }
              }}
              disabled={!capability.resizable}
            />
          </label>
          {capability.reason ? null : (
            <p className="static-html-presentation-layout-hint">
              {t("conversation.fileViewerPresentationLayoutHint")}
            </p>
          )}
        </div>
      ) : (
        <div className="static-html-presentation-toolbar-empty static-html-presentation-inspector-empty">
          <p className="status-text">{t("conversation.fileViewerPresentationLayoutSelectNode")}</p>
        </div>
      )}
    </div>
  );
}

function NodeInspector({
  node,
  selectedRunIndex,
  onSelectedRunChange,
  compact = false,
  onTextChange,
  onStyleChange
}: {
  node: DocumentNode;
  selectedRunIndex: number | null;
  onSelectedRunChange: (value: number | null) => void;
  compact?: boolean;
  onTextChange: (value: TopTextEditorChange) => void;
  onStyleChange: (patch: Partial<DocumentNodeStyle>) => void;
}) {
  const isTextLike = node.type === "text" || typeof node.content.text === "string";
  const fontSizeValue = typeof node.style.fontSize === "number" ? node.style.fontSize : null;
  const fontFamilyValue = node.style.fontFamily ?? "";
  const fontWeightValue = normalizeFontWeightValue(node.style.fontWeight);
  const fontStyleValue = node.style.fontStyle ?? "";
  const textDecorationValue = node.style.textDecoration ?? "";
  const lineHeightValue = node.style.lineHeight ?? "";
  const colorValue = normalizeColorValue(node.style.color);
  const backgroundColorValue = normalizeColorValue(node.style.backgroundColor);

  return (
    <div
      className="static-html-presentation-inspector-panel"
      data-compact={compact ? "true" : undefined}
    >
      <div
        className="static-html-presentation-inspector-controls"
        data-compact={compact ? "true" : undefined}
      >
        {isTextLike ? (
          <div className="static-html-presentation-text-edit-row">
            <div className="static-html-presentation-text-toolbar" role="toolbar" aria-label={t("conversation.fileViewerPresentationTextToolbar")}>
              <div className="static-html-presentation-text-toolbar-row">
                <select
                  className="static-html-presentation-text-toolbar-select static-html-presentation-text-toolbar-font"
                  value={fontFamilyValue}
                  onChange={(event) => onStyleChange({ fontFamily: event.target.value || null })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationFontFamilyLabel")}
                >
                  <option value="">{t("conversation.fileViewerPresentationKeepOriginal")}</option>
                  <option value={'"PingFang SC", "Microsoft YaHei", sans-serif'}>{t("conversation.fileViewerPresentationFontPresetTitle")}</option>
                  <option value={'"Noto Sans SC", "PingFang SC", sans-serif'}>{t("conversation.fileViewerPresentationFontPresetSans")}</option>
                  <option value={'Georgia, "Times New Roman", serif'}>{t("conversation.fileViewerPresentationFontPresetSerif")}</option>
                  <option value={'"SF Mono", "Cascadia Mono", monospace'}>{t("conversation.fileViewerPresentationFontPresetMono")}</option>
                </select>

                <select
                  className="static-html-presentation-text-toolbar-select static-html-presentation-text-toolbar-size"
                  value={fontSizeValue ? String(fontSizeValue) : ""}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    onStyleChange({
                      fontSize: nextValue ? Number(nextValue) : null
                    });
                  }}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationFontSizeLabel")}
                >
                  <option value="">{t("conversation.fileViewerPresentationKeepOriginal")}</option>
                  {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>

                <button
                  type="button"
                  className="secondary-button static-html-presentation-text-toolbar-button"
                  data-active={fontWeightValue === "700" ? "true" : undefined}
                  onClick={() => onStyleChange({ fontWeight: fontWeightValue === "700" ? null : "700" })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationBoldAction")}
                >
                  B
                </button>

                <button
                  type="button"
                  className="secondary-button static-html-presentation-text-toolbar-button static-html-presentation-text-toolbar-button-italic"
                  data-active={fontStyleValue === "italic" ? "true" : undefined}
                  onClick={() => onStyleChange({ fontStyle: fontStyleValue === "italic" ? null : "italic" })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationItalicAction")}
                >
                  I
                </button>

                <button
                  type="button"
                  className="secondary-button static-html-presentation-text-toolbar-button static-html-presentation-text-toolbar-button-underline"
                  data-active={textDecorationValue.includes("underline") ? "true" : undefined}
                  onClick={() => onStyleChange({
                    textDecoration: textDecorationValue.includes("underline") ? null : "underline"
                  })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationUnderlineAction")}
                >
                  U
                </button>

                <label className="static-html-presentation-text-toolbar-color" aria-label={t("conversation.fileViewerPresentationTextColorLabel")}>
                  <span
                    className="static-html-presentation-text-toolbar-color-label"
                    style={{ ["--static-html-toolbar-color" as string]: colorValue }}
                  >
                    A
                  </span>
                  <input
                    type="color"
                    value={colorValue}
                    onChange={(event) => onStyleChange({ color: event.target.value })}
                    disabled={!node.editable}
                  />
                </label>

                <label className="static-html-presentation-text-toolbar-color" aria-label={t("conversation.fileViewerPresentationBackgroundColorLabel")}>
                  <span
                    className="static-html-presentation-text-toolbar-color-label static-html-presentation-text-toolbar-color-label-fill"
                    style={{ ["--static-html-toolbar-color" as string]: backgroundColorValue }}
                  >
                    A
                  </span>
                  <input
                    type="color"
                    value={backgroundColorValue}
                    onChange={(event) => onStyleChange({ backgroundColor: event.target.value })}
                    disabled={!node.editable}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button static-html-presentation-text-toolbar-button"
                  onClick={() => onStyleChange({ fontSize: Math.max(8, (fontSizeValue ?? 24) - 2) })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationFontSizeDecreaseAction")}
                >
                  A-
                </button>

                <button
                  type="button"
                  className="secondary-button static-html-presentation-text-toolbar-button"
                  onClick={() => onStyleChange({ fontSize: Math.min(160, (fontSizeValue ?? 24) + 2) })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationFontSizeIncreaseAction")}
                >
                  A+
                </button>

                <select
                  className="static-html-presentation-text-toolbar-select static-html-presentation-text-toolbar-line-height"
                  value={lineHeightValue}
                  onChange={(event) => onStyleChange({ lineHeight: event.target.value || null })}
                  disabled={!node.editable}
                  aria-label={t("conversation.fileViewerPresentationLineHeightLabel")}
                >
                  <option value="">{t("conversation.fileViewerPresentationLineHeightAuto")}</option>
                  <option value="1">1.0</option>
                  <option value="1.2">1.2</option>
                  <option value="1.4">1.4</option>
                  <option value="1.6">1.6</option>
                  <option value="1.8">1.8</option>
                  <option value="2">2.0</option>
                </select>
              </div>
            </div>

            <textarea
              hidden
              readOnly
              value={node.content.text ?? ""}
              aria-hidden="true"
              tabIndex={-1}
            />
            <TopRunsEditor
              node={node}
              selectedRunIndex={selectedRunIndex}
              onSelectedRunChange={onSelectedRunChange}
              disabled={!node.editable}
              onChange={onTextChange}
            />
          </div>
        ) : (
          <p className="static-html-presentation-inspector-warning">
            {node.lockedReason || t("conversation.fileViewerPresentationReadOnlyHint")}
          </p>
        )}
      </div>
    </div>
  );
}

function TopRunsEditor({
  node,
  selectedRunIndex,
  onSelectedRunChange,
  disabled,
  onChange
}: {
  node: DocumentNode;
  selectedRunIndex: number | null;
  onSelectedRunChange: (value: number | null) => void;
  disabled: boolean;
  onChange: (value: TopTextEditorChange) => void;
}) {
  const runs = useMemo(() => buildEditorRuns(node), [node]);
  const activeRunIndex = useMemo(() => {
    if (!runs.length) {
      return null;
    }

    if (selectedRunIndex !== null && selectedRunIndex >= 0 && selectedRunIndex < runs.length) {
      return selectedRunIndex;
    }

    return 0;
  }, [runs, selectedRunIndex]);

  function commitRunTextChange(runIndex: number, nextText: string): void {
    const nextRuns = runs.map((run, index) => (
      index === runIndex
        ? {
            ...cloneTextRun(run),
            text: normalizeInlineEditorText(nextText)
        }
        : cloneTextRun(run)
    ));

    onChange({
      text: normalizeRunsText(nextRuns),
      runs: nextRuns
    });
  }

  return (
    <div
      className="static-html-presentation-textarea static-html-presentation-textarea-standalone static-html-presentation-runs-editor"
      data-testid="static-html-presentation-runs-editor"
      role="group"
      aria-label={t("conversation.fileViewerPresentationTextToolbar")}
    >
      {runs.map((run, index) => (
        <label
          key={`${index}-${run.tagName ?? "text"}-${run.className ?? "none"}`}
          className={run.className ?? undefined}
          data-static-html-run={String(index)}
          data-static-html-run-wrapper="true"
          data-active={activeRunIndex === index ? "true" : undefined}
          data-static-html-run-text={run.text}
        >
          <textarea
            className="static-html-presentation-run-input"
            data-static-html-run-input="true"
            value={run.text}
            disabled={disabled}
            rows={1}
            spellCheck={false}
            aria-label={`${t("conversation.fileViewerPresentationNodeTextLabel")} ${index + 1}`}
            onFocus={() => onSelectedRunChange(index)}
            onClick={() => onSelectedRunChange(index)}
            onChange={(event) => {
              commitRunTextChange(index, event.target.value);
            }}
            style={resolveRunInputStyle(run.style ?? null)}
          />
        </label>
      ))}
    </div>
  );
}

function normalizeColorValue(value: string | null | undefined): string {
  if (!value || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    return "#000000";
  }

  const normalized = value.trim();

  if (normalized.length === 4) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }

  return normalized;
}

function normalizeFontWeightValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  if (value === "bold") {
    return "700";
  }

  return value;
}

function updateNodeTextRuns(node: DocumentNode, nextText: string): DocumentTextRun[] | null {
  const normalizedText = normalizeInlineEditorText(nextText);
  const existingRuns = Array.isArray(node.content.runs) ? node.content.runs : [];

  if (existingRuns.length === 0) {
    return normalizedText
      ? [{ text: normalizedText }]
      : null;
  }

  const nextRuns = existingRuns.map((run) => ({ ...run }));
  const longestRunIndex = findLongestEditableRunIndex(nextRuns);

  if (longestRunIndex < 0) {
    return normalizedText
      ? [{ text: normalizedText }]
      : null;
  }

  nextRuns[longestRunIndex] = {
    ...nextRuns[longestRunIndex]!,
    text: normalizedText
  };

  return nextRuns;
}

function buildEditorRuns(node: DocumentNode): DocumentTextRun[] {
  if (Array.isArray(node.content.runs) && node.content.runs.length > 0) {
    return node.content.runs.map((run) => ({
      ...run,
      style: run.style ? { ...run.style } : null
    }));
  }

  const text = normalizeInlineEditorText(node.content.text ?? "");
  return text ? [{ text }] : [];
}

function renderRunsIntoEditor(element: HTMLDivElement, runs: DocumentTextRun[]): void {
  const ownerDocument = element.ownerDocument;

  if (!ownerDocument) {
    element.textContent = normalizeRunsText(runs);
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  if (runs.length === 0) {
    element.textContent = "";
    return;
  }

  runs.forEach((run, index) => {
    const fragmentNode = createRunEditorNode(ownerDocument, run, index);
    element.appendChild(fragmentNode);
  });
}

function createRunEditorNode(
  ownerDocument: Document,
  run: DocumentTextRun,
  index: number
): Node {
  const element = ownerDocument.createElement(run.tagName || "span");
  element.setAttribute("data-static-html-run", String(index));
  element.setAttribute("data-static-html-run-wrapper", "true");

  if (run.className) {
    element.setAttribute("class", run.className);
  }

  applyRunStyleToEditorElement(element, run.style ?? null);
  element.textContent = run.text;
  return element;
}

function applyRunStyleToEditorElement(
  element: HTMLElement,
  style: DocumentNodeStyle | null
): void {
  if (!style) {
    return;
  }

  if (style.fontFamily) {
    element.style.fontFamily = style.fontFamily;
  }

  if (typeof style.fontSize === "number") {
    element.style.fontSize = `${style.fontSize}px`;
  }

  if (style.fontWeight) {
    element.style.fontWeight = style.fontWeight;
  }

  if (style.fontStyle) {
    element.style.fontStyle = style.fontStyle;
  }

  if (style.lineHeight) {
    element.style.lineHeight = style.lineHeight;
  }

  if (style.letterSpacing) {
    element.style.letterSpacing = style.letterSpacing;
  }

  if (style.color) {
    element.style.color = style.color;
  }

  if (style.textDecoration) {
    element.style.textDecoration = style.textDecoration;
  }

  if (style.textDecorationColor) {
    element.style.textDecorationColor = style.textDecorationColor;
  }

  if (style.backgroundColor) {
    element.style.backgroundColor = style.backgroundColor;
  }
}

function parseRunsFromEditor(
  element: HTMLDivElement,
  fallbackRuns: DocumentTextRun[],
  fallbackText: string
): DocumentTextRun[] | null {
  const reconciledRuns = reconcileRunsFromMergedEditorText(element, fallbackRuns, fallbackText);

  if (reconciledRuns) {
    return reconciledRuns;
  }

  const parsedRuns: DocumentTextRun[] = [];
  const seenRunIndices = new Set<number>();

  element.childNodes.forEach((childNode) => {
    collectRunsFromEditorNode(childNode, parsedRuns, fallbackRuns, seenRunIndices);
  });

  const normalizedRuns = normalizeEditorRuns(parsedRuns);
  return normalizedRuns.length > 0 ? normalizedRuns : null;
}

function reconcileRunsFromMergedEditorText(
  element: HTMLDivElement,
  fallbackRuns: DocumentTextRun[],
  fallbackText: string
): DocumentTextRun[] | null {
  if (fallbackRuns.length === 0) {
    return null;
  }

  const originalFullText = normalizeInlineEditorText(
    fallbackText || fallbackRuns.map((run) => run.text).join("")
  );
  const wrapperElements = Array.from(
    element.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
  );

  const mergedCandidate = wrapperElements
    .map((wrapper) => normalizeInlineEditorText(wrapper.textContent ?? ""))
    .filter((text) => text.length > originalFullText.length)
    .sort((left, right) => right.length - left.length)[0];

  if (!mergedCandidate || !mergedCandidate.includes(originalFullText)) {
    return null;
  }

  return reconcileRunsByFullText(fallbackRuns, mergedCandidate);
}

function reconcileRunsByFullText(
  fallbackRuns: DocumentTextRun[],
  nextFullText: string
): DocumentTextRun[] | null {
  const originalFullText = fallbackRuns.map((run) => run.text).join("");

  if (nextFullText === originalFullText) {
    return fallbackRuns.map((run) => ({
      ...run,
      style: run.style ? { ...run.style } : null
    }));
  }

  const prefixLength = resolveCommonPrefixLength(originalFullText, nextFullText);
  const suffixLength = resolveCommonSuffixLength(originalFullText, nextFullText, prefixLength);
  const originalChangeStart = prefixLength;
  const originalChangeEnd = originalFullText.length - suffixLength;
  const nextChangeText = nextFullText.slice(prefixLength, nextFullText.length - suffixLength);
  const targetRunIndex = resolveTargetRunIndexForTextChange(
    fallbackRuns,
    originalChangeStart,
    originalChangeEnd
  );

  if (targetRunIndex < 0) {
    return null;
  }

  const nextRuns = fallbackRuns.map((run) => ({
    ...run,
    style: run.style ? { ...run.style } : null
  }));
  const targetRunBounds = resolveRunBounds(nextRuns, targetRunIndex);

  if (!targetRunBounds) {
    return null;
  }

  if (
    originalChangeStart < targetRunBounds.start
    || originalChangeEnd > targetRunBounds.end
  ) {
    return null;
  }

  const targetRun = nextRuns[targetRunIndex];

  if (!targetRun) {
    return null;
  }

  const startInRun = originalChangeStart - targetRunBounds.start;
  const endInRun = originalChangeEnd - targetRunBounds.start;
  targetRun.text = `${targetRun.text.slice(0, startInRun)}${nextChangeText}${targetRun.text.slice(endInRun)}`;
  return nextRuns;
}

function resolveCommonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function resolveCommonSuffixLength(left: string, right: string, prefixLength: number): number {
  const leftRemaining = left.length - prefixLength;
  const rightRemaining = right.length - prefixLength;
  const maxLength = Math.min(leftRemaining, rightRemaining);
  let index = 0;

  while (
    index < maxLength
    && left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1;
  }

  return index;
}

function resolveTargetRunIndexForTextChange(
  runs: DocumentTextRun[],
  originalChangeStart: number,
  originalChangeEnd: number
): number {
  if (runs.length === 0) {
    return -1;
  }

  const changeIsInsertion = originalChangeStart === originalChangeEnd;

  if (changeIsInsertion) {
    if (originalChangeStart <= 0) {
      return 0;
    }

    const insertionOffset = originalChangeStart - 1;
    return resolveRunIndexByOffset(runs, insertionOffset);
  }

  return resolveRunIndexByOffset(runs, originalChangeStart);
}

function resolveRunIndexByOffset(runs: DocumentTextRun[], offset: number): number {
  let cursor = 0;

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];

    if (!run) {
      continue;
    }

    const nextCursor = cursor + run.text.length;

    if (offset < nextCursor) {
      return index;
    }

    cursor = nextCursor;
  }

  return runs.length - 1;
}

function resolveRunBounds(
  runs: DocumentTextRun[],
  targetRunIndex: number
): { start: number; end: number } | null {
  let cursor = 0;

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];

    if (!run) {
      continue;
    }

    const nextCursor = cursor + run.text.length;

    if (index === targetRunIndex) {
      return {
        start: cursor,
        end: nextCursor
      };
    }

    cursor = nextCursor;
  }

  return null;
}

function collectRunsFromEditorNode(
  currentNode: Node,
  runs: DocumentTextRun[],
  fallbackRuns: DocumentTextRun[],
  seenRunIndices: Set<number>
): void {
  if (currentNode.nodeType === Node.TEXT_NODE) {
    const text = normalizeInlineEditorText(currentNode.textContent ?? "");

    if (text) {
      const previousRun = runs[runs.length - 1];

      if (previousRun) {
        previousRun.text = `${previousRun.text}${text}`;
      } else {
        runs.push({ text });
      }
    }
    return;
  }

  if (!(currentNode instanceof HTMLElement)) {
    return;
  }

  if (currentNode.tagName === "BR") {
    runs.push({ text: "\n" });
    return;
  }

  const runIndexValue = currentNode.getAttribute("data-static-html-run");
  const runIndex = runIndexValue ? Number.parseInt(runIndexValue, 10) : Number.NaN;
  const fallbackRun = Number.isInteger(runIndex) ? fallbackRuns[runIndex] : null;
  const hasNestedRunWrappers = currentNode.querySelector("[data-static-html-run-wrapper='true']") !== null;

  if (Number.isInteger(runIndex) && seenRunIndices.has(runIndex)) {
    return;
  }

  if (currentNode.getAttribute("data-static-html-run-wrapper") === "true") {
    if (Number.isInteger(runIndex)) {
      seenRunIndices.add(runIndex);
    }

    if (hasNestedRunWrappers) {
      currentNode.childNodes.forEach((childNode) => {
        if (childNode.nodeType === Node.TEXT_NODE) {
          pushEditorRunFromTemplate(
            runs,
            normalizeInlineEditorText(childNode.textContent ?? ""),
            fallbackRun ?? null
          );
          return;
        }

        collectRunsFromEditorNode(childNode, runs, fallbackRuns, seenRunIndices);
      });
      return;
    }

    pushEditorRunFromTemplate(
      runs,
      normalizeInlineEditorText(currentNode.textContent ?? ""),
      fallbackRun ?? createRunTemplateFromElement(currentNode)
    );
    return;
  }

  currentNode.childNodes.forEach((childNode) => {
    collectRunsFromEditorNode(childNode, runs, fallbackRuns, seenRunIndices);
  });
}

function pushEditorRunFromTemplate(
  runs: DocumentTextRun[],
  text: string,
  template: DocumentTextRun | null
): void {
  if (!text) {
    return;
  }

  runs.push({
    text,
    tagName: template?.tagName ?? null,
    className: template?.className ?? null,
    style: template?.style ? { ...template.style } : null
  });
}

function createRunTemplateFromElement(element: HTMLElement): DocumentTextRun {
  return {
    text: "",
    tagName: element.tagName.toLowerCase(),
    className: normalizeRunClassName(element.className),
    style: null
  };
}

function normalizeRunClassName(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEditorRuns(runs: DocumentTextRun[]): DocumentTextRun[] {
  const normalizedRuns: DocumentTextRun[] = [];

  runs.forEach((run) => {
    const text = normalizeInlineEditorText(run.text ?? "");

    if (!text) {
      return;
    }

    const previousRun = normalizedRuns[normalizedRuns.length - 1];
    const currentRun = {
      text,
      tagName: run.tagName ?? null,
      className: run.className ?? null,
      style: run.style ? { ...run.style } : null
    } satisfies DocumentTextRun;

    if (
      previousRun
      && (previousRun.tagName ?? null) === (currentRun.tagName ?? null)
      && (previousRun.className ?? null) === (currentRun.className ?? null)
      && JSON.stringify(previousRun.style ?? null) === JSON.stringify(currentRun.style ?? null)
    ) {
      previousRun.text = `${previousRun.text}${currentRun.text}`;
      return;
    }

    normalizedRuns.push(currentRun);
  });

  return normalizedRuns;
}

function normalizeRunsText(runs: DocumentTextRun[] | null): string {
  if (!runs || runs.length === 0) {
    return "";
  }

  return normalizeInlineEditorText(runs.map((run) => run.text).join(""));
}

function serializeRunsSignature(runs: DocumentTextRun[]): string {
  return JSON.stringify(runs.map((run) => ({
    text: run.text,
    tagName: run.tagName ?? null,
    className: run.className ?? null,
    style: run.style ?? null
  })));
}

function resolveEditorSelectionOffsets(
  editor: HTMLDivElement | null,
  runs: DocumentTextRun[]
): RunsSelectionOffsets | null {
  if (!editor) {
    return null;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return {
      start: getRunsTotalTextLength(runs),
      end: getRunsTotalTextLength(runs)
    };
  }

  const range = selection.getRangeAt(0);
  return {
    start: resolveEditorBoundaryOffset(editor, runs, range.startContainer, range.startOffset),
    end: resolveEditorBoundaryOffset(editor, runs, range.endContainer, range.endOffset)
  };
}

function resolveEditorBoundaryOffset(
  editor: HTMLDivElement,
  runs: DocumentTextRun[],
  container: Node,
  offset: number
): number {
  if (container === editor) {
    const childCount = Math.max(0, Math.min(offset, editor.childNodes.length));
    let total = 0;

    for (let index = 0; index < childCount; index += 1) {
      const childNode = editor.childNodes[index];

      if (childNode instanceof HTMLElement && childNode.getAttribute("data-static-html-run-wrapper") === "true") {
        total += childNode.textContent?.length ?? 0;
      } else {
        total += childNode.textContent?.length ?? 0;
      }
    }

    return total;
  }

  const wrapper = resolveRunWrapperFromNode(container, editor);

  if (!wrapper) {
    return getRunsTotalTextLength(runs);
  }

  const runIndexValue = wrapper.getAttribute("data-static-html-run");
  const runIndex = runIndexValue ? Number.parseInt(runIndexValue, 10) : Number.NaN;
  const prefixLength = getRunsPrefixTextLength(runs, Number.isInteger(runIndex) ? runIndex : 0);
  const wrapperOffset = resolveOffsetWithinRunWrapper(wrapper, container, offset);
  return prefixLength + wrapperOffset;
}

function resolveRunWrapperFromNode(
  node: Node,
  editor: HTMLDivElement
): HTMLElement | null {
  if (node instanceof HTMLElement) {
    if (node.getAttribute("data-static-html-run-wrapper") === "true") {
      return node;
    }

    return node.closest("[data-static-html-run-wrapper='true']");
  }

  return node.parentElement?.closest("[data-static-html-run-wrapper='true']") ?? null;
}

function resolveOffsetWithinRunWrapper(
  wrapper: HTMLElement,
  container: Node,
  offset: number
): number {
  const wrapperText = wrapper.textContent ?? "";
  const safeOffset = Math.max(0, offset);

  if (container.nodeType === Node.TEXT_NODE) {
    return Math.min(safeOffset, container.textContent?.length ?? 0);
  }

  if (container === wrapper) {
    if (safeOffset <= 0) {
      return 0;
    }

    return wrapperText.length;
  }

  return Math.min(wrapperText.length, safeOffset);
}

function getRunsPrefixTextLength(
  runs: DocumentTextRun[],
  endExclusive: number
): number {
  return runs.slice(0, Math.max(0, endExclusive)).reduce((total, run) => total + run.text.length, 0);
}

function getRunsTotalTextLength(runs: DocumentTextRun[]): number {
  return runs.reduce((total, run) => total + run.text.length, 0);
}

function expandDeletionSelection(
  selection: RunsSelectionOffsets,
  runs: DocumentTextRun[],
  direction: "backward" | "forward"
): RunsSelectionOffsets {
  if (selection.start !== selection.end) {
    return selection.start <= selection.end
      ? selection
      : {
          start: selection.end,
          end: selection.start
        };
  }

  const totalLength = getRunsTotalTextLength(runs);

  if (direction === "backward") {
    const nextStart = Math.max(0, selection.start - 1);
    return {
      start: nextStart,
      end: selection.start
    };
  }

  const nextEnd = Math.min(totalLength, selection.end + 1);
  return {
    start: selection.start,
    end: nextEnd
  };
}

function applyTextReplacementToRuns(
  runs: DocumentTextRun[],
  selection: RunsSelectionOffsets,
  insertedText: string
): DocumentTextRun[] {
  const normalizedSelection = selection.start <= selection.end
    ? selection
    : {
        start: selection.end,
        end: selection.start
      };
  const prefixRuns: DocumentTextRun[] = [];
  const suffixRuns: DocumentTextRun[] = [];
  let cursor = 0;

  runs.forEach((run) => {
    const nextCursor = cursor + run.text.length;

    if (nextCursor <= normalizedSelection.start) {
      prefixRuns.push(cloneTextRun(run));
      cursor = nextCursor;
      return;
    }

    if (cursor >= normalizedSelection.end) {
      suffixRuns.push(cloneTextRun(run));
      cursor = nextCursor;
      return;
    }

    const localStart = Math.max(0, normalizedSelection.start - cursor);
    const localEnd = Math.max(0, normalizedSelection.end - cursor);
    const beforeText = run.text.slice(0, localStart);
    const afterText = run.text.slice(Math.min(run.text.length, localEnd));

    if (beforeText) {
      prefixRuns.push({
        ...cloneTextRun(run),
        text: beforeText
      });
    }

    if (afterText) {
      suffixRuns.push({
        ...cloneTextRun(run),
        text: afterText
      });
    }

    cursor = nextCursor;
  });

  const templateRun = resolveEditingTemplateRun(runs, normalizedSelection);
  const insertedRuns = insertedText
    ? [{
        ...templateRun,
        text: insertedText
      }]
    : [];

  return normalizeEditorRuns([
    ...prefixRuns,
    ...insertedRuns,
    ...suffixRuns
  ]);
}

function resolveEditingTemplateRun(
  runs: DocumentTextRun[],
  selection: RunsSelectionOffsets
): DocumentTextRun {
  const targetOffset = selection.start;
  let cursor = 0;

  for (const run of runs) {
    const nextCursor = cursor + run.text.length;

    if (targetOffset > cursor && targetOffset <= nextCursor) {
      return cloneTextRun(run);
    }

    if (targetOffset === cursor) {
      return cloneTextRun(run);
    }

    cursor = nextCursor;
  }

  const lastRun = runs[runs.length - 1];
  return lastRun ? cloneTextRun(lastRun) : { text: "" };
}

function cloneTextRun(run: DocumentTextRun): DocumentTextRun {
  return {
    ...run,
    style: run.style ? { ...run.style } : null
  };
}

function resolveNormalizedRunIndex(
  previousRuns: DocumentTextRun[],
  nextRuns: DocumentTextRun[],
  preferredIndex: number
): number | null {
  if (nextRuns.length === 0) {
    return null;
  }

  const preferredRun = previousRuns[preferredIndex];

  if (!preferredRun) {
    return Math.min(preferredIndex, nextRuns.length - 1);
  }

  const exactMatchIndex = nextRuns.findIndex((run) =>
    run.tagName === (preferredRun.tagName ?? null)
    && run.className === (preferredRun.className ?? null)
    && JSON.stringify(run.style ?? null) === JSON.stringify(preferredRun.style ?? null)
  );

  if (exactMatchIndex >= 0) {
    return exactMatchIndex;
  }

  return Math.min(preferredIndex, nextRuns.length - 1);
}

function restoreSelectionToRunWrapper(
  editor: HTMLDivElement | null,
  runIndex: number | null,
  offset: number
): void {
  if (!editor || runIndex === null) {
    return;
  }

  const wrapper = editor.querySelector<HTMLElement>(
    `[data-static-html-run-wrapper='true'][data-static-html-run='${CSS.escape(String(runIndex))}']`
  );

  if (!wrapper) {
    return;
  }

  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();
  const textNode = wrapper.firstChild;
  const safeOffset = Math.max(0, Math.min(offset, wrapper.textContent?.length ?? 0));

  if (textNode?.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.min(safeOffset, textNode.textContent?.length ?? 0));
  } else {
    range.setStart(wrapper, 0);
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  wrapper.focus();
}

function resolveSelectionOffsetInsideWrapper(wrapper: HTMLElement): number {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return wrapper.textContent?.length ?? 0;
  }

  const range = selection.getRangeAt(0);

  if (!wrapper.contains(range.startContainer)) {
    return wrapper.textContent?.length ?? 0;
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    return Math.max(0, Math.min(range.startOffset, range.startContainer.textContent?.length ?? 0));
  }

  return Math.max(0, Math.min(range.startOffset, wrapper.textContent?.length ?? 0));
}

function resolveRunEditorStyle(style: DocumentNodeStyle | null): CSSProperties | undefined {
  if (!style) {
    return undefined;
  }

  return {
    fontFamily: style.fontFamily ?? undefined,
    fontSize: typeof style.fontSize === "number" ? `${style.fontSize}px` : undefined,
    fontWeight: style.fontWeight ?? undefined,
    fontStyle: style.fontStyle ?? undefined,
    lineHeight: style.lineHeight ?? undefined,
    letterSpacing: style.letterSpacing ?? undefined,
    color: style.color ?? undefined,
    textDecoration: style.textDecoration ?? undefined,
    textDecorationColor: style.textDecorationColor ?? undefined,
    backgroundColor: style.backgroundColor ?? undefined,
    whiteSpace: "pre-wrap"
  };
}

function resolveRunInputStyle(style: DocumentNodeStyle | null): CSSProperties | undefined {
  const baseStyle = resolveRunEditorStyle(style);

  return {
    ...baseStyle,
    width: "100%",
    minHeight: "34px",
    padding: "6px 8px",
    border: "none",
    outline: "none",
    resize: "none",
    overflow: "hidden",
    background: "transparent"
  };
}

function insertPlainTextIntoContentEditable(element: HTMLElement, text: string): void {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    element.textContent = `${element.textContent ?? ""}${text}`;
    return;
  }

  const range = selection.getRangeAt(0);

  if (!element.contains(range.startContainer)) {
    element.textContent = `${element.textContent ?? ""}${text}`;
    return;
  }

  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function restoreEditorSelection(
  editor: HTMLDivElement,
  runs: DocumentTextRun[],
  absoluteOffset: number
): void {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const wrappers = Array.from(
    editor.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
  );
  const safeOffset = Math.max(0, Math.min(absoluteOffset, getRunsTotalTextLength(runs)));

  if (wrappers.length === 0) {
    editor.focus();
    selection.removeAllRanges();
    return;
  }

  let cursor = 0;
  let targetWrapper = wrappers[wrappers.length - 1]!;
  let targetOffset = targetWrapper.textContent?.length ?? 0;

  for (const wrapper of wrappers) {
    const textLength = wrapper.textContent?.length ?? 0;
    const nextCursor = cursor + textLength;

    if (safeOffset <= nextCursor) {
      targetWrapper = wrapper;
      targetOffset = Math.max(0, safeOffset - cursor);
      break;
    }

    cursor = nextCursor;
  }

  const textNode = targetWrapper.firstChild;
  const range = document.createRange();

  if (textNode?.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.min(targetOffset, textNode.textContent?.length ?? 0));
  } else {
    range.setStart(targetWrapper, 0);
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

function findLongestEditableRunIndex(runs: DocumentTextRun[]): number {
  let matchedIndex = -1;
  let matchedLength = -1;

  runs.forEach((run, index) => {
    const textLength = run.text.trim().length;

    if (textLength > matchedLength) {
      matchedLength = textLength;
      matchedIndex = index;
    }
  });

  return matchedIndex;
}
