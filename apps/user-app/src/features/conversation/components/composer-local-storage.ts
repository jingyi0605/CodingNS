const DRAFT_STORAGE_KEY_PREFIX = "codingns.conversation.composer-draft:";
const STORAGE_SCHEMA_VERSION = 1;

export interface QuickPhraseRecord {
  id: string;
  text: string;
}

export interface StoredComposerDraftAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  lastModified: number;
  contentBase64: string;
}

export interface ComposerDraftRecord {
  content: string;
  attachments: StoredComposerDraftAttachment[];
}

interface StoredComposerDraftEnvelope {
  schemaVersion: number;
  draft: ComposerDraftRecord;
}

export const DEFAULT_QUICK_PHRASES: QuickPhraseRecord[] = [
  {
    id: "builtin-stage-and-summarize",
    text: "请将本次会话变更的所有代码提交到git暂存区，然后总结一条中文的提交信息"
  },
  {
    id: "builtin-review-module",
    text: "分析本项目  模块的代码实现，并分析存在的问题"
  },
  {
    id: "builtin-group-commits",
    text: "分析当前项目中的未提交文件，按照功能模块进行分类提交，提交信息格式请参考我最近的提交记录"
  }
];

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeStoredAttachment(input: unknown): StoredComposerDraftAttachment | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rawId = "id" in input ? input.id : null;
  const rawFileName = "fileName" in input ? input.fileName : null;
  const rawMimeType = "mimeType" in input ? input.mimeType : null;
  const rawFileSize = "fileSize" in input ? input.fileSize : null;
  const rawLastModified = "lastModified" in input ? input.lastModified : null;
  const rawContentBase64 = "contentBase64" in input ? input.contentBase64 : null;

  if (
    typeof rawId !== "string" ||
    typeof rawFileName !== "string" ||
    typeof rawMimeType !== "string" ||
    typeof rawFileSize !== "number" ||
    typeof rawLastModified !== "number" ||
    typeof rawContentBase64 !== "string"
  ) {
    return null;
  }

  const id = rawId.trim();
  const fileName = rawFileName.trim();
  const mimeType = rawMimeType.trim();
  const contentBase64 = rawContentBase64.trim();

  if (!id || !fileName || !mimeType || rawFileSize < 0 || rawLastModified < 0 || !contentBase64) {
    return null;
  }

  return {
    id,
    fileName,
    mimeType,
    fileSize: rawFileSize,
    lastModified: rawLastModified,
    contentBase64
  };
}

function normalizeDraft(input: unknown): ComposerDraftRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rawContent = "content" in input ? input.content : null;
  const rawAttachments = "attachments" in input ? input.attachments : null;

  if (typeof rawContent !== "string" || !Array.isArray(rawAttachments)) {
    return null;
  }

  const attachments = rawAttachments
    .map((item) => normalizeStoredAttachment(item))
    .filter((item): item is StoredComposerDraftAttachment => item !== null);

  if (attachments.length !== rawAttachments.length) {
    return null;
  }

  if (rawContent.length === 0 && attachments.length === 0) {
    return null;
  }

  return {
    content: rawContent,
    attachments
  };
}

function getDraftStorageKey(scopeId: string): string {
  return `${DRAFT_STORAGE_KEY_PREFIX}${scopeId}`;
}

export function createQuickPhraseRecord(text: string): QuickPhraseRecord {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `phrase-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: text.trim()
  };
}

export function readComposerDraftRecord(scopeId: string): ComposerDraftRecord | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const normalizedScopeId = scopeId.trim();

  if (!normalizedScopeId) {
    return null;
  }

  const rawValue = window.localStorage.getItem(getDraftStorageKey(normalizedScopeId));

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as
      | Partial<StoredComposerDraftEnvelope>
      | Partial<ComposerDraftRecord>;

    const rawDraft =
      parsed &&
      typeof parsed === "object" &&
      "draft" in parsed &&
      parsed.draft &&
      typeof parsed.draft === "object"
        ? parsed.draft
        : parsed;
    const draft = normalizeDraft(rawDraft);

    if (!draft) {
      window.localStorage.removeItem(getDraftStorageKey(normalizedScopeId));
      return null;
    }

    return draft;
  } catch {
    window.localStorage.removeItem(getDraftStorageKey(normalizedScopeId));
    return null;
  }
}

export function persistComposerDraftRecord(
  scopeId: string,
  draft: ComposerDraftRecord
): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }

  const normalizedScopeId = scopeId.trim();

  if (!normalizedScopeId) {
    return false;
  }

  if (draft.content.length === 0 && draft.attachments.length === 0) {
    clearComposerDraftRecord(normalizedScopeId);
    return true;
  }

  try {
    window.localStorage.setItem(
      getDraftStorageKey(normalizedScopeId),
      JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        draft
      } satisfies StoredComposerDraftEnvelope)
    );
    return true;
  } catch {
    return false;
  }
}

export function clearComposerDraftRecord(scopeId: string): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const normalizedScopeId = scopeId.trim();

  if (!normalizedScopeId) {
    return;
  }

  window.localStorage.removeItem(getDraftStorageKey(normalizedScopeId));
}
