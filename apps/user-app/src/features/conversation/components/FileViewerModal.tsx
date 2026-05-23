import {
  isValidElement,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  DesktopModal,
  type DesktopModalSizePreset
} from "../../../components/DesktopModal";
import { ModalCloseButton } from "../../../components/ModalCloseButton";
import { getHostBaseUrl, getHostRequestUrl } from "../../../config/env";
import { resolveHostTransportTarget } from "../../../network/host-transport-registry";
import { usePlatform } from "../../../platform/platform-provider";
import { createHtmlPreviewWorkspaceBridge } from "../../../platform/preview/html-preview-workspace-bridge";
import {
  createPresentationExportTask,
  downloadPresentationExportTask,
  getPresentationExportTask,
  type PresentationExportTaskInfo
} from "../../../platform/server/presentation-export-manager";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  StaticHtmlPresentationView,
  inspectStaticHtmlPresentation,
  type DocumentProject,
  writeStaticHtmlDocumentProject
} from "../../static-html-editor";
import {
  getFilePreview,
  saveFileContent,
  type FilePreviewDto
} from "../api/file-context-api";

export interface FileViewerModalProps {
  workspaceId: string | null | undefined;
  filePath: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (filePath: string) => Promise<void> | void;
  diffContent?: string | null;
  showDetachAction?: boolean;
  onDetach?: () => void | Promise<void>;
}

export interface FileViewerPanelProps {
  workspaceId: string | null | undefined;
  filePath: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (filePath: string) => Promise<void> | void;
  diffContent?: string | null;
  chrome?: "modal" | "window";
  windowTitle?: string | null;
  showDetachAction?: boolean;
  onDetach?: () => void | Promise<void>;
}

type ViewerMode = "preview" | "presentation" | "code" | "edit";
type ViewerModalSizePreset = Extract<DesktopModalSizePreset, "regular" | "full">;
type ImageScaleMode = "fit" | "custom" | "actual";
type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "operator"
  | "tag"
  | "attr"
  | "boolean"
  | "null";

interface CodeToken {
  text: string;
  kind: TokenKind;
}

interface ViewerToolbarAction {
  id: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void | Promise<void>;
}

const DEFAULT_HTML_PREVIEW_SANDBOX = "allow-forms allow-modals allow-scripts";
const CROSS_ORIGIN_HTML_PREVIEW_SANDBOX = `${DEFAULT_HTML_PREVIEW_SANDBOX} allow-same-origin`;

const SCRIPT_KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield"
]);

const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "readonly",
  "return",
  "then",
  "until",
  "while"
]);

const SQL_KEYWORDS = new Set([
  "add",
  "alter",
  "and",
  "as",
  "asc",
  "between",
  "by",
  "create",
  "delete",
  "desc",
  "drop",
  "from",
  "group",
  "having",
  "insert",
  "into",
  "join",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "right",
  "select",
  "set",
  "table",
  "union",
  "update",
  "values",
  "where"
]);

const DOCKERFILE_KEYWORDS = new Set([
  "add",
  "arg",
  "cmd",
  "copy",
  "entrypoint",
  "env",
  "expose",
  "from",
  "healthcheck",
  "label",
  "maintainer",
  "onbuild",
  "run",
  "shell",
  "stopsignal",
  "user",
  "volume",
  "workdir",
  "as"
]);

const LOG_LEVELS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "warning",
  "error",
  "fatal"
]);

export function FileViewerModal(props: FileViewerModalProps) {
  return <FileViewerPanel {...props} chrome="modal" />;
}

