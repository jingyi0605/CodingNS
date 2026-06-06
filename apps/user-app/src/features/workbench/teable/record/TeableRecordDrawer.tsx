import { useEffect, useMemo, useState } from "react";

import { DesktopModal } from "../../../../components/DesktopModal";
import { ModalActions, ModalField, ModalSection } from "../../../../components/ModalAtoms";
import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto, TeableRuntimeRecordDto } from "../api/teable-runtime-api";
import { deleteTeableRuntimeRecords, updateTeableRuntimeRecord } from "../api/teable-runtime-api";
import { TeableFieldEditor } from "../fields/TeableFieldEditor";
import { isTeableFieldWritable } from "../fields/teable-field-utils";
import { orderTeableFieldsByView, type TeableFieldDisplayConfig } from "../utils/teable-view-config";

export function TeableRecordDrawer({
  tableId,
  fields,
  record,
  fieldOrder,
  visibleFieldIds,
  requiredFieldIds,
  fieldDisplay,
  open,
  onClose,
  onSaved,
  onDeleted
}: {
  tableId: string;
  fields: TeableRuntimeFieldDto[];
  record: TeableRuntimeRecordDto | null;
  fieldOrder?: string[];
  visibleFieldIds?: string[];
  requiredFieldIds?: string[];
  fieldDisplay?: Record<string, TeableFieldDisplayConfig>;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formFields = useMemo(() => orderTeableFieldsByView(fields, { fieldOrder, visibleFieldIds }), [fieldOrder, fields, visibleFieldIds]);
  const requiredSet = useMemo(() => new Set(requiredFieldIds ?? []), [requiredFieldIds]);
  const writableFieldIds = useMemo(() => new Set(formFields.filter((field) => isTeableFieldWritable(field, "update")).map((field) => field.fieldId)), [formFields]);

  useEffect(() => {
    setDraft(record?.fields ?? {});
    setError(null);
  }, [record]);

  if (!open || !record) {
    return null;
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const writableFields: Record<string, unknown> = {};
      for (const fieldId of writableFieldIds) {
        if (Object.prototype.hasOwnProperty.call(draft, fieldId)) {
          writableFields[fieldId] = draft[fieldId];
        }
      }
      await updateTeableRuntimeRecord(tableId, record.recordId, writableFields);
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("shell.teableRuntimeDeleteConfirm"))) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteTeableRuntimeRecords(tableId, [record.recordId]);
      await onDeleted();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeDeleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DesktopModal
      open={open}
      title={t("shell.teableRuntimeRecordDrawerTitle")}
      description={t("shell.teableRuntimeRecordDrawerDescription")}
      size="regular"
      onClose={onClose}
    >
      <ModalSection heading={t("shell.teableRuntimeRecordFieldsTitle")} description={t("shell.teableRuntimeReadonlyHint")}>
        <div className="teable-runtime-field-list">
          {formFields.map((field) => {
            const display = fieldDisplay?.[field.fieldId];
            const label = `${display?.label || field.fieldName}${requiredSet.has(field.fieldId) ? t("shell.teableRuntimeRequiredMark") : ""}`;
            return (
            <ModalField key={field.fieldId} label={label} description={display?.description}>
              <TeableFieldEditor
                tableId={tableId}
                field={field}
                mode="update"
                value={draft[field.fieldId]}
                placeholder={display?.placeholder}
                onChange={(value) => setDraft((current) => ({ ...current, [field.fieldId]: value }))}
              />
            </ModalField>
            );
          })}
        </div>
        {error ? <p className="affairs-dashboard-inline-error">{error}</p> : null}
      </ModalSection>
      <ModalActions align="between">
        <button type="button" className="settings-button-danger" disabled={saving} onClick={remove}>
          {t("shell.teableRuntimeDeleteRecordAction")}
        </button>
        <span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
          <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? t("common.loading") : t("shell.teableRuntimeSaveRecordAction")}</button>
        </span>
      </ModalActions>
    </DesktopModal>
  );
}
