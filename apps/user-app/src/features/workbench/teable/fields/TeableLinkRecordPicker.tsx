import { useEffect, useMemo, useState } from "react";

import { t } from "../../../../shared/i18n";
import { listTeableLinkedRecordOptions, type TeableLinkedRecordOptionDto, type TeableRuntimeFieldDto } from "../api/teable-runtime-api";

export function TeableLinkRecordPicker({
  tableId,
  field,
  value,
  onChange
}: {
  tableId: string;
  field: TeableRuntimeFieldDto;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [options, setOptions] = useState<TeableLinkedRecordOptionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multiple = field.linkOptions?.multiple === true;
  const selectedIds = useMemo(() => normalizeLinkedValue(value), [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listTeableLinkedRecordOptions(tableId, field.fieldId, { take: 50 })
      .then((response) => {
        if (!cancelled) {
          setOptions(response.options);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeLinkOptionsLoadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [field.fieldId, tableId]);

  if (!field.linkOptions?.foreignTableId) {
    return <span className="affairs-dashboard-inline-error">{t("shell.teableRuntimeLinkFieldMissing")}</span>;
  }

  return (
    <label className="teable-runtime-link-picker">
      <select
        className="affairs-dashboard-inline-select"
        multiple={multiple}
        value={multiple ? selectedIds : selectedIds[0] ?? ""}
        disabled={loading}
        onChange={(event) => {
          if (multiple) {
            onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value));
            return;
          }
          onChange(event.currentTarget.value ? [event.currentTarget.value] : []);
        }}
      >
        {!multiple ? <option value="">{t("shell.teableRuntimeLinkEmptyOption")}</option> : null}
        {options.map((option) => (
          <option key={option.recordId} value={option.recordId}>{option.title}</option>
        ))}
      </select>
      {error ? <span className="affairs-dashboard-inline-error">{error}</span> : null}
    </label>
  );
}

function normalizeLinkedValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item : readRecordId(item)).filter((item): item is string => Boolean(item));
  }
  const single = typeof value === "string" ? value : readRecordId(value);
  return single ? [single] : [];
}

function readRecordId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : typeof record.recordId === "string" ? record.recordId : null;
}
