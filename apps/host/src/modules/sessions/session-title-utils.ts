export const SESSION_TITLE_MAX_LENGTH = 72;

export function buildSessionTitleFromContent(content: string, fallbackTitle: string): string {
  const title = normalizeSessionTitleSource(content);
  return title?.slice(0, SESSION_TITLE_MAX_LENGTH) || fallbackTitle;
}

export function normalizeRuntimePromptTitle(content: string | null | undefined): string | null {
  const normalized = normalizeSessionTitleSource(content);

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, SESSION_TITLE_MAX_LENGTH);
}

function normalizeSessionTitleSource(content: string | null | undefined): string | null {
  const normalized = (typeof content === "string" ? content : "").trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return null;
  }

  return extractCodexSubagentTaskTitle(normalized) ?? normalized;
}

function extractCodexSubagentTaskTitle(title: string): string | null {
  const match = title.match(/^你是\s*Agent\s*[A-Za-z0-9_-]+\s*[,，。:：；;\s]*负责\s*(.+)$/i);
  const task = match?.[1]?.trim().replace(/^[：:，,。；;\s]+/, "").trim();

  return task || null;
}
