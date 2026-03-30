import type { FileNodeDto } from "../api/file-context-api";

const HIDDEN_SYSTEM_ENTRY_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "ehthumbs.db",
  "desktop.ini",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  "__macosx",
  "$recycle.bin",
  "system volume information",
  ".apdisk",
  ".appledouble",
  ".temporaryitems"
]);

const HIDDEN_SYSTEM_ENTRY_PREFIXES = ["._"];

export function getPathLeafName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function shouldHideSystemEntry(entryName: string): boolean {
  const normalizedName = entryName.trim().toLowerCase();

  if (!normalizedName) {
    return false;
  }

  return (
    HIDDEN_SYSTEM_ENTRY_NAMES.has(normalizedName) ||
    HIDDEN_SYSTEM_ENTRY_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
  );
}

export function filterVisibleEntriesByName<T>(
  items: readonly T[],
  getName: (item: T) => string,
  showSystemFiles: boolean
): T[] {
  if (showSystemFiles) {
    return [...items];
  }

  return items.filter((item) => !shouldHideSystemEntry(getName(item)));
}

export function filterVisibleFileNodes(
  items: readonly FileNodeDto[],
  showSystemFiles: boolean
): FileNodeDto[] {
  return filterVisibleEntriesByName(items, (item) => item.name, showSystemFiles);
}

export function filterVisibleFileTreeCache(
  treeCache: Record<string, FileNodeDto[]>,
  showSystemFiles: boolean
): Record<string, FileNodeDto[]> {
  if (showSystemFiles) {
    return treeCache;
  }

  return Object.entries(treeCache).reduce<Record<string, FileNodeDto[]>>(
    (nextTreeCache, [directoryPath, items]) => {
      nextTreeCache[directoryPath] = filterVisibleFileNodes(items, false);
      return nextTreeCache;
    },
    {}
  );
}
