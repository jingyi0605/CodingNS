import fs from "node:fs";
import path from "node:path";

import type { NormalizedMessage, NormalizedMessageAttachment } from "@codingns/session-sync-core";

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
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface SessionImageAttachmentInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface RuntimeImageAttachmentDescriptor extends NormalizedMessageAttachment {
  filePath: string;
}

interface PersistImageAttachmentsInput {
  sessionId: string;
  clientRequestId: string;
  attachments: SessionImageAttachmentInput[];
}

export class SessionMessageAttachmentService {
  private readonly storageRoot: string;

  constructor(
    private readonly repository: SessionMessageAttachmentRepository,
    config: HostConfig
  ) {
    this.storageRoot = path.resolve(path.dirname(config.databasePath), "session-attachments");
  }

  persistImageAttachments(
    input: PersistImageAttachmentsInput
  ): {
    messageAttachments: NormalizedMessageAttachment[];
    runtimeAttachments: RuntimeImageAttachmentDescriptor[];
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
    provider: "claude-code" | "codex",
    content: string,
    attachments: RuntimeImageAttachmentDescriptor[]
  ): string | null {
    if (attachments.length === 0 || provider !== "claude-code") {
      return null;
    }

    const normalizedContent = content.trim();
    const attachmentLines = attachments
      .map((attachment, index) => `${index + 1}. ${attachment.filePath}`)
      .join("\n");

    return [
      normalizedContent,
      CLAUDE_ATTACHMENT_HEADER,
      "下面这些图片是用户随消息附带的本地图片。请先读取并理解它们，再继续处理这条请求。",
      attachmentLines,
      CLAUDE_ATTACHMENT_FOOTER
    ]
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
    attachment: SessionImageAttachmentInput,
    index: number
  ): SessionMessageAttachmentRecord {
    const mimeType = attachment.mimeType.trim().toLowerCase();
    const extension = SUPPORTED_IMAGE_EXTENSIONS.get(mimeType);

    if (!extension) {
      throw new Error("UNSUPPORTED_IMAGE_TYPE");
    }

    const buffer = Buffer.from(attachment.contentBase64, "base64");

    if (buffer.length === 0) {
      throw new Error("EMPTY_IMAGE_CONTENT");
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("IMAGE_TOO_LARGE");
    }

    const attachmentId = createId();
    const fileName = buildSafeFileName(attachment.fileName, index, extension);
    const storagePath = path.join(targetDir, `${attachmentId}-${fileName}`);
    fs.writeFileSync(storagePath, buffer);

    return {
      id: attachmentId,
      sessionId,
      clientRequestId,
      messageId: null,
      kind: "image",
      fileName,
      mimeType,
      fileSize: buffer.length,
      storagePath,
      createdAt: nowIso()
    };
  }
}

export function normalizeProviderMessageContent(provider: string, content: string): string {
  if (provider !== "claude-code") {
    return content;
  }

  const headerIndex = content.indexOf(CLAUDE_ATTACHMENT_HEADER);

  if (headerIndex < 0) {
    return content;
  }

  const footerIndex = content.indexOf(CLAUDE_ATTACHMENT_FOOTER, headerIndex);

  if (footerIndex < 0) {
    return content;
  }

  return content.slice(0, headerIndex).trimEnd();
}

function buildSafeFileName(fileName: string, index: number, extension: string): string {
  const normalized = path.basename(fileName || `image-${index + 1}${extension}`);
  const safeBase = normalized.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  const hasSupportedExtension = Array.from(SUPPORTED_IMAGE_EXTENSIONS.values()).some((value) =>
    safeBase.toLowerCase().endsWith(value)
  );

  if (safeBase.length === 0) {
    return `image-${index + 1}${extension}`;
  }

  return hasSupportedExtension ? safeBase : `${safeBase}${extension}`;
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
): RuntimeImageAttachmentDescriptor {
  return {
    ...toMessageAttachmentDto(record),
    filePath: record.storagePath
  };
}
