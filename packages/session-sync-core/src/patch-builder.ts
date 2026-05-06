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
 * Codex 新版本可能把文件编辑包在 exec_command/write_stdin 的命令文本里。
 * 优先识别真实 apply_patch；其次从常见 `text.replace(old, new)` 脚本里还原行级 diff；
 * 实在没有 old/new 信息时，才退回文件级编辑摘要。
 */
export function buildApplyPatchFromCodexCommandLikeValue(value: unknown): string | null {
  const texts = collectCodexCommandLikeTexts(value);

  for (const text of texts) {
    const patchText = extractFullApplyPatchText(text);

    if (patchText) {
      return normalizeApplyPatchText(patchText) ?? patchText;
    }
  }

  const editEntries = mergeCodexCommandEditEntries(
    texts.flatMap((text) => extractCodexCommandEditEntries(text))
  );

  if (editEntries.length > 0) {
    return buildApplyPatchText(editEntries);
  }

  const paths = dedupePatchPaths(texts.flatMap((text) => extractCodexCommandEditPaths(text)));

  if (paths.length === 0) {
    return null;
  }

  return buildApplyPatchFromFileChangeList(
    paths.map((filePath) => ({
      path: filePath,
      kind: "update"
    }))
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

function collectCodexCommandLikeTexts(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === undefined || value === null) {
    return [];
  }

  if (typeof value === "string") {
    const texts = [value];
    const unescapedText = expandEscapedCodexCommandText(value);

    if (unescapedText) {
      texts.push(unescapedText);
    }

    const parsed = parseJsonLikeValue(value);

    if (parsed !== null) {
      texts.push(...collectCodexCommandLikeTexts(parsed, depth + 1));
    }

    texts.push(...extractJsonQuotedCommandTexts(value));
    return texts;
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCodexCommandLikeTexts(entry, depth + 1));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;

  return [
    stringifyCommandLikeValue(value),
    ...["cmd", "command", "input", "arguments", "output", "aggregated_output", "aggregatedOutput"].flatMap(
      (key) => collectCodexCommandLikeTexts(record[key], depth + 1)
    )
  ];
}

function expandEscapedCodexCommandText(value: string): string | null {
  if (!value.includes("\\n") || !looksLikeCodexCommandEdit(value)) {
    return null;
  }

  const expanded = value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  return expanded === value ? null : expanded;
}

function extractJsonQuotedCommandTexts(value: string): string[] {
  if (!looksLikeCodexCommandEdit(value)) {
    return [];
  }

  const texts: string[] = [];
  const pattern = /"(?:\\.|[^"\\])*"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    try {
      const decoded = JSON.parse(match[0]!) as unknown;

      if (typeof decoded === "string" && looksLikeCodexCommandEdit(decoded)) {
        texts.push(decoded);
      }
    } catch {
      // 不是合法 JSON 字符串时跳过，不能猜。
    }
  }

  return texts;
}

