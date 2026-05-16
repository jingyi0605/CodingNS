import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../shared/i18n";
import type { DocumentNode, DocumentNodeStyle, DocumentProject, DocumentTextRun } from "./model";
import {
  appendProjectPage,
  buildStaticHtmlDocumentProject,
  buildStaticHtmlPresentationPreviewFromProject,
  duplicateProjectPage,
  inspectStaticHtmlPresentation,
  listPageNodeIds,
  moveProjectPageToIndex,
  removeProjectPage,
  updateProjectNode
} from "./parser";

interface EditorHistoryEntry {
  project: DocumentProject;
  currentPageIndex: number;
  selectedNodeId: string | null;
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

export function StaticHtmlPresentationView({
  filePath,
  html,
  onProjectChange,
  onSave,
  canSave = false,
  saving = false
}: {
  filePath: string;
  html: string;
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
  const [project, setProject] = useState(initialProject);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorHistoryEntry[]>([]);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameStageRef = useRef<HTMLDivElement | null>(null);
  const frameShellRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<HTMLDivElement | null>(null);
  const historyCoalesceKeyRef = useRef<string | null>(null);
  const [frameScale, setFrameScale] = useState(1);
  const currentProject = project;
  const currentPage = currentProject?.pages[currentPageIndex] ?? currentProject?.pages[0] ?? null;
  const pageNodeIds = useMemo(() => {
    if (!currentProject || !currentPage) {
      return [];
    }

    return listPageNodeIds(currentProject, currentPage.id);
  }, [currentPage, currentProject]);

  useEffect(() => {
    setProject(initialProject);
    setCurrentPageIndex(0);
    setSelectedNodeId(null);
    setSelectedRunIndex(null);
    setHistory([]);
    setDraggingPageId(null);
    setDragPreview(null);
    setInlineEditor(null);
    historyCoalesceKeyRef.current = null;
  }, [initialProject]);

  useEffect(() => {
    onProjectChange?.(project);
  }, [onProjectChange, project]);

  useEffect(() => {
    if (!currentProject || !currentPage) {
      setSelectedNodeId(null);
      setSelectedRunIndex(null);
      return;
    }

    if (selectedNodeId && pageNodeIds.includes(selectedNodeId)) {
      return;
    }

    const firstEditableNodeId = pageNodeIds.find((nodeId) => currentProject.nodes[nodeId]?.editable) ?? null;
    setSelectedNodeId(firstEditableNodeId);
    setSelectedRunIndex(null);
  }, [currentPage, currentProject, pageNodeIds, selectedNodeId]);

  const selectedNode = selectedNodeId && currentProject
    ? currentProject.nodes[selectedNodeId] ?? null
    : null;
  const previewHtml = useMemo(() => {
    if (!currentProject) {
      return null;
    }

    return buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: currentProject,
      pageIndex: currentPageIndex
    });
  }, [currentPageIndex, currentProject, html]);

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

                      setSelectedNodeId(nodeId);
                      setSelectedRunIndex(runIndex);

      if (payload.eventType === "dblclick") {
        const node = currentProject.nodes[nodeId];
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
  }, [currentPageIndex, currentProject, previewHtml]);

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
        inlineEditingNodeId: inlineEditor?.nodeId ?? null
      },
      "*"
    );
  }, [inlineEditor?.nodeId, previewHtml, selectedNodeId, selectedRunIndex]);

  const currentPageId = currentPage?.id ?? null;
  const canUndo = history.length > 0;

  function handleUndo() {
    const previousEntry = history[history.length - 1];

    if (!previousEntry) {
      return;
    }

    historyCoalesceKeyRef.current = null;
    setHistory((current) => current.slice(0, -1));
    setProject(previousEntry.project);
    setCurrentPageIndex(previousEntry.currentPageIndex);
    setSelectedNodeId(previousEntry.selectedNodeId);
    setSelectedRunIndex(null);
    setInlineEditor(null);
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
    }
  ) {
    setProject(nextProject);

    if (options?.focusPageId !== undefined) {
      const focusState = resolveFocusStateByPageId(options.focusPageId, nextProject);
      setCurrentPageIndex(focusState.nextIndex);
      setSelectedNodeId(options.selectedNodeId ?? focusState.nextSelectedNodeId);
      return;
    }

    if (options?.selectedNodeId !== undefined) {
      setSelectedNodeId(options.selectedNodeId);
    }
  }

  function commitProjectChange(input: {
    nextProject: DocumentProject;
    focusPageId?: string | null;
    selectedNodeId?: string | null;
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
          selectedNodeId
        }
      ].slice(-10));
    }

    historyCoalesceKeyRef.current = input.historyKey ?? null;
    applyProjectState(input.nextProject, {
      focusPageId: input.focusPageId,
      selectedNodeId: input.selectedNodeId
    });

    if (!input.preserveInlineEditor) {
      setInlineEditor(null);
    }
  }

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
        <div className="static-html-presentation-toolbar static-html-presentation-inspector">
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
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

        <div className="static-html-presentation-workarea">
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
                        inlineEditingNodeId: inlineEditor?.nodeId ?? null
                      },
                      "*"
                    );
                  }}
                />
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
                    data-locked={node.editable ? undefined : "true"}
                    onClick={() => {
                      setSelectedNodeId(nodeId);
                      setSelectedRunIndex(null);
                    }}
                  >
                    <span className="static-html-presentation-node-chip-type">{node.type}</span>
                    <span className="static-html-presentation-node-chip-name">
                      {node.name || node.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
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
