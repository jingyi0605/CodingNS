import type { FileScanResult } from "../scanner/file-scanner.js";
import type { ParsedDocument } from "../parser/plain-text-parser.js";
import { loadTagRulesConfig, type ConfigTagRule, type CustomerRule, type TagRulesConfig } from "./tag-rules-config.js";

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

interface TopicRule {
  tagPath: string;
  keywords: string[];
  minScore: number;
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

const TOPIC_RULES: TopicRule[] = [
  { keywords: ["node", "typescript", "javascript", "npm"], tagPath: "主题/Node开发", minScore: 0.45 },
  { keywords: ["邮件", "exchange", "lync"], tagPath: "主题/邮件系统", minScore: 0.55 },
  { keywords: ["备份", "容灾", "恢复", "veeam"], tagPath: "主题/备份恢复", minScore: 0.55 },
  { keywords: ["文件服务器", "共享", "ftp"], tagPath: "主题/文件服务器", minScore: 0.75 },
];

function setTag(target: Map<string, TagAssignment>, assignment: TagAssignment): void {
  const current = target.get(assignment.tagPath);
  if (!current || assignment.confidence >= current.confidence) {
    target.set(assignment.tagPath, assignment);
  }
}

function uniqueMatchedKeywords(text: string, keywords: string[]): string[] {
  const matched: string[] = [];
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      matched.push(keyword);
    }
  }
  return [...new Set(matched)];
}

function scoreRule(rule: ConfigTagRule, textByScope: Record<ConfigTagRule["scope"][number], string>): { score: number; matched: string[] } {
  const matched = new Set<string>();
  let score = 0;

  for (const pathToken of rule.pathIncludes) {
    if (textByScope.path.includes(pathToken.toLowerCase())) {
      matched.add(pathToken);
      score += 0.65;
    }
  }

  const scopeWeights: Record<ConfigTagRule["scope"][number], number> = {
    path: 0.5,
    title: 0.4,
    summary: 0.25,
    body: 0.08,
  };
  for (const scope of rule.scope) {
    const scopeMatches = uniqueMatchedKeywords(textByScope[scope], rule.keywords);
    if (scopeMatches.length === 0) {
      continue;
    }
    scopeMatches.forEach(item => matched.add(item));
    score += scope === "body"
      ? Math.min(0.2, scopeMatches.length * scopeWeights[scope])
      : scopeWeights[scope];
  }

  if (matched.size >= 2) {
    score += 0.12;
  }

  return { score, matched: [...matched] };
}

function customerToRule(customer: CustomerRule): ConfigTagRule {
  return {
    tagPath: customer.tagPath,
    keywords: customer.aliases,
    pathIncludes: customer.pathIncludes,
    scope: ["path", "title", "summary", "body"],
    confidence: customer.confidence,
    minScore: 0.5,
    source: "customer_rule",
  };
}

/**
 * 最小规则标签推断器。
 * 当前阶段只做稳定、可解释的规则标签，避免一开始就做复杂语义裁决。
 */
export class SimpleTagInferenceEngine {
  private readonly configRules: ConfigTagRule[];
  private readonly customers: CustomerRule[];

  constructor(options: { tagRulesPath?: string; tagRulesConfig?: TagRulesConfig } = {}) {
    const config = options.tagRulesConfig
      ?? (options.tagRulesPath ? loadTagRulesConfig(options.tagRulesPath) : { version: 1, rules: [], customers: [] });
    this.configRules = config.rules;
    this.customers = config.customers;
  }

