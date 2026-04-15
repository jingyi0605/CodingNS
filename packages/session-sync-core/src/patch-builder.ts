/**
 * 将各 provider 的编辑操作统一转换为 Codex apply_patch 格式，
 * 使前端可复用同一套 diff 预览渲染逻辑。
 *
 * apply_patch 格式规范：
 *   *** Begin Patch
 *   *** Update File: <path>    | *** Add File: <path>    | *** Delete File: <path>
 *   @@ -old_start,old_count +new_start,new_count @@
 *    context line
 *   -removed line
 *   +added line
 *   *** End Patch
 */

/**
 * 将 Claude Code 的 Edit 工具输入转换为 apply_patch 格式。
 * Edit 工具参数：{ file_path, old_string, new_string, replace_all? }
 */
export function buildApplyPatchFromClaudeEdit(
  input: Record<string, unknown>
): string | null {
  const filePath = extractStringField(input, "file_path");
  if (!filePath) {
    return null;
  }

  const oldString = extractStringField(input, "old_string");
  const newString = extractStringField(input, "new_string");

  const oldLines = oldString.length > 0 ? oldString.split("\n") : [];
  const newLines = newString.length > 0 ? newString.split("\n") : [];

  return buildApplyPatchText([
    {
      action: "update",
      filePath,
      hunks: [{ oldLines, newLines }]
    }
  ]);
}

/**
 * 将 Claude Code 的 Write 工具输入转换为 apply_patch 格式。
 * Write 工具参数：{ file_path, content }
 * Write 是全量写入，视作新增文件处理。
 */
export function buildApplyPatchFromClaudeWrite(
  input: Record<string, unknown>
): string | null {
  const filePath = extractStringField(input, "file_path");
  if (!filePath) {
    return null;
  }

  const content = extractStringField(input, "content");
  const contentLines = content.length > 0 ? content.split("\n") : [];

  return buildApplyPatchText([
    {
      action: "add",
      filePath,
      contentLines
    }
  ]);
}

/**
 * 将 OpenCode 的 patch 部分（仅含文件路径列表）转换为 apply_patch 格式。
 * OpenCode 的 patch part 只提供文件名，不含实际 diff 内容，
 * 转换后前端仍可显示变更文件列表。
 */
export function buildApplyPatchFromOpenCodePatch(
  files: string[]
): string | null {
  if (files.length === 0) {
    return null;
  }

  return buildApplyPatchText(
    files.map((filePath) => ({
      action: "update" as const,
      filePath,
      hunks: []
    }))
  );
}

/**
 * 将只包含文件路径和变更类型的结果转换成 apply_patch。
 * 这类数据常见于 Codex 的 `fileChange` 事件，本身没有 diff，
 * 但前端至少可以据此展示文件级编辑摘要。
 */
export function buildApplyPatchFromFileChangeList(
  changes: Array<{
    path?: string | null;
    kind?: string | null;
  }>
): string | null {
  const normalizedChanges = changes
    .map((change) => {
      const filePath = normalizePatchPath(change.path);

      if (!filePath) {
        return null;
      }

      return {
        filePath,
        action: normalizePatchAction(change.kind)
      };
    })
    .filter(
      (change): change is {
        filePath: string;
        action: PatchFileEntry["action"];
      } => Boolean(change)
    );

  if (normalizedChanges.length === 0) {
    return null;
  }

  return buildApplyPatchText(
    normalizedChanges.map((change) => {
      if (change.action === "add") {
        return {
          action: "add" as const,
          filePath: change.filePath,
          contentLines: []
        };
      }

      if (change.action === "delete") {
        return {
          action: "delete" as const,
          filePath: change.filePath
        };
      }

      return {
        action: "update" as const,
        filePath: change.filePath,
        hunks: []
      };
    })
  );
}

/**
 * 将供应商返回的“松散 patch 输入”兜底规范成 apply_patch。
 * 常见坏格式有两种：
 * 1. 只有 `@@ ...` hunk，没有 `*** Begin Patch`
 * 2. 只有文件路径列表，真正的 diff 已经丢了
 */
export function normalizeApplyPatchText(
  input: string,
  options?: {
    fallbackPaths?: string[];
  }
): string | null {
  const normalizedInput = input.replace(/\r\n/g, "\n").trim();

  if (!normalizedInput) {
    return null;
  }

  if (isFullApplyPatchText(normalizedInput)) {
    return normalizedInput;
  }

  const fallbackPaths = dedupePatchPaths(options?.fallbackPaths ?? []);

  if (fallbackPaths.length !== 1 || !looksLikeLooseApplyPatchBody(normalizedInput)) {
    return null;
  }

  return [
    "*** Begin Patch",
    `*** Update File: ${fallbackPaths[0]}`,
    normalizedInput,
    "*** End Patch"
  ].join("\n");
}

/**
 * 从工具输出文本中提取“Updated the following files”里的文件路径。
 * Codex 的 apply_patch 成功结果经常只在这里保留目标文件列表。
 */
