import { t } from "../../../../shared/i18n";
import type { TeableRuntimeFieldDto, TeableRuntimeRecordDto } from "../api/teable-runtime-api";
import { TeableCellRenderer } from "../fields/TeableCellRenderer";
import { formatTeableCellValue, resolveTeablePrimaryField } from "../fields/teable-field-utils";

export function TeableCalendarView({
  fields,
  records,
  startFieldId,
  onOpenRecord
}: {
  fields: TeableRuntimeFieldDto[];
  records: TeableRuntimeRecordDto[];
  startFieldId?: string;
  onOpenRecord: (record: TeableRuntimeRecordDto) => void;
}) {
  const dateField = fields.find((field) => field.fieldId === startFieldId) ?? fields.find((field) => field.fieldType === "date");
  const primaryField = resolveTeablePrimaryField(fields);
  if (!dateField) {
    return <div className="affairs-stage-empty compact">{t("shell.teableRuntimeCalendarDateMissing")}</div>;
  }
  const groups = new Map<string, TeableRuntimeRecordDto[]>();
  records.forEach((record) => {
    const key = formatTeableCellValue(record.fields[dateField.fieldId]).slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(record);
  });
  return (
    <div className="teable-runtime-calendar-view">
      {Array.from(groups.entries()).map(([date, items]) => (
        <section key={date} className="teable-runtime-calendar-day">
          <strong>{date}</strong>
          {items.map((record) => (
            <button key={record.recordId} type="button" onClick={() => onOpenRecord(record)}>
              {primaryField ? <TeableCellRenderer field={primaryField} value={record.fields[primaryField.fieldId]} /> : record.recordId}
            </button>
          ))}
        </section>
      ))}
      {groups.size === 0 ? <div className="affairs-stage-empty compact">{t("shell.teableRuntimeRecordsEmpty")}</div> : null}
    </div>
  );
}