  infer(file: FileScanResult, parsed: ParsedDocument): TagInferenceResult {
    const direct = new Map<string, TagAssignment>();
    const derived = new Map<string, TagAssignment>();
    const relativePath = file.relativePath;
    const pathParts = relativePath.split("/").filter(Boolean);
    const rootName = pathParts[0] ?? "未分类";
    const pathText = relativePath.toLowerCase();
    const titleText = parsed.title.toLowerCase();
    const summaryText = parsed.summary.toLowerCase();
    const bodyText = parsed.text.toLowerCase();
    const textByScope = {
      path: pathText,
      title: titleText,
      summary: summaryText,
      body: bodyText,
    };

    setTag(direct, {
      tagPath: `来源/目录/${rootName}`,
      confidence: 0.95,
      source: "path_rule",
      evidence: `根目录命中: ${rootName}`,
    });

    const typeTag = EXTENSION_TYPE_TAGS.get(file.extension);
    if (typeTag) {
      setTag(direct, {
        tagPath: typeTag,
        confidence: 0.92,
        source: "extension_rule",
        evidence: `扩展名命中: ${file.extension}`,
      });
    }

    for (const rule of TOPIC_RULES) {
      const pathMatches = uniqueMatchedKeywords(pathText, rule.keywords);
      const titleMatches = uniqueMatchedKeywords(titleText, rule.keywords);
      const summaryMatches = uniqueMatchedKeywords(summaryText, rule.keywords);
      const bodyMatches = uniqueMatchedKeywords(bodyText, rule.keywords);
      const matched = [...new Set([...pathMatches, ...titleMatches, ...summaryMatches, ...bodyMatches])];

      if (matched.length === 0) {
        continue;
      }

      let score = 0;
      if (pathMatches.length > 0) {
        score += 0.5;
      }
      if (titleMatches.length > 0) {
        score += 0.4;
      }
      if (summaryMatches.length > 0) {
        score += 0.25;
      }
      score += Math.min(0.2, bodyMatches.length * 0.08);

      if (matched.length >= 2) {
        score += 0.12;
      }

      if (score < rule.minScore) {
        continue;
      }

      setTag(direct, {
        tagPath: rule.tagPath,
        confidence: Math.min(0.95, 0.6 + score * 0.3),
        source: "keyword_rule",
        evidence: `主题关键词命中: ${matched.slice(0, 3).join(", ")}`,
      });
    }

    for (const customer of this.customers) {
      const rule = customerToRule(customer);
      const result = scoreRule(rule, textByScope);
      if (result.score < rule.minScore || result.matched.length === 0) {
        continue;
      }
      setTag(direct, {
        tagPath: rule.tagPath,
        confidence: Math.min(0.98, rule.confidence),
        source: rule.source,
        evidence: `客户归一命中: ${result.matched.slice(0, 4).join(", ")}；customerId=${customer.customerId}；canonical=${customer.canonicalName}`,
      });
    }

    for (const rule of this.configRules) {
      const result = scoreRule(rule, textByScope);
      if (result.score < rule.minScore || result.matched.length === 0) {
        continue;
      }
      setTag(direct, {
        tagPath: rule.tagPath,
        confidence: Math.min(0.97, rule.confidence),
        source: rule.source,
        evidence: `配置规则命中: ${result.matched.slice(0, 4).join(", ")}`,
      });
    }

    const modifiedAt = new Date(file.mtime);
    if (!Number.isNaN(modifiedAt.getTime())) {
      const now = new Date();
      const diffMs = Math.max(0, now.getTime() - modifiedAt.getTime());
      const days = Math.floor(diffMs / 86400000);

      setTag(derived, {
        tagPath: `时间/${modifiedAt.getFullYear()}/${String(modifiedAt.getMonth() + 1).padStart(2, "0")}`,
        confidence: 1,
        source: "derived_time",
        evidence: "由修改时间推导的绝对时间标签",
      });

      if (days <= 3) {
        setTag(derived, {
          tagPath: "时间/最近3天",
          confidence: 1,
          source: "derived_time_window",
          evidence: "最近3天有修改",
        });
        setTag(derived, {
          tagPath: "状态/近期活跃",
          confidence: 1,
          source: "derived_status",
          evidence: "最近3天有修改",
        });
      } else if (days <= 30) {
        setTag(derived, {
          tagPath: "时间/最近30天",
          confidence: 1,
          source: "derived_time_window",
          evidence: "最近30天有修改",
        });
        setTag(derived, {
          tagPath: "状态/近期活跃",
          confidence: 0.8,
          source: "derived_status",
          evidence: "最近30天有修改",
        });
      } else {
        setTag(derived, {
          tagPath: "状态/长期未更新",
          confidence: 1,
          source: "derived_status",
          evidence: "超过30天未更新",
        });
      }
    }

    return {
      tags: [...direct.values()].sort((a, b) => a.tagPath.localeCompare(b.tagPath, "zh-Hans-CN")),
      derivedTags: [...derived.values()].sort((a, b) => a.tagPath.localeCompare(b.tagPath, "zh-Hans-CN")),
    };
  }
}
