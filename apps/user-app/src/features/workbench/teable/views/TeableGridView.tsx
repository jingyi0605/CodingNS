import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto, TeableRuntimeRecordDto } from "../api/teable-runtime-api";
import { TeableCellRenderer } from "../fields/TeableCellRenderer";
import { orderTeableFieldsByView, type TeableFieldDisplayConfig } from "../utils/teable-view-config";

export function TeableGridView({
  fields,
  records,
  fieldOrder,
  visibleFieldIds,
  fieldWidths,
  fieldDisplay,
  onOpenRecord
}: {
  fields: TeableRuntimeFieldDto[];
  records: TeableRuntimeRecordDto[];
  fieldOrder?: string[];
  visibleFieldIds?: string[];
  fieldWidths?: Record<string, number>;
  fieldDisplay?: Record<string, TeableFieldDisplayConfig>;
  onOpenRecord: (record: TeableRuntimeRecordDto) => void;
}) {
  const visibleFields = orderTeableFieldsByView(fields, { fieldOrder, visibleFieldIds });
  if (records.length === 0) {
    return <div className="affairs-stage-empty compact">{t("shell.teableRuntimeRecordsEmpty")}</div>;
  }
  return (
    <div className="teable-runtime-grid-shell">
      <table className="teable-runtime-grid-table">
        <thead>
          <tr>
            {visibleFields.map((field) => {
              const width = normalizeColumnWidth(fieldWidths?.[field.fieldId]);
              const label = fieldDisplay?.[field.fieldId]?.label || field.fieldName;
              return (
                <th key={field.fieldId} data-field-type={field.fieldType} style={width ? { width, minWidth: width } : undefined}>
                  <span className="teable-runtime-grid-heading">
                    <span className="teable-runtime-grid-heading-icon" aria-hidden="true">{resolveFieldTypeIcon(field)}</span>
                    <span>{label}</span>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.recordId}
              onClick={() => onOpenRecord(record)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenRecord(record);
                }
              }}
              tabIndex={0}
            >
              {visibleFields.map((field) => {
                const width = normalizeColumnWidth(fieldWidths?.[field.fieldId]);
                return (
                  <td key={field.fieldId} data-field-type={field.fieldType} style={width ? { width, minWidth: width } : undefined}>
                    <TeableCellRenderer field={field} value={record.fields[field.fieldId]} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizeColumnWidth(width: number | undefined): number | undefined {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return undefined;
  }
  return Math.max(80, Math.min(width, 600));
}

function resolveFieldTypeIcon(field: TeableRuntimeFieldDto): string {
  if (field.isPrimary) return "A";
  if (field.fieldType === "singleSelect" || field.fieldType === "multipleSelect") return "▾";
  if (field.fieldType === "number" || field.fieldType === "formula" || field.fieldType === "rollup") return "#";
  if (field.fieldType === "date" || field.fieldType === "createdTime" || field.fieldType === "lastModifiedTime") return "◷";
  if (field.fieldType === "checkbox" || field.fieldType === "boolean") return "✓";
  if (field.fieldType === "link") return "↗";
  if (field.fieldType === "user" || field.fieldType === "createdBy" || field.fieldType === "lastModifiedBy") return "●";
  return "T";
}
