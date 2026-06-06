import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto } from "../api/teable-runtime-api";
import { extractSelectOptions, formatTeableCellValue, isTeableFieldWritable } from "./teable-field-utils";
import { TeableLinkRecordPicker } from "./TeableLinkRecordPicker";

export function TeableFieldEditor({
  tableId,
  field,
  value,
  mode,
  placeholder,
  onChange
}: {
  tableId: string;
  field: TeableRuntimeFieldDto;
  value: unknown;
  mode: "create" | "update";
  placeholder?: string;
  onChange: (value: unknown) => void;
}) {
  if (!isTeableFieldWritable(field, mode)) {
    return <span className="teable-runtime-readonly-value">{formatTeableCellValue(value)}</span>;
  }

  if (field.fieldType === "link") {
    return <TeableLinkRecordPicker tableId={tableId} field={field} value={value} onChange={onChange} />;
  }

  if (field.fieldType === "singleSelect" || field.fieldType === "multipleSelect") {
    const options = extractSelectOptions(field);
    const values = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);
    return (
      <select
        className="affairs-dashboard-inline-select"
        multiple={field.fieldType === "multipleSelect" || field.isMultipleCellValue}
        value={field.fieldType === "multipleSelect" || field.isMultipleCellValue ? values : values[0] ?? ""}
        onChange={(event) => {
          if (field.fieldType === "multipleSelect" || field.isMultipleCellValue) {
            onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value));
            return;
          }
          onChange(event.currentTarget.value || null);
        }}
      >
        <option value="">{t("shell.teableRuntimeEmptyValue")}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }

  if (field.fieldType === "checkbox" || field.fieldType === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  }

  if (field.fieldType === "number") {
    return (
      <input
        className="affairs-dashboard-inline-input"
        type="number"
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}
      />
    );
  }

  if (field.fieldType === "date") {
    return (
      <input
        className="affairs-dashboard-inline-input"
        type="date"
        value={typeof value === "string" ? value.slice(0, 10) : ""}
        onChange={(event) => onChange(event.currentTarget.value || null)}
      />
    );
  }

  if (field.fieldType === "longText") {
    return (
      <textarea
        className="affairs-dashboard-inline-input teable-runtime-textarea"
        placeholder={placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field.fieldType === "singleLineText" || field.fieldType === "text") {
    return (
      <input
        className="affairs-dashboard-inline-input"
        placeholder={placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return <span className="teable-runtime-readonly-value">{t("shell.teableRuntimeUnsupportedEditor", { value: formatTeableCellValue(value) })}</span>;
}