export function FileViewerPanel({
  workspaceId,
  filePath,
  open,
  onClose,
  onSaved,
  diffContent,
  chrome = "modal",
  windowTitle = null,
  showDetachAction = false,
  onDetach
}: FileViewerPanelProps) {
  const [preview, setPreview] = useState<FilePreviewDto | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [presentationProject, setPresentationProject] = useState<DocumentProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [mode, setMode] = useState<ViewerMode>("preview");
  const [modalSizePreset, setModalSizePreset] = useState<ViewerModalSizePreset>("regular");
  const [resourceRefreshVersion, setResourceRefreshVersion] = useState(0);
  const [imageScaleMode, setImageScaleMode] = useState<ImageScaleMode>("fit");
  const [imageScale, setImageScale] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(110);
  const [pdfFitWidth, setPdfFitWidth] = useState(true);
  const { showToast } = useToast();
  const platform = usePlatform();
  const onCloseRef = useRef(onClose);
  const showToastRef = useRef(showToast);

  const detectedLanguage = useMemo(() => detectLanguage(filePath), [filePath]);
  const overviewMarkers = useMemo(() => buildFileOverviewMarkers(diffContent), [diffContent]);
  const overviewTotalLines = useMemo(
    () => resolveOverviewTotalLines(editorContent, overviewMarkers),
    [editorContent, overviewMarkers]
  );
  const previewKind = preview?.kind ?? null;
  const canEdit = Boolean(preview?.capabilities?.canEdit);
  const canRefresh = Boolean(preview?.capabilities?.canRefresh);
  const previewUrl = useMemo(
    () => resolvePreviewAccessUrl(preview, platform.isDesktop),
    [platform.isDesktop, preview]
  );
  const externalPreviewUrl = useMemo(
    () => resolveExternalPreviewUrl(preview, platform.isDesktop),
    [platform.isDesktop, preview]
  );
  const imagePreviewUrl = useMemo(
    () => buildResourcePreviewUrl(previewUrl, resourceRefreshVersion),
    [previewUrl, resourceRefreshVersion]
  );
  const pdfPreviewUrl = useMemo(
    () => buildPdfPreviewUrl(previewUrl, resourceRefreshVersion, pdfPage, pdfScale, pdfFitWidth),
    [previewUrl, resourceRefreshVersion, pdfPage, pdfScale, pdfFitWidth]
  );
  const htmlPreviewUrl = useMemo(
    () => buildResourcePreviewUrl(previewUrl, resourceRefreshVersion),
    [previewUrl, resourceRefreshVersion]
  );
  const currentContent = preview?.content ?? "";
  const presentationSavedContent = useMemo(() => {
    if (previewKind !== "html" || !presentationProject) {
      return null;
    }

    return writeStaticHtmlDocumentProject({
      html: currentContent,
      project: presentationProject
    });
  }, [currentContent, presentationProject, previewKind]);
  const isDirty = canEdit && (
    editorContent !== currentContent
    || (mode === "presentation" && Boolean(presentationSavedContent) && presentationSavedContent !== currentContent)
  );
  const presentationProbe = useMemo(() => {
    if (previewKind !== "html" || !currentContent.trim()) {
      return null;
    }

    return inspectStaticHtmlPresentation(currentContent, filePath ?? "document.html");
  }, [currentContent, filePath, previewKind]);
  const canShowPresentationTab = useMemo(() => {
    return shouldEnableHtmlPresentationMode({
      filePath,
      html: currentContent,
      probe: presentationProbe
    });
  }, [currentContent, filePath, presentationProbe]);
  const canShowPreviewTab = canUsePreviewMode(previewKind);
  const canShowCodeTab = canUseCodeMode(previewKind);
  const canShowSeparateCodeTab = canShowCodeTab && previewKind !== "html";
  const canShowEditTab = canUseEditMode(previewKind) && canEdit;
  const isMobileViewer = platform.isMobile;
  const isWindowViewer = chrome === "window";
  const shouldRenderModalChrome = chrome === "modal";
  const isPresentationMode = mode === "presentation" && previewKind === "html";
  const useForcedFullSize = !isWindowViewer && !isMobileViewer && previewKind === "html";
  const activeModalSizePreset = isMobileViewer || useForcedFullSize ? "full" : modalSizePreset;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setEditorContent("");
      setPresentationProject(null);
      setLoading(false);
      setSaving(false);
      setExportingPdf(false);
      setExportingPptx(false);
      setMode(resolveInitialViewerMode(filePath, null));
      resetResourceViewerState({
        setResourceRefreshVersion,
        setImageScale,
        setImageScaleMode,
        setPdfPage,
        setPdfScale,
        setPdfFitWidth
      });
      setModalSizePreset("regular");
      return;
    }

    if (!workspaceId || !filePath) {
      return;
    }

    const safeWorkspaceId = workspaceId;
    const safeFilePath = filePath;
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);

      try {
        const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);

        if (!cancelled) {
          applyPreviewState(nextPreview, safeFilePath, {
            preserveMode: false,
            setPreview,
            setEditorContent,
            setPresentationProject,
            setMode,
            setResourceRefreshVersion,
            setImageScale,
            setImageScaleMode,
            setPdfPage,
            setPdfScale,
            setPdfFitWidth
          });
        }
      } catch (error) {
        if (!cancelled) {
          showToastRef.current({
            title: readError(error, t("conversation.filePanelOpenFailed")),
            tone: "error"
          });
          onCloseRef.current();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [filePath, open, workspaceId]);

  if (!open || !filePath) {
    return null;
  }

  const safeFilePath = filePath;
  const safeWorkspaceId = workspaceId;

  async function handleSave() {
    if (!safeWorkspaceId || !preview?.version || !canEdit) {
      return;
    }

    setSaving(true);

    try {
      const nextContent = mode === "presentation" && presentationProject
        ? presentationSavedContent ?? editorContent
        : editorContent;

      await saveFileContent(safeWorkspaceId, safeFilePath, nextContent, preview.version);
      const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);
      applyPreviewState(nextPreview, safeFilePath, {
        preserveMode: false,
        setPreview,
        setEditorContent,
        setPresentationProject,
        setMode,
        setResourceRefreshVersion,
        setImageScale,
        setImageScaleMode,
        setPdfPage,
        setPdfScale,
        setPdfFitWidth
      });
      await onSaved(safeFilePath);
      showToast({
        title: t("conversation.filePanelSaveSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelSaveFailed")),
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshPreview() {
    if (!safeWorkspaceId || !canRefresh || isDirty) {
      return;
    }

    setLoading(true);

    try {
      const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);
      applyPreviewState(nextPreview, safeFilePath, {
        preserveMode: true,
        setPreview,
        setEditorContent,
        setPresentationProject,
        setMode,
        setResourceRefreshVersion,
        setImageScale,
        setImageScaleMode,
        setPdfPage,
        setPdfScale,
        setPdfFitWidth
      });
      setResourceRefreshVersion((previous) => previous + 1);
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.fileViewerRefreshFailed")),
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenExternal() {
    if (!externalPreviewUrl) {
      return;
    }

    const result = await platform.bridge.openExternal(externalPreviewUrl);

    if (!result.ok) {
      showToast({
        title: result.detail ?? t("conversation.fileViewerOpenExternalFailed"),
        tone: "error"
      });
    }
  }

  async function handleExportPdf() {
    await handleExportPresentation("pdf");
  }

  async function handleExportPptx() {
    await handleExportPresentation("pptx");
  }

  async function handleExportPresentation(format: "pdf" | "pptx") {
    const isExporting = format === "pdf" ? exportingPdf : exportingPptx;

    if (!safeWorkspaceId || previewKind !== "html" || !canShowPresentationTab || isExporting) {
      return;
    }

    const htmlContent = mode === "presentation" && presentationProject
      ? presentationSavedContent ?? editorContent
      : editorContent;

    if (!htmlContent.trim()) {
      showToast({
        title: format === "pdf"
          ? t("conversation.fileViewerExportPdfMissingHtml")
          : t("conversation.fileViewerExportPptxMissingHtml"),
        tone: "error"
      });
      return;
    }

    if (format === "pdf") {
      setExportingPdf(true);
    } else {
      setExportingPptx(true);
    }

    try {
      const task = await createPresentationExportTask({
        workspaceId: safeWorkspaceId,
        path: safeFilePath,
        htmlContent,
        format
      });
      const finishedTask = await waitForPresentationExportTask(task.taskId);

      if (finishedTask.status !== "succeeded") {
        throw new ApiError(500, {
          detail: finishedTask.errorMessage ?? (
            format === "pdf"
              ? t("conversation.fileViewerExportPdfFailed")
              : t("conversation.fileViewerExportPptxFailed")
          ),
          error_code: "PRESENTATION_EXPORT_FAILED"
        });
      }

      const download = await downloadPresentationExportTask(finishedTask.taskId);
      downloadBlob(download.fileName, download.blob);

      showToast({
        title: format === "pdf"
          ? t("conversation.fileViewerExportPdfSuccess", {
            path: download.fileName
          })
          : t("conversation.fileViewerExportPptxSuccess", {
            path: download.fileName
          }),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readError(
          error,
          format === "pdf"
            ? t("conversation.fileViewerExportPdfFailed")
            : t("conversation.fileViewerExportPptxFailed")
        ),
        tone: "error"
      });
    } finally {
      if (format === "pdf") {
        setExportingPdf(false);
      } else {
        setExportingPptx(false);
      }
    }
  }

  const viewerTabs = buildViewerTabs({
    canShowPresentationTab,
    canShowPreviewTab,
    canShowCodeTab: canShowSeparateCodeTab,
    canShowEditTab
  });
  const formatActions = buildFormatActions({
    preview,
    canOpenExternal: Boolean(externalPreviewUrl),
    canExportPdf: previewKind === "html" && canShowPresentationTab,
    canExportPptx: previewKind === "html" && canShowPresentationTab,
    exportingPdf,
    exportingPptx,
    isDirty,
    handleRefreshPreview,
    handleExportPdf,
    handleExportPptx,
    handleOpenExternal,
    imageScaleMode,
    imageScale,
    setImageScale,
    setImageScaleMode,
    pdfPage,
    setPdfPage,
    pdfScale,
    setPdfScale,
    pdfFitWidth,
    setPdfFitWidth
  });
  const visibleFormatActions = isMobileViewer ? formatActions.filter(isRefreshAction) : formatActions;
  const showHeaderSaveAction = canEdit && mode === "edit" && !isPresentationMode;
  const viewerControls = (
    <>
      <div className="file-viewer-header-tabs" role="tablist" aria-label={t("conversation.fileViewerModeLabel")}>
        {viewerTabs.includes("presentation") ? (
          <button
            type="button"
            className="file-viewer-tab"
            data-active={mode === "presentation"}
            role="tab"
            aria-selected={mode === "presentation"}
            onClick={() => setMode("presentation")}
          >
            {t("conversation.fileViewerPresentation")}
          </button>
        ) : null}
        {viewerTabs.includes("preview") ? (
          <button
            type="button"
            className="file-viewer-tab"
            data-active={mode === "preview"}
            role="tab"
            aria-selected={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            {t("conversation.fileViewerPreview")}
          </button>
        ) : null}
        {viewerTabs.includes("code") ? (
          <button
            type="button"
            className="file-viewer-tab"
            data-active={mode === "code"}
            role="tab"
            aria-selected={mode === "code"}
            onClick={() => setMode("code")}
          >
            {t("conversation.fileViewerCode")}
          </button>
        ) : null}
        {viewerTabs.includes("edit") ? (
          <button
            type="button"
            className="file-viewer-tab"
            data-active={mode === "edit"}
            role="tab"
            aria-selected={mode === "edit"}
            onClick={() => setMode("edit")}
            disabled={!canEdit}
          >
            {t("conversation.fileViewerEdit")}
          </button>
        ) : null}
      </div>
      {!isWindowViewer && !isMobileViewer && !useForcedFullSize ? (
        <div className="file-viewer-size-group" role="group" aria-label={t("conversation.fileViewerSizeLabel")}>
          <button
            type="button"
            className="secondary-button file-viewer-action-button"
            data-active={modalSizePreset === "regular"}
            onClick={() => setModalSizePreset("regular")}
          >
            {t("conversation.fileViewerSizeDefault")}
          </button>
          <button
            type="button"
            className="secondary-button file-viewer-action-button"
            data-active={modalSizePreset === "full"}
            onClick={() => setModalSizePreset("full")}
          >
            {t("conversation.fileViewerSizeFull")}
          </button>
        </div>
      ) : null}
      <div className="file-viewer-header-action-buttons">
        {visibleFormatActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="secondary-button file-viewer-action-button"
            data-active={action.active ? "true" : undefined}
            onClick={() => void action.onClick()}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
        {showHeaderSaveAction ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
          >
            {saving ? t("conversation.filePanelSaving") : t("conversation.filePanelSave")}
          </button>
        ) : null}
      </div>
    </>
  );

  const detachControl = showDetachAction && onDetach ? (
    <button
      type="button"
      className="workbench-modal-close file-viewer-detach-button"
      aria-label={t("conversation.fileViewerOpenInWindow")}
      title={t("conversation.fileViewerOpenInWindow")}
      onClick={() => void onDetach()}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M5 3.5h7.5V11M12.5 3.5 7.8 8.2M3.5 6.5v6h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  ) : null;

  const viewerBody = (
    <>
      {isMobileViewer && shouldRenderModalChrome ? <div className="file-viewer-toolbar">{viewerControls}</div> : null}

      <div className="file-viewer-body">
        {loading ? (
          <p className="status-text">{t("common.loading")}</p>
        ) : preview?.supported === false ? (
          <p className="status-text">{preview.reason ?? t("conversation.filePanelUnsupported")}</p>
        ) : mode === "presentation" && previewKind === "html" ? (
          <StaticHtmlPresentationView
            filePath={filePath}
            html={editorContent}
            baseHref={htmlPreviewUrl}
            onProjectChange={setPresentationProject}
            onSave={() => void handleSave()}
            canSave={isDirty}
            saving={saving}
          />
        ) : mode === "edit" ? (
          <EditModeLayout
            content={editorContent}
            language={detectedLanguage}
            onContentChange={setEditorContent}
          />
        ) : mode === "preview" && previewKind === "html" ? (
          <HtmlPreview
            src={htmlPreviewUrl}
            workspaceId={safeWorkspaceId}
            filePath={filePath}
            overviewMarkers={overviewMarkers}
            overviewTotalLines={overviewTotalLines}
          />
        ) : mode === "preview" && previewKind === "image" ? (
          <ImagePreview
            src={imagePreviewUrl}
            filePath={filePath}
            scale={imageScale}
            scaleMode={imageScaleMode}
            overviewMarkers={overviewMarkers}
            overviewTotalLines={overviewTotalLines}
          />
        ) : mode === "preview" && previewKind === "pdf" ? (
          <PdfPreview
            src={pdfPreviewUrl}
            filePath={filePath}
            overviewMarkers={overviewMarkers}
            overviewTotalLines={overviewTotalLines}
          />
        ) : mode === "preview" && previewKind === "markdown" ? (
          <MarkdownPreview
            content={editorContent}
            overviewMarkers={overviewMarkers}
            overviewTotalLines={overviewTotalLines}
          />
        ) : (
          <CodePreview
            content={editorContent}
            language={detectedLanguage}
            overviewMarkers={overviewMarkers}
            overviewTotalLines={overviewTotalLines}
          />
        )}
      </div>
    </>
  );

  if (isWindowViewer) {
    return (
      <section className="file-viewer-window-panel" aria-label={windowTitle ?? filePath}>
        <header className="file-viewer-window-header" data-tauri-drag-region="">
          <div className="file-viewer-window-title-wrap" data-tauri-drag-region="">
            <h1 data-tauri-drag-region="">{windowTitle ?? filePath}</h1>
          </div>
          <div className="file-viewer-header-controls file-viewer-window-controls" data-window-drag="ignore">
            {viewerControls}
            <ModalCloseButton onClick={onClose} />
          </div>
        </header>
        <div className="file-viewer-modal-body file-viewer-window-body">{viewerBody}</div>
      </section>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={filePath}
      size={activeModalSizePreset}
      layout="viewer"
      className={`file-viewer-modal${platform.isDesktop && activeModalSizePreset !== "full" ? " is-resizable" : ""}`}
      bodyClassName="file-viewer-modal-body"
      headerActions={!isMobileViewer ? <div className="file-viewer-header-controls">{viewerControls}</div> : undefined}
      beforeCloseButton={detachControl}
      onClose={onClose}
    >
      {viewerBody}
    </DesktopModal>
  );
}

interface HtmlPresentationModeInput {
  filePath: string | null;
  html: string;
  probe: ReturnType<typeof inspectStaticHtmlPresentation> | null;
}

const PRESENTATION_DIRECTORY_SEGMENTS = new Set([
  "slides",
  "slide",
  "presentations",
  "presentation",
  "deck",
  "decks",
  "ppt",
  "pptx"
]);

const TOOL_DIRECTORY_SEGMENTS = new Set([
  "tools",
  "tool"
]);

function shouldEnableHtmlPresentationMode(input: HtmlPresentationModeInput): boolean {
  const { filePath, html, probe } = input;

  if (!probe?.supported || !html.trim()) {
    return false;
  }

  const normalizedSegments = splitNormalizedPathSegments(filePath);

  if (normalizedSegments.some((segment) => TOOL_DIRECTORY_SEGMENTS.has(segment))) {
    return false;
  }

  if (hasExplicitPresentationOptIn(html)) {
    return true;
  }

  if (normalizedSegments.some((segment) => PRESENTATION_DIRECTORY_SEGMENTS.has(segment))) {
    return true;
  }

  if (probe.strategy === "deck-direct-child") {
    return false;
  }

  return hasStrongPresentationSignals(html);
}

function splitNormalizedPathSegments(filePath: string | null): string[] {
  if (!filePath) {
    return [];
  }

  return filePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function hasExplicitPresentationOptIn(html: string): boolean {
  return /<meta[^>]+name=["'](?:codingns-preview-mode|codingns-presentation|cns-preview-mode|cns-presentation)["'][^>]+content=["']presentation["'][^>]*>/i.test(html)
    || /\bdata-(?:codingns|cns)-(?:preview-mode|presentation)\s*=\s*["']presentation["']/i.test(html);
}

function hasStrongPresentationSignals(html: string): boolean {
  const hasDeckContainer = /\bclass\s*=\s*["'][^"']*\bdeck\b[^"']*["']/i.test(html);
  const hasSlideClass = /\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["']/i.test(html);
  const hasSlideMetadata = /\bdata-(?:slide|title)\s*=\s*["'][^"']+["']/i.test(html);
  const hasDeckViewport = /--deck-width\s*:|--deck-height\s*:|aspect-ratio\s*:\s*16\s*\/\s*9/i.test(html);

  return hasSlideClass && (hasDeckContainer || hasSlideMetadata || hasDeckViewport);
}

function resolveInitialViewerMode(filePath: string | null, previewKind: FilePreviewDto["kind"] | null): ViewerMode {
  if (previewKind === "markdown" || previewKind === "html" || previewKind === "image" || previewKind === "pdf") {
    return "preview";
  }

  return isMarkdownFile(filePath ?? "") || isHtmlFile(filePath ?? "") ? "preview" : "code";
}

function applyPreviewState(
  nextPreview: FilePreviewDto,
  filePath: string,
  setters: {
    preserveMode: boolean;
    setPreview: (preview: FilePreviewDto) => void;
    setEditorContent: (content: string) => void;
    setPresentationProject: (project: DocumentProject | null) => void;
    setMode: (updater: ViewerMode | ((current: ViewerMode) => ViewerMode)) => void;
    setResourceRefreshVersion: (updater: number) => void;
    setImageScale: (scale: number) => void;
    setImageScaleMode: (mode: ImageScaleMode) => void;
    setPdfPage: (page: number) => void;
    setPdfScale: (scale: number) => void;
    setPdfFitWidth: (value: boolean) => void;
  }
): void {
  setters.setPreview(nextPreview);
  setters.setEditorContent(nextPreview.content ?? "");
  setters.setPresentationProject(null);
  setters.setMode((current) => {
    if (setters.preserveMode && canUseMode(current, nextPreview.kind)) {
      return current;
    }

    return resolveInitialViewerMode(filePath, nextPreview.kind);
  });
  resetResourceViewerState(setters);
}

function resetResourceViewerState(setters: {
  setResourceRefreshVersion: (updater: number) => void;
  setImageScale: (scale: number) => void;
  setImageScaleMode: (mode: ImageScaleMode) => void;
  setPdfPage: (page: number) => void;
  setPdfScale: (scale: number) => void;
  setPdfFitWidth: (value: boolean) => void;
}): void {
  setters.setResourceRefreshVersion(0);
  setters.setImageScale(1);
  setters.setImageScaleMode("fit");
  setters.setPdfPage(1);
  setters.setPdfScale(110);
  setters.setPdfFitWidth(true);
}

function canUsePreviewMode(previewKind: FilePreviewDto["kind"] | null): boolean {
  return previewKind === "markdown"
    || previewKind === "html"
    || previewKind === "image"
    || previewKind === "pdf";
}

function canUseCodeMode(previewKind: FilePreviewDto["kind"] | null): boolean {
  return previewKind === "text" || previewKind === "markdown" || previewKind === "html";
}

function canUseEditMode(previewKind: FilePreviewDto["kind"] | null): boolean {
  return previewKind === "text" || previewKind === "markdown" || previewKind === "html";
}

function canUseMode(mode: ViewerMode, previewKind: FilePreviewDto["kind"] | null): boolean {
  if (mode === "presentation") {
    return previewKind === "html";
  }

  if (mode === "preview") {
    return canUsePreviewMode(previewKind);
  }

  if (mode === "code") {
    return canUseCodeMode(previewKind);
  }

  return canUseEditMode(previewKind);
}

function buildViewerTabs(input: {
  canShowPresentationTab: boolean;
  canShowPreviewTab: boolean;
  canShowCodeTab: boolean;
  canShowEditTab: boolean;
}): ViewerMode[] {
  const tabs: ViewerMode[] = [];

  if (input.canShowPresentationTab) {
    tabs.push("presentation");
  }

  if (input.canShowPreviewTab) {
    tabs.push("preview");
  }

  if (input.canShowCodeTab) {
    tabs.push("code");
  }

  if (input.canShowEditTab) {
    tabs.push("edit");
  }

  return tabs;
}

function buildFormatActions(input: {
  preview: FilePreviewDto | null;
  canOpenExternal: boolean;
  canExportPdf: boolean;
  canExportPptx: boolean;
  exportingPdf: boolean;
  exportingPptx: boolean;
  isDirty: boolean;
  handleRefreshPreview: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleExportPptx: () => Promise<void>;
  handleOpenExternal: () => Promise<void>;
  imageScaleMode: ImageScaleMode;
  imageScale: number;
  setImageScale: (updater: number | ((current: number) => number)) => void;
  setImageScaleMode: (mode: ImageScaleMode) => void;
  pdfPage: number;
  setPdfPage: (updater: number | ((current: number) => number)) => void;
  pdfScale: number;
  setPdfScale: (updater: number | ((current: number) => number)) => void;
  pdfFitWidth: boolean;
  setPdfFitWidth: (value: boolean) => void;
}): ViewerToolbarAction[] {
  if (!input.preview?.supported) {
    return [];
  }

  const actions: ViewerToolbarAction[] = [];
  const refreshDisabled = !input.preview.capabilities?.canRefresh || input.isDirty;

  if (input.preview.kind === "image") {
    actions.push(
      {
        id: "image-zoom-out",
        label: t("conversation.fileViewerZoomOut"),
        onClick: () => {
          input.setImageScaleMode("custom");
          input.setImageScale((current) => Math.max(0.25, roundScale(current - 0.25)));
        }
      },
      {
        id: "image-zoom-in",
        label: t("conversation.fileViewerZoomIn"),
        onClick: () => {
          input.setImageScaleMode("custom");
          input.setImageScale((current) => Math.min(4, roundScale(current + 0.25)));
        }
      },
      {
        id: "image-fit",
        label: t("conversation.fileViewerFit"),
        active: input.imageScaleMode === "fit",
        onClick: () => {
          input.setImageScaleMode("fit");
          input.setImageScale(1);
        }
      },
      {
        id: "image-actual",
        label: t("conversation.fileViewerActualSize"),
        active: input.imageScaleMode === "actual",
        onClick: () => {
          input.setImageScaleMode("actual");
          input.setImageScale(1);
        }
      },
      {
        id: "image-refresh",
        label: t("conversation.fileViewerRefreshPreview"),
        disabled: refreshDisabled,
        onClick: input.handleRefreshPreview
      }
    );
  }

  if (input.preview.kind === "pdf") {
    actions.push(
      {
        id: "pdf-prev-page",
        label: t("conversation.fileViewerPreviousPage"),
        disabled: input.pdfPage <= 1,
        onClick: () => input.setPdfPage((current) => Math.max(1, current - 1))
      },
      {
        id: "pdf-page-indicator",
        label: t("conversation.fileViewerPageIndicator").replace("{page}", String(input.pdfPage)),
        disabled: true,
        onClick: () => undefined
      },
      {
        id: "pdf-next-page",
        label: t("conversation.fileViewerNextPage"),
        onClick: () => input.setPdfPage((current) => current + 1)
      },
      {
        id: "pdf-zoom-out",
        label: t("conversation.fileViewerZoomOut"),
        onClick: () => {
          input.setPdfFitWidth(false);
          input.setPdfScale((current) => Math.max(50, Math.round(current - 10)));
        }
      },
      {
        id: "pdf-zoom-in",
        label: t("conversation.fileViewerZoomIn"),
        onClick: () => {
          input.setPdfFitWidth(false);
          input.setPdfScale((current) => Math.min(300, Math.round(current + 10)));
        }
      },
      {
        id: "pdf-fit-width",
        label: t("conversation.fileViewerFitWidth"),
        active: input.pdfFitWidth,
        onClick: () => input.setPdfFitWidth(true)
      },
      {
        id: "pdf-refresh",
        label: t("conversation.fileViewerRefreshPreview"),
        disabled: refreshDisabled,
        onClick: input.handleRefreshPreview
      }
    );
  }

  if (input.preview.kind === "html" || input.preview.kind === "markdown" || input.preview.kind === "text") {
    actions.push({
      id: "text-refresh",
      label: t("conversation.fileViewerRefreshPreview"),
      disabled: refreshDisabled,
      onClick: input.handleRefreshPreview
    });
  }

  if (input.preview.kind === "html" && input.canExportPdf) {
    actions.push({
      id: "presentation-export-pdf",
      label: input.exportingPdf
        ? t("conversation.fileViewerExportPdfRunning")
        : t("conversation.fileViewerExportPdf"),
      disabled: input.exportingPdf,
      onClick: input.handleExportPdf
    });
  }

  if (input.preview.kind === "html" && input.canExportPptx) {
    actions.push({
      id: "presentation-export-pptx",
      label: input.exportingPptx
        ? t("conversation.fileViewerExportPptxRunning")
        : t("conversation.fileViewerExportPptx"),
      disabled: input.exportingPptx,
      onClick: input.handleExportPptx
    });
  }

  if (input.canOpenExternal) {
    actions.push({
      id: "open-external",
      label: t("conversation.fileViewerOpenExternal"),
      onClick: input.handleOpenExternal
    });
  }

  return actions;
}

function isRefreshAction(action: ViewerToolbarAction): boolean {
  return action.id.endsWith("-refresh")
    || action.id === "text-refresh"
    || action.id === "presentation-export-pdf"
    || action.id === "presentation-export-pptx";
}

function buildResourcePreviewUrl(baseUrl: string | null, refreshVersion: number): string | null {
  if (!baseUrl) {
    return null;
  }

  const nextUrl = new URL(baseUrl, window.location.origin);
  nextUrl.searchParams.set("_preview", String(refreshVersion));
  nextUrl.searchParams.set("_cns_parent_origin", window.location.origin);
  nextUrl.hash = "";
  return nextUrl.toString();
}

function resolvePreviewAccessUrl(
  preview: Pick<FilePreviewDto, "previewPath" | "previewUrl"> | null,
  isDesktop: boolean
): string | null {
  if (!preview) {
    return null;
  }

  if (preview.previewPath) {
    if (!isDesktop && typeof window !== "undefined" && window.location?.origin) {
      return new URL(preview.previewPath, window.location.origin).toString();
    }

    if (isDesktop) {
      const desktopPreviewUrl = buildDesktopPreviewUrl(preview.previewPath);

      if (desktopPreviewUrl) {
        return desktopPreviewUrl;
      }
    }
  }

  return preview.previewUrl ?? null;
}

function resolveExternalPreviewUrl(
  preview: Pick<FilePreviewDto, "previewPath" | "previewUrl"> | null,
  isDesktop: boolean
): string | null {
  if (!preview) {
    return null;
  }

  if (preview.previewPath) {
    if (!isDesktop && typeof window !== "undefined" && window.location?.origin) {
      return new URL(preview.previewPath, window.location.origin).toString();
    }

    if (isDesktop) {
      const desktopPreviewUrl = buildDesktopPreviewUrl(preview.previewPath);

      if (desktopPreviewUrl) {
        return desktopPreviewUrl;
      }
    }
  }

  return preview.previewUrl ?? null;
}

function buildDesktopPreviewUrl(previewPath: string): string | null {
  try {
    const resolvedBaseUrl = resolveHostTransportTarget(getHostBaseUrl()).baseUrl;
    return getHostRequestUrl(previewPath, resolvedBaseUrl);
  } catch {
    return null;
  }
}

function buildPdfPreviewUrl(
  baseUrl: string | null,
  refreshVersion: number,
  page: number,
  scale: number,
  fitWidth: boolean
): string | null {
  const refreshedUrl = buildResourcePreviewUrl(baseUrl, refreshVersion);

  if (!refreshedUrl) {
    return null;
  }

  const nextUrl = new URL(refreshedUrl, window.location.origin);
  const hashParams = new URLSearchParams();
  hashParams.set("page", String(page));
  hashParams.set("zoom", fitWidth ? "page-width" : String(scale));
  nextUrl.hash = hashParams.toString();
  return nextUrl.toString();
}

function resolveHtmlPreviewSandbox(src: string): string {
  if (typeof window === "undefined" || !window.location?.origin) {
    return DEFAULT_HTML_PREVIEW_SANDBOX;
  }

  try {
    const previewUrl = new URL(src, window.location.origin);

    // 桌面端这里通常是 Host 的本地地址，和 Tauri WebView 自身不同源。
    // macOS 的 WKWebView 对跨源 sandbox 更苛刻，不补 allow-same-origin 时，脚本型 HTML 容易直接白屏。
    if (previewUrl.origin !== window.location.origin) {
      return CROSS_ORIGIN_HTML_PREVIEW_SANDBOX;
    }
  } catch {
    return DEFAULT_HTML_PREVIEW_SANDBOX;
  }

  return DEFAULT_HTML_PREVIEW_SANDBOX;
}

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

function HtmlPreview({
  src,
  workspaceId,
  filePath,
  overviewMarkers,
  overviewTotalLines
}: {
  src: string | null;
  workspaceId: string | null | undefined;
  filePath: string;
  overviewMarkers: FileOverviewMarker[];
  overviewTotalLines: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!src || !workspaceId) {
      return;
    }

    const bridge = createHtmlPreviewWorkspaceBridge({
      iframe: frameRef.current,
      workspaceId
    });

    function handleMessage(event: MessageEvent) {
      void bridge.onMessage(event);
    }

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      bridge.dispose();
    };
  }, [src, workspaceId]);

  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerHtmlPreviewUnavailable")}</p>;
  }

  const sandbox = resolveHtmlPreviewSandbox(src);

  return (
    <PreviewOverviewShell
      overviewMarkers={overviewMarkers}
      overviewTotalLines={overviewTotalLines}
      scrollContainerRef={scrollContainerRef}
    >
      <div className="file-viewer-html-frame-shell" ref={scrollContainerRef}>
        <iframe
          ref={frameRef}
          key={src}
          className="file-viewer-html-frame"
          data-testid="file-viewer-html-preview"
          title={filePath}
          src={src}
          sandbox={sandbox}
        />
      </div>
    </PreviewOverviewShell>
  );
}

function PreviewOverviewShell({
  children,
  overviewMarkers,
  overviewTotalLines,
  scrollContainerRef
}: {
  children: ReactNode;
  overviewMarkers: FileOverviewMarker[];
  overviewTotalLines: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const diffKind = resolvePreviewDiffKind(overviewMarkers);

  return (
    <div className="file-viewer-preview-overview-shell">
      {children}
      {diffKind ? (
        <div className="file-viewer-preview-diff-badge" data-kind={diffKind}>
          {diffKind === "modify"
            ? t("conversation.fileViewerDiffModified")
            : t("conversation.fileViewerDiffAdded")}
        </div>
      ) : null}
      <OverviewRuler
        markers={overviewMarkers}
        totalLines={overviewTotalLines}
        scrollContainerRef={scrollContainerRef}
        hideWithoutMarkers
      />
    </div>
  );
}

function resolvePreviewDiffKind(markers: FileOverviewMarker[]): FileOverviewMarker["kind"] | null {
  if (markers.some((marker) => marker.kind === "modify")) {
    return "modify";
  }

  if (markers.some((marker) => marker.kind === "add")) {
    return "add";
  }

  return null;
}

function EditModeLayout(input: {
  content: string;
  language: string;
  onContentChange: (content: string) => void;
}) {
  return (
    <CodePreview
      content={input.content}
      language={input.language}
      overviewMarkers={[]}
      overviewTotalLines={Math.max(1, input.content.split(/\r?\n/).length)}
      editable
      onContentChange={input.onContentChange}
    />
  );
}

function ImagePreview({
  src,
  filePath,
  scale,
  scaleMode,
  overviewMarkers,
  overviewTotalLines
}: {
  src: string | null;
  filePath: string;
  scale: number;
  scaleMode: ImageScaleMode;
  overviewMarkers: FileOverviewMarker[];
  overviewTotalLines: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerImageUnavailable")}</p>;
  }

  return (
    <PreviewOverviewShell
      overviewMarkers={overviewMarkers}
      overviewTotalLines={overviewTotalLines}
      scrollContainerRef={scrollContainerRef}
    >
      <div className="file-viewer-media-shell" data-mode={scaleMode} ref={scrollContainerRef}>
        <div className="file-viewer-image-stage">
          <img
            className="file-viewer-image"
            data-testid="file-viewer-image-preview"
            data-mode={scaleMode}
            src={src}
            alt={filePath}
            style={scaleMode === "fit" ? undefined : { transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </PreviewOverviewShell>
  );
}

function PdfPreview({
  src,
  filePath,
  overviewMarkers,
  overviewTotalLines
}: {
  src: string | null;
  filePath: string;
  overviewMarkers: FileOverviewMarker[];
  overviewTotalLines: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerPdfUnavailable")}</p>;
  }

  return (
    <PreviewOverviewShell
      overviewMarkers={overviewMarkers}
      overviewTotalLines={overviewTotalLines}
      scrollContainerRef={scrollContainerRef}
    >
      <div className="file-viewer-pdf-shell" ref={scrollContainerRef}>
        <iframe
          key={src}
          className="file-viewer-pdf-frame"
          data-testid="file-viewer-pdf-preview"
          title={filePath}
          src={src}
        />
      </div>
    </PreviewOverviewShell>
  );
}

function MarkdownPreview({
  content,
  overviewMarkers,
  overviewTotalLines
}: {
  content: string;
  overviewMarkers: FileOverviewMarker[];
  overviewTotalLines: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const markdownDiffIndex = useMemo(
    () => buildMarkdownDiffIndex(overviewMarkers),
    [overviewMarkers]
  );
  const markdownComponents = useMemo(
    () => buildMarkdownComponents(markdownDiffIndex),
    [markdownDiffIndex]
  );

  return (
    <PreviewOverviewShell
      overviewMarkers={overviewMarkers}
      overviewTotalLines={overviewTotalLines}
      scrollContainerRef={scrollContainerRef}
    >
      <div className="markdown-content file-viewer-markdown" ref={scrollContainerRef}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </Markdown>
      </div>
    </PreviewOverviewShell>
  );
}

type MarkdownSourceNode = {
  position?: {
    start?: { line?: number | null };
    end?: { line?: number | null };
  } | null;
};

interface MarkdownDiffRange {
  start: number;
  end: number;
  kind: FileOverviewMarker["kind"];
}

interface MarkdownDiffIndex {
  ranges: MarkdownDiffRange[];
}

function buildMarkdownDiffIndex(markers: FileOverviewMarker[]): MarkdownDiffIndex {
  return {
    ranges: markers
      .map((marker) => ({
        start: marker.line,
        end: marker.line + marker.span - 1,
        kind: marker.kind
      }))
      .sort((left, right) => left.start - right.start)
  };
}

function buildMarkdownComponents(diffIndex: MarkdownDiffIndex): Components {
  return {
    h1(props) {
      const { node, className, ...rest } = props;
      return <h1 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    h2(props) {
      const { node, className, ...rest } = props;
      return <h2 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    h3(props) {
      const { node, className, ...rest } = props;
      return <h3 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    h4(props) {
      const { node, className, ...rest } = props;
      return <h4 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    h5(props) {
      const { node, className, ...rest } = props;
      return <h5 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    h6(props) {
      const { node, className, ...rest } = props;
      return <h6 {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    p(props) {
      const { node, className, ...rest } = props;
      return <p {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    li(props) {
      const { node, className, ...rest } = props;
      return <li {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    blockquote(props) {
      const { node, className, ...rest } = props;
      return <blockquote {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    table(props) {
      const { node, className, ...rest } = props;
      return <table {...rest} className={buildMarkdownDiffClass(className, node, diffIndex)} />;
    },
    pre(props) {
      const { node, className } = props;
      const blockProps = extractCodeBlockProps(props.children);

      if (!blockProps) {
        return <pre className={buildMarkdownDiffClass(className, node, diffIndex)}>{props.children}</pre>;
      }

      return (
        <MarkdownCopyBlock
          content={blockProps.content}
          language={blockProps.language}
          codeClassName={blockProps.codeClassName}
          changeKind={resolveMarkdownNodeChangeKind(node, diffIndex)}
        />
      );
    },
    code(props) {
      const codeClassName = typeof props.className === "string" ? props.className : "";
      return <code className={codeClassName || undefined}>{props.children}</code>;
    }
  };
}

function buildMarkdownDiffClass(
  className: unknown,
  node: MarkdownSourceNode | undefined,
  diffIndex: MarkdownDiffIndex
): string | undefined {
  const normalizedClassName = typeof className === "string" ? className : "";
  const changeKind = resolveMarkdownNodeChangeKind(node, diffIndex);

  return mergeClassNames(
    normalizedClassName,
    changeKind ? "markdown-diff-block" : null,
    changeKind ? `diff-block-${changeKind}` : null
  );
}

function resolveMarkdownNodeChangeKind(
  node: MarkdownSourceNode | undefined,
  diffIndex: MarkdownDiffIndex
): FileOverviewMarker["kind"] | null {
  const startLine = node?.position?.start?.line;
  const endLine = node?.position?.end?.line;

  if (!startLine || !endLine) {
    return null;
  }

  let hasAdd = false;
  const firstCandidateIndex = findFirstPotentiallyOverlappingRangeIndex(diffIndex.ranges, startLine);

  for (let index = firstCandidateIndex; index < diffIndex.ranges.length; index += 1) {
    const range = diffIndex.ranges[index];

    if (!range || range.start > endLine) {
      break;
    }

    const overlaps = range.end >= startLine;

    if (!overlaps) {
      continue;
    }

    if (range.kind === "modify") {
      return "modify";
    }

    hasAdd = true;
  }

  return hasAdd ? "add" : null;
}

function findFirstPotentiallyOverlappingRangeIndex(ranges: MarkdownDiffRange[], startLine: number): number {
  let low = 0;
  let high = ranges.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];

    if (range && range.end < startLine) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function CodePreview({
  content,
  language,
  overviewMarkers = [],
  overviewTotalLines,
  editable = false,
  onContentChange
}: {
  content: string;
  language: string;
  overviewMarkers?: FileOverviewMarker[];
  overviewTotalLines: number;
  editable?: boolean;
  onContentChange?: (content: string) => void;
}) {
  const lines = content.split(/\r?\n/);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const lineChangeMap = useMemo(() => {
    const map = new Map<number, "add" | "modify">();
    for (const marker of overviewMarkers) {
      for (let i = 0; i < marker.span; i++) {
        map.set(marker.line + i, marker.kind);
      }
    }
    return map;
  }, [overviewMarkers]);

  return (
    <div className="file-viewer-code-block">
      <div className="file-viewer-code-header">
        <span className="file-viewer-code-header-label">{formatLanguageLabel(language)}</span>
        <CopyBlockButton content={content} />
      </div>
      <div className="file-viewer-scroll-shell">
        <div className="file-viewer-code-body" data-editable={editable ? "true" : undefined} ref={bodyRef}>
          {editable ? (
            <EditableCodeContent
              content={content}
              language={language}
              onContentChange={onContentChange}
              lineChangeMap={lineChangeMap}
            />
          ) : (
            lines.map((line, index) => {
              const tokens = tokenizeLine(line, language);
              const lineNo = index + 1;
              const changeKind = lineChangeMap.get(lineNo);

              return (
                <div
                  key={`${index}-${line}`}
                  className={`file-viewer-code-line${changeKind ? ` diff-line-${changeKind}` : ""}`}
                >
                  <span className="file-viewer-code-gutter">{lineNo}</span>
                  <code className="file-viewer-code-content">
                    {tokens.length ? (
                      tokens.map((token, tokenIndex) => (
                        <span
                          key={`${index}-${tokenIndex}-${token.text}`}
                          className={`code-token ${token.kind}`}
                        >
                          {token.text}
                        </span>
                      ))
                    ) : (
                      <span className="code-token plain"> </span>
                    )}
                  </code>
                </div>
              );
            })
          )}
        </div>
        <OverviewRuler
          markers={overviewMarkers}
          totalLines={overviewTotalLines}
          scrollContainerRef={bodyRef}
        />
      </div>
    </div>
  );
}

function EditableCodeContent({
  content,
  language,
  onContentChange,
  lineChangeMap
}: {
  content: string;
  language: string;
  onContentChange?: (content: string) => void;
  lineChangeMap: Map<number, "add" | "modify">;
}) {
  const renderRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  useLayoutEffect(() => {
    const renderElement = renderRef.current;

    if (!renderElement) {
      return;
    }

    let frameId = 0;

    const measureTarget = renderElement;

    function measureLineHeights() {
      const nextHeights = Array.from(
        measureTarget.querySelectorAll<HTMLElement>("[data-editor-line-index]")
      ).map((lineElement) => Math.max(24, Math.ceil(lineElement.getBoundingClientRect().height)));

      setLineHeights((previousHeights) => {
        if (previousHeights.length === nextHeights.length
          && previousHeights.every((height, index) => height === nextHeights[index])) {
          return previousHeights;
        }

        return nextHeights;
      });
    }

    const animationFrame = globalThis.window;

    function requestMeasure() {
      if (!animationFrame) {
        measureLineHeights();
        return;
      }

      animationFrame.cancelAnimationFrame(frameId);
      frameId = animationFrame.requestAnimationFrame(measureLineHeights);
    }

    requestMeasure();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestMeasure);
    resizeObserver?.observe(measureTarget);

    return () => {
      animationFrame?.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [content, language]);

  function handleScroll(event: React.UIEvent<HTMLTextAreaElement>) {
    const renderElement = renderRef.current;
    const gutterElement = gutterRef.current;

    if (!renderElement) {
      return;
    }

    renderElement.scrollTop = event.currentTarget.scrollTop;
    renderElement.scrollLeft = event.currentTarget.scrollLeft;

    if (gutterElement) {
      gutterElement.scrollTop = event.currentTarget.scrollTop;
    }
  }

  const lines = content.split(/\r?\n/);

  return (
    <div className="file-viewer-code-editor-shell">
      <div
        ref={gutterRef}
        className="file-viewer-code-editor-gutter"
        aria-hidden="true"
      >
        {lines.map((line, index) => {
          const lineNo = index + 1;
          const changeKind = lineChangeMap.get(lineNo);

          return (
            <div
              key={`gutter-${index}-${line}`}
              className={`file-viewer-code-editor-gutter-line${changeKind ? ` diff-line-${changeKind}` : ""}`}
              style={lineHeights[index] ? { height: `${lineHeights[index]}px` } : undefined}
            >
              <span className="file-viewer-code-gutter">{lineNo}</span>
            </div>
          );
        })}
      </div>
      <div className="file-viewer-code-editor-pane">
      <div
        ref={renderRef}
        className="file-viewer-code-editor-render"
        data-testid="file-viewer-inline-render"
        aria-hidden="true"
      >
        {lines.map((line, index) => {
          const tokens = tokenizeLine(line, language);
          const lineNo = index + 1;
          const changeKind = lineChangeMap.get(lineNo);

          return (
            <div
              key={`${index}-${line}`}
              className={`file-viewer-code-editor-line${changeKind ? ` diff-line-${changeKind}` : ""}`}
              data-editor-line-index={index}
            >
              <code className="file-viewer-code-content">
                {tokens.length ? (
                  tokens.map((token, tokenIndex) => (
                    <span
                      key={`${index}-${tokenIndex}-${token.text}`}
                      className={`code-token ${token.kind}`}
                    >
                      {token.text}
                    </span>
                  ))
                ) : (
                  <span className="code-token plain"> </span>
                )}
              </code>
            </div>
          );
        })}
      </div>
      <textarea
        className="file-viewer-editor file-viewer-code-editor-input"
        data-testid="file-viewer-editor"
        value={content}
        onChange={(event) => onContentChange?.(event.target.value)}
        onScroll={handleScroll}
        spellCheck={false}
      />
      </div>
    </div>
  );
}

function MarkdownCopyBlock({
  content,
  language,
  codeClassName,
  changeKind = null
}: {
  content: string;
  language: string | null;
  codeClassName?: string;
  changeKind?: FileOverviewMarker["kind"] | null;
}) {
  const normalizedLanguage = language ? normalizeLanguage(language) : null;

  return (
    <div
      className={mergeClassNames(
        "file-viewer-markdown-copy-block",
        changeKind ? "markdown-diff-block" : null,
        changeKind ? `diff-block-${changeKind}` : null
      )}
    >
      <div className="file-viewer-markdown-copy-header">
        <span className="file-viewer-markdown-copy-label">
          {normalizedLanguage ? formatLanguageLabel(normalizedLanguage) : t("conversation.fileViewerPlainText")}
        </span>
        <CopyBlockButton content={content} />
      </div>
      <pre className={codeClassName}>
        <code>{content}</code>
      </pre>
    </div>
  );
}

function mergeClassNames(...classNames: Array<string | null | undefined>): string | undefined {
  const mergedClassName = classNames.filter(Boolean).join(" ");
  return mergedClassName || undefined;
}

function CopyBlockButton({ content }: { content: string }) {
  const { showToast } = useToast();
  const platform = usePlatform();
  const [copying, setCopying] = useState(false);

  if (!content.trim()) {
    return null;
  }

  async function handleCopy() {
    if (copying) {
      return;
    }

    setCopying(true);

    try {
      await writeTextToClipboard(content, platform);
      showToast({
        title: t("conversation.copyContentSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.copyContentFailed"),
        tone: "error"
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <button
      type="button"
      className="file-viewer-copy-button"
      aria-label={t("conversation.copyAction")}
      title={t("conversation.copyAction")}
      onClick={() => void handleCopy()}
      disabled={copying}
    >
      <CopyIcon />
    </button>
  );
}

function flattenReactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((item) => flattenReactNodeText(item)).join("");
  }

  if (isValidElement(node)) {
    return flattenReactNodeText(node.props?.children ?? "");
  }

  return "";
}

function extractCodeBlockProps(node: ReactNode): {
  content: string;
  codeClassName?: string;
  language: string | null;
} | null {
  const candidate = Array.isArray(node) ? node[0] : node;

  if (!isValidElement(candidate)) {
    return null;
  }

  const props = candidate.props as {
    className?: string;
    children?: ReactNode;
  };
  const codeClassName = typeof props.className === "string" ? props.className : "";
  const match = /language-([^\s]+)/.exec(codeClassName);

  return {
    content: flattenReactNodeText(props.children).replace(/\n$/, ""),
    codeClassName: codeClassName || undefined,
    language: match?.[1] ?? null
  };
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function writeTextToClipboard(
  text: string,
  platform: ReturnType<typeof usePlatform>
): Promise<void> {
  if (platform.isDesktop) {
    const desktopResult = await platform.bridge.writeClipboardText(text);

    if (desktopResult.ok) {
      return;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView/权限场景会拒绝异步剪贴板，继续回退到同步兼容路径。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("conversation.copyContentFailed"));
}

function tokenizeLine(line: string, language: string): CodeToken[] {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === "json") {
    return tokenizeJsonLine(line);
  }

  if (normalizedLanguage === "yaml") {
    return tokenizeYamlLine(line);
  }

  if (normalizedLanguage === "toml") {
    return tokenizeTomlLine(line);
  }

  if (normalizedLanguage === "ini") {
    return tokenizeIniLine(line);
  }

  if (normalizedLanguage === "env") {
    return tokenizeEnvLine(line);
  }

  if (normalizedLanguage === "properties") {
    return tokenizePropertiesLine(line);
  }

  if (normalizedLanguage === "conf") {
    return tokenizeConfLine(line);
  }

  if (normalizedLanguage === "editorconfig") {
    return tokenizeEditorConfigLine(line);
  }

  if (normalizedLanguage === "dockerfile") {
    return tokenizeDockerfileLine(line);
  }

  if (normalizedLanguage === "gitignore") {
    return tokenizeGitIgnoreLine(line);
  }

  if (normalizedLanguage === "log") {
    return tokenizeLogLine(line);
  }

  if (normalizedLanguage === "python") {
    return tokenizeWithWordSet(line, PYTHON_KEYWORDS, "#");
  }

  if (normalizedLanguage === "shell") {
    return tokenizeWithWordSet(line, SHELL_KEYWORDS, "#");
  }

  if (normalizedLanguage === "sql") {
    return tokenizeSqlLine(line);
  }

  if (normalizedLanguage === "html" || normalizedLanguage === "xml") {
    return tokenizeMarkupLine(line);
  }

  if (normalizedLanguage === "css") {
    return tokenizeCssLine(line);
  }

  if (normalizedLanguage === "markdown") {
    return [{ text: line, kind: "plain" }];
  }

  return tokenizeWithWordSet(line, SCRIPT_KEYWORDS, "//");
}

function tokenizeWithWordSet(line: string, keywords: ReadonlySet<string>, commentPrefix: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith(commentPrefix)) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const stringMatch = /^(?:'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const wordMatch = /^[A-Za-z_][\w$-]*/.exec(rest);

    if (wordMatch) {
      const word = wordMatch[0];
      const lowerWord = word.toLowerCase();

      if (word === "true" || word === "false" || lowerWord === "true" || lowerWord === "false") {
        tokens.push({ text: word, kind: "boolean" });
      } else if (word === "null" || word === "None" || lowerWord === "none") {
        tokens.push({ text: word, kind: "null" });
      } else if (keywords.has(word) || keywords.has(lowerWord)) {
        tokens.push({ text: word, kind: "keyword" });
      } else {
        tokens.push({ text: word, kind: "plain" });
      }

      index += word.length;
      continue;
    }

    const operatorMatch = /^(?:===|!==|==|!=|<=|>=|=>|&&|\|\||[+\-*/%=<>!?:|&^~]+)/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeJsonLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);
    const stringMatch = /^"(?:[^"\\]|\\.)*"/.exec(rest);

    if (stringMatch) {
      const nextChar = line.slice(index + stringMatch[0].length).trimStart()[0];
      tokens.push({
        text: stringMatch[0],
        kind: nextChar === ":" ? "attr" : "string"
      });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const literalMatch = /^(?:true|false|null)\b/.exec(rest);

    if (literalMatch) {
      const kind = literalMatch[0] === "null" ? "null" : "boolean";
      tokens.push({ text: literalMatch[0], kind });
      index += literalMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?::|,|\{|\}|\[|\])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeMarkupLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("<!--")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const tagMatch = /^(<\/?[\w:-]+)/.exec(rest);

    if (tagMatch) {
      tokens.push({ text: tagMatch[0], kind: "tag" });
      index += tagMatch[0].length;
      continue;
    }

    const attrMatch = /^([\w:-]+)(=)/.exec(rest);

    if (attrMatch) {
      tokens.push({ text: attrMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: attrMatch[2] ?? "", kind: "operator" });
      index += attrMatch[0].length;
      continue;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:\/?>)/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeCssLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("/*")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const attrMatch = /^([A-Za-z-]+)(\s*:)/.exec(rest);

    if (attrMatch) {
      tokens.push({ text: attrMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: attrMatch[2] ?? "", kind: "operator" });
      index += attrMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:#(?:[\da-fA-F]{3,8})|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const keywordMatch = /^(?:@media|@supports|@import|@keyframes)\b/.exec(rest);

    if (keywordMatch) {
      tokens.push({ text: keywordMatch[0], kind: "keyword" });
      index += keywordMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:[{}:;(),.>])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeSqlLine(line: string): CodeToken[] {
  return tokenizeWithWordSet(line, SQL_KEYWORDS, "--");
}

function tokenizeYamlLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*:)/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:-?\d+(?:\.\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const literalMatch = /^(?:true|false|yes|no|null|~)\b/i.exec(rest);

    if (literalMatch) {
      const lowerLiteral = literalMatch[0].toLowerCase();
      const kind: TokenKind =
        lowerLiteral === "null" || lowerLiteral === "~" ? "null" : "boolean";
      tokens.push({ text: literalMatch[0], kind });
      index += literalMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:[-?:,[\]{}|>])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeTomlLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const sectionMatch = /^(\[\[?[^\]]+\]?\])/.exec(rest);

    if (sectionMatch) {
      tokens.push({ text: sectionMatch[0], kind: "tag" });
      index += sectionMatch[0].length;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*=)/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true"],
      falseValues: ["false"],
      nullValues: []
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    const operatorMatch = /^(?:[,[\]{}])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeIniLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);
    const trimmedRest = rest.trimStart();

    if (trimmedRest.startsWith(";") || trimmedRest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const sectionMatch = /^(\[[^\]]+\])/.exec(rest);

    if (sectionMatch) {
      tokens.push({ text: sectionMatch[0], kind: "tag" });
      index += sectionMatch[0].length;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*[=:])/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true", "yes", "on"],
      falseValues: ["false", "no", "off"],
      nullValues: ["null"]
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeEnvLine(line: string): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (trimmedLine.startsWith("#")) {
    return [{ text: line, kind: "comment" }];
  }

  const exportMatch = /^(\s*)(export)(\s+)/.exec(line);
  const keyStart = exportMatch ? exportMatch[0].length : 0;
  const tokens: CodeToken[] = [];

  if (exportMatch) {
    tokens.push({ text: exportMatch[1] ?? "", kind: "plain" });
    tokens.push({ text: exportMatch[2] ?? "", kind: "keyword" });
    tokens.push({ text: exportMatch[3] ?? "", kind: "plain" });
  }

  const rest = line.slice(keyStart);
  const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)(=)/.exec(rest);

  if (!keyMatch) {
    return tokenizeIniLine(line);
  }

  tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
  tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });

  const valueText = rest.slice(keyMatch[0].length);
  const valueTokens = readConfigScalar(valueText, {
    trueValues: ["true"],
    falseValues: ["false"],
    nullValues: ["null"]
  });

  if (valueTokens) {
    tokens.push(...valueTokens.tokens);
    return tokens;
  }

  tokens.push({ text: valueText, kind: "plain" });
  return tokens;
}

function tokenizePropertiesLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", "!"],
    allowSection: false,
    delimiters: ["=", ":"]
  });
}

function tokenizeConfLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", ";"],
    allowSection: true,
    delimiters: ["=", ":"]
  });
}

function tokenizeEditorConfigLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", ";"],
    allowSection: true,
    delimiters: ["="]
  });
}

function tokenizeDockerfileLine(line: string): CodeToken[] {
  return tokenizeWithWordSet(line, DOCKERFILE_KEYWORDS, "#");
}

function tokenizeGitIgnoreLine(line: string): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (!trimmedLine) {
    return [];
  }

  if (trimmedLine.startsWith("#")) {
    return [{ text: line, kind: "comment" }];
  }

  if (trimmedLine.startsWith("!")) {
    const leadingWhitespaceLength = line.length - trimmedLine.length;
    const leadingWhitespace = line.slice(0, leadingWhitespaceLength);
    const pattern = trimmedLine.slice(1);

    return [
      { text: leadingWhitespace, kind: "plain" },
      { text: "!", kind: "operator" },
      { text: pattern, kind: "string" }
    ];
  }

  return [{ text: line, kind: "string" }];
}

function tokenizeLogLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const timestampMatch =
      /^(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3,6})?(?:Z|[+-]\d{2}:\d{2})?)/.exec(rest);

    if (timestampMatch) {
      tokens.push({ text: timestampMatch[0], kind: "tag" });
      index += timestampMatch[0].length;
      continue;
    }

    const bracketLevelMatch = /^(?:\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\])/.exec(rest);

    if (bracketLevelMatch) {
      tokens.push({ text: rest.slice(0, bracketLevelMatch[0].length), kind: "keyword" });
      index += bracketLevelMatch[0].length;
      continue;
    }

    const wordMatch = /^[A-Za-z_][\w-]*/.exec(rest);

    if (wordMatch) {
      const word = wordMatch[0];

      if (LOG_LEVELS.has(word.toLowerCase())) {
        tokens.push({ text: word, kind: "keyword" });
      } else {
        tokens.push({ text: word, kind: "plain" });
      }

      index += word.length;
      continue;
    }

    const numberMatch = /^(?:\d+(?:\.\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeConfigEntryLine(
  line: string,
  options: {
    commentPrefixes: string[];
    allowSection: boolean;
    delimiters: string[];
  }
): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (options.commentPrefixes.some((prefix) => trimmedLine.startsWith(prefix))) {
    return [{ text: line, kind: "comment" }];
  }

  if (options.allowSection) {
    const sectionMatch = /^(\[[^\]]+\])/.exec(line);

    if (sectionMatch) {
      return [{ text: sectionMatch[0], kind: "tag" }];
    }
  }

  const keyMatch = /^([A-Za-z0-9_.\-*?]+)(\s*(?:=|:))/.exec(line);

  if (!keyMatch) {
    return [{ text: line, kind: "plain" }];
  }

  const delimiter = (keyMatch[2] ?? "").trim();

  if (!options.delimiters.includes(delimiter)) {
    return [{ text: line, kind: "plain" }];
  }

  const tokens: CodeToken[] = [
    { text: keyMatch[1] ?? "", kind: "attr" },
    { text: keyMatch[2] ?? "", kind: "operator" }
  ];
  const valueText = line.slice(keyMatch[0].length);
  const valueTokens = tokenizeConfigValue(valueText);

  if (valueTokens.length) {
    tokens.push(...valueTokens);
  }

  return tokens;
}

function tokenizeConfigValue(text: string): CodeToken[] {
  if (!text) {
    return [];
  }

  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < text.length) {
    const rest = text.slice(index);
    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true", "yes", "on"],
      falseValues: ["false", "no", "off"],
      nullValues: ["null"]
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    if (rest.startsWith("#") || rest.startsWith(";")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function readConfigScalar(
  text: string,
  literals: {
    trueValues: string[];
    falseValues: string[];
    nullValues: string[];
  }
): { tokens: CodeToken[]; length: number } | null {
  const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(text);

  if (stringMatch) {
    return {
      tokens: [{ text: stringMatch[0], kind: "string" }],
      length: stringMatch[0].length
    };
  }

  const numberMatch = /^(?:-?\d+(?:\.\d+)?)/.exec(text);

  if (numberMatch) {
    return {
      tokens: [{ text: numberMatch[0], kind: "number" }],
      length: numberMatch[0].length
    };
  }

  const wordMatch = /^[A-Za-z0-9_.:+/-]+/.exec(text);

  if (!wordMatch) {
    return null;
  }

  const word = wordMatch[0];
  const lowerWord = word.toLowerCase();

  if (literals.trueValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "boolean" }],
      length: word.length
    };
  }

  if (literals.falseValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "boolean" }],
      length: word.length
    };
  }

  if (literals.nullValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "null" }],
      length: word.length
    };
  }

  return {
    tokens: [{ text: word, kind: "plain" }],
    length: word.length
  };
}

