export interface InlineImagePreview {
  url: string;
  mimeType: string;
  altText: string | null;
  estimatedBytes: number | null;
}

export interface ParsedMessageRichContent {
  text: string;
  inlineImages: InlineImagePreview[];
}

const DATA_IMAGE_URL_PATTERN = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const MARKDOWN_DATA_IMAGE_PATTERN = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g;
const HTML_DATA_IMAGE_PATTERN = /<img\b[^>]*src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)["'][^>]*>/gi;
const CUSTOM_IMAGE_BLOCK_PATTERN = /<image\b([^>]*)>([\s\S]*?)<\/image>/gi;

export function parseMessageRichContent(content: string): ParsedMessageRichContent {
  const parsedStructuredContent = parseStructuredRichContent(content);

  if (parsedStructuredContent) {
    return parsedStructuredContent;
  }

  return extractInlineImagesFromText(content);
}

function parseStructuredRichContent(content: string): ParsedMessageRichContent | null {
  const normalized = content.trim();

  if (!looksLikeStructuredContent(normalized)) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const richContent = collectRichContentFromValue(parsed);
    return richContent.text || richContent.inlineImages.length > 0 ? richContent : null;
  } catch {
    return null;
  }
}

function looksLikeStructuredContent(content: string): boolean {
  if (content.length < 2) {
    return false;
  }

  return (
    (content.startsWith("[") && content.endsWith("]")) ||
    (content.startsWith("{") && content.endsWith("}"))
  );
}

function collectRichContentFromValue(value: unknown): ParsedMessageRichContent {
  const textSegments: string[] = [];
  const inlineImages: InlineImagePreview[] = [];

  visitRichContentValue(value, textSegments, inlineImages);

  return {
    text: normalizeDisplayText(textSegments.join("\n\n")),
    inlineImages: dedupeInlineImages(inlineImages)
  };
}

function visitRichContentValue(
  value: unknown,
  textSegments: string[],
  inlineImages: InlineImagePreview[]
): void {
  if (typeof value === "string") {
    const extracted = extractInlineImagesFromText(value);

    if (extracted.text) {
      textSegments.push(extracted.text);
    }

    inlineImages.push(...extracted.inlineImages);
    return;
  }

  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => visitRichContentValue(item, textSegments, inlineImages));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const handledKeys = new Set<string>();
  const structuredInlineImage = extractInlineImagePreviewFromRecord(record);

  if (structuredInlineImage) {
    inlineImages.push(structuredInlineImage);

    [
      "type",
      "source",
      "media_type",
      "mime_type",
      "mimeType",
      "data",
      "image_url",
      "imageUrl",
      "url",
      "src",
      "alt",
      "name"
    ].forEach((key) => {
      if (key in record) {
        handledKeys.add(key);
      }
    });
  }

  for (const key of ["image_url", "url", "src", "source"]) {
    const rawValue = record[key];

    if (typeof rawValue !== "string" || !isInlineDataImageUrl(rawValue)) {
      continue;
    }

    inlineImages.push(buildInlineImagePreview(rawValue, ensureText(record.alt)));
    handledKeys.add(key);
  }

  for (const key of ["text", "message", "content", "output", "result", "summary", "caption"]) {
    if (!(key in record)) {
      continue;
    }

    handledKeys.add(key);
    visitRichContentValue(record[key], textSegments, inlineImages);
  }

  if (handledKeys.size > 0) {
    return;
  }

  Object.values(record).forEach((entry) => {
    visitRichContentValue(entry, textSegments, inlineImages);
  });
}

function extractInlineImagesFromText(content: string): ParsedMessageRichContent {
  const inlineImages: InlineImagePreview[] = [];
  let nextContent = content;

  nextContent = nextContent.replace(CUSTOM_IMAGE_BLOCK_PATTERN, (_match, attributeSource, blockContent) => {
    const name = readImageAttribute(attributeSource, "name");
    const parsedImageBlock = parseCustomImageBlock(blockContent);

    if (parsedImageBlock?.url) {
      inlineImages.push(buildInlineImagePreview(parsedImageBlock.url, parsedImageBlock.altText || name));
    }

    return "";
  });

  nextContent = nextContent.replace(MARKDOWN_DATA_IMAGE_PATTERN, (_match, altText, url) => {
    inlineImages.push(buildInlineImagePreview(url, altText));
    return "";
  });

  nextContent = nextContent.replace(HTML_DATA_IMAGE_PATTERN, (_match, url) => {
    inlineImages.push(buildInlineImagePreview(url, null));
    return "";
  });

  nextContent = nextContent.replace(DATA_IMAGE_URL_PATTERN, (match, mimeSubtype, base64Content) => {
    inlineImages.push(
      buildInlineImagePreview(
        match,
        null,
        `image/${mimeSubtype}`,
        estimateBase64Bytes(base64Content)
      )
    );
    return "";
  });

  return {
    text: normalizeDisplayText(nextContent),
    inlineImages: dedupeInlineImages(inlineImages)
  };
}

