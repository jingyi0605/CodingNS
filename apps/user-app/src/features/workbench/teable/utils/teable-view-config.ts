import type { TeableRuntimeFieldDto, TeableRuntimeViewDto } from "../api/teable-runtime-api";

export interface TeableFieldDisplayConfig {
  label?: string;
  description?: string;
  placeholder?: string;
}

export interface TeableFieldLayoutConfig {
  fieldId: string;
  hidden: boolean;
  width?: number;
  required: boolean;
  display?: TeableFieldDisplayConfig;
}

export interface TeableViewFieldConfigDraft {
  visibleFieldIds?: string[];
  fieldOrder?: string[];
  requiredFieldIds?: string[];
  fieldDisplay?: Record<string, TeableFieldDisplayConfig>;
  fieldWidths?: Record<string, number>;
}

export function extractTeableViewFieldConfig(view: TeableRuntimeViewDto): TeableViewFieldConfigDraft {
  const sources = collectConfigSources(view);
  const layoutByFieldId = new Map<string, TeableFieldLayoutConfig>();

  for (const source of sources) {
    collectFieldEntries(source, layoutByFieldId);
  }

  const layouts = Array.from(layoutByFieldId.values());
  const visibleFieldIds = layouts.filter((item) => !item.hidden).map((item) => item.fieldId);
  const requiredFieldIds = layouts.filter((item) => item.required).map((item) => item.fieldId);
  const fieldDisplay = Object.fromEntries(
    layouts
      .filter((item) => item.display && Object.keys(item.display).length > 0)
      .map((item) => [item.fieldId, item.display])
  ) as Record<string, TeableFieldDisplayConfig>;
  const fieldWidths = Object.fromEntries(
    layouts
      .filter((item) => typeof item.width === "number")
      .map((item) => [item.fieldId, item.width])
  ) as Record<string, number>;

  return {
    ...(layouts.length > 0 ? { fieldOrder: layouts.map((item) => item.fieldId) } : {}),
    ...(visibleFieldIds.length > 0 ? { visibleFieldIds } : {}),
    ...(requiredFieldIds.length > 0 ? { requiredFieldIds } : {}),
    ...(Object.keys(fieldDisplay).length > 0 ? { fieldDisplay } : {}),
    ...(Object.keys(fieldWidths).length > 0 ? { fieldWidths } : {})
  };
}

export function orderTeableFieldsByView(
  fields: TeableRuntimeFieldDto[],
  input: {
    fieldOrder?: string[];
    visibleFieldIds?: string[];
  }
): TeableRuntimeFieldDto[] {
  const visibleSet = input.visibleFieldIds?.length ? new Set(input.visibleFieldIds) : null;
  const filtered = visibleSet ? fields.filter((field) => visibleSet.has(field.fieldId)) : fields;
  const order = input.fieldOrder ?? [];
  if (order.length === 0) {
    return filtered;
  }
  const indexById = new Map(order.map((fieldId, index) => [fieldId, index] as const));
  return [...filtered].sort((left, right) => {
    const leftIndex = indexById.get(left.fieldId) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = indexById.get(right.fieldId) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return fields.indexOf(left) - fields.indexOf(right);
  });
}

function collectConfigSources(view: TeableRuntimeViewDto): Array<Record<string, unknown>> {
  const options = readRecord(view.options) ?? {};
  return [
    options,
    readRecord(options.fields),
    readRecord(options.form),
    readRecord(options.formMeta),
    readRecord(options.fieldMeta),
    readRecord(options.columnMeta),
    readRecord(view.columnMeta)
  ].filter((item): item is Record<string, unknown> => Boolean(item));
}

function collectFieldEntries(
  source: Record<string, unknown>,
  layoutByFieldId: Map<string, TeableFieldLayoutConfig>
): void {
  for (const key of ["fieldIds", "fields", "fieldOrder", "formFieldOrder", "visibleFieldIds"]) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const fieldId = readFieldId(item);
      if (!fieldId) continue;
      mergeLayout(layoutByFieldId, fieldId, item);
    }
  }

  for (const [fieldId, value] of Object.entries(source)) {
    if (!looksLikeFieldId(fieldId)) continue;
    mergeLayout(layoutByFieldId, fieldId, value);
  }
}

function mergeLayout(
  layoutByFieldId: Map<string, TeableFieldLayoutConfig>,
  fieldId: string,
  rawValue: unknown
): void {
  const current = layoutByFieldId.get(fieldId) ?? {
    fieldId,
    hidden: false,
    required: false
  };
  const width = readWidth(rawValue);
  const display = readDisplayConfig(rawValue);
  layoutByFieldId.set(fieldId, {
    ...current,
    hidden: current.hidden || isHidden(rawValue),
    required: current.required || isRequired(rawValue),
    ...(typeof width === "number" ? { width } : {}),
    ...(display ? { display: { ...current.display, ...display } } : {})
  });
}

function readFieldId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = readRecord(value);
  if (!record) return null;
  for (const key of ["fieldId", "id", "fieldID"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function isHidden(value: unknown): boolean {
  const record = readRecord(value);
  if (!record) return false;
  return record.hidden === true || record.isHidden === true || record.visible === false;
}

function isRequired(value: unknown): boolean {
  const record = readRecord(value);
  if (!record) return false;
  return record.required === true || record.isRequired === true;
}

function readWidth(value: unknown): number | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  for (const key of ["width", "columnWidth"]) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

function readDisplayConfig(value: unknown): TeableFieldDisplayConfig | null {
  const record = readRecord(value);
  if (!record) return null;
  const display = {
    ...readStringConfig(record, "label", "label", "title", "name", "fieldName"),
    ...readStringConfig(record, "description", "desc", "helpText", "help"),
    ...readStringConfig(record, "placeholder", "placeHolder")
  };
  return Object.keys(display).length > 0 ? display : null;
}

function readStringConfig(
  record: Record<string, unknown>,
  targetKey: keyof TeableFieldDisplayConfig,
  ...sourceKeys: string[]
): TeableFieldDisplayConfig {
  for (const sourceKey of sourceKeys) {
    const value = record[sourceKey];
    if (typeof value === "string" && value.trim()) {
      return { [targetKey]: value.trim() };
    }
  }
  return {};
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function looksLikeFieldId(value: string): boolean {
  return value.startsWith("fld") || value.startsWith("field");
}
