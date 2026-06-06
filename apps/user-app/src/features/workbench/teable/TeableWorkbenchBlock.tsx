import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { t } from "../../../shared/i18n";
import {
  listTeableRuntimeFields,
  listTeableRuntimeRecords,
  listTeableRuntimeViews,
  type TeableRuntimeBlockConfig,
  type TeableRuntimeFieldDto,
  type TeableRuntimeRecordDto,
  type TeableRuntimeViewDto
} from "./api/teable-runtime-api";
import { resolveTeablePrimaryField } from "./fields/teable-field-utils";
import { TeableRecordDrawer } from "./record/TeableRecordDrawer";
import { TeableCreateRecordModal } from "./record/TeableCreateRecordModal";
import { extractTeableFormViewConfig } from "./utils/teable-form-view-config";
import { extractTeableViewFieldConfig, type TeableViewFieldConfigDraft } from "./utils/teable-view-config";
import { TeableCalendarView } from "./views/TeableCalendarView";
import { TeableFormView } from "./views/TeableFormView";
import { TeableGridView } from "./views/TeableGridView";
import { TeableKanbanView } from "./views/TeableKanbanView";

export function TeableWorkbenchBlock({
  config,
  render
}: {
  config: TeableRuntimeBlockConfig;
  render?: (payload: { headerActions: ReactNode; content: ReactNode }) => ReactNode;
}) {
  const [fields, setFields] = useState<TeableRuntimeFieldDto[]>([]);
  const [records, setRecords] = useState<TeableRuntimeRecordDto[]>([]);
  const [runtimeViewConfig, setRuntimeViewConfig] = useState<TeableViewFieldConfigDraft>({});
  const [runtimeCreateFormConfig, setRuntimeCreateFormConfig] = useState<ReturnType<typeof extractTeableFormViewConfig>>({});
  const [runtimeEditFormConfig, setRuntimeEditFormConfig] = useState<ReturnType<typeof extractTeableFormViewConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<TeableRuntimeRecordDto | null>(null);
  const [creating, setCreating] = useState(false);
  const primaryField = useMemo(() => resolveTeablePrimaryField(fields, config.fieldOverrides?.primaryFieldId), [config.fieldOverrides?.primaryFieldId, fields]);

  const reload = useCallback(async () => {
    if (!config.tableId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [fieldResponse, viewResponse, recordResponse] = await Promise.all([
        listTeableRuntimeFields(config.tableId),
        listTeableRuntimeViews(config.tableId),
        listTeableRuntimeRecords(config.tableId, { viewId: config.viewId, take: 100, skip: 0 })
      ]);
      const currentView = resolveRuntimeView(viewResponse.views, config.viewId);
      const createFormView = resolveRuntimeView(viewResponse.views, config.createFormViewId ?? config.viewId);
      const editFormView = resolveRuntimeView(viewResponse.views, config.editFormViewId ?? config.createFormViewId ?? config.viewId);
      const latestViewConfig = currentView ? extractTeableViewFieldConfig(currentView) : {};
      const latestCreateFormConfig = createFormView?.viewType === "form" ? extractTeableFormViewConfig(createFormView) : {};
      const latestEditFormConfig = editFormView?.viewType === "form" ? extractTeableFormViewConfig(editFormView) : {};
      setFields(fieldResponse.fields);
      setRecords(recordResponse.records);
      setRuntimeViewConfig(latestViewConfig);
      setRuntimeCreateFormConfig(latestCreateFormConfig);
      setRuntimeEditFormConfig(latestEditFormConfig);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeBlockLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [config.tableId, config.viewId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!config.tableId) {
    return <div className="affairs-stage-empty compact">{t("shell.teableRuntimeConfigMissing")}</div>;
  }

  if (loading) {
    return <div className="affairs-stage-empty compact">{t("common.loading")}</div>;
  }

  if (error) {
    return (
      <div className="affairs-dashboard-widget-error">
        <strong>{t("shell.teableRuntimeBlockLoadFailed")}</strong>
        <p>{error}</p>
      </div>
    );
  }

  const headerActions = (
    <>
      {config.viewType !== "form" && !config.readOnly ? (
        <button type="button" className="affairs-dashboard-toolbar-button" onClick={() => setCreating(true)}>
          {t("shell.teableRuntimeCreateRecordAction")}
        </button>
      ) : null}
      <button type="button" className="affairs-dashboard-toolbar-button" onClick={() => void reload()}>{t("shell.teableRuntimeRefreshAction")}</button>
    </>
  );

  const content = (
    <div className="teable-runtime-block" data-view-type={config.viewType}>
      {config.viewType === "form" ? (
        <TeableFormView
          tableId={config.tableId}
          fields={fields}
          fieldOrder={runtimeCreateFormConfig.formFieldOrder ?? config.fieldOverrides?.createFormFieldOrder ?? config.fieldOverrides?.formFieldOrder}
          visibleFieldIds={runtimeCreateFormConfig.visibleFieldIds ?? config.fieldOverrides?.createFormVisibleFieldIds ?? config.fieldOverrides?.visibleFieldIds}
          requiredFieldIds={runtimeCreateFormConfig.requiredFieldIds ?? config.fieldOverrides?.createFormRequiredFieldIds ?? config.fieldOverrides?.requiredFieldIds}
          fieldDisplay={runtimeCreateFormConfig.formFieldDisplay ?? config.fieldOverrides?.createFormFieldDisplay ?? config.fieldOverrides?.formFieldDisplay}
          onCreated={reload}
        />
      ) : config.viewType === "calendar" ? (
        <TeableCalendarView fields={fields} records={records} startFieldId={config.fieldOverrides?.calendarStartFieldId} onOpenRecord={setSelectedRecord} />
      ) : config.viewType === "kanban" ? (
        <TeableKanbanView fields={fields} records={records} groupFieldId={config.fieldOverrides?.kanbanGroupFieldId} onOpenRecord={setSelectedRecord} />
      ) : (
        <TeableGridView
          fields={fields}
          records={records}
          fieldOrder={runtimeViewConfig.fieldOrder ?? config.fieldOverrides?.viewFieldOrder ?? config.fieldOverrides?.formFieldOrder}
          visibleFieldIds={runtimeViewConfig.visibleFieldIds ?? config.fieldOverrides?.viewVisibleFieldIds ?? config.fieldOverrides?.visibleFieldIds}
          fieldWidths={runtimeViewConfig.fieldWidths ?? config.fieldOverrides?.viewFieldWidths ?? config.fieldOverrides?.fieldWidths}
          fieldDisplay={runtimeViewConfig.fieldDisplay ?? config.fieldOverrides?.viewFieldDisplay}
          onOpenRecord={setSelectedRecord}
        />
      )}
      <TeableRecordDrawer
        tableId={config.tableId}
        fields={fields}
        record={selectedRecord}
        fieldOrder={runtimeEditFormConfig.formFieldOrder ?? config.fieldOverrides?.editFormFieldOrder ?? runtimeCreateFormConfig.formFieldOrder ?? config.fieldOverrides?.formFieldOrder}
        visibleFieldIds={runtimeEditFormConfig.visibleFieldIds ?? config.fieldOverrides?.editFormVisibleFieldIds ?? runtimeCreateFormConfig.visibleFieldIds ?? config.fieldOverrides?.visibleFieldIds}
        requiredFieldIds={runtimeEditFormConfig.requiredFieldIds ?? config.fieldOverrides?.editFormRequiredFieldIds ?? runtimeCreateFormConfig.requiredFieldIds ?? config.fieldOverrides?.requiredFieldIds}
        fieldDisplay={runtimeEditFormConfig.formFieldDisplay ?? config.fieldOverrides?.editFormFieldDisplay ?? runtimeCreateFormConfig.formFieldDisplay ?? config.fieldOverrides?.formFieldDisplay}
        open={Boolean(selectedRecord)}
        onClose={() => setSelectedRecord(null)}
        onSaved={reload}
        onDeleted={reload}
      />
      <TeableCreateRecordModal
        open={creating}
        tableId={config.tableId}
        tableName={config.tableName}
        fields={fields}
        fieldOrder={runtimeCreateFormConfig.formFieldOrder ?? config.fieldOverrides?.createFormFieldOrder ?? config.fieldOverrides?.formFieldOrder}
        visibleFieldIds={runtimeCreateFormConfig.visibleFieldIds ?? config.fieldOverrides?.createFormVisibleFieldIds ?? config.fieldOverrides?.visibleFieldIds}
        requiredFieldIds={runtimeCreateFormConfig.requiredFieldIds ?? config.fieldOverrides?.createFormRequiredFieldIds ?? config.fieldOverrides?.requiredFieldIds}
        fieldDisplay={runtimeCreateFormConfig.formFieldDisplay ?? config.fieldOverrides?.createFormFieldDisplay ?? config.fieldOverrides?.formFieldDisplay}
        onClose={() => setCreating(false)}
        onCreated={reload}
      />
      {primaryField ? null : <div className="affairs-stage-empty compact">{t("shell.teableRuntimePrimaryFieldMissing")}</div>}
    </div>
  );

  return render ? <>{render({ headerActions, content })}</> : content;
}

function resolveRuntimeView(views: TeableRuntimeViewDto[], viewId: string | null): TeableRuntimeViewDto | null {
  if (!viewId) {
    return null;
  }
  return views.find((view) => view.viewId === viewId) ?? null;
}
