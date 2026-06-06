import type { CSSProperties } from "react";

export interface ShortcutAppSmartIconInput {
  title: string;
  entryPath?: string;
  sourceKind?: string;
}

export interface ShortcutAppSmartIcon {
  text: string;
  style: CSSProperties;
}

function resolveShortcutIconLabel(input: ShortcutAppSmartIconInput): string {
  const title = input.title.trim();
  if (title) {
    return title;
  }

  const entryPath = input.entryPath?.trim() ?? "";
  const pathParts = entryPath.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] ?? "";
  const fileStem = fileName.replace(/\.[^.]+$/, "");
  if (fileStem && fileStem !== "index") {
    return fileStem;
  }

  return pathParts[pathParts.length - 2] ?? "快捷应用";
}

function resolveShortcutIconText(label: string): string {
  const cjkChars = Array.from(label).filter((char) => /[㐀-鿿]/.test(char));
  if (cjkChars.length > 0) {
    return cjkChars.slice(0, 2).join("");
  }

  const wordChars = label
    .split(/[\s\-_/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .filter(Boolean);
  if (wordChars.length > 0) {
    return wordChars.slice(0, 2).join("");
  }

  return Array.from(label).slice(0, 2).join("").toUpperCase();
}

function hashShortcutIconSeed(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function resolveShortcutAppSmartIcon(input: ShortcutAppSmartIconInput): ShortcutAppSmartIcon {
  const label = resolveShortcutIconLabel(input);
  const seed = [
    label,
    input.entryPath?.trim() ?? "",
    input.sourceKind?.trim() ?? ""
  ].join("|");
  const hue = hashShortcutIconSeed(seed) % 360;
  const accentHue = (hue + 28) % 360;

  return {
    text: resolveShortcutIconText(label),
    style: {
      background: `linear-gradient(135deg, hsl(${hue} 82% 91%), hsl(${accentHue} 78% 85%))`,
      color: `hsl(${hue} 46% 20%)`
    }
  };
}
