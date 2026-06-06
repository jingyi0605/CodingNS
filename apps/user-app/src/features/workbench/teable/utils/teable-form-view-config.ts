import type { TeableRuntimeFieldDto, TeableRuntimeViewDto } from "../api/teable-runtime-api";
import { extractTeableViewFieldConfig, orderTeableFieldsByView, type TeableFieldDisplayConfig } from "./teable-view-config";

export interface TeableFormViewConfigDraft {
  visibleFieldIds?: string[];
  formFieldOrder?: string[];
  requiredFieldIds?: string[];
  formFieldDisplay?: Record<string, TeableFormFieldDisplayConfig>;
}

export type TeableFormFieldDisplayConfig = TeableFieldDisplayConfig;

export function extractTeableFormViewConfig(view: TeableRuntimeViewDto): TeableFormViewConfigDraft {
  const config = extractTeableViewFieldConfig(view);
  return {
    ...(config.fieldOrder ? { formFieldOrder: config.fieldOrder } : {}),
    ...(config.visibleFieldIds ? { visibleFieldIds: config.visibleFieldIds } : {}),
    ...(config.requiredFieldIds ? { requiredFieldIds: config.requiredFieldIds } : {}),
    ...(config.fieldDisplay ? { formFieldDisplay: config.fieldDisplay } : {})
  };
}

export function orderTeableFormFields(
  fields: TeableRuntimeFieldDto[],
  input: {
    fieldOrder?: string[];
    visibleFieldIds?: string[];
  }
): TeableRuntimeFieldDto[] {
  return orderTeableFieldsByView(fields, input);
}
