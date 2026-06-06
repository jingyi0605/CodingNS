import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";

export type TeableCellDisplayKind =
  | "empty"
  | "plain"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "link"
  | "user"
  | "readonly";

export interface TeableCellDisplayToken {
  key: string;
  label: string;
  tone: TeableCellTone;
}

export interface TeableCellDisplayValue {
  kind: TeableCellDisplayKind;
  text: string;
  tokens: TeableCellDisplayToken[];
  readonly: boolean;
}

export type TeableCellTone =
  | "blue"
  | "cyan"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "pink"
  | "gray";

interface TeableSelectOption {
  value: string;
  label: string;
  tone: TeableCellTone;
}

const COMPUTED_FIELD_TYPES = new Set([
  "formula",
  "lookup",
  "rollup",
  "conditionalLookup",
  "conditionalRollup",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber"
]);

export function isTeableFieldComputed(field: TeableRuntimeFieldDto): boolean {
  return field.isComputed || field.isLookup || COMPUTED_FIELD_TYPES.has(field.fieldType);
}

export function isTeableFieldWritable(field: TeableRuntimeFieldDto, mode: "create" | "update"): boolean {
  if (isTeableFieldComputed(field)) {
    return false;
  }
  return mode === "create" ? field.recordCreate : field.recordUpdate;
}

export function formatTeableCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return t("shell.teableRuntimeEmptyValue");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatTeableCellValue).filter((item) => item !== t("shell.teableRuntimeEmptyValue")).join("、") || t("shell.teableRuntimeEmptyValue");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["title", "name", "text", "label"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim();
      }
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function resolveTeableCellDisplay(field: TeableRuntimeFieldDto, value: unknown): TeableCellDisplayValue {
  const readonly = isTeableFieldComputed(field);
  if (isEmptyTeableValue(value)) {
    return {
      kind: "empty",
      text: t("shell.teableRuntimeEmptyValue"),
      tokens: [],
      readonly
    };
  }

  if (field.fieldType === "singleSelect" || field.fieldType === "multipleSelect") {
    const optionByValue = new Map(extractSelectOptions(field).map((option) => [option.value, option]));
    const tokens = normalizeCellValueList(value).map((item, index) => {
      const rawLabel = formatTeableCellValue(item);
      const option = optionByValue.get(String(item)) ?? optionByValue.get(rawLabel);
      const label = option?.label || rawLabel;
      return {
        key: `${field.fieldId}-${index}-${label}`,
        label,
        tone: option?.tone ?? resolveToneFromText(label)
      };
    });
    return {
      kind: "select",
      text: tokens.map((token) => token.label).join("、") || t("shell.teableRuntimeEmptyValue"),
      tokens,
      readonly
    };
  }

  if (field.fieldType === "checkbox" || field.fieldType === "boolean") {
    const checked = Boolean(value);
    return {
      kind: "boolean",
      text: checked ? "✓" : "—",
      tokens: [{
        key: `${field.fieldId}-boolean`,
        label: checked ? "✓" : "—",
        tone: checked ? "green" : "gray"
      }],
      readonly
    };
  }

  if (field.fieldType === "link" || field.linkOptions) {
    const tokens = normalizeCellValueList(value).map((item, index) => {
      const label = formatTeableCellValue(item);
      return {
        key: `${field.fieldId}-${index}-${label}`,
        label,
        tone: "blue" as const
      };
    });
    return {
      kind: "link",
      text: tokens.map((token) => token.label).join("、") || t("shell.teableRuntimeEmptyValue"),
      tokens,
      readonly
    };
  }

  if (field.fieldType === "user" || field.fieldType === "createdBy" || field.fieldType === "lastModifiedBy") {
    const tokens = normalizeCellValueList(value).map((item, index) => {
      const label = formatTeableCellValue(item);
      return {
        key: `${field.fieldId}-${index}-${label}`,
        label,
        tone: resolveToneFromText(label)
      };
    });
    return {
      kind: "user",
      text: tokens.map((token) => token.label).join("、") || t("shell.teableRuntimeEmptyValue"),
      tokens,
      readonly
    };
  }

  return {
    kind: resolvePlainDisplayKind(field),
    text: formatTeableCellValue(value),
    tokens: [],
    readonly
  };
}

export function resolveTeablePrimaryField(fields: TeableRuntimeFieldDto[], fallbackId?: string): TeableRuntimeFieldDto | null {
  return fields.find((field) => field.fieldId === fallbackId)
    ?? fields.find((field) => field.isPrimary)
    ?? fields[0]
    ?? null;
}

export function extractSelectOptions(field: TeableRuntimeFieldDto): TeableSelectOption[] {
  const rawChoices = field.options.choices ?? field.options.options ?? field.options.items;
  if (!Array.isArray(rawChoices)) {
    return [];
  }
  return rawChoices.map((item, index) => {
    if (typeof item === "string") {
      return { value: item, label: item, tone: resolveToneFromIndex(index) };
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const value = typeof record.id === "string" ? record.id : typeof record.value === "string" ? record.value : typeof record.name === "string" ? record.name : "";
      const label = typeof record.name === "string" ? record.name : typeof record.label === "string" ? record.label : value;
      const color = readSelectOptionColor(record);
      return { value, label, tone: color ? resolveToneFromText(color) : resolveToneFromIndex(index) };
    }
    return { value: "", label: "", tone: resolveToneFromIndex(index) };
  }).filter((item) => item.value);
}

function isEmptyTeableValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function normalizeCellValueList(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => !isEmptyTeableValue(item)) : [value];
}

function resolvePlainDisplayKind(field: TeableRuntimeFieldDto): TeableCellDisplayKind {
  if (field.fieldType === "number" || field.fieldType === "formula" || field.fieldType === "rollup") {
    return "number";
  }
  if (field.fieldType === "date" || field.fieldType === "createdTime" || field.fieldType === "lastModifiedTime") {
    return "date";
  }
  return isTeableFieldComputed(field) ? "readonly" : "plain";
}

function readSelectOptionColor(record: Record<string, unknown>): string | null {
  for (const key of ["color", "backgroundColor", "colorName", "theme"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveToneFromText(input: string): TeableCellTone {
  const normalized = input.toLowerCase();
  if (/red|rose|danger|fail|失败|逾期|紧急|高|未开始/.test(normalized)) return "red";
  if (/orange|amber|warning|warn|进行|处理中|待处理/.test(normalized)) return "orange";
  if (/yellow|gold|pending|等待|待/.test(normalized)) return "yellow";
  if (/green|success|done|完成|已完成|通过/.test(normalized)) return "green";
  if (/cyan|teal|bluegreen|华北|华南/.test(normalized)) return "cyan";
  if (/purple|violet|重要|核心/.test(normalized)) return "purple";
  if (/pink|magenta/.test(normalized)) return "pink";
  if (/gray|grey|default|取消|关闭/.test(normalized)) return "gray";
  return resolveToneFromIndex(hashString(input));
}

function resolveToneFromIndex(index: number): TeableCellTone {
  const tones: TeableCellTone[] = ["blue", "cyan", "green", "yellow", "orange", "purple", "pink", "red"];
  return tones[Math.abs(index) % tones.length] ?? "blue";
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}
