import { existsSync } from "node:fs";

import {
  ensureText,
  extractTextBlocks,
  readJsonLines
} from "./providers/utils.js";

export function buildCodexResumeHistoryFromRawStore(
  rawStoreRef: string | null
): Array<Record<string, unknown>> {
  const filePath = ensureText(rawStoreRef).trim();

  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  const history: Array<Record<string, unknown>> = [];
  let lastSignature: string | null = null;

  for (const recordEntry of readJsonLines(filePath)) {
    const record = toRecord(recordEntry.data) ?? {};
    const recordType = ensureText(record.type).trim();

    if (recordType === "event_msg") {
      const payload = toRecord(record.payload) ?? {};
      const eventType = ensureText(payload.type).trim();
      const content = ensureText(payload.message).trim();

      if (content.length === 0) {
        continue;
      }

      if (eventType === "user_message") {
        pushResumeHistoryMessage(history, "user", content, () => lastSignature, (next) => {
          lastSignature = next;
        });
        continue;
      }

      if (eventType === "agent_message") {
        pushResumeHistoryMessage(history, "assistant", content, () => lastSignature, (next) => {
          lastSignature = next;
        });
      }

      continue;
    }

    if (recordType !== "response_item") {
      continue;
    }

    const payload = toRecord(record.payload) ?? {};

    if (ensureText(payload.type).trim() !== "message") {
      continue;
    }

    const role = ensureText(payload.role).trim();

    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const content = extractTextBlocks(payload.content).trim();

    if (content.length === 0) {
      continue;
    }

    pushResumeHistoryMessage(history, role, content, () => lastSignature, (next) => {
      lastSignature = next;
    });
  }

  return history;
}

function pushResumeHistoryMessage(
  history: Array<Record<string, unknown>>,
  role: "user" | "assistant",
  content: string,
  readLastSignature: () => string | null,
  writeLastSignature: (signature: string) => void
): void {
  const signature = `${role}:${content}`;

  // Codex transcript 常同时落 event_msg 与 response_item，冷恢复时不去重会把上下文翻倍。
  if (readLastSignature() === signature) {
    return;
  }

  writeLastSignature(signature);
  history.push(createResumeHistoryMessage(role, content));
}

function createResumeHistoryMessage(
  role: "user" | "assistant",
  content: string
): Record<string, unknown> {
  return {
    type: "message",
    role,
    content: [
      {
        type: role === "user" ? "input_text" : "output_text",
        text: content
      }
    ]
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