function buildInlineImagePreview(
  url: string,
  altText: string | null,
  mimeType?: string,
  estimatedBytes?: number | null
): InlineImagePreview {
  const resolvedMimeType = mimeType ?? resolveMimeTypeFromDataUrl(url) ?? "image/png";

  return {
    url,
    mimeType: resolvedMimeType,
    altText: normalizeOptionalText(altText),
    estimatedBytes: estimatedBytes ?? estimateBase64BytesFromDataUrl(url)
  };
}

function extractInlineImagePreviewFromRecord(record: Record<string, unknown>): InlineImagePreview | null {
  const sourceRecord = asRecord(record.source);

  if (sourceRecord) {
    const sourceType = ensureText(sourceRecord.type).trim().toLowerCase();
    const mediaType = normalizeImageMediaType(sourceRecord.media_type ?? sourceRecord.mime_type ?? sourceRecord.mimeType);
    const payload = normalizeBase64Payload(sourceRecord.data);

    if (sourceType === "base64" && mediaType && payload) {
      return buildInlineImagePreview(
        `data:${mediaType};base64,${payload}`,
        normalizeOptionalText(ensureText(sourceRecord.alt) || ensureText(sourceRecord.name) || ensureText(record.alt) || ensureText(record.name)),
        mediaType,
        estimateBase64Bytes(payload)
      );
    }
  }

  const mediaType = normalizeImageMediaType(record.media_type ?? record.mime_type ?? record.mimeType);
  const payload = normalizeBase64Payload(record.data);

  if (mediaType && payload) {
    return buildInlineImagePreview(
      `data:${mediaType};base64,${payload}`,
      normalizeOptionalText(ensureText(record.alt) || ensureText(record.name)),
      mediaType,
      estimateBase64Bytes(payload)
    );
  }

  return null;
}

function dedupeInlineImages(images: InlineImagePreview[]): InlineImagePreview[] {
  const uniqueImages = new Map<string, InlineImagePreview>();

  images.forEach((image) => {
    if (!uniqueImages.has(image.url)) {
      uniqueImages.set(image.url, image);
    }
  });

  return [...uniqueImages.values()];
}

function normalizeDisplayText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isInlineDataImageUrl(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value.trim());
}

function resolveMimeTypeFromDataUrl(url: string): string | null {
  const matched = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  return matched?.[1]?.toLowerCase() ?? null;
}

function estimateBase64BytesFromDataUrl(url: string): number | null {
  const matched = url.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i);
  return matched ? estimateBase64Bytes(matched[1]) : null;
}

function estimateBase64Bytes(contentBase64: string): number {
  const normalized = contentBase64.trim();
  const paddingLength = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingLength);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = ensureText(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBase64Payload(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").trim();
  return /^[A-Za-z0-9+/=]+$/.test(normalized) ? normalized : null;
}

function normalizeImageMediaType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("image/") ? normalized : null;
}

function ensureText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseCustomImageBlock(
  blockContent: string
): { url: string | null; altText: string | null } | null {
  const normalized = blockContent.trim();

  if (normalized.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const imageUrl = ensureText(parsed.image_url ?? parsed.imageUrl).trim();
    const altText = normalizeOptionalText(ensureText(parsed.name) || ensureText(parsed.alt));

    return {
      url: isInlineDataImageUrl(imageUrl) ? imageUrl : null,
      altText
    };
  } catch {
    const matched = normalized.match(/(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/i);

    if (!matched) {
      return null;
    }

    return {
      url: matched[1],
      altText: null
    };
  }
}

function readImageAttribute(attributeSource: string, attributeName: string): string | null {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = attributeSource.match(
    new RegExp(`${escapedName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|\\[([^\\]]*)\\]|([^\\s>]+))`, "i")
  );

  return normalizeOptionalText(matched?.[1] ?? matched?.[2] ?? matched?.[3] ?? matched?.[4] ?? "");
}