function detectLanguage(filePath: string | null): string {
  if (!filePath) {
    return "plain";
  }

  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "env";
  }

  if (fileName === ".editorconfig") {
    return "editorconfig";
  }

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "dockerfile";
  }

  if (fileName === ".gitignore") {
    return "gitignore";
  }

  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";

  switch (extension) {
    case "md":
    case "markdown":
      return "markdown";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "log":
      return "log";
    case "properties":
      return "properties";
    case "toml":
      return "toml";
    case "ini":
      return "ini";
    case "conf":
      return "conf";
    case "dockerfile":
      return "dockerfile";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "xml":
    case "svg":
      return "xml";
    case "py":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "yml":
    case "yaml":
      return "yaml";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "hpp":
      return "cpp";
    default:
      return "plain";
  }
}

function normalizeLanguage(language: string): string {
  const lowerLanguage = language.toLowerCase();

  switch (lowerLanguage) {
    case "ts":
    case "tsx":
    case "typescript":
      return "typescript";
    case "js":
    case "jsx":
    case "javascript":
      return "javascript";
    case "bash":
    case "shell":
    case "sh":
    case "zsh":
      return "shell";
    case "md":
    case "markdown":
      return "markdown";
    case "properties":
      return "properties";
    case "toml":
      return "toml";
    case "ini":
      return "ini";
    case "env":
      return "env";
    case "conf":
      return "conf";
    case "editorconfig":
      return "editorconfig";
    case "dockerfile":
      return "dockerfile";
    case "gitignore":
      return "gitignore";
    case "log":
      return "log";
    default:
      return lowerLanguage;
  }
}

