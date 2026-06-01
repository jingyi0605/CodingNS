export type AffairsDocumentKind =
  | "file"
  | "markdown"
  | "text"
  | "pdf"
  | "word"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "archive"
  | "code"
  | "web"
  | "json"
  | "xml"
  | "yaml"
  | "database"
  | "audio"
  | "video"
  | "design"
  | "font"
  | "ebook";

export type AffairsDocumentTone =
  | "neutral"
  | "slate"
  | "red"
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "amber"
  | "indigo"
  | "cyan"
  | "pink"
  | "violet"
  | "rose"
  | "stone"
  | "teal"
  | "sky"
  | "emerald";

export type AffairsDocumentVisual = {
  extension: string;
  kind: AffairsDocumentKind;
  badge: string;
  tone: AffairsDocumentTone;
};

type AffairsDocumentPreset = Omit<AffairsDocumentVisual, "extension">;

const DOCUMENT_PRESETS: Array<[string[], AffairsDocumentPreset]> = [
  [["md", "mdx"], { kind: "markdown", tone: "emerald", badge: "MD" }],
  [["txt", "text", "log", "rtf"], { kind: "text", tone: "slate", badge: "TXT" }],
  [["pdf"], { kind: "pdf", tone: "red", badge: "PDF" }],
  [["doc", "docx", "odt", "wps"], { kind: "word", tone: "blue", badge: "DOC" }],
  [["xls", "xlsx", "ods", "et", "csv", "tsv"], { kind: "spreadsheet", tone: "green", badge: "XLS" }],
  [["numbers"], { kind: "spreadsheet", tone: "green", badge: "NUM" }],
  [["ppt", "pptx", "odp", "key"], { kind: "presentation", tone: "orange", badge: "PPT" }],
  [["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "heic", "heif", "avif", "tif", "tiff"], { kind: "image", tone: "purple", badge: "IMG" }],
  [["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso"], { kind: "archive", tone: "amber", badge: "ZIP" }],
  [["html", "htm"], { kind: "web", tone: "sky", badge: "HTML" }],
  [["css", "scss", "less"], { kind: "code", tone: "sky", badge: "CSS" }],
  [["js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "go", "rs", "php", "rb", "sh", "bash", "zsh", "ps1", "vue"], { kind: "code", tone: "indigo", badge: "CODE" }],
  [["json"], { kind: "json", tone: "cyan", badge: "JSON" }],
  [["xml"], { kind: "xml", tone: "cyan", badge: "XML" }],
  [["yaml", "yml", "toml", "ini", "conf"], { kind: "yaml", tone: "cyan", badge: "YAML" }],
  [["sql"], { kind: "database", tone: "cyan", badge: "SQL" }],
  [["db", "sqlite", "sqlite3"], { kind: "database", tone: "cyan", badge: "DB" }],
  [["mp3", "wav", "flac", "m4a", "aac", "ogg"], { kind: "audio", tone: "pink", badge: "AUDIO" }],
  [["mp4", "mov", "m4v", "mkv", "avi", "webm"], { kind: "video", tone: "violet", badge: "VIDEO" }],
  [["fig", "sketch", "xd", "psd", "ai"], { kind: "design", tone: "rose", badge: "DES" }],
  [["ttf", "otf", "woff", "woff2"], { kind: "font", tone: "stone", badge: "FONT" }],
  [["epub", "mobi", "azw3"], { kind: "ebook", tone: "teal", badge: "BOOK" }]
];

const EXTENSION_PRESET_MAP = new Map<string, AffairsDocumentPreset>();

for (const [extensions, preset] of DOCUMENT_PRESETS) {
  for (const extension of extensions) {
    EXTENSION_PRESET_MAP.set(extension, preset);
  }
}

export function resolveAffairsDocumentExtension(filePath: string): string {
  const normalized = filePath.trim();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === normalized.length - 1) {
    return "document";
  }
  return normalized.slice(dotIndex + 1).toLowerCase();
}

export function resolveAffairsDocumentVisual(filePath: string): AffairsDocumentVisual {
  const extension = resolveAffairsDocumentExtension(filePath);
  if (extension === "document") {
    return {
      extension,
      kind: "file",
      badge: "FILE",
      tone: "neutral"
    };
  }

  const preset = EXTENSION_PRESET_MAP.get(extension);
  if (!preset) {
    return {
      extension,
      kind: "file",
      badge: extension.slice(0, 4).toUpperCase(),
      tone: "neutral"
    };
  }

  return {
    extension,
    kind: preset.kind,
    badge: preset.badge,
    tone: preset.tone
  };
}