export function extractApplyPatchTargetPathsFromToolOutput(output: string): string[] {
  const resolvedText = unwrapToolOutputText(output);

  if (!resolvedText) {
    return [];
  }

  const lines = resolvedText.replace(/\r\n/g, "\n").split("\n");
  const collected: string[] = [];
  let inUpdatedFilesSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inUpdatedFilesSection) {
      if (/^Success\.\s+Updated the following files:/i.test(line)) {
        inUpdatedFilesSection = true;
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
    const candidatePath = normalizePatchPath(matched?.[1] ?? line);

    if (!candidatePath) {
      break;
    }

    collected.push(candidatePath);
  }

  return dedupePatchPaths(collected);
}

/**
 * 将通用文件编辑类工具参数转换为 apply_patch。
 * 兼容 Gemini 等 provider 常见的字段风格：
 * - 新建/覆盖写入：{ file_path|filePath|path, content|new_content|newContent }
 * - 单次编辑：{ file_path|filePath|path, old_string|oldText|search, new_string|newText|replacement }
 * - 多次编辑：{ file_path|filePath|path, edits: [{ old_string, new_string }, ...] }
 */
export function buildApplyPatchFromStructuredFileTool(
  input: Record<string, unknown>
): string | null {
  const filePath = extractFirstStringField(input, ["file_path", "filePath", "path"]);

  if (!filePath) {
    return null;
  }

  const directContent = extractFirstStringField(input, ["content", "new_content", "newContent"]);

  if (directContent) {
    return buildApplyPatchText([
      {
        action: "add",
        filePath,
        contentLines: directContent.split("\n")
      }
    ]);
  }

  const directEdit = extractStructuredEdit(input);

  if (directEdit) {
    return buildApplyPatchText([
      {
        action: "update",
        filePath,
        hunks: [directEdit]
      }
    ]);
  }

  const edits = Array.isArray(input.edits) ? input.edits : [];
  const normalizedEdits = edits
    .map((edit) => normalizeEditRecord(edit))
    .filter((edit): edit is { oldLines: string[]; newLines: string[] } => Boolean(edit));

  if (normalizedEdits.length === 0) {
    return null;
  }

  return buildApplyPatchText([
    {
      action: "update",
      filePath,
      hunks: normalizedEdits
    }
  ]);
}

// ---- 内部类型与工具函数 ----

interface PatchFileUpdate {
  action: "update";
  filePath: string;
  hunks: Array<{ oldLines: string[]; newLines: string[] }>;
}

interface PatchFileAdd {
  action: "add";
  filePath: string;
  contentLines: string[];
}

interface PatchFileDelete {
  action: "delete";
  filePath: string;
}

type PatchFileEntry = PatchFileUpdate | PatchFileAdd | PatchFileDelete;

function buildApplyPatchText(entries: PatchFileEntry[]): string {
  const lines: string[] = ["*** Begin Patch"];

  for (const entry of entries) {
    if (entry.action === "add") {
      lines.push(`*** Add File: ${entry.filePath}`);
      for (const contentLine of entry.contentLines) {
        lines.push(`+${contentLine}`);
      }
    } else if (entry.action === "delete") {
      lines.push(`*** Delete File: ${entry.filePath}`);
    } else {
      lines.push(`*** Update File: ${entry.filePath}`);
      if (entry.hunks.length === 0) {
        // 无 diff 内容时仅列出文件，跳过 hunk
        continue;
      }
      for (const hunk of entry.hunks) {
        lines.push(
          `@@ -1,${hunk.oldLines.length} +1,${hunk.newLines.length} @@`
        );
        for (const oldLine of hunk.oldLines) {
          lines.push(`-${oldLine}`);
        }
        for (const newLine of hunk.newLines) {
          lines.push(`+${newLine}`);
        }
      }
    }
  }

  lines.push("*** End Patch");
  return lines.join("\n");
}

function extractStringField(
  record: Record<string, unknown>,
  field: string
): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function extractFirstStringField(
  record: Record<string, unknown>,
  fields: string[]
): string {
  for (const field of fields) {
    const value = extractStringField(record, field);

    if (value) {
      return value;
    }
  }

  return "";
}

function extractStructuredEdit(
  input: Record<string, unknown>
): { oldLines: string[]; newLines: string[] } | null {
  return normalizeEditRecord(input);
}

function normalizeEditRecord(
  value: unknown
): { oldLines: string[]; newLines: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const oldValue = extractFirstStringField(record, [
    "old_string",
    "oldString",
    "old_text",
    "oldText",
    "search",
    "searchText"
  ]);
  const newValue = extractFirstStringField(record, [
    "new_string",
    "newString",
    "new_text",
    "newText",
    "replacement",
    "replacementText",
    "replace"
  ]);

  if (!oldValue && !newValue) {
    return null;
  }

  return {
    oldLines: oldValue.length > 0 ? oldValue.split("\n") : [],
    newLines: newValue.length > 0 ? newValue.split("\n") : []
  };
}

function normalizePatchAction(value: string | null | undefined): PatchFileEntry["action"] {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized === "add" || normalized === "create" || normalized === "new") {
    return "add";
  }

  if (normalized === "delete" || normalized === "remove" || normalized === "removed") {
    return "delete";
  }

  return "update";
}

function normalizePatchPath(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function dedupePatchPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => normalizePatchPath(path)).filter((path) => path.length > 0))];
}

function isFullApplyPatchText(input: string): boolean {
  return input.includes("*** Begin Patch") && input.includes("*** End Patch");
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

function unwrapToolOutputText(output: string): string {
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
