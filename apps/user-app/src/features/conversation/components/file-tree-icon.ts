export type FileTreeIconKind = "default" | "code" | "style" | "data" | "md" | "env" | "image";

export function resolveFileTreeIconLabel(fileName: string) {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return "ENV";
  }

  if (normalizedName.endsWith(".d.ts")) {
    return "DTS";
  }

  const extension = normalizedName.includes(".")
    ? normalizedName.slice(normalizedName.lastIndexOf(".") + 1)
    : "";

  switch (extension) {
    case "ts":
      return "TS";
    case "tsx":
      return "TSX";
    case "js":
      return "JS";
    case "jsx":
      return "JSX";
    case "json":
      return "{}";
    case "md":
      return "MD";
    case "css":
      return "CSS";
    case "scss":
      return "SASS";
    case "html":
      return "HTML";
    case "yml":
    case "yaml":
      return "YAML";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "IMG";
    case "txt":
      return "TXT";
    default:
      return "FILE";
  }
}

export function resolveFileTreeIconKind(fileName: string): FileTreeIconKind {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return "env";
  }

  if (normalizedName.endsWith(".md")) {
    return "md";
  }

  if (normalizedName.endsWith(".css") || normalizedName.endsWith(".scss")) {
    return "style";
  }

  if (
    normalizedName.endsWith(".png") ||
    normalizedName.endsWith(".jpg") ||
    normalizedName.endsWith(".jpeg") ||
    normalizedName.endsWith(".gif") ||
    normalizedName.endsWith(".svg") ||
    normalizedName.endsWith(".webp")
  ) {
    return "image";
  }

  if (
    normalizedName.endsWith(".ts") ||
    normalizedName.endsWith(".tsx") ||
    normalizedName.endsWith(".js") ||
    normalizedName.endsWith(".jsx")
  ) {
    return "code";
  }

  if (normalizedName.endsWith(".json") || normalizedName.endsWith(".yml") || normalizedName.endsWith(".yaml")) {
    return "data";
  }

  return "default";
}
