import fs from "node:fs";

export interface ConfigTagRule {
  tagPath: string;
  keywords: string[];
  pathIncludes: string[];
  scope: Array<"path" | "title" | "summary" | "body">;
  confidence: number;
  minScore: number;
  source: string;
}

export interface CustomerRule {
  customerId: string;
  displayName: string;
  canonicalName: string;
  tagPath: string;
  aliases: string[];
  pathIncludes: string[];
  confidence: number;
}

export interface TagRulesConfig {
  version: number;
  rules: ConfigTagRule[];
  customers: CustomerRule[];
}

const DEFAULT_SCOPE: ConfigTagRule["scope"] = ["path", "title", "summary", "body"];

function normalizeTagPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const path = value.split("/").map(item => item.trim()).filter(Boolean).join("/");
  return path.includes("/") ? path : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean),
  )];
}

function normalizeScope(value: unknown): ConfigTagRule["scope"] {
  if (!Array.isArray(value)) {
    return DEFAULT_SCOPE;
  }
  const allowed = new Set(DEFAULT_SCOPE);
  const scope = value
    .filter((item): item is ConfigTagRule["scope"][number] => typeof item === "string" && allowed.has(item as ConfigTagRule["scope"][number]));
  return scope.length ? [...new Set(scope)] : DEFAULT_SCOPE;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRule(raw: unknown): ConfigTagRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const tagPath = normalizeTagPath(item.tagPath);
  if (!tagPath) {
    return null;
  }
  const keywords = normalizeStringList(item.keywords);
  const pathIncludes = normalizeStringList(item.pathIncludes);
  if (keywords.length === 0 && pathIncludes.length === 0) {
    return null;
  }
  return {
    tagPath,
    keywords,
    pathIncludes,
    scope: normalizeScope(item.scope),
    confidence: Math.max(0.1, Math.min(1, normalizeNumber(item.confidence, 0.86))),
    minScore: Math.max(0.1, Math.min(1, normalizeNumber(item.minScore, 0.55))),
    source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "config_rule",
  };
}

function normalizeCustomer(raw: unknown): CustomerRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const displayName = typeof item.displayName === "string" ? item.displayName.trim() : "";
  const customerId = typeof item.customerId === "string" ? item.customerId.trim() : displayName;
  if (!displayName || !customerId) {
    return null;
  }
  const canonicalName = typeof item.canonicalName === "string" && item.canonicalName.trim()
    ? item.canonicalName.trim()
    : displayName;
  const tagPath = normalizeTagPath(item.tagPath) ?? `客户/${displayName}`;
  const aliases = normalizeStringList([displayName, canonicalName, ...normalizeStringList(item.aliases)]);
  const pathIncludes = normalizeStringList(item.pathIncludes);
  return {
    customerId,
    displayName,
    canonicalName,
    tagPath,
    aliases,
    pathIncludes,
    confidence: Math.max(0.1, Math.min(1, normalizeNumber(item.confidence, 0.94))),
  };
}

export function loadTagRulesConfig(filePath: string): TagRulesConfig {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      version: 1,
      rules: [],
      customers: [],
    };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`标签规则配置根节点必须是对象：${filePath}`);
  }
  const payload = raw as Record<string, unknown>;
  return {
    version: normalizeNumber(payload.version, 1),
    rules: Array.isArray(payload.rules) ? payload.rules.map(normalizeRule).filter((item): item is ConfigTagRule => Boolean(item)) : [],
    customers: Array.isArray(payload.customers) ? payload.customers.map(normalizeCustomer).filter((item): item is CustomerRule => Boolean(item)) : [],
  };
}

