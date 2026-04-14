import type Database from "better-sqlite3";

import type { FrameworkAnalysisResult } from "../../types/domain.js";

export class FrameworkAnalysisResultRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: FrameworkAnalysisResult): FrameworkAnalysisResult {
    this.db
      .prepare(
        `INSERT INTO framework_analysis_results (
          id,
          target_id,
          service_id,
          primary_framework,
          confidence,
          compatibility_level,
          recommended_injection_mode,
          requires_service_discovery_handling,
          requires_hmr_handling,
          requires_callback_handling,
          ai_fallback_policy,
          reasons_json,
          detected_files_json,
          raw_evidence_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.targetId,
        record.serviceId ?? null,
        record.primaryFramework ?? null,
        record.confidence,
        record.compatibilityLevel,
        record.recommendedInjectionMode ?? null,
        record.requiresServiceDiscoveryHandling ? 1 : 0,
        record.requiresHmrHandling ? 1 : 0,
        record.requiresCallbackHandling ? 1 : 0,
        record.aiFallbackPolicy,
        JSON.stringify(record.reasons),
        JSON.stringify(record.detectedFiles),
        JSON.stringify(record.rawEvidence ?? {}),
        record.createdAt
      );

    return record;
  }

  listByTargetId(targetId: string): FrameworkAnalysisResult[] {
    return this.db
      .prepare(
        `SELECT
          id,
          target_id,
          service_id,
          primary_framework,
          confidence,
          compatibility_level,
          recommended_injection_mode,
          requires_service_discovery_handling,
          requires_hmr_handling,
          requires_callback_handling,
          ai_fallback_policy,
          reasons_json,
          detected_files_json,
          raw_evidence_json,
          created_at
        FROM framework_analysis_results
        WHERE target_id = ?
        ORDER BY created_at DESC`
      )
      .all(targetId)
      .map((row) => mapFrameworkAnalysisRow(row as FrameworkAnalysisRow));
  }

  deleteByTargetId(targetId: string): void {
    this.db
      .prepare(
        `DELETE FROM framework_analysis_results
         WHERE target_id = ?`
      )
      .run(targetId);
  }
}

interface FrameworkAnalysisRow {
  id: string;
  target_id: string;
  service_id: string | null;
  primary_framework: string | null;
  confidence: FrameworkAnalysisResult["confidence"];
  compatibility_level: FrameworkAnalysisResult["compatibilityLevel"];
  recommended_injection_mode: FrameworkAnalysisResult["recommendedInjectionMode"] | null;
  requires_service_discovery_handling: number;
  requires_hmr_handling: number;
  requires_callback_handling: number;
  ai_fallback_policy: FrameworkAnalysisResult["aiFallbackPolicy"];
  reasons_json: string;
  detected_files_json: string;
  raw_evidence_json: string;
  created_at: string;
}

function mapFrameworkAnalysisRow(row: FrameworkAnalysisRow): FrameworkAnalysisResult {
  return {
    id: row.id,
    targetId: row.target_id,
    serviceId: row.service_id,
    primaryFramework: row.primary_framework,
    confidence: row.confidence,
    compatibilityLevel: row.compatibility_level,
    recommendedInjectionMode: row.recommended_injection_mode,
    requiresServiceDiscoveryHandling: row.requires_service_discovery_handling === 1,
    requiresHmrHandling: row.requires_hmr_handling === 1,
    requiresCallbackHandling: row.requires_callback_handling === 1,
    aiFallbackPolicy: row.ai_fallback_policy,
    reasons: parseJsonStringArray(row.reasons_json),
    detectedFiles: parseJsonStringArray(row.detected_files_json),
    rawEvidence: parseJsonObject(row.raw_evidence_json),
    createdAt: row.created_at
  };
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
