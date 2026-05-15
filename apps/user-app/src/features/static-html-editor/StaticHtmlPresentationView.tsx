import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModalField } from "../../components/ModalAtoms";
import { t } from "../../shared/i18n";
import type { DocumentNode, DocumentNodeStyle, DocumentProject } from "./model";
import {
  appendProjectPage,
  buildStaticHtmlDocumentProject,
  buildStaticHtmlPresentationPreviewFromProject,
  duplicateProjectPage,
  duplicateProjectNode,
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

export function StaticHtmlPresentationView({
  filePath,
  html,
  onProjectChange
}: {
  filePath: string;
  html: string;
  onProjectChange?: (project: DocumentProject | null) => void;
}) {
  const probe = useMemo(() => inspectStaticHtmlPresentation(html, filePath), [filePath, html]);
  const initialProject = useMemo(
    () => buildStaticHtmlDocumentProject({ html, filePath }),
    [filePath, html]
  );
  const [project, setProject] = useState(initialProject);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [history, setHistory] = useState<EditorHistoryEntry[]>([]);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameStageRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<HTMLDivElement | null>(null);
  const historyCoalesceKeyRef = useRef<string | null>(null);
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
      return;
    }

    if (selectedNodeId && pageNodeIds.includes(selectedNodeId)) {
      return;
    }

    const firstEditableNodeId = pageNodeIds.find((nodeId) => currentProject.nodes[nodeId]?.editable) ?? null;
    setSelectedNodeId(firstEditableNodeId);
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
      pageIndex: currentPageIndex,
      selectedNodeId,
      inlineEditingNodeId: inlineEditor?.nodeId ?? null
    });
  }, [currentPageIndex, currentProject, html, inlineEditor?.nodeId, selectedNodeId]);

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

      if (payload.eventType === "dblclick") {
        const node = currentProject.nodes[nodeId];
        const isInlineEditable = node?.editable && (node.type === "text" || typeof node.content.text === "string");
        const rect = isMessageRect(payload.rect) ? payload.rect : null;

        if (isInlineEditable && rect) {
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

  const currentPageId = currentPage?.id ?? null;
  const canUndo = history.length > 0;
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

    const left = iframeRect.left - stageRect.left + inlineEditor.rect.left;
    const top = iframeRect.top - stageRect.top + inlineEditor.rect.top;

    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.max(120, inlineEditor.rect.width),
      minHeight: Math.max(48, inlineEditor.rect.height)
    };
  }, [inlineEditor]);

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
        <div className="static-html-presentation-meta">
          <span className="static-html-presentation-badge">
            {t("conversation.fileViewerPresentationBadge")}
          </span>
          <p className="static-html-presentation-summary">
            {t("conversation.fileViewerPresentationSummary")
              .replace("{count}", String(currentProject.pages.length))
              .replace("{size}", `${currentProject.canvas.width} × ${currentProject.canvas.height}`)}
          </p>
          {currentProject.warnings.length ? (
            <p className="static-html-presentation-warning">
              {t("conversation.fileViewerPresentationWarningCount").replace(
                "{count}",
                String(currentProject.warnings.length)
              )}
            </p>
          ) : null}
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
        <div className="static-html-presentation-stage-header">
          <div>
            <p className="static-html-presentation-stage-kicker">
              {t("conversation.fileViewerPresentationCurrentPage")}
            </p>
            <h3 className="static-html-presentation-stage-title">
              {currentPage?.title ?? t("conversation.fileViewerPresentationUntitled")}
            </h3>
          </div>
          <p className="static-html-presentation-stage-caption">
            {t("conversation.fileViewerPresentationCanvasSelectHint")}
          </p>
        </div>

        <div className="static-html-presentation-stage-actions">
          <button
            type="button"
            className="secondary-button static-html-presentation-toolbar-button"
            onClick={() => {
              const latestHistory = history[history.length - 1];

              if (!latestHistory) {
                return;
              }

              setHistory((current) => current.slice(0, -1));
              historyCoalesceKeyRef.current = null;
              setProject(latestHistory.project);
              setCurrentPageIndex(latestHistory.currentPageIndex);
              setSelectedNodeId(latestHistory.selectedNodeId);
              setDraggingPageId(null);
              setDragPreview(null);
              setInlineEditor(null);
            }}
            disabled={!canUndo}
          >
            {t("conversation.fileViewerPresentationUndoAction")}
          </button>
          {selectedNode ? (
            <button
              type="button"
              className="secondary-button static-html-presentation-toolbar-button"
              onClick={() => {
                if (!selectedNodeId) {
                  return;
                }

                const duplicated = duplicateProjectNode(currentProject, selectedNodeId);
                commitProjectChange({
                  nextProject: duplicated.project,
                  selectedNodeId: duplicated.duplicatedNodeId
                });
              }}
              disabled={!selectedNode.editable}
            >
              {t("conversation.fileViewerPresentationDuplicateAction")}
            </button>
          ) : null}
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
                onClick={() => setSelectedNodeId(nodeId)}
              >
                <span className="static-html-presentation-node-chip-type">{node.type}</span>
                <span className="static-html-presentation-node-chip-name">
                  {node.name || node.id}
                </span>
              </button>
            );
          })}
        </div>

        <div className="static-html-presentation-workarea">
          <div className="static-html-presentation-frame-shell">
            {previewHtml ? (
              <div
                ref={frameStageRef}
                className="static-html-presentation-frame-stage"
              >
                <iframe
                  ref={frameRef}
                  className="static-html-presentation-frame"
                  data-testid="static-html-presentation-frame"
                  title={currentPage?.title ?? filePath}
                  srcDoc={previewHtml}
                  sandbox="allow-forms allow-modals allow-scripts"
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
                          text: nextText
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

          <div className="static-html-presentation-inspector">
            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                onTextChange={(nextText) => {
                  if (!selectedNodeId) {
                    return;
                  }

                  const nextProject = updateProjectNode(currentProject, selectedNodeId, (node) => ({
                    ...node,
                    content: {
                      ...node.content,
                      text: nextText
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
                onBoxChange={(boxPatch) => {
                  if (!selectedNodeId) {
                    return;
                  }

                  const nextProject = updateProjectNode(currentProject, selectedNodeId, (node) => ({
                    ...node,
                    box: {
                      ...node.box,
                      ...boxPatch
                    },
                    runtimeFlags: Array.from(new Set([...node.runtimeFlags, "draft-box"]))
                  }));
                  commitProjectChange({
                    nextProject,
                    historyKey: `box:${selectedNodeId}`
                  });
                }}
              />
            ) : (
              <div className="static-html-presentation-inspector-empty">
                <p className="status-text">{t("conversation.fileViewerPresentationSelectNode")}</p>
              </div>
            )}
          </div>
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
  onTextChange,
  onStyleChange,
  onBoxChange
}: {
  node: DocumentNode;
  onTextChange: (value: string) => void;
  onStyleChange: (patch: Partial<DocumentNodeStyle>) => void;
  onBoxChange: (patch: Partial<DocumentNode["box"]>) => void;
}) {
  const isTextLike = node.type === "text" || typeof node.content.text === "string";

  return (
    <div className="static-html-presentation-inspector-panel">
      <div className="static-html-presentation-inspector-header">
        <div>
          <p className="static-html-presentation-inspector-kicker">
            {t("conversation.fileViewerPresentationInspector")}
          </p>
          <h4 className="static-html-presentation-inspector-title">{node.name || node.id}</h4>
        </div>
        <span
          className="static-html-presentation-inspector-badge"
          data-tone={node.editable ? "default" : "warning"}
        >
          {node.editable
            ? t("conversation.fileViewerPresentationEditable")
            : t("conversation.fileViewerPresentationReadOnly")}
        </span>
      </div>

      {!node.editable && node.lockedReason ? (
        <p className="static-html-presentation-inspector-warning">{node.lockedReason}</p>
      ) : null}

      {isTextLike ? (
        <ModalField
          label={t("conversation.fileViewerPresentationTextLabel")}
          description={t("conversation.fileViewerPresentationTextDescription")}
        >
          <textarea
            className="static-html-presentation-textarea"
            value={node.content.text ?? ""}
            onChange={(event) => onTextChange(event.target.value)}
            disabled={!node.editable}
          />
        </ModalField>
      ) : null}

      <div className="static-html-presentation-inspector-grid">
        <ModalField label={t("conversation.fileViewerPresentationFontSizeLabel")}>
          <input
            type="number"
            min="8"
            max="160"
            value={node.style.fontSize ?? ""}
            onChange={(event) => {
              const value = event.target.value.trim();
              onStyleChange({
                fontSize: value ? Number(value) : null
              });
            }}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationFontWeightLabel")}>
          <select
            value={node.style.fontWeight ?? ""}
            onChange={(event) => onStyleChange({ fontWeight: event.target.value || null })}
            disabled={!node.editable}
          >
            <option value="">{t("conversation.fileViewerPresentationKeepOriginal")}</option>
            <option value="400">400</option>
            <option value="500">500</option>
            <option value="600">600</option>
            <option value="700">700</option>
          </select>
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationTextColorLabel")}>
          <input
            type="color"
            value={normalizeColorValue(node.style.color)}
            onChange={(event) => onStyleChange({ color: event.target.value })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationBackgroundColorLabel")}>
          <input
            type="color"
            value={normalizeColorValue(node.style.backgroundColor)}
            onChange={(event) => onStyleChange({ backgroundColor: event.target.value })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationTextAlignLabel")}>
          <select
            value={node.style.textAlign ?? ""}
            onChange={(event) => onStyleChange({ textAlign: event.target.value || null })}
            disabled={!node.editable}
          >
            <option value="">{t("conversation.fileViewerPresentationKeepOriginal")}</option>
            <option value="left">{t("conversation.fileViewerPresentationAlignLeft")}</option>
            <option value="center">{t("conversation.fileViewerPresentationAlignCenter")}</option>
            <option value="right">{t("conversation.fileViewerPresentationAlignRight")}</option>
          </select>
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationLineHeightLabel")}>
          <input
            type="text"
            value={node.style.lineHeight ?? ""}
            placeholder="例如 1.6 / 28px"
            onChange={(event) => onStyleChange({ lineHeight: event.target.value || null })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationPaddingLabel")}>
          <input
            type="text"
            value={node.style.padding ?? ""}
            placeholder="例如 12px 16px"
            onChange={(event) => onStyleChange({ padding: event.target.value || null })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationRadiusLabel")}>
          <input
            type="text"
            value={node.style.borderRadius ?? ""}
            placeholder="例如 16px"
            onChange={(event) => onStyleChange({ borderRadius: event.target.value || null })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationPositionXLabel")}>
          <input
            type="number"
            value={node.box.x}
            onChange={(event) => onBoxChange({ x: Number(event.target.value || 0) })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationPositionYLabel")}>
          <input
            type="number"
            value={node.box.y}
            onChange={(event) => onBoxChange({ y: Number(event.target.value || 0) })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationWidthLabel")}>
          <input
            type="number"
            min="0"
            value={node.box.width}
            onChange={(event) => onBoxChange({ width: Number(event.target.value || 0) })}
            disabled={!node.editable}
          />
        </ModalField>

        <ModalField label={t("conversation.fileViewerPresentationHeightLabel")}>
          <input
            type="number"
            min="0"
            value={node.box.height}
            onChange={(event) => onBoxChange({ height: Number(event.target.value || 0) })}
            disabled={!node.editable}
          />
        </ModalField>
      </div>
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
