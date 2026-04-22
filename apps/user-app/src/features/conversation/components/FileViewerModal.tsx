import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  DesktopModal,
  type DesktopModalSizePreset
} from "../../../components/DesktopModal";
import { getHostBaseUrl, getHostRequestUrl } from "../../../config/env";
import { resolveHostTransportTarget } from "../../../network/host-transport-registry";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  getFilePreview,
  saveFileContent,
  type FilePreviewDto
} from "../api/file-context-api";

interface FileViewerModalProps {
  workspaceId: string | null | undefined;
  filePath: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (filePath: string) => Promise<void> | void;
  diffContent?: string | null;
}

type ViewerMode = "preview" | "code" | "edit";
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

export function FileViewerModal({
  workspaceId,
  filePath,
  open,
  onClose,
  onSaved,
  diffContent
}: FileViewerModalProps) {
  const [preview, setPreview] = useState<FilePreviewDto | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const previewKind = preview?.kind ?? null;
  const canEdit = Boolean(preview?.capabilities?.canEdit);
  const canRefresh = Boolean(preview?.capabilities?.canRefresh);
  const viewerLabel = resolveViewerLabel(previewKind, detectedLanguage);
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
  const isDirty = canEdit && editorContent !== currentContent;
  const canShowPreviewTab = canUsePreviewMode(previewKind);
  const canShowCodeTab = canUseCodeMode(previewKind);

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
      setLoading(false);
      setSaving(false);
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
      await saveFileContent(safeWorkspaceId, safeFilePath, editorContent, preview.version);
      const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);
      applyPreviewState(nextPreview, safeFilePath, {
        preserveMode: false,
        setPreview,
        setEditorContent,
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

  const viewerTabs = buildViewerTabs({
    canShowPreviewTab,
    canShowCodeTab,
    canEdit
  });
  const formatActions = buildFormatActions({
    preview,
    canOpenExternal: Boolean(externalPreviewUrl),
    isDirty,
    handleRefreshPreview,
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

  return (
    <DesktopModal
      open={open}
      title={filePath}
      description={t("conversation.fileViewerHint").replace("{language}", viewerLabel)}
      size={modalSizePreset}
      layout="viewer"
      className={`file-viewer-modal${platform.isDesktop && modalSizePreset !== "full" ? " is-resizable" : ""}`}
      bodyClassName="file-viewer-modal-body"
      onClose={onClose}
    >
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-start">
          <div className="file-viewer-tabs" role="tablist" aria-label={t("conversation.fileViewerModeLabel")}>
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
          <span className="file-viewer-language">{viewerLabel}</span>
        </div>
        <div className="file-viewer-toolbar-end">
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
          <div className="file-viewer-actions">
            {formatActions.map((action) => (
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
          </div>
          {canEdit ? (
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
      </div>

      <div className="file-viewer-body">
        {loading ? (
          <p className="status-text">{t("common.loading")}</p>
        ) : preview?.supported === false ? (
          <p className="status-text">{preview.reason ?? t("conversation.filePanelUnsupported")}</p>
        ) : mode === "edit" ? (
          <textarea
            className="file-viewer-editor"
            data-testid="file-viewer-editor"
            value={editorContent}
            onChange={(event) => setEditorContent(event.target.value)}
            spellCheck={false}
          />
        ) : mode === "preview" && previewKind === "html" ? (
          <HtmlPreview src={htmlPreviewUrl} filePath={filePath} />
        ) : mode === "preview" && previewKind === "image" ? (
          <ImagePreview
            src={imagePreviewUrl}
            filePath={filePath}
            scale={imageScale}
            scaleMode={imageScaleMode}
          />
        ) : mode === "preview" && previewKind === "pdf" ? (
          <PdfPreview src={pdfPreviewUrl} filePath={filePath} />
        ) : mode === "preview" && previewKind === "markdown" ? (
          <MarkdownPreview content={editorContent} />
        ) : (
          <CodePreview
            content={editorContent}
            language={detectedLanguage}
            overviewMarkers={overviewMarkers}
          />
        )}
      </div>
    </DesktopModal>
  );
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

function canUseMode(mode: ViewerMode, previewKind: FilePreviewDto["kind"] | null): boolean {
  if (mode === "preview") {
    return canUsePreviewMode(previewKind);
  }

  if (mode === "code") {
    return canUseCodeMode(previewKind);
  }

  return canUseCodeMode(previewKind);
}

function buildViewerTabs(input: {
  canShowPreviewTab: boolean;
  canShowCodeTab: boolean;
  canEdit: boolean;
}): ViewerMode[] {
  const tabs: ViewerMode[] = [];

  if (input.canShowPreviewTab) {
    tabs.push("preview");
  }

  if (input.canShowCodeTab) {
    tabs.push("code");
    tabs.push("edit");
  } else if (input.canEdit) {
    tabs.push("edit");
  }

  return tabs;
}

function buildFormatActions(input: {
  preview: FilePreviewDto | null;
  canOpenExternal: boolean;
  isDirty: boolean;
  handleRefreshPreview: () => Promise<void>;
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

  if (input.canOpenExternal) {
    actions.push({
      id: "open-external",
      label: t("conversation.fileViewerOpenExternal"),
      onClick: input.handleOpenExternal
    });
  }

  return actions;
}

function resolveViewerLabel(
  previewKind: FilePreviewDto["kind"] | null,
  detectedLanguage: string
): string {
  switch (previewKind) {
    case "image":
      return t("conversation.fileViewerImage");
    case "pdf":
      return t("conversation.fileViewerPdf");
    case "html":
      return "HTML";
    case "markdown":
      return "Markdown";
    default:
      return formatLanguageLabel(detectedLanguage);
  }
}

function buildResourcePreviewUrl(baseUrl: string | null, refreshVersion: number): string | null {
  if (!baseUrl) {
    return null;
  }

  const nextUrl = new URL(baseUrl, window.location.origin);
  nextUrl.searchParams.set("_preview", String(refreshVersion));
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

  if (!isDesktop && preview.previewPath && typeof window !== "undefined" && window.location?.origin) {
    return new URL(preview.previewPath, window.location.origin).toString();
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

function HtmlPreview({ src, filePath }: { src: string | null; filePath: string }) {
  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerHtmlPreviewUnavailable")}</p>;
  }

  const sandbox = resolveHtmlPreviewSandbox(src);

  return (
    <div className="file-viewer-html-frame-shell">
      <iframe
        key={src}
        className="file-viewer-html-frame"
        data-testid="file-viewer-html-preview"
        title={filePath}
        src={src}
        sandbox={sandbox}
      />
    </div>
  );
}

function ImagePreview({
  src,
  filePath,
  scale,
  scaleMode
}: {
  src: string | null;
  filePath: string;
  scale: number;
  scaleMode: ImageScaleMode;
}) {
  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerImageUnavailable")}</p>;
  }

  return (
    <div className="file-viewer-media-shell" data-mode={scaleMode}>
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
  );
}

function PdfPreview({ src, filePath }: { src: string | null; filePath: string }) {
  if (!src) {
    return <p className="status-text">{t("conversation.fileViewerPdfUnavailable")}</p>;
  }

  return (
    <div className="file-viewer-pdf-shell">
      <iframe
        key={src}
        className="file-viewer-pdf-frame"
        data-testid="file-viewer-pdf-preview"
        title={filePath}
        src={src}
      />
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-content file-viewer-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const codeClassName = typeof props.className === "string" ? props.className : "";
            const match = /language-([\w-]+)/.exec(codeClassName);

            if (match) {
              return (
                <CodePreview
                  content={String(props.children).replace(/\n$/, "")}
                  language={normalizeLanguage(match[1] ?? "plain")}
                />
              );
            }

            return <code className={codeClassName || undefined}>{props.children}</code>;
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function CodePreview({
  content,
  language,
  overviewMarkers = []
}: {
  content: string;
  language: string;
  overviewMarkers?: FileOverviewMarker[];
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
      <div className="file-viewer-code-header">{formatLanguageLabel(language)}</div>
      <div className="file-viewer-scroll-shell">
        <div className="file-viewer-code-body" ref={bodyRef}>
          {lines.map((line, index) => {
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
          })}
        </div>
        <OverviewRuler
          markers={overviewMarkers}
          totalLines={lines.length}
          scrollContainerRef={bodyRef}
        />
      </div>
    </div>
  );
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

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
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
  scrollContainerRef
}: {
  markers: FileOverviewMarker[];
  totalLines: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const [viewport, setViewport] = useState({
    top: 0,
    height: 0
  });

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      setViewport({
        top: 0,
        height: 0
      });
      return;
    }

    const activeScrollContainer = scrollContainer;

    function updateViewport() {
      const { clientHeight, scrollHeight, scrollTop } = activeScrollContainer;

      if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
        setViewport({
          top: 0,
          height: 0
        });
        return;
      }

      const visibleRatio = clientHeight / scrollHeight;
      const nextHeight = Math.min(100, Math.max(12, visibleRatio * 100));
      const scrollableHeight = scrollHeight - clientHeight;
      const maxTop = Math.max(0, 100 - nextHeight);
      const nextTop = scrollableHeight <= 0 ? 0 : (scrollTop / scrollableHeight) * maxTop;

      setViewport({
        top: nextTop,
        height: nextHeight
      });
    }

    updateViewport();
    activeScrollContainer.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);

    return () => {
      activeScrollContainer.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [scrollContainerRef]);

  if (markers.length === 0 && viewport.height === 0) {
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
      {viewport.height > 0 ? (
        <div
          className="file-overview-viewport"
          style={{
            top: `${viewport.top}%`,
            height: `${viewport.height}%`
          }}
        />
      ) : null}
    </div>
  );
}
