import path from "node:path";

export type FilePreviewKind =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "office"
  | "binary"
  | "unsupported";

export interface FilePreviewCapabilities {
  canEdit: boolean;
  canRefresh: boolean;
  canResize: boolean;
  canZoom: boolean;
  canPaginate: boolean;
}

export interface FilePreviewResult {
  workspaceId: string;
  path: string;
  supported: boolean;
  kind: FilePreviewKind;
  reason: string | null;
  content: string | null;
  version: string | null;
  size: number;
  updatedAt: string | null;
  previewPath: string | null;
  previewUrl: string | null;
  onlyOffice: OnlyOfficePreviewPayload | null;
  capabilities: FilePreviewCapabilities;
}

export interface OnlyOfficePreviewPayload {
  apiScriptUrl: string;
  editorMode: "edit" | "view";
  documentUrl: string;
  callbackUrl: string;
  editorConfig: Record<string, unknown>;
}

export interface FilePreviewContentSnapshot {
  content: string;
  version: string | null;
  updatedAt: string | null;
}

const MARKDOWN_FILE_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const HTML_FILE_EXTENSIONS = new Set([".html", ".htm"]);
const IMAGE_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico"
]);
const PDF_FILE_EXTENSIONS = new Set([".pdf"]);
const OFFICE_FILE_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);

export const RESOURCE_PREVIEW_KINDS = new Set<FilePreviewKind>(["html", "image", "pdf", "office"]);

export const PREVIEW_CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".cjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".bmp", "image/bmp"],
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".eot", "application/vnd.ms-fontobject"]
]);

export function detectPreviewKind(filePath: string): FilePreviewKind {
  const extension = path.extname(filePath).toLowerCase();

  if (MARKDOWN_FILE_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (HTML_FILE_EXTENSIONS.has(extension)) {
    return "html";
  }

  if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (PDF_FILE_EXTENSIONS.has(extension)) {
    return "pdf";
  }

  if (OFFICE_FILE_EXTENSIONS.has(extension)) {
    return "office";
  }

  return "text";
}

export function isResourcePreviewKind(kind: FilePreviewKind): boolean {
  return RESOURCE_PREVIEW_KINDS.has(kind);
}

export function resolvePreviewContentType(filePath: string): string | null {
  return PREVIEW_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? null;
}

export function buildPreviewCapabilities(
  kind: FilePreviewKind,
  options: {
    supported: boolean;
    content: string | null;
    version: string | null;
  }
): FilePreviewCapabilities {
  if (!options.supported) {
    return {
      canEdit: false,
      canRefresh: false,
      canResize: false,
      canZoom: false,
      canPaginate: false
    };
  }

  return {
    canEdit: Boolean(
      options.content !== null
      && options.version !== null
      && (kind === "text" || kind === "markdown" || kind === "html")
    ),
    canRefresh: true,
    canResize: true,
    canZoom: kind === "image" || kind === "pdf",
    canPaginate: kind === "pdf"
  };
}