function formatLanguageLabel(language: string): string {
  const normalizedLanguage = normalizeLanguage(language);

  switch (normalizedLanguage) {
    case "typescript":
      return "TypeScript";
    case "javascript":
      return "JavaScript";
    case "markdown":
      return "Markdown";
    case "json":
      return "JSON";
    case "properties":
      return "Properties";
    case "toml":
      return "TOML";
    case "ini":
      return "INI";
    case "env":
      return "ENV";
    case "conf":
      return "CONF";
    case "editorconfig":
      return "EditorConfig";
    case "dockerfile":
      return "Dockerfile";
    case "gitignore":
      return "GitIgnore";
    case "log":
      return "Log";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "xml":
      return "XML";
    case "python":
      return "Python";
    case "shell":
      return "Shell";
    case "sql":
      return "SQL";
    case "yaml":
      return "YAML";
    case "rust":
      return "Rust";
    case "go":
      return "Go";
    case "java":
      return "Java";
    case "cpp":
      return "C/C++";
    default:
      return t("conversation.fileViewerPlainText");
  }
}

function isMarkdownFile(filePath: string) {
  return detectLanguage(filePath) === "markdown";
}

function isHtmlFile(filePath: string) {
  return detectLanguage(filePath) === "html";
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 2.5h7.5v9H5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 5H2.4V13.5H10V12.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
}