function parseJsonLikeValue(value: string): unknown | null {
  const trimmed = value.trim();

  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function stringifyCommandLikeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractFullApplyPatchText(value: string): string | null {
  const normalized = value.replace(/\r\n/g, "\n");
  const startMatch = /(?:^|\n)\*\*\* Begin Patch(?:\n|$)/.exec(normalized);

  if (!startMatch) {
    return null;
  }

  const start = startMatch.index + (startMatch[0].startsWith("\n") ? 1 : 0);
  const endPattern = /(?:^|\n)\*\*\* End Patch(?:\n|$)/g;
  endPattern.lastIndex = start;
  const endMatch = endPattern.exec(normalized);

  if (!endMatch) {
    return null;
  }

  const end = endMatch.index + (endMatch[0].startsWith("\n") ? 1 : 0) + "*** End Patch".length;
  return normalized.slice(start, end).trim();
}

function extractCodexCommandEditEntries(value: string): PatchFileEntry[] {
  if (!looksLikeCodexCommandEdit(value)) {
    return [];
  }

  const filePaths = extractCodexCommandEditPaths(value);
  const replacements = extractPythonTextReplaceEdits(value);

  if (filePaths.length !== 1 || replacements.length === 0) {
    return [];
  }

  return [
    {
      action: "update",
      filePath: filePaths[0]!,
      hunks: replacements.map((replacement) => ({
        oldLines: splitPatchLiteralLines(replacement.oldText),
        newLines: splitPatchLiteralLines(replacement.newText)
      }))
    }
  ];
}

function mergeCodexCommandEditEntries(entries: PatchFileEntry[]): PatchFileEntry[] {
  const mergedUpdates = new Map<string, PatchFileUpdate>();
  const others: PatchFileEntry[] = [];

  for (const entry of entries) {
    if (entry.action !== "update") {
      others.push(entry);
      continue;
    }

    const existing = mergedUpdates.get(entry.filePath);

    if (existing) {
      existing.hunks.push(...entry.hunks);
    } else {
      mergedUpdates.set(entry.filePath, {
        action: "update",
        filePath: entry.filePath,
        hunks: [...entry.hunks]
      });
    }
  }

  return [...mergedUpdates.values(), ...others];
}

function extractPythonTextReplaceEdits(value: string): Array<{ oldText: string; newText: string }> {
  const stringVariables = collectPythonStringVariables(value);
  const replacements: Array<{ oldText: string; newText: string }> = [];

  for (const args of extractPythonReplaceCallArgs(value)) {
    if (args.length < 2) {
      continue;
    }

    const oldText = resolvePythonReplaceArgument(args[0]!, stringVariables);
    const newText = resolvePythonReplaceArgument(args[1]!, stringVariables);

    if (oldText === null || newText === null) {
      continue;
    }

    replacements.push({ oldText, newText });
  }

  return replacements;
}

function collectPythonStringVariables(value: string): Map<string, string> {
  const variables = new Map<string, string>();
  const assignmentPattern = /\b([A-Za-z_]\w*)\s*=\s*(?:[rRuUbBfF]{0,3})?["']/g;
  let match: RegExpExecArray | null;

  while ((match = assignmentPattern.exec(value)) !== null) {
    const variableName = match[1] ?? "";
    const literalStart = findPythonLiteralStart(value, assignmentPattern.lastIndex - 1);

    if (!variableName || literalStart < 0) {
      continue;
    }

    const parsed = parsePythonStringLiteralAt(value, literalStart);

    if (!parsed) {
      continue;
    }

    variables.set(variableName, parsed.value);
    assignmentPattern.lastIndex = parsed.end;
  }

  return variables;
}

function extractPythonReplaceCallArgs(value: string): string[][] {
  const calls: string[][] = [];
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const replaceIndex = value.indexOf(".replace(", searchFrom);

    if (replaceIndex < 0) {
      break;
    }

    const argsStart = replaceIndex + ".replace(".length;
    const argsEnd = findMatchingParen(value, argsStart - 1);

    if (argsEnd < 0) {
      break;
    }

    calls.push(splitTopLevelArguments(value.slice(argsStart, argsEnd)));
    searchFrom = argsEnd + 1;
  }

  return calls;
}

function resolvePythonReplaceArgument(value: string, variables: Map<string, string>): string | null {
  const trimmed = value.trim();

  if (/^[A-Za-z_]\w*$/.test(trimmed)) {
    return variables.get(trimmed) ?? null;
  }

  const literalStart = findPythonLiteralStart(trimmed, 0);

  if (literalStart < 0) {
    return null;
  }

  const parsed = parsePythonStringLiteralAt(trimmed, literalStart);
  return parsed?.value ?? null;
}

function splitTopLevelArguments(value: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let index = 0;

  while (index < value.length) {
    const literalStart = findPythonLiteralStart(value, index);

    if (literalStart === index) {
      const parsed = parsePythonStringLiteralAt(value, literalStart);

      if (parsed) {
        index = parsed.end;
        continue;
      }
    }

    const char = value[index];

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }

    index += 1;
  }

  args.push(value.slice(start).trim());
  return args;
}

