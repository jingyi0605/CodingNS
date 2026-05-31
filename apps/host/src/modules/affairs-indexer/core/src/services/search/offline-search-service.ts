import fs from "node:fs";
import path from "node:path";
import { AppError, APP_ERROR_CODES, type RuntimeConfig } from "../../../../contracts/src/index.js";
import type { SearchDocumentResult } from "../../repositories/catalog-repository.js";

interface SearchBucketPosting {
  term: string;
  document_count: number;
  document_ids: string[];
}

interface SearchBucketDocument {
  document_id: string;
  path: string;
  title: string;
  summary: string;
  mtime: string;
  tags: string[];
}

interface SearchBucketPayload {
  documents?: SearchBucketDocument[];
  terms?: SearchBucketPosting[];
}

interface LegacySearchBucketPosting {
  term: string;
  document_count: number;
  postings: Array<{
    document_id: string;
    path: string;
    title: string;
    summary: string;
    mtime: string;
    tags: string[];
  }>;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function bucketName(term: string): string {
  const first = term[0] ?? "_";
  if (/[a-z0-9]/.test(first)) {
    return first;
  }
  return "han";
}

/**
 * 离线搜索服务。
 * 优先读取 export-v2/search bucket，找不到再由上层决定是否回退 SQLite。
 */
export class OfflineSearchService {
  constructor(private readonly config: RuntimeConfig) {}

  search(query: string, limit = 20): SearchDocumentResult[] {
    const normalized = normalizeText(query);
    if (!normalized) {
      return [];
    }

    const manifestPath = path.join(this.config.exportV2Dir, "search", "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return [];
    }

    const bucket = bucketName(normalized);
    const bucketPath = path.join(this.config.exportV2Dir, "search", `${bucket}.json`);
    if (!fs.existsSync(bucketPath)) {
      return [];
    }

    let payload: SearchBucketPayload | { terms?: LegacySearchBucketPosting[] };
    try {
      payload = JSON.parse(fs.readFileSync(bucketPath, "utf-8")) as SearchBucketPayload | { terms?: LegacySearchBucketPosting[] };
    } catch (error) {
      throw new AppError(
        `离线搜索 bucket 解析失败：${bucketPath}`,
        APP_ERROR_CODES.SEARCH_INDEX_INVALID,
        {
          details: {
            bucketPath,
          },
          cause: error,
        },
      );
    }
    const matched = (payload.terms ?? []).find(item => item.term === normalized);
    if (!matched) {
      return [];
    }

    if ("document_ids" in matched) {
      const documents = new Map(
        (((payload as SearchBucketPayload).documents) ?? []).map(item => [item.document_id, item]),
      );
      return matched.document_ids
        .slice(0, limit)
        .map(documentId => documents.get(documentId))
        .filter((item): item is SearchBucketDocument => Boolean(item))
        .map(item => ({
          documentId: item.document_id,
          path: item.path,
          title: item.title,
          summary: item.summary,
          modifiedAt: item.mtime,
        }));
    }

    return matched.postings.slice(0, limit).map(item => ({
      documentId: item.document_id,
      path: item.path,
      title: item.title,
      summary: item.summary,
      modifiedAt: item.mtime,
    }));
  }
}