async function waitForPresentationExportTask(taskId: string): Promise<PresentationExportTaskInfo> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 60_000) {
    const task = await getPresentationExportTask(taskId);

    if (task.status === "queued" || task.status === "running") {
      await delay(800);
      continue;
    }

    return task;
  }

  throw new ApiError(408, {
    detail: t("conversation.fileViewerExportTaskTimeout"),
    error_code: "PRESENTATION_EXPORT_TIMEOUT"
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// ==================== Git Diff 解析与渲染 ====================

interface GitDiffLine {
  kind: "context" | "add" | "remove" | "hunk" | "meta";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

interface FileOverviewMarker {
  line: number;
  span: number;
  kind: "add" | "modify";
}

function parseGitDiffContent(content: string): GitDiffLine[] {
  const lines: GitDiffLine[] = [];
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of rawLines) {
    // diff header lines
    if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ") || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      lines.push({ kind: "meta", text: rawLine, oldLineNo: null, newLineNo: null });
      continue;
    }

    // hunk header
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      lines.push({ kind: "hunk", text: rawLine, oldLineNo: null, newLineNo: null });
      continue;
    }

    // context line
    if (rawLine.startsWith(" ") || rawLine === "") {
      lines.push({ kind: "context", text: rawLine.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
      continue;
    }

    // added line
    if (rawLine.startsWith("+")) {
      lines.push({ kind: "add", text: rawLine.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
      continue;
    }

    // removed line
    if (rawLine.startsWith("-")) {
      lines.push({ kind: "remove", text: rawLine.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
      continue;
    }

    // 其他行（如 No newline at end of file）
    lines.push({ kind: "meta", text: rawLine, oldLineNo: null, newLineNo: null });
  }

  return lines;
}

function buildFileOverviewMarkers(diffContent?: string | null): FileOverviewMarker[] {
  if (!diffContent?.trim()) {
    return [];
  }

  const diffLines = parseGitDiffContent(diffContent);
  const markers: FileOverviewMarker[] = [];
  let removedCount = 0;
  let addedLineNumbers: number[] = [];

  function flushGroup() {
    if (addedLineNumbers.length === 0) {
      removedCount = 0;
      return;
    }

    const kind: FileOverviewMarker["kind"] = removedCount > 0 ? "modify" : "add";
    appendOverviewMarkerRanges(markers, addedLineNumbers, kind);
    removedCount = 0;
    addedLineNumbers = [];
  }

  for (const line of diffLines) {
    if (line.kind === "remove") {
      removedCount += 1;
      continue;
    }

    if (line.kind === "add") {
      if (line.newLineNo !== null) {
        addedLineNumbers.push(line.newLineNo);
      }
      continue;
    }

    flushGroup();
  }

  flushGroup();
  return markers;
}

function resolveOverviewTotalLines(content: string, markers: FileOverviewMarker[]): number {
  const contentLineCount = content ? content.split(/\r?\n/).length : 1;
  const diffLineCount = markers.reduce(
    (maxLine, marker) => Math.max(maxLine, marker.line + marker.span - 1),
    0
  );

  return Math.max(contentLineCount, diffLineCount, 1);
}

function appendOverviewMarkerRanges(
  target: FileOverviewMarker[],
  lineNumbers: number[],
  kind: FileOverviewMarker["kind"]
) {
  const sortedLineNumbers = lineNumbers.filter((lineNo) => lineNo > 0);

  if (sortedLineNumbers.length === 0) {
    return;
  }

  let rangeStart = sortedLineNumbers[0] ?? 1;
  let rangeEnd = rangeStart;

  for (let index = 1; index < sortedLineNumbers.length; index += 1) {
    const lineNo = sortedLineNumbers[index] ?? rangeEnd;

    if (lineNo === rangeEnd + 1) {
      rangeEnd = lineNo;
      continue;
    }

    target.push({
      line: rangeStart,
      span: rangeEnd - rangeStart + 1,
      kind
    });
    rangeStart = lineNo;
    rangeEnd = lineNo;
  }

  target.push({
    line: rangeStart,
    span: rangeEnd - rangeStart + 1,
    kind
  });
}

function OverviewRuler({
  markers,
  totalLines,
  scrollContainerRef,
  hideWithoutMarkers = false
}: {
  markers: FileOverviewMarker[];
  totalLines: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  hideWithoutMarkers?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderViewport = !hideWithoutMarkers || markers.length > 0;

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const viewportElement = viewportRef.current;

    if (!scrollContainer || !viewportElement || !shouldRenderViewport) {
      return;
    }

    const activeScrollContainer = scrollContainer;
    const activeViewportElement = viewportElement;
    let animationFrameId: number | null = null;

    function updateViewport() {
      animationFrameId = null;
      const { clientHeight, scrollHeight, scrollTop } = activeScrollContainer;

      if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
        activeViewportElement.style.display = "none";
        return;
      }

      const visibleRatio = clientHeight / scrollHeight;
      const nextHeight = Math.min(100, Math.max(12, visibleRatio * 100));
      const scrollableHeight = scrollHeight - clientHeight;
      const maxTop = Math.max(0, 100 - nextHeight);
      const nextTop = scrollableHeight <= 0 ? 0 : (scrollTop / scrollableHeight) * maxTop;

      activeViewportElement.style.display = "block";
      activeViewportElement.style.top = `${nextTop}%`;
      activeViewportElement.style.height = `${nextHeight}%`;
    }

    function scheduleViewportUpdate() {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(updateViewport);
    }

    updateViewport();
    activeScrollContainer.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
    window.addEventListener("resize", scheduleViewportUpdate);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      activeScrollContainer.removeEventListener("scroll", scheduleViewportUpdate);
      window.removeEventListener("resize", scheduleViewportUpdate);
    };
  }, [scrollContainerRef, shouldRenderViewport]);

  if (hideWithoutMarkers && markers.length === 0) {
    return null;
  }

  const safeTotalLines = Math.max(totalLines, 1);

  return (
    <div className="file-overview-ruler" data-testid="file-overview-ruler" aria-hidden="true">
      {markers.map((marker) => {
        const top = ((marker.line - 1) / safeTotalLines) * 100;
        const height = Math.max(2, (marker.span / safeTotalLines) * 100);

        return (
          <div
            key={`${marker.kind}-${marker.line}-${marker.span}`}
            className={`file-overview-marker is-${marker.kind}`}
            data-kind={marker.kind}
            style={{ top: `${top}%`, height: `${height}%` }}
          />
        );
      })}
      {shouldRenderViewport ? (
        <div
          ref={viewportRef}
          className="file-overview-viewport"
        />
      ) : null}
    </div>
  );
}

function downloadBlob(fileName: string, blob: Blob): void {
  if (typeof document === "undefined") {
    throw new Error(t("conversation.filePanelDownloadFailed"));
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}
