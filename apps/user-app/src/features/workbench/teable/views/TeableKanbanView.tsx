import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto, TeableRuntimeRecordDto } from "../api/teable-runtime-api";
import { TeableCellRenderer } from "../fields/TeableCellRenderer";
import { extractSelectOptions, formatTeableCellValue, resolveTeablePrimaryField } from "../fields/teable-field-utils";

export function TeableKanbanView({
  fields,
  records,
  groupFieldId,
  onOpenRecord
}: {
  fields: TeableRuntimeFieldDto[];
  records: TeableRuntimeRecordDto[];
  groupFieldId?: string;
  onOpenRecord: (record: TeableRuntimeRecordDto) => void;
}) {
  const groupField = fields.find((field) => field.fieldId === groupFieldId) ?? fields.find((field) => field.fieldType === "singleSelect");
  const primaryField = resolveTeablePrimaryField(fields);
  if (!groupField) {
    return <div className="affairs-stage-empty compact">{t("shell.teableRuntimeKanbanGroupMissing")}</div>;
  }
  const options = extractSelectOptions(groupField);
  const optionLabels = options.map((option) => option.label);
  const fallbackGroups = Array.from(new Set(records.map((record) => formatTeableCellValue(record.fields[groupField.fieldId]))));
  const groups = (optionLabels.length > 0 ? optionLabels : fallbackGroups).filter(Boolean);
  return (
    <div className="teable-runtime-kanban-view">
      {groups.map((group) => {
        const items = records.filter((record) => formatTeableCellValue(record.fields[groupField.fieldId]) === group);
        const tone = options.find((option) => option.label === group || option.value === group)?.tone ?? "gray";
        return (
          <section key={group} className="teable-runtime-kanban-column">
            <strong>
              <span className="teable-runtime-token" data-tone={tone}>{group}</span>
              <span className="teable-runtime-kanban-count">{items.length}</span>
            </strong>
            {items.map((record) => (
              <button key={record.recordId} type="button" onClick={() => onOpenRecord(record)}>
                {primaryField ? <TeableCellRenderer field={primaryField} value={record.fields[primaryField.fieldId]} /> : record.recordId}
              </button>
            ))}
          </section>
        );
      })}
      {records.length === 0 ? <div className="affairs-stage-empty compact">{t("shell.teableRuntimeRecordsEmpty")}</div> : null}
    </div>
  );
}
