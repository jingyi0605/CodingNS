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

type PatchFileEntry = PatchFileUpdate | PatchFileAdd;

function buildApplyPatchText(entries: PatchFileEntry[]): string {
  const lines: string[] = ["*** Begin Patch"];

  for (const entry of entries) {
    if (entry.action === "add") {
      lines.push(`*** Add File: ${entry.filePath}`);
      for (const contentLine of entry.contentLines) {
        lines.push(`+${contentLine}`);
      }
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
