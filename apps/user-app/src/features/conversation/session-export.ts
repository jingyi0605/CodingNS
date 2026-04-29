import { t } from "../../shared/i18n";
import { getSessionMessages, type SessionSummaryDto } from "./api/conversation-api";
import { toViewMessage, type SessionMessageViewModel } from "./runtime/session-runtime-machine";

const SESSION_EXPORT_PAGE_SIZE = 200;

export interface SessionExportSnapshot {
  messages: SessionMessageViewModel[];
}

export async function loadSessionExportSnapshot(sessionId: string): Promise<SessionExportSnapshot> {
  const messages: SessionMessageViewModel[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    if (cursor && visitedCursors.has(cursor)) {
      break;
    }

    if (cursor) {
      visitedCursors.add(cursor);
    }

    const page = await getSessionMessages(sessionId, cursor, SESSION_EXPORT_PAGE_SIZE, "forward");
    const pageMessages = page.messages.map((message) => toViewMessage(sessionId, message));
    messages.push(...pageMessages);

    if (!page.nextCursor || page.nextCursor === cursor || pageMessages.length === 0) {
      break;
    }

    cursor = page.nextCursor;
  }

  return { messages };
}

export function buildSessionExportFileName(
  session: SessionSummaryDto,
  extension: "md" | "pdf" | "html",
  exportedAt = new Date()
): string {
  const safeTitle = sanitizeFileName(session.title || t("conversation.titleFallback"));
  return `${safeTitle}-${formatExportTimestamp(exportedAt)}.${extension}`;
}

