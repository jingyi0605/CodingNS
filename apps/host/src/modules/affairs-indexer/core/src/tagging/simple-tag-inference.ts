import type { FileScanResult } from "../scanner/file-scanner.js";
import type { ParsedDocument } from "../parser/plain-text-parser.js";

export interface TagAssignment {
  tagPath: string;
  confidence: number;
  source: string;
  evidence: string;
  manualOverride?: boolean;
}

export interface TagInferenceResult {
  tags: TagAssignment[];
  derivedTags: TagAssignment[];
}

const EXTENSION_TYPE_TAGS = new Map<string, string>([
  [".md", "类型/文本/Markdown"],
  [".mdx", "类型/文本/Markdown"],
  [".txt", "类型/文本/纯文本"],
  [".rtf", "类型/文本/RTF"],
  [".html", "类型/文本/HTML"],
  [".htm", "类型/文本/HTML"],
  [".pdf", "类型/办公/PDF"],
  [".doc", "类型/办公/Word"],
  [".docx", "类型/办公/Word"],
  [".wps", "类型/办公/Word"],
  [".ppt", "类型/办公/PPT"],
  [".pptx", "类型/办公/PPT"],
  [".xls", "类型/办公/Excel"],
  [".xlsx", "类型/办公/Excel"],
  [".csv", "类型/表格/CSV"],
]);

function setTag(target: Map<string, TagAssignment>, assignment: TagAssignment): void {
  const current = target.get(assignment.tagPath);
  if (!current || assignment.confidence >= current.confidence) {
    target.set(assignment.tagPath, assignment);
  }
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function resolveRecentDayDistance(now: Date, modifiedAt: Date): number | null {
  const todayStart = startOfLocalDay(now).getTime();
  const modifiedStart = startOfLocalDay(modifiedAt).getTime();
  if (!Number.isFinite(todayStart) || !Number.isFinite(modifiedStart)) {
    return null;
  }
  return Math.max(0, Math.floor((todayStart - modifiedStart) / 86400000));
}

/**
 * 最小系统标签推断器。
 * 这里只保留稳定、可解释的系统派生标签，不再做业务规则识别。
 */
export class SimpleTagInferenceEngine {
  constructor() {}

  infer(file: FileScanResult, parsed: ParsedDocument): TagInferenceResult {
    void parsed;
    const derived = new Map<string, TagAssignment>();

    const typeTag = EXTENSION_TYPE_TAGS.get(file.extension);
    if (typeTag) {
      setTag(derived, {
        tagPath: typeTag,
        confidence: 0.92,
        source: "derived_extension",
        evidence: `扩展名推导: ${file.extension}`,
      });
    }

    const modifiedAt = new Date(file.mtime);
    if (!Number.isNaN(modifiedAt.getTime())) {
      const now = new Date();
      const recentDayDistance = resolveRecentDayDistance(now, modifiedAt);

      setTag(derived, {
        tagPath: `时间/${modifiedAt.getFullYear()}/${String(modifiedAt.getMonth() + 1).padStart(2, "0")}`,
        confidence: 1,
        source: "derived_time",
        evidence: "由修改时间推导的绝对时间标签",
      });

      if (recentDayDistance !== null && recentDayDistance <= 29) {
        setTag(derived, {
          tagPath: "时间/最近30天",
          confidence: 1,
          source: "derived_time_window",
          evidence: "最近30天有修改",
        });
      }

      if (recentDayDistance !== null && recentDayDistance <= 6) {
        setTag(derived, {
          tagPath: "时间/最近7天",
          confidence: 1,
          source: "derived_time_window",
          evidence: "最近7天有修改",
        });
      }

      if (recentDayDistance !== null && recentDayDistance <= 2) {
        setTag(derived, {
          tagPath: "时间/最近3天",
          confidence: 1,
          source: "derived_time_window",
          evidence: "最近3天有修改",
        });
      }
    }

    return {
      tags: [],
      derivedTags: [...derived.values()].sort((a, b) => a.tagPath.localeCompare(b.tagPath, "zh-Hans-CN")),
    };
  }
}
