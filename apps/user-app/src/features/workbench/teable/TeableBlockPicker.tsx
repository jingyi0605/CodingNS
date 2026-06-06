import { useEffect, useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import {
  listTeableRuntimeTables,
  listTeableRuntimeViews,
  type TeableBlockSelection,
  type TeableRuntimeTableDto,
  type TeableRuntimeViewDto
} from "./api/teable-runtime-api";
import { extractTeableFormViewConfig } from "./utils/teable-form-view-config";
import { extractTeableViewFieldConfig } from "./utils/teable-view-config";

const SUPPORTED_VIEW_TYPES = new Set(["grid", "form", "calendar", "kanban"]);

export function TeableBlockPicker({
  title,
  onSelectionChange
}: {
  title: string;
  onSelectionChange: (selection: TeableBlockSelection | null) => void;
}) {
  const [tables, setTables] = useState<TeableRuntimeTableDto[]>([]);
  const [views, setViews] = useState<TeableRuntimeViewDto[]>([]);
  const [tableId, setTableId] = useState("");
  const [viewId, setViewId] = useState("");
  const [createFormViewId, setCreateFormViewId] = useState("");
  const [editFormViewId, setEditFormViewId] = useState("");
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingViews, setLoadingViews] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTable = useMemo(() => tables.find((table) => table.tableId === tableId) ?? null, [tableId, tables]);
  const supportedViews = useMemo(() => views.filter((view) => SUPPORTED_VIEW_TYPES.has(view.viewType)), [views]);
  const formViews = useMemo(() => views.filter((view) => view.viewType === "form"), [views]);
  const selectedView = useMemo(() => supportedViews.find((view) => view.viewId === viewId) ?? null, [supportedViews, viewId]);
  const selectedCreateFormView = useMemo(() => formViews.find((view) => view.viewId === createFormViewId) ?? null, [createFormViewId, formViews]);
  const selectedEditFormView = useMemo(() => formViews.find((view) => view.viewId === editFormViewId) ?? null, [editFormViewId, formViews]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTables(true);
    setError(null);
    void listTeableRuntimeTables()
      .then((response) => {
        if (cancelled) return;
        setTables(response.tables);
        setTableId(response.tables[0]?.tableId ?? "");
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeTablesLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tableId) {
      setViews([]);
      setViewId("");
      return;
    }
    let cancelled = false;
    setLoadingViews(true);
    setError(null);
    void listTeableRuntimeViews(tableId)
      .then((response) => {
        if (cancelled) return;
        setViews(response.views);
        const firstSupported = response.views.find((view) => SUPPORTED_VIEW_TYPES.has(view.viewType));
        const firstFormView = response.views.find((view) => view.viewType === "form");
        setViewId(firstSupported?.viewId ?? "");
        setCreateFormViewId(firstFormView?.viewId ?? "");
        setEditFormViewId(firstFormView?.viewId ?? "");
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("shell.teableRuntimeViewsLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingViews(false);
      });
    return () => { cancelled = true; };
  }, [tableId]);

  useEffect(() => {
    if (!selectedTable || !selectedView || !SUPPORTED_VIEW_TYPES.has(selectedView.viewType)) {
      onSelectionChange(null);
      return;
    }
    const requiredCreateFormView = selectedView.viewType === "form" ? selectedView : selectedCreateFormView;
    const requiredEditFormView = selectedView.viewType === "form" ? selectedView : selectedEditFormView;
    if (!requiredCreateFormView || !requiredEditFormView) {
      onSelectionChange(null);
      return;
    }
    const nextTitle = title.trim() || selectedView.viewName || selectedTable.tableName;
    const createFormViewConfig = extractTeableFormViewConfig(requiredCreateFormView);
    const editFormViewConfig = extractTeableFormViewConfig(requiredEditFormView);
    const viewFieldConfig = extractTeableViewFieldConfig(selectedView);
    onSelectionChange({
      table: selectedTable,
      view: selectedView,
      config: {
        tableId: selectedTable.tableId,
        tableName: selectedTable.tableName,
        viewId: selectedView.viewId,
        viewName: selectedView.viewName,
        viewType: selectedView.viewType as "grid" | "form" | "calendar" | "kanban",
        createFormViewId: requiredCreateFormView.viewId,
        createFormViewName: requiredCreateFormView.viewName,
        editFormViewId: requiredEditFormView.viewId,
        editFormViewName: requiredEditFormView.viewName,
        title: nextTitle,
        density: "compact",
        readOnly: false,
        fieldOverrides: {
          viewFieldOrder: viewFieldConfig.fieldOrder,
          viewVisibleFieldIds: viewFieldConfig.visibleFieldIds,
          viewFieldWidths: viewFieldConfig.fieldWidths,
          viewFieldDisplay: viewFieldConfig.fieldDisplay,
          createFormFieldOrder: createFormViewConfig.formFieldOrder,
          createFormVisibleFieldIds: createFormViewConfig.visibleFieldIds,
          createFormRequiredFieldIds: createFormViewConfig.requiredFieldIds,
          createFormFieldDisplay: createFormViewConfig.formFieldDisplay,
          editFormFieldOrder: editFormViewConfig.formFieldOrder,
          editFormVisibleFieldIds: editFormViewConfig.visibleFieldIds,
          editFormRequiredFieldIds: editFormViewConfig.requiredFieldIds,
          editFormFieldDisplay: editFormViewConfig.formFieldDisplay,
          // 兼容旧块配置：旧代码只读这一组字段。
          visibleFieldIds: viewFieldConfig.visibleFieldIds,
          formFieldOrder: createFormViewConfig.formFieldOrder,
          requiredFieldIds: createFormViewConfig.requiredFieldIds,
          fieldWidths: viewFieldConfig.fieldWidths,
          formFieldDisplay: createFormViewConfig.formFieldDisplay
        }
      }
    });
  }, [onSelectionChange, selectedCreateFormView, selectedEditFormView, selectedTable, selectedView, title]);

  return (
    <div className="teable-runtime-picker">
      <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-teable-table">
        <span>{t("shell.teableRuntimeTableField")}</span>
        <select
          id="affairs-dashboard-teable-table"
          className="affairs-dashboard-inline-select"
          value={tableId}
          disabled={loadingTables}
          onChange={(event) => setTableId(event.currentTarget.value)}
        >
          {tables.map((table) => <option key={table.tableId} value={table.tableId}>{table.tableName}</option>)}
        </select>
      </label>
      <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-teable-view">
        <span>{t("shell.teableRuntimeViewField")}</span>
        <select
          id="affairs-dashboard-teable-view"
          className="affairs-dashboard-inline-select"
          value={viewId}
          disabled={loadingViews || !tableId}
          onChange={(event) => setViewId(event.currentTarget.value)}
        >
          {supportedViews.map((view) => <option key={view.viewId} value={view.viewId}>{view.viewName} · {resolveViewTypeLabel(view.viewType)}</option>)}
        </select>
      </label>
      <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-teable-create-form-view">
        <span>{t("shell.teableRuntimeCreateFormViewField")}</span>
        <select
          id="affairs-dashboard-teable-create-form-view"
          className="affairs-dashboard-inline-select"
          value={createFormViewId}
          disabled={loadingViews || !tableId || formViews.length === 0}
          onChange={(event) => setCreateFormViewId(event.currentTarget.value)}
        >
          {formViews.map((view) => <option key={view.viewId} value={view.viewId}>{view.viewName}</option>)}
        </select>
      </label>
      <label className="affairs-dashboard-inline-field" htmlFor="affairs-dashboard-teable-edit-form-view">
        <span>{t("shell.teableRuntimeEditFormViewField")}</span>
        <select
          id="affairs-dashboard-teable-edit-form-view"
          className="affairs-dashboard-inline-select"
          value={editFormViewId}
          disabled={loadingViews || !tableId || formViews.length === 0}
          onChange={(event) => setEditFormViewId(event.currentTarget.value)}
        >
          {formViews.map((view) => <option key={view.viewId} value={view.viewId}>{view.viewName}</option>)}
        </select>
      </label>
      {tableId && formViews.length === 0 && !loadingViews ? <p className="affairs-dashboard-inline-error">{t("shell.teableRuntimeFormViewsEmpty")}</p> : null}
      {tables.length === 0 && !loadingTables ? <p className="affairs-dashboard-inline-help">{t("shell.teableRuntimeTablesEmpty")}</p> : null}
      {tableId && supportedViews.length === 0 && !loadingViews ? <p className="affairs-dashboard-inline-help">{t("shell.teableRuntimeViewsEmpty")}</p> : null}
      {error ? <p className="affairs-dashboard-inline-error">{error}</p> : null}
    </div>
  );
}

function resolveViewTypeLabel(viewType: string): string {
  if (viewType === "grid") return t("shell.teableRuntimeViewGrid");
  if (viewType === "form") return t("shell.teableRuntimeViewForm");
  if (viewType === "calendar") return t("shell.teableRuntimeViewCalendar");
  if (viewType === "kanban") return t("shell.teableRuntimeViewKanban");
  return viewType;
}
