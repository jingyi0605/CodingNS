import { useMemo, useState } from "react";

import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";
import { createTeableRuntimeRecord } from "../api/teable-runtime-api";
import { TeableFieldEditor } from "../fields/TeableFieldEditor";
import { isTeableFieldWritable } from "../fields/teable-field-utils";
import { orderTeableFormFields, type TeableFormFieldDisplayConfig } from "../utils/teable-form-view-config";

export function TeableFormView({
  tableId,
  fields,
  fieldOrder,
  visibleFieldIds,
  requiredFieldIds,
  fieldDisplay,
  onCreated
}: {
  tableId: string;
  fields: TeableRuntimeFieldDto[];
  fieldOrder?: string[];
  visibleFieldIds?: string[];
  requiredFieldIds?: string[];
  fieldDisplay?: Record<string, TeableFormFieldDisplayConfig>;
  onCreated: () => Promise<void> | void;
}) {
  const writableFields = useMemo(
    () => orderTeableFormFields(fields, { fieldOrder, visibleFieldIds }).filter((field) => isTeableFieldWritable(field, "create")),
    [fieldOrder, fields, visibleFieldIds]
  );
  const requiredSet = useMemo(() => new Set(requiredFieldIds ?? []), [requiredFieldIds]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const missingRequiredField = writableFields.find((field) => requiredSet.has(field.fieldId) && isEmptyValue(draft[field.fieldId]));
    if (missingRequiredField) {
      setError(t("shell.teableRuntimeRequiredFieldMissing", { field: missingRequiredField.fieldName }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTeableRuntimeRecord(tableId, draft);
      setDraft({});
      await onCreated();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (writableFields.length === 0) {
    return <div className="affairs-stage-empty compact">{t("shell.teableRuntimeNoWritableFields")}</div>;
  }

  return (
    <div className="teable-runtime-form-view">
      {writableFields.map((field) => {
        const display = fieldDisplay?.[field.fieldId];
        const label = display?.label || field.fieldName;
        return (
        <label key={field.fieldId} className="affairs-dashboard-inline-field">
          <span>{label}{requiredSet.has(field.fieldId) ? t("shell.teableRuntimeRequiredMark") : ""}</span>
          {display?.description ? <small className="affairs-dashboard-inline-help">{display.description}</small> : null}
          <TeableFieldEditor
            tableId={tableId}
            field={field}
            mode="create"
            value={draft[field.fieldId]}
            placeholder={display?.placeholder}
            onChange={(value) => setDraft((current) => ({ ...current, [field.fieldId]: value }))}
          />
        </label>
        );
      })}
      {error ? <p className="affairs-dashboard-inline-error">{error}</p> : null}
      <button type="button" className="secondary-button" disabled={submitting} onClick={submit}>
        {submitting ? t("common.loading") : t("shell.teableRuntimeCreateRecordAction")}
      </button>
    </div>
  );
}

function isEmptyValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}
