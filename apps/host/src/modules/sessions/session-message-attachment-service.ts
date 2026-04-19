import fs from "node:fs";
import path from "node:path";

import type {
  NormalizedMessage,
  NormalizedMessageAttachment,
  ProviderId
} from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { SessionMessageAttachmentRecord } from "../../types/domain.js";
import type { SessionMessageAttachmentRepository } from "../../storage/repositories/session-message-attachment-repository.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"]
]);

const CLAUDE_ATTACHMENT_HEADER = "[[CODINGNS_IMAGE_ATTACHMENTS]]";
const CLAUDE_ATTACHMENT_FOOTER = "[[/CODINGNS_IMAGE_ATTACHMENTS]]";
const INTERNAL_ATTACHMENT_BLOCK_PATTERN =
  /\[\[CODINGNS_IMAGE_ATTACHMENTS\]\][\s\S]*?\[\[\/CODINGNS_IMAGE_ATTACHMENTS\]\]/g;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export interface SessionAttachmentInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface RuntimeAttachmentDescriptor extends NormalizedMessageAttachment {
  filePath: string;
}

interface PersistAttachmentsInput {
  sessionId: string;
  clientRequestId: string;
  attachments: SessionAttachmentInput[];
}

export class SessionMessageAttachmentService {
  private readonly storageRoot: string;

  constructor(
    private readonly repository: SessionMessageAttachmentRepository,
    config: HostConfig
  ) {
    this.storageRoot = path.resolve(path.dirname(config.databasePath), "session-attachments");
  }

  persistAttachments(
    input: PersistAttachmentsInput
  ): {
    messageAttachments: NormalizedMessageAttachment[];
    runtimeAttachments: RuntimeAttachmentDescriptor[];
  } {
    if (input.attachments.length === 0) {
      return {
        messageAttachments: [],
        runtimeAttachments: []
      };
    }

    const existing = this.repository.listBySessionAndClientRequest(
      input.sessionId,
      input.clientRequestId
    );

    if (existing.length > 0) {
      return {
        messageAttachments: existing.map(toMessageAttachmentDto),
        runtimeAttachments: existing.map(toRuntimeAttachment)
      };
    }

    const targetDir = path.join(this.storageRoot, input.sessionId, input.clientRequestId);
    fs.mkdirSync(targetDir, { recursive: true });

    const records = input.attachments.map((attachment, index) =>
      this.createRecord(targetDir, input.sessionId, input.clientRequestId, attachment, index)
    );

    records.forEach((record) => {
      this.repository.insert(record);
    });

    return {
      messageAttachments: records.map(toMessageAttachmentDto),
      runtimeAttachments: records.map(toRuntimeAttachment)
    };
  }

  bindClientRequestToMessage(
    sessionId: string,
    clientRequestId: string | null,
    messageId: string | null
  ): NormalizedMessageAttachment[] {
    if (!clientRequestId || !messageId) {
      return [];
    }

    this.repository.bindMessage(sessionId, clientRequestId, messageId);
    return this.repository
      .listBySessionAndClientRequest(sessionId, clientRequestId)
      .map(toMessageAttachmentDto);
  }

  getMessageAttachments(
    sessionId: string,
    messageId: string | null
  ): NormalizedMessageAttachment[] {
    if (!messageId) {
      return [];
    }

    return this.repository
      .listBySessionAndMessageIds(sessionId, [messageId])
      .map(toMessageAttachmentDto);
  }

  getRuntimeAttachments(
    sessionId: string,
    clientRequestId: string | null
  ): RuntimeAttachmentDescriptor[] {
    if (!clientRequestId) {
      return [];
    }

    return this.repository
      .listBySessionAndClientRequest(sessionId, clientRequestId)
      .map(toRuntimeAttachment);
  }

  deletePendingAttachments(sessionId: string, clientRequestId: string | null): void {
    if (!clientRequestId) {
      return;
    }

    const records = this.repository.listUnboundBySessionAndClientRequest(sessionId, clientRequestId);

    if (records.length === 0) {
      return;
    }

    this.repository.deleteByIds(records.map((record) => record.id));

    records.forEach((record) => {
      try {
        fs.rmSync(record.storagePath, { force: true });
      } catch {
        return;
      }

      pruneEmptyParentDirectories(path.dirname(record.storagePath), this.storageRoot);
    });
  }

  deleteSessionAttachments(sessionId: string): void {
    const records = this.repository.listBySession(sessionId);

    if (records.length === 0) {
      return;
    }

    this.repository.deleteBySession(sessionId);

    records.forEach((record) => {
      try {
        fs.rmSync(record.storagePath, { force: true });
      } catch {
        return;
      }

      pruneEmptyParentDirectories(path.dirname(record.storagePath), this.storageRoot);
    });

    try {
      fs.rmSync(path.join(this.storageRoot, sessionId), { recursive: true, force: true });
    } catch {
      // 会话目录收尾失败不影响主删除流程，避免覆盖原始错误。
    }
  }

  readAttachmentContent(
    sessionId: string,
    attachmentId: string
  ): {
    attachment: NormalizedMessageAttachment;
    fileName: string;
    mimeType: string;
    content: Buffer;
  } | null {
    const record = this.repository.findBySessionAndId(sessionId, attachmentId);

    if (!record) {
      return null;
    }

    return {
      attachment: toMessageAttachmentDto(record),
      fileName: record.fileName,
      mimeType: record.mimeType,
      content: fs.readFileSync(record.storagePath)
    };
  }