function findMatchingParen(value: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;

  while (index < value.length) {
    const literalStart = findPythonLiteralStart(value, index);

    if (literalStart === index) {
      const parsed = parsePythonStringLiteralAt(value, literalStart);

      if (parsed) {
        index = parsed.end;
        continue;
      }
    }

    const char = value[index];

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return -1;
}

function findPythonLiteralStart(value: string, startIndex: number): number {
  let index = startIndex;

  while (index < value.length && /\s/.test(value[index] ?? "")) {
    index += 1;
  }

  while (index < value.length && /[rRuUbBfF]/.test(value[index] ?? "")) {
    index += 1;
  }

  const char = value[index];
  return char === "'" || char === '"' ? index : -1;
}

function parsePythonStringLiteralAt(
  value: string,
  quoteIndex: number
): { value: string; end: number } | null {
  const quote = value[quoteIndex];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const triple = value.slice(quoteIndex, quoteIndex + 3) === quote.repeat(3);
  const contentStart = quoteIndex + (triple ? 3 : 1);
  const endMarker = triple ? quote.repeat(3) : quote;
  const rawLiteral = hasRawPythonStringPrefix(value, quoteIndex);
  let index = contentStart;
  let result = "";

  while (index < value.length) {
    if (value.startsWith(endMarker, index)) {
      return {
        value: result,
        end: index + endMarker.length
      };
    }

    const char = value[index] ?? "";

    if (!rawLiteral && char === "\\") {
      const next = value[index + 1] ?? "";
      result += decodeSimplePythonEscape(next);
      index += 2;
      continue;
    }

    result += char;
    index += 1;
  }

  return null;
}

function hasRawPythonStringPrefix(value: string, quoteIndex: number): boolean {
  let prefixStart = quoteIndex;

  while (prefixStart > 0 && /[A-Za-z]/.test(value[prefixStart - 1] ?? "")) {
    prefixStart -= 1;
  }

  return /r/i.test(value.slice(prefixStart, quoteIndex));
}

function decodeSimplePythonEscape(value: string): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    default:
      return value;
  }
}

function splitPatchLiteralLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function extractCodexCommandEditPaths(value: string): string[] {
  if (!looksLikeCodexCommandEdit(value)) {
    return [];
  }

  return dedupePatchPaths([
    ...extractPythonPathConstructorEditPaths(value),
    ...extractWriteFileSyncEditPaths(value)
  ]);
}

function looksLikeCodexCommandEdit(value: string): boolean {
  return (
    /\.write_(?:text|bytes)\s*\(/.test(value) ||
    /\bwriteFileSync\s*\(/.test(value) ||
    /\bcat\s+>\s*\S+/.test(value) ||
    /\btee\s+\S+/.test(value)
  );
}

function extractPythonPathConstructorEditPaths(value: string): string[] {
  const paths: string[] = [];
  const chainedPattern = /\bPath\(\s*(["'`])([^"'`\n]+)\1\s*\)\.write_(?:text|bytes)\s*\(/g;
  let chainedMatch: RegExpExecArray | null;

  while ((chainedMatch = chainedPattern.exec(value)) !== null) {
    paths.push(chainedMatch[2] ?? "");
  }

  const assignmentPattern = /\b([A-Za-z_]\w*)\s*=\s*Path\(\s*(["'`])([^"'`\n]+)\2\s*\)/g;
  let assignmentMatch: RegExpExecArray | null;

  while ((assignmentMatch = assignmentPattern.exec(value)) !== null) {
    const variableName = assignmentMatch[1] ?? "";
    const filePath = assignmentMatch[3] ?? "";

    if (variableName && new RegExp(`\\b${escapeRegExp(variableName)}\\.write_(?:text|bytes)\\s*\\(`).test(value)) {
      paths.push(filePath);
    }
  }

  return paths;
}

function extractWriteFileSyncEditPaths(value: string): string[] {
  const paths: string[] = [];
  const pattern = /\bwriteFileSync\(\s*(["'`])([^"'`\n]+)\1/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    paths.push(match[2] ?? "");
  }

  return paths;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
