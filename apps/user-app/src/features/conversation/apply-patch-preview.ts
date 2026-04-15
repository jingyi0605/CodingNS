export interface ApplyPatchDiffLine {
  kind: "meta" | "hunk" | "context" | "add" | "remove";
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface ApplyPatchFileChange {
  path: string;
  nextPath: string | null;
  action: "update" | "add" | "delete";
  additions: number;
  deletions: number;
  lines: ApplyPatchDiffLine[];
}

export interface ApplyPatchPreview {
  files: ApplyPatchFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

interface HunkCursor {
  oldLineNumber: number;
  newLineNumber: number;
}

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";

export function parseApplyPatchPreview(input: string): ApplyPatchPreview | null {
  const normalized = input.replace(/\r\n/g, "\n");

  if (!normalized.includes(BEGIN_PATCH_MARKER) || !normalized.includes(END_PATCH_MARKER)) {
    return null;
  }

  const rawLines = normalized.split("\n");
  const files: ApplyPatchFileChange[] = [];
  let currentFile: ApplyPatchFileChange | null = null;
  let currentHunk: HunkCursor | null = null;

  for (const rawLine of rawLines) {
    if (rawLine === BEGIN_PATCH_MARKER || rawLine === END_PATCH_MARKER) {
      continue;
    }

    if (rawLine.startsWith("*** Update File: ")) {
      currentFile = createFileChange("update", rawLine.slice("*** Update File: ".length));
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (rawLine.startsWith("*** Add File: ")) {
      currentFile = createFileChange("add", rawLine.slice("*** Add File: ".length));
      files.push(currentFile);
      currentHunk = {
        oldLineNumber: 0,
        newLineNumber: 1
      };
      continue;
    }

    if (rawLine.startsWith("*** Delete File: ")) {
      currentFile = createFileChange("delete", rawLine.slice("*** Delete File: ".length));
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (rawLine.startsWith("*** Move to: ")) {
      currentFile.nextPath = rawLine.slice("*** Move to: ".length);
      currentFile.lines.push({
        kind: "meta",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      continue;
    }

    if (rawLine.startsWith("@@")) {
      currentHunk = parseHunkCursor(rawLine) ?? {
        oldLineNumber: 0,
        newLineNumber: 0
      };
      currentFile.lines.push({
        kind: "hunk",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      continue;
    }

    if (rawLine === "*** End of File") {
      currentFile.lines.push({
        kind: "meta",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      continue;
    }

    if (currentFile.action === "add" && rawLine.startsWith("+")) {
      currentFile.additions += 1;
      currentFile.lines.push({
        kind: "add",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: currentHunk?.newLineNumber ?? currentFile.additions
      });

      if (currentHunk) {
        currentHunk.newLineNumber += 1;
      }
      continue;
    }

    if (!currentHunk) {
      currentFile.lines.push({
        kind: "meta",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      continue;
    }

    if (rawLine.startsWith("+")) {
      currentFile.additions += 1;
      currentFile.lines.push({
        kind: "add",
        text: rawLine,
        oldLineNumber: null,
        newLineNumber: currentHunk.newLineNumber
      });
      currentHunk.newLineNumber += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      currentFile.deletions += 1;
      currentFile.lines.push({
        kind: "remove",
        text: rawLine,
        oldLineNumber: currentHunk.oldLineNumber,
        newLineNumber: null
      });
      currentHunk.oldLineNumber += 1;
      continue;
    }

    const isContextLine = rawLine.startsWith(" ") || rawLine.length === 0;

    if (isContextLine) {
      currentFile.lines.push({
        kind: "context",
        text: rawLine,
        oldLineNumber: currentHunk.oldLineNumber,
        newLineNumber: currentHunk.newLineNumber
      });
      currentHunk.oldLineNumber += 1;
      currentHunk.newLineNumber += 1;
      continue;
    }

    currentFile.lines.push({
      kind: "meta",
      text: rawLine,
      oldLineNumber: null,
      newLineNumber: null
    });
  }

  if (files.length === 0) {
    return null;
  }

  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0)
  };
}

export function normalizeApplyPatchPreviewInput(
  input: string,
  fallbackPaths: string[] = []
): string | null {
  const normalized = input.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes(BEGIN_PATCH_MARKER) && normalized.includes(END_PATCH_MARKER)) {
    return normalized;
  }

  const uniquePaths = [...new Set(fallbackPaths.map((path) => path.trim()).filter((path) => path.length > 0))];

  if (uniquePaths.length !== 1 || !looksLikeLooseApplyPatchBody(normalized)) {
    return null;
  }

  return [
    BEGIN_PATCH_MARKER,
    `*** Update File: ${uniquePaths[0]}`,
    normalized,
    END_PATCH_MARKER
  ].join("\n");
}

export function extractApplyPatchPathsFromToolOutput(output: string): string[] {
  const resolvedText = unwrapApplyPatchOutputText(output);

  if (!resolvedText) {
    return [];
  }

  const lines = resolvedText.replace(/\r\n/g, "\n").split("\n");
  const collected: string[] = [];
  let inUpdatedFileSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inUpdatedFileSection) {
      if (/^Success\.\s+Updated the following files:/i.test(line)) {
        inUpdatedFileSection = true;
      }
      continue;
    }

    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    const matched = line.match(/^[A-Z?]\s+(.+)$/);
    const candidate = (matched?.[1] ?? line).trim();

    if (!candidate) {
      break;
    }

    collected.push(candidate);
  }

  return [...new Set(collected)];
}

export function getApplyPatchDisplayName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.at(-1) || filePath;
}

function createFileChange(
  action: ApplyPatchFileChange["action"],
  path: string
): ApplyPatchFileChange {
  return {
    path,
    nextPath: null,
    action,
    additions: 0,
    deletions: 0,
    lines: []
  };
}

function parseHunkCursor(line: string): HunkCursor | null {
  const matched = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);

  if (!matched) {
    return null;
  }

  return {
    oldLineNumber: Number(matched[1]),
    newLineNumber: Number(matched[2])
  };
}

function looksLikeLooseApplyPatchBody(input: string): boolean {
  return (
    input.startsWith("@@") ||
    input.startsWith("*** Update File: ") ||
    input.startsWith("*** Add File: ") ||
    input.startsWith("*** Delete File: ") ||
    input.includes("\n@@") ||
    input.startsWith("+") ||
    input.startsWith("-")
  );
}

function unwrapApplyPatchOutputText(output: string): string {
  const normalized = output.trim();

  if (!normalized) {
    return "";
  }

  if (!normalized.startsWith("{")) {
    return normalized;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalized;
    }

    const record = parsed as Record<string, unknown>;

    if (typeof record.output === "string" && record.output.trim().length > 0) {
      return record.output;
    }

    if (typeof record.result === "string" && record.result.trim().length > 0) {
      return record.result;
    }

    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }
  } catch {
    return normalized;
  }

  return normalized;
}