  enrichMessages(sessionId: string, messages: NormalizedMessage[]): NormalizedMessage[] {
    const messageIds = messages.map((message) => message.messageId);
    const records = this.repository.listBySessionAndMessageIds(sessionId, messageIds);
    const attachmentMap = new Map<string, NormalizedMessageAttachment[]>();

    records.forEach((record) => {
      if (!record.messageId) {
        return;
      }

      const current = attachmentMap.get(record.messageId) ?? [];
      current.push(toMessageAttachmentDto(record));
      attachmentMap.set(record.messageId, current);
    });

    return messages.map((message) => {
      const attachments = attachmentMap.get(message.messageId) ?? [];

      if (attachments.length === 0) {
        return message;
      }

      return {
        ...message,
        content: normalizeProviderMessageContent(message.provider, message.content),
        attachments
      };
    });
  }

  buildProviderPrompt(
    provider: ProviderId,
    content: string,
    attachments: RuntimeAttachmentDescriptor[]
  ): string | null {
    if (attachments.length === 0) {
      return null;
    }

    if (provider !== "claude-code" && provider !== "codex") {
      return null;
    }

    const normalizedContent = content.trim();
    const attachmentLines = attachments
      .map((attachment, index) => `${index + 1}. ${attachment.filePath}`)
      .join("\n");
    const hasOnlyImages = attachments.every((attachment) => attachment.kind === "image");
    const attachmentInstruction =
      hasOnlyImages
        ? "下面这些图片是用户随消息附带的本地附件。请先读取并理解它们，再继续处理这条请求。"
        : "下面这些文件是用户随消息附带的本地文件。请先读取并理解相关内容，再继续处理这条请求。";

    return [normalizedContent, CLAUDE_ATTACHMENT_HEADER, attachmentInstruction, attachmentLines, CLAUDE_ATTACHMENT_FOOTER]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  buildAcceptedContentCandidates(content: string, providerPrompt: string | null): string[] {
    const candidates = [content];

    if (providerPrompt && providerPrompt !== content) {
      candidates.push(providerPrompt);
    }

    return candidates;
  }

  private createRecord(
    targetDir: string,
    sessionId: string,
    clientRequestId: string,
    attachment: SessionAttachmentInput,
    index: number
  ): SessionMessageAttachmentRecord {
    const mimeType = attachment.mimeType.trim().toLowerCase();
    const kind = mimeType.startsWith("image/") ? "image" : "file";

    const buffer = Buffer.from(attachment.contentBase64, "base64");

    if (buffer.length === 0) {
      throw new Error("EMPTY_ATTACHMENT_CONTENT");
    }

    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error("ATTACHMENT_TOO_LARGE");
    }

    const attachmentId = createId();
    const fileName = buildSafeFileName(attachment.fileName, index, mimeType);
    const storagePath = path.join(targetDir, `${attachmentId}-${fileName}`);
    fs.writeFileSync(storagePath, buffer);

    return {
      id: attachmentId,
      sessionId,
      clientRequestId,
      messageId: null,
      kind,
      fileName,
      mimeType,
      fileSize: buffer.length,
      storagePath,
      createdAt: nowIso()
    };
  }
}

export function normalizeProviderMessageContent(provider: string, content: string): string {
  if (provider !== "claude-code" && provider !== "codex") {
    return content;
  }

  return content.replace(INTERNAL_ATTACHMENT_BLOCK_PATTERN, "").trimEnd();
}

function buildSafeFileName(fileName: string, index: number, mimeType: string): string {
  const fallbackExtension = SUPPORTED_IMAGE_EXTENSIONS.get(mimeType) ?? "";
  const normalized = path.basename(fileName || `attachment-${index + 1}${fallbackExtension}`);
  const safeBase = normalized.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();

  if (safeBase.length === 0) {
    return `attachment-${index + 1}${fallbackExtension}`;
  }

  return safeBase;
}

function toMessageAttachmentDto(
  record: SessionMessageAttachmentRecord
): NormalizedMessageAttachment {
  return {
    id: record.id,
    kind: record.kind,
    fileName: record.fileName,
    mimeType: record.mimeType,
    fileSize: record.fileSize
  };
}

function toRuntimeAttachment(
  record: SessionMessageAttachmentRecord
): RuntimeAttachmentDescriptor {
  return {
    ...toMessageAttachmentDto(record),
    filePath: record.storagePath
  };
}

function pruneEmptyParentDirectories(currentDir: string, stopDir: string): void {
  let cursor = currentDir;
  const normalizedStopDir = path.resolve(stopDir);

  while (cursor.startsWith(normalizedStopDir)) {
    try {
      const entries = fs.readdirSync(cursor);

      if (entries.length > 0) {
        return;
      }

      fs.rmdirSync(cursor);
    } catch {
      return;
    }

    if (cursor === normalizedStopDir) {
      return;
    }

    const parentDir = path.dirname(cursor);

    if (parentDir === cursor) {
      return;
    }

    cursor = parentDir;
  }
}