export function buildSessionMarkdownExport(
  session: SessionSummaryDto,
  messages: SessionMessageViewModel[],
  exportedAt = new Date()
): string {
  const title = (session.title || t("conversation.titleFallback")).trim() || t("conversation.titleFallback");
  const lines = [
    `# ${title}`,
    "",
    `${t("conversation.exportMarkdownSessionIdLabel")}：\`${session.sessionId}\``,
    `${t("conversation.exportMarkdownProviderLabel")}：${session.provider}`,
    `${t("conversation.exportMarkdownWorkspaceLabel")}：\`${session.workspaceId}\``,
    `${t("conversation.exportMarkdownCreatedAtLabel")}：${formatExportDateTime(session.createdAt)}`,
    `${t("conversation.exportMarkdownExportedAtLabel")}：${formatExportDateTime(exportedAt.toISOString())}`,
    ""
  ];

  messages.forEach((message, index) => {
    lines.push(`## ${index + 1}. ${resolveMessageHeading(message)}`);
    lines.push("");
    lines.push(`- ${t("conversation.exportMarkdownTimeLabel")}：${formatExportDateTime(message.timestamp)}`);
    lines.push(`- ${t("conversation.exportMarkdownTypeLabel")}：${resolveMessageTypeLabel(message)}`);

    if ((message.attachments?.length ?? 0) > 0) {
      lines.push(`- ${t("conversation.exportMarkdownAttachmentsLabel")}：${message.attachments!.length}`);
    }

    lines.push("");

    if (message.content.trim()) {
      lines.push(message.content);
      lines.push("");
    }

    if (message.toolCall) {
      lines.push(`### ${t("conversation.exportMarkdownToolSectionTitle")}`);
      lines.push("");
      lines.push(`- ${t("conversation.exportMarkdownToolNameLabel")}：${message.toolCall.name}`);
      lines.push(`- ${t("conversation.exportMarkdownToolStatusLabel")}：${message.toolCall.status}`);
      lines.push("");

      if (message.toolCall.input.trim()) {
        lines.push(`#### ${t("conversation.exportMarkdownToolInputLabel")}`);
        lines.push("");
        lines.push("```text");
        lines.push(message.toolCall.input);
        lines.push("```");
        lines.push("");
      }

      if ((message.toolCall.output ?? "").trim()) {
        lines.push(`#### ${t("conversation.exportMarkdownToolOutputLabel")}`);
        lines.push("");
        lines.push("```text");
        lines.push(message.toolCall.output ?? "");
        lines.push("```");
        lines.push("");
      }

      if ((message.toolCall.error ?? "").trim()) {
        lines.push(`#### ${t("conversation.exportMarkdownToolErrorLabel")}`);
        lines.push("");
        lines.push("```text");
        lines.push(message.toolCall.error ?? "");
        lines.push("```");
        lines.push("");
      }
    }

    if ((message.attachments?.length ?? 0) > 0) {
      lines.push(`### ${t("conversation.exportMarkdownAttachmentsSectionTitle")}`);
      lines.push("");

      message.attachments?.forEach((attachment) => {
        lines.push(
          `- ${attachment.fileName} (${attachment.kind}, ${attachment.mimeType}, ${formatAttachmentSize(attachment.fileSize)})`
        );
      });

      lines.push("");
    }
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

export function downloadTextFile(fileName: string, content: string, mimeType = "text/plain;charset=utf-8"): void {
  if (typeof document === "undefined") {
    throw new Error(t("conversation.exportDownloadFailed"));
  }

  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function downloadBinaryFile(
  fileName: string,
  content: Uint8Array,
  mimeType = "application/octet-stream"
): void {
  if (typeof document === "undefined") {
    throw new Error(t("conversation.exportDownloadFailed"));
  }

  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  const blob = new Blob([bytes], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function buildSessionPdfExport(
  session: SessionSummaryDto,
  messages: SessionMessageViewModel[],
  exportedAt = new Date()
): Uint8Array {
  const documentTitle = (session.title || t("conversation.titleFallback")).trim() || t("conversation.titleFallback");
  const metaLines = [
    `${t("conversation.exportMarkdownSessionIdLabel")}：${session.sessionId}`,
    `${t("conversation.exportMarkdownProviderLabel")}：${session.provider}`,
    `${t("conversation.exportMarkdownWorkspaceLabel")}：${session.workspaceId}`,
    `${t("conversation.exportMarkdownCreatedAtLabel")}：${formatExportDateTime(session.createdAt)}`,
    `${t("conversation.exportMarkdownExportedAtLabel")}：${formatExportDateTime(exportedAt.toISOString())}`
  ];

  const layout = new SessionPdfLayoutEngine();
  layout.renderDocumentHeader(documentTitle, metaLines);

  messages.forEach((message, index) => {
    layout.renderMessageCard(index, message);
  });

  return buildPdfDocument(layout.finish());
}

export function buildStandaloneSessionExportHtml(input: {
  title: string;
  bodyHtml: string;
  styleText: string;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  htmlStyle?: string | null;
  bodyStyle?: string | null;
}): string {
  const htmlAttributes = serializeAttributes(input.htmlAttributes, input.htmlStyle);
  const bodyAttributes = serializeAttributes(input.bodyAttributes, input.bodyStyle);

  return [
    "<!DOCTYPE html>",
    `<html${htmlAttributes}>`,
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>${input.styleText}</style>`,
    "</head>",
    `<body${bodyAttributes}>`,
    input.bodyHtml,
    "</body>",
    "</html>"
  ].join("");
}

function resolveMessageHeading(message: SessionMessageViewModel): string {
  return `${resolveMessageRoleLabel(message)} · ${formatExportDateTime(message.timestamp)}`;
}

function resolveMessageRoleLabel(message: SessionMessageViewModel): string {
  switch (message.role) {
    case "user":
      return t("conversation.roleUser");
    case "assistant":
      return t("conversation.roleAssistant");
    case "tool":
      return t("conversation.roleTool");
    case "system":
    default:
      return t("conversation.roleSystem");
  }
}

function resolveMessageTypeLabel(message: SessionMessageViewModel): string {
  if (message.kind === "thinking") {
    return t("conversation.thinkingLabel");
  }

  if (message.kind === "tool_call") {
    return t("conversation.exportMarkdownToolCallType");
  }

  if (message.kind === "tool_result") {
    return t("conversation.exportMarkdownToolResultType");
  }

  return t("conversation.exportMarkdownTextType");
}

function formatExportDateTime(value: string): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function formatExportTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function formatAttachmentSize(fileSize: number): string {
  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return t("conversation.exportMarkdownUnknownSize");
  }

  if (fileSize < 1024) {
    return `${fileSize} B`;
  }

  if (fileSize < 1024 * 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(input: string): string {
  const normalized = input.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return normalized || "session";
}

function serializeAttributes(attributes?: Record<string, string>, style?: string | null): string {
  const entries = Object.entries(attributes ?? {}).filter(([, value]) => value.trim().length > 0);

  if (style?.trim()) {
    entries.push(["style", style.trim()]);
  }

  if (entries.length === 0) {
    return "";
  }

  return ` ${entries.map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`).join(" ")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

const PDF_PAGE_WIDTH_PT = 595.28;
const PDF_PAGE_HEIGHT_PT = 841.89;
const PDF_MARGIN_TOP_PT = 40;
const PDF_MARGIN_BOTTOM_PT = 40;
const PDF_MARGIN_X_PT = 36;
const PDF_CONTENT_WIDTH_PT = PDF_PAGE_WIDTH_PT - PDF_MARGIN_X_PT * 2;
const PDF_CARD_GAP_PT = 14;
const PDF_CARD_PADDING_X_PT = 12;
const PDF_CARD_PADDING_Y_PT = 12;
const PDF_CARD_MIN_SEGMENT_HEIGHT_PT = 72;
const PDF_BODY_FONT_SIZE_PT = 11;
const PDF_META_FONT_SIZE_PT = 9;
const PDF_HEADER_FONT_SIZE_PT = 12;
const PDF_TITLE_FONT_SIZE_PT = 20;
type PdfRgb = readonly [number, number, number];

interface PdfRenderableLine {
  text: string;
  fontSize: number;
  color: PdfRgb;
  gapBefore: number;
  fontKind: "sans" | "mono";
}

interface PdfMessageBlock {
  header: string;
  headerColor: PdfRgb;
  backgroundColor: PdfRgb;
  borderColor: PdfRgb;
  lines: PdfRenderableLine[];
}

class SessionPdfLayoutEngine {
  private readonly pages: string[][] = [[]];
  private cursorTop = PDF_MARGIN_TOP_PT;

  renderDocumentHeader(title: string, metaLines: string[]): void {
    this.drawRichText(title, PDF_MARGIN_X_PT, this.cursorTop, PDF_TITLE_FONT_SIZE_PT, [15, 23, 42], "sans");
    this.cursorTop += PDF_TITLE_FONT_SIZE_PT + 8;

    metaLines.forEach((line) => {
      this.drawRichText(line, PDF_MARGIN_X_PT, this.cursorTop, PDF_META_FONT_SIZE_PT, [71, 85, 105], "sans");
      this.cursorTop += lineHeightForFontSize(PDF_META_FONT_SIZE_PT);
    });

    this.cursorTop += 18;
  }

  renderMessageCard(index: number, message: SessionMessageViewModel): void {
    const block = buildPdfMessageBlock(index, message);
    let lineIndex = 0;
    let continuationIndex = 0;

    while (lineIndex < block.lines.length || continuationIndex === 0) {
      this.ensureVerticalSpace(PDF_CARD_MIN_SEGMENT_HEIGHT_PT);
      const segment = this.pickSegmentLines(block.lines, lineIndex);

      if (segment.count === 0 && block.lines.length > 0) {
        segment.lines.push(block.lines[lineIndex]);
        segment.count = 1;
        segment.height = lineHeightForFontSize(block.lines[lineIndex].fontSize);
      }

      const segmentHeader =
        continuationIndex === 0
          ? block.header
          : `${block.header} · 续`;
      const segmentHeight =
        PDF_CARD_PADDING_Y_PT * 2
        + lineHeightForFontSize(PDF_HEADER_FONT_SIZE_PT)
        + 8
        + Math.max(segment.height, 0);

      this.ensureVerticalSpace(segmentHeight);
      this.drawCardSegment(block, segmentHeader, segment.lines, segment.height);

      this.cursorTop += segmentHeight + PDF_CARD_GAP_PT;
      lineIndex += segment.count;
      continuationIndex += 1;

      if (block.lines.length === 0) {
        break;
      }
    }
  }

  finish(): string[] {
    return this.pages.map((commands) => commands.join("\n"));
  }

  private drawCardSegment(
    block: PdfMessageBlock,
    header: string,
    lines: PdfRenderableLine[],
    linesHeight: number
  ): void {
    const segmentHeight =
      PDF_CARD_PADDING_Y_PT * 2
      + lineHeightForFontSize(PDF_HEADER_FONT_SIZE_PT)
      + 8
      + Math.max(linesHeight, 0);
    const rectTop = this.cursorTop;
    const rectBottom = PDF_PAGE_HEIGHT_PT - rectTop - segmentHeight;

    this.pushCommand(
      `${formatPdfRgb(block.backgroundColor)} rg ${formatPdfRgb(block.borderColor)} RG 1 w ${formatPdfNumber(PDF_MARGIN_X_PT)} ${formatPdfNumber(rectBottom)} ${formatPdfNumber(PDF_CONTENT_WIDTH_PT)} ${formatPdfNumber(segmentHeight)} re B`
    );

    let top = rectTop + PDF_CARD_PADDING_Y_PT;
    this.drawRichText(
      header,
      PDF_MARGIN_X_PT + PDF_CARD_PADDING_X_PT,
      top,
      PDF_HEADER_FONT_SIZE_PT,
      block.headerColor,
      "sans"
    );
    top += lineHeightForFontSize(PDF_HEADER_FONT_SIZE_PT) + 8;

    lines.forEach((line) => {
      top += line.gapBefore;
      this.drawRichText(
        line.text,
        PDF_MARGIN_X_PT + PDF_CARD_PADDING_X_PT,
        top,
        line.fontSize,
        line.color,
        line.fontKind
      );
      top += lineHeightForFontSize(line.fontSize);
    });
  }

  private pickSegmentLines(lines: PdfRenderableLine[], startIndex: number): {
    lines: PdfRenderableLine[];
    count: number;
    height: number;
  } {
    const result = {
      lines: [] as PdfRenderableLine[],
      count: 0,
      height: 0
    };
    const availableHeight =
      PDF_PAGE_HEIGHT_PT - this.cursorTop - PDF_MARGIN_BOTTOM_PT
      - PDF_CARD_PADDING_Y_PT * 2
      - lineHeightForFontSize(PDF_HEADER_FONT_SIZE_PT)
      - 8;

    if (availableHeight <= 0) {
      return result;
    }

    let consumedHeight = 0;

    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      const nextHeight = consumedHeight + line.gapBefore + lineHeightForFontSize(line.fontSize);

      if (result.count > 0 && nextHeight > availableHeight) {
        break;
      }

      result.lines.push(line);
      result.count += 1;
      consumedHeight = nextHeight;
    }

    result.height = consumedHeight;
    return result;
  }

  private ensureVerticalSpace(requiredHeight: number): void {
    if (this.cursorTop + requiredHeight <= PDF_PAGE_HEIGHT_PT - PDF_MARGIN_BOTTOM_PT) {
      return;
    }

    this.pages.push([]);
    this.cursorTop = PDF_MARGIN_TOP_PT;
  }

  private drawRichText(
    text: string,
    left: number,
    top: number,
    fontSize: number,
    color: PdfRgb,
    fontKind: PdfRenderableLine["fontKind"]
  ): void {
    const baselineY = PDF_PAGE_HEIGHT_PT - top - fontSize;
    let cursorLeft = left;
    const runs = segmentPdfTextRuns(text, fontKind);

    runs.forEach((run) => {
      if (!run.text) {
        return;
      }

      if (run.fontRef === "F1") {
        cursorLeft = this.drawPdfUnicodeRun(run.text, cursorLeft, baselineY, fontSize, color);
        return;
      }

      this.pushCommand(
        `BT /${run.fontRef} ${formatPdfNumber(fontSize)} Tf ${formatPdfRgb(color)} rg 1 0 0 1 ${formatPdfNumber(cursorLeft)} ${formatPdfNumber(baselineY)} Tm (${escapePdfLiteralString(run.text)}) Tj ET`
      );
      cursorLeft += measurePdfRunWidth(run.text, fontSize, run.fontRef);
    });
  }

  private drawPdfUnicodeRun(
    text: string,
    left: number,
    baselineY: number,
    fontSize: number,
    color: PdfRgb
  ): number {
    let cursorLeft = left;

    for (const character of Array.from(text)) {
      this.pushCommand(
        `BT /F1 ${formatPdfNumber(fontSize)} Tf ${formatPdfRgb(color)} rg 1 0 0 1 ${formatPdfNumber(cursorLeft)} ${formatPdfNumber(baselineY)} Tm <${encodePdfUnicodeHex(character)}> Tj ET`
      );
      cursorLeft += estimatePdfCharacterWidth(character, fontSize, "F1");
    }

    return cursorLeft;
  }

  private pushCommand(command: string): void {
    this.pages[this.pages.length - 1]?.push(command);
  }
}

function buildPdfMessageBlock(index: number, message: SessionMessageViewModel): PdfMessageBlock {
  const theme = resolvePdfMessageTheme(message.role);
  const cardWidth = PDF_CONTENT_WIDTH_PT - PDF_CARD_PADDING_X_PT * 2;
  const lines: PdfRenderableLine[] = [];
  const heading = `${index + 1}. ${resolveMessageHeading(message)}`;

  if (message.content.trim()) {
    appendWrappedPdfTextLines(lines, message.content, cardWidth, PDF_BODY_FONT_SIZE_PT, [15, 23, 42], 0, "sans");
  }

  if (message.toolCall) {
    const toolHeading = `${t("conversation.exportMarkdownToolSectionTitle")} · ${message.toolCall.name} · ${message.toolCall.status}`;
    appendWrappedPdfTextLines(lines, toolHeading, cardWidth, PDF_BODY_FONT_SIZE_PT, [30, 41, 59], 10, "sans");

    if (message.toolCall.input.trim()) {
      appendWrappedPdfTextLines(
        lines,
        `${t("conversation.exportMarkdownToolInputLabel")}：${message.toolCall.input}`,
        cardWidth,
        PDF_META_FONT_SIZE_PT,
        [71, 85, 105],
        6,
        "mono"
      );
    }

    if ((message.toolCall.output ?? "").trim()) {
      appendWrappedPdfTextLines(
        lines,
        `${t("conversation.exportMarkdownToolOutputLabel")}：${message.toolCall.output ?? ""}`,
        cardWidth,
        PDF_META_FONT_SIZE_PT,
        [71, 85, 105],
        6,
        "mono"
      );
    }

    if ((message.toolCall.error ?? "").trim()) {
      appendWrappedPdfTextLines(
        lines,
        `${t("conversation.exportMarkdownToolErrorLabel")}：${message.toolCall.error ?? ""}`,
        cardWidth,
        PDF_META_FONT_SIZE_PT,
        [185, 28, 28],
        6,
        "mono"
      );
    }
  }

  if ((message.attachments?.length ?? 0) > 0) {
    appendWrappedPdfTextLines(
      lines,
      t("conversation.exportMarkdownAttachmentsSectionTitle"),
      cardWidth,
      PDF_BODY_FONT_SIZE_PT,
      [30, 41, 59],
      10,
      "sans"
    );

    message.attachments?.forEach((attachment) => {
      appendWrappedPdfTextLines(
        lines,
        `- ${attachment.fileName} (${attachment.kind}, ${attachment.mimeType}, ${formatAttachmentSize(attachment.fileSize)})`,
        cardWidth,
        PDF_META_FONT_SIZE_PT,
        [71, 85, 105],
        4,
        "sans"
      );
    });
  }

  if (lines.length === 0) {
    appendWrappedPdfTextLines(
      lines,
      t("conversation.exportMarkdownTextType"),
      cardWidth,
      PDF_BODY_FONT_SIZE_PT,
      [100, 116, 139],
      0,
      "sans"
    );
  }

  return {
    header: heading,
    headerColor: theme.headerColor,
    backgroundColor: theme.backgroundColor,
    borderColor: theme.borderColor,
    lines
  };
}

function resolvePdfMessageTheme(role: SessionMessageViewModel["role"]): {
  headerColor: PdfRgb;
  backgroundColor: PdfRgb;
  borderColor: PdfRgb;
} {
  switch (role) {
    case "user":
      return {
        headerColor: [30, 64, 175],
        backgroundColor: [239, 246, 255],
        borderColor: [191, 219, 254]
      };
    case "tool":
      return {
        headerColor: [6, 95, 70],
        backgroundColor: [236, 253, 245],
        borderColor: [167, 243, 208]
      };
    case "system":
      return {
        headerColor: [71, 85, 105],
        backgroundColor: [248, 250, 252],
        borderColor: [226, 232, 240]
      };
    case "assistant":
    default:
      return {
        headerColor: [15, 23, 42],
        backgroundColor: [255, 255, 255],
        borderColor: [226, 232, 240]
      };
  }
}

function appendWrappedPdfTextLines(
  target: PdfRenderableLine[],
  text: string,
  maxWidth: number,
  fontSize: number,
  color: PdfRgb,
  gapBefore = 0,
  fontKind: PdfRenderableLine["fontKind"] = "sans"
): void {
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split("\n");

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const wrappedLines = wrapPdfText(paragraph, maxWidth, fontSize, fontKind);

    if (wrappedLines.length === 0) {
      target.push({
        text: " ",
        fontSize,
        color,
        gapBefore: paragraphIndex === 0 ? gapBefore : 4,
        fontKind
      });
      return;
    }

    wrappedLines.forEach((line, lineIndex) => {
      target.push({
        text: line,
        fontSize,
        color,
        gapBefore:
          paragraphIndex === 0 && lineIndex === 0
            ? gapBefore
            : lineIndex === 0
              ? 4
              : 0,
        fontKind
      });
    });
  });
}

function wrapPdfText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontKind: PdfRenderableLine["fontKind"]
): string[] {
  if (!text.trim()) {
    return [];
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  const lineFontRef = resolvePdfLineFontRef(text, fontKind);

  for (const character of Array.from(text)) {
    const charWidth = estimatePdfCharacterWidth(character, fontSize, lineFontRef);

    if (current && currentWidth + charWidth > maxWidth) {
      lines.push(current.trimEnd());
      current = character;
      currentWidth = charWidth;
      continue;
    }

    current += character;
    currentWidth += charWidth;
  }

  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }

  return lines;
}

function estimatePdfCharacterWidth(character: string, fontSize: number, fontRef: "F1" | "F2" | "F3"): number {
  if (fontRef === "F1") {
    return fontSize * (estimatePdfCjkFontGlyphWidth(character) / 1000);
  }

  const width = fontRef === "F3" ? 600 : PDF_HELVETICA_GLYPH_WIDTHS[character] ?? 556;
  return fontSize * (width / 1000);
}

function lineHeightForFontSize(fontSize: number): number {
  return fontSize * 1.5;
}

function formatPdfRgb(color: PdfRgb): string {
  return color.map((value) => formatPdfNumber(value / 255)).join(" ");
}

function formatPdfNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function encodePdfUnicodeHex(text: string): string {
  const codeUnits = Array.from(text).flatMap((character) => {
    const codePoint = character.codePointAt(0) ?? 0x20;

    if (codePoint <= 0xffff) {
      return [codePoint];
    }

    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + ((adjusted >> 10) & 0x3ff);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return [high, low];
  });

  const bytes = [0xfe, 0xff, ...codeUnits.flatMap((unit) => [(unit >> 8) & 0xff, unit & 0xff])];
  return bytes.map((value) => value.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function segmentPdfTextRuns(
  text: string,
  fontKind: PdfRenderableLine["fontKind"]
): Array<{ text: string; fontRef: "F1" | "F2" | "F3" }> {
  if (!text) {
    return [];
  }

  const lineFontRef = resolvePdfLineFontRef(text, fontKind);
  return [{ text, fontRef: lineFontRef }];
}

function resolvePdfLineFontRef(text: string, fontKind: PdfRenderableLine["fontKind"]): "F1" | "F2" | "F3" {
  void text;
  void fontKind;
  return "F1";
}

function resolvePdfFontRefForCharacter(
  character: string,
  fontKind: PdfRenderableLine["fontKind"]
): "F1" | "F2" | "F3" {
  return isPdfAsciiCharacter(character)
    ? fontKind === "mono"
      ? "F3"
      : "F2"
    : "F1";
}

function isPdfAsciiCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x20 && codePoint <= 0x7e;
}

function measurePdfRunWidth(text: string, fontSize: number, fontRef: "F1" | "F2" | "F3"): number {
  return Array.from(text).reduce((total, character) => total + estimatePdfCharacterWidth(character, fontSize, fontRef), 0);
}

function estimatePdfCjkFontGlyphWidth(character: string): number {
  if (isPdfAsciiCharacter(character)) {
    return PDF_HELVETICA_GLYPH_WIDTHS[character] ?? 556;
  }

  if (character === " ") {
    return 278;
  }

  return 1000;
}

function escapePdfLiteralString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/\(/gu, "\\(").replace(/\)/gu, "\\)");
}

const PDF_HELVETICA_GLYPH_WIDTHS: Record<string, number> = {
  " ": 278,
  "!": 278,
  '"': 355,
  "#": 556,
  "$": 556,
  "%": 889,
  "&": 667,
  "'": 191,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  ":": 278,
  ";": 278,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 556,
  "@": 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  "[": 278,
  "\\": 278,
  "]": 278,
  "^": 469,
  _: 556,
  "`": 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  "{": 334,
  "|": 260,
  "}": 334,
  "~": 584
};

function buildPdfDocument(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const contentObjectNumbers: number[] = [];
  const fontObjectNumber = 3;
  const cidFontObjectNumber = 4;
  const helveticaObjectNumber = 5;
  const courierObjectNumber = 6;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[fontObjectNumber] =
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontObjectNumber} 0 R] >>`;
  objects[cidFontObjectNumber] =
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>";
  objects[helveticaObjectNumber] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[courierObjectNumber] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  let nextObjectNumber = 7;

  pageStreams.forEach((stream) => {
    const pageObjectNumber = nextObjectNumber;
    const contentObjectNumber = nextObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    contentObjectNumbers.push(contentObjectNumber);
    nextObjectNumber += 2;

    const encodedStream = new TextEncoder().encode(stream);
    objects[contentObjectNumber] =
      `<< /Length ${encodedStream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectNumber] = [
      "<< /Type /Page",
      "/Parent 2 0 R",
      `/MediaBox [0 0 ${formatPdfNumber(PDF_PAGE_WIDTH_PT)} ${formatPdfNumber(PDF_PAGE_HEIGHT_PT)}]`,
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R /F2 ${helveticaObjectNumber} 0 R /F3 ${courierObjectNumber} 0 R >> >>`,
      `/Contents ${contentObjectNumber} 0 R`,
      ">>"
    ].join(" ");
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  const objectCount = objects.filter(Boolean).length;
  const chunks: string[] = ["%PDF-1.4\n%----\n"];
  const offsets: number[] = [0];
  let currentOffset = new TextEncoder().encode(chunks[0]).length;

  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    const body = objects[objectNumber];

    if (!body) {
      continue;
    }

    offsets[objectNumber] = currentOffset;
    const serialized = `${objectNumber} 0 obj\n${body}\nendobj\n`;
    chunks.push(serialized);
    currentOffset += new TextEncoder().encode(serialized).length;
  }

  const xrefOffset = currentOffset;
  const xrefLines = [
    "xref",
    `0 ${objectCount + 1}`,
    "0000000000 65535 f "
  ];

  for (let objectNumber = 1; objectNumber < offsets.length; objectNumber += 1) {
    const offset = offsets[objectNumber];

    if (typeof offset !== "number") {
      continue;
    }

    xrefLines.push(`${String(offset).padStart(10, "0")} 00000 n `);
  }

  chunks.push(`${xrefLines.join("\n")}\n`);
  chunks.push(
    [
      "trailer",
      `<< /Size ${objectCount + 1} /Root 1 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF"
    ].join("\n")
  );

  return new TextEncoder().encode(chunks.join(""));
}
