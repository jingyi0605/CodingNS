import { useEffect, useMemo, useRef, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import { MobileSheet } from "../components/MobileSheet";
import type {
  AffairsTagNodeDto,
  TeableCreatedFieldMappingDto,
  TeableFieldMappingDto,
  TeableFieldSummaryDto,
  TeableGlobalBindingDto,
  TeableMirrorModeDto,
  TeableOverviewDto,
  TeableSourceFieldDefinitionDto,
  TeableSyncLogDto,
  TeableSyncSourceTypeDto,
  TeableTableCatalogItemDto,
  TeableWorkbenchSyncConfigDto,
  WorkspaceDto
} from "../features/conversation/api/conversation-api";
import {
  createTeableTableFields,
  getTeableFieldMappings,
  getTeableGlobalBinding,
  getTeableOverview,
  getTeableSyncLogs,
  getTeableTableCatalog,
  getTeableTableFields,
  listGlobalAffairsTags,
  requestTeableMirrorSync,
  saveTeableFieldMappings,
  saveTeableGlobalBinding,
  saveTeableWorkbenchSyncConfigs
} from "../features/conversation/api/conversation-api";
import { t } from "../shared/i18n";
import { useToast } from "../shared/toast";
import { SettingsSwitch } from "./SettingsSwitch";

interface TeableSettingsModalProps {
  readonly open: boolean;
  readonly mobile: boolean;
  readonly workspaceOptions?: Array<Pick<WorkspaceDto, "id" | "name">>;
  readonly onClose: () => void;
}

interface TeableBindingDraft {
  readonly baseUrl: string;
  readonly spaceId: string;
  readonly baseId: string;
  readonly authRef: string;
  readonly authToken: string;
  readonly enabled: boolean;
  readonly mirrorMode: TeableMirrorModeDto;
}

interface MirrorDraft {
  readonly configId: string;
  readonly sourceType: TeableSyncSourceTypeDto;
  readonly enabled: boolean;
  readonly targetTableId: string;
  readonly scope: TeableWorkbenchSyncConfigDto["scope"];
}

interface FieldMappingDraft {
  readonly configId: string;
  readonly sourceType: TeableSyncSourceTypeDto;
  readonly targetTableId: string;
  readonly items: TeableFieldMappingDto["items"];
}

interface SyncTableOption {
  readonly tableId: string;
  readonly tableName: string;
  readonly assignedSourceType: TeableSyncSourceTypeDto | null;
}

interface TagRootOption {
  readonly key: string;
  readonly tag: AffairsTagNodeDto;
}

interface FieldAutoCreateDraft {
  readonly sourceField: string;
  readonly fieldName: string;
  readonly fieldType: "singleLineText" | "longText" | "date";
  readonly required: boolean;
}

type TeableSettingsTab = "connection" | "tableSync" | "syncLogs";

const DEFAULT_TEABLE_AUTH_REF = "secret://teable/main";
const MIRROR_MODE_OPTIONS: TeableMirrorModeDto[] = ["manual", "scheduled", "event_driven"];
const MIRROR_SOURCE_TYPES: TeableSyncSourceTypeDto[] = ["sessions", "todos", "tags"];

export function TeableSettingsModal({
  open,
  mobile,
  workspaceOptions = [],
  onClose
}: TeableSettingsModalProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TeableSettingsTab>("connection");
  const [binding, setBinding] = useState<TeableGlobalBindingDto | null>(null);
  const [overview, setOverview] = useState<TeableOverviewDto | null>(null);
  const [tableCatalog, setTableCatalog] = useState<TeableTableCatalogItemDto[]>([]);
  const [sourceFieldsByType, setSourceFieldsByType] = useState<Record<TeableSyncSourceTypeDto, TeableSourceFieldDefinitionDto[]>>({
    tags: [],
    sessions: [],
    todos: []
  });
  const [fieldMappings, setFieldMappings] = useState<TeableFieldMappingDto[]>([]);
  const [targetFieldsByTableId, setTargetFieldsByTableId] = useState<Record<string, TeableFieldSummaryDto[]>>({});
  const [rootTags, setRootTags] = useState<AffairsTagNodeDto[]>([]);
  const [syncLogs, setSyncLogs] = useState<TeableSyncLogDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [savingSyncSettings, setSavingSyncSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [bindingDraft, setBindingDraft] = useState<TeableBindingDraft>(createBindingDraft(null));
  const [mirrorDrafts, setMirrorDrafts] = useState<MirrorDraft[]>(createMirrorDrafts([]));
  const [mappingDrafts, setMappingDrafts] = useState<Record<TeableSyncSourceTypeDto, FieldMappingDraft>>({
    tags: createEmptyFieldMappingDraft("tags"),
    sessions: createEmptyFieldMappingDraft("sessions"),
    todos: createEmptyFieldMappingDraft("todos")
  });
  const [selectedMappingSourceType, setSelectedMappingSourceType] = useState<TeableSyncSourceTypeDto>("sessions");
  const lastSelectedTableIdRef = useRef<string | null>(null);
  const [addedSyncTableIds, setAddedSyncTableIds] = useState<string[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableToAddId, setTableToAddId] = useState("");
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldPickerSelection, setFieldPickerSelection] = useState<string[]>([]);
  const [creatingFields, setCreatingFields] = useState(false);

  const normalizedWorkspaceOptions = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ id: string; name: string }> = [];
    workspaceOptions.forEach((item) => {
      const id = item.id.trim();
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      items.push({
        id,
        name: item.name.trim() || id
      });
    });
    return items;
  }, [workspaceOptions]);

  const settingsTabs = useMemo<Array<{ id: TeableSettingsTab; label: string }>>(() => ([
    { id: "connection", label: t("settings.teableTabConnectionSettings") },
    { id: "tableSync", label: t("settings.teableTabTableSyncSettings") },
    { id: "syncLogs", label: t("settings.teableTabSyncLogs") }
  ]), []);

  const syncTableOptions = useMemo(() => buildSyncTableOptions(tableCatalog, mirrorDrafts), [tableCatalog, mirrorDrafts]);
  const addedSyncTables = useMemo(() => {
    const addedIds = new Set(addedSyncTableIds);
    return syncTableOptions.filter((item) => addedIds.has(item.tableId));
  }, [addedSyncTableIds, syncTableOptions]);
  const selectedSyncTable = useMemo(() => {
    return addedSyncTables.find((item) => item.tableId === selectedTableId)
      ?? addedSyncTables[0]
      ?? null;
  }, [addedSyncTables, selectedTableId]);
  const selectedMappingDraft = mappingDrafts[selectedMappingSourceType];
  const selectedMirrorDraft = mirrorDrafts.find((item) => item.sourceType === selectedMappingSourceType) ?? createMirrorDrafts([]).find((item) => item.sourceType === selectedMappingSourceType)!;
  const selectedSourceFields = sourceFieldsByType[selectedMappingSourceType] ?? [];
  const selectedTargetFields = selectedSyncTable ? targetFieldsByTableId[selectedSyncTable.tableId] ?? [] : [];
  const selectedTableName = selectedSyncTable?.tableName ?? "";
  const availableSyncTables = useMemo(
    () => syncTableOptions.filter((table) => !addedSyncTableIds.includes(table.tableId)),
    [addedSyncTableIds, syncTableOptions]
  );
  const tagRootOptions = useMemo(() => {
    return rootTags.map((tag) => ({
      key: tag.id,
      tag
    } satisfies TagRootOption));
  }, [rootTags]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveTab("connection");
    setPanelError(null);
    setStatusText(null);
    void loadAll();
  }, [open]);

  useEffect(() => {
    setBindingDraft(createBindingDraft(binding));
  }, [binding]);

  useEffect(() => {
    setMirrorDrafts(createMirrorDrafts(overview?.syncConfigs ?? []));
  }, [overview?.syncConfigs]);

  useEffect(() => {
    setMappingDrafts(buildMappingDrafts(overview?.syncConfigs ?? [], fieldMappings));
  }, [overview?.syncConfigs, fieldMappings]);

  useEffect(() => {
    const configuredTableIds = mirrorDrafts.map((item) => item.targetTableId.trim()).filter(Boolean);
    setAddedSyncTableIds((current) => {
      const merged = Array.from(new Set([...current, ...configuredTableIds]));
      return sameStringArray(current, merged) ? current : merged;
    });
  }, [mirrorDrafts]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (selectedTableId && addedSyncTables.some((item) => item.tableId === selectedTableId)) {
      return;
    }
    setSelectedTableId(addedSyncTables[0]?.tableId ?? null);
  }, [addedSyncTables, open, selectedTableId]);

  useEffect(() => {
    if (tableToAddId && availableSyncTables.some((item) => item.tableId === tableToAddId)) {
      return;
    }
    setTableToAddId(availableSyncTables[0]?.tableId ?? "");
  }, [availableSyncTables, tableToAddId]);

  useEffect(() => {
    const targetTableId = selectedSyncTable?.tableId.trim() ?? "";
    if (!open || !targetTableId || targetFieldsByTableId[targetTableId]) {
      return;
    }
    void loadTableFields(targetTableId);
  }, [open, selectedSyncTable, targetFieldsByTableId]);

  useEffect(() => {
    if (!selectedSyncTable || lastSelectedTableIdRef.current === selectedSyncTable.tableId) {
      return;
    }
    lastSelectedTableIdRef.current = selectedSyncTable.tableId;
    if (selectedSyncTable.assignedSourceType) {
      setSelectedMappingSourceType(selectedSyncTable.assignedSourceType);
    }
  }, [selectedSyncTable]);

  async function loadAll(): Promise<void> {
    setLoading(true);
    try {
      const [
        nextBinding,
        nextOverview,
        nextTableCatalog,
        nextFieldMappingsPayload,
        nextSyncLogs,
        nextRootTagsPayload
      ] = await Promise.all([
        getTeableGlobalBinding(),
        getTeableOverview(),
        getTeableTableCatalog(),
        getTeableFieldMappings(),
        getTeableSyncLogs(),
        listGlobalAffairsTags({ includeDisabled: true }).catch(() => ({
          items: [],
          summary: {
            totalActiveTags: 0,
            totalDisabledTags: 0,
            totalRuleEnabledTags: 0,
            totalBoundDocuments: 0
          },
          status: {
            recomputeState: "idle" as const,
            lastRecomputedAt: null,
            lastError: null
          }
        }))
      ]);

      setBinding(nextBinding);
      setOverview(nextOverview);
      setTableCatalog(nextTableCatalog);
      setFieldMappings(nextFieldMappingsPayload.mappings);
      setSyncLogs(nextSyncLogs);
      setSourceFieldsByType(nextFieldMappingsPayload.sourceFieldsByType);
      setRootTags(nextRootTagsPayload.items.filter((item) => item.parentId === null));
      setPanelError(null);
    } catch (error) {
      setPanelError(resolveErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function loadTableFields(tableId: string): Promise<void> {
    try {
      const fields = await getTeableTableFields(tableId);
      setTargetFieldsByTableId((current) => ({
        ...current,
        [tableId]: fields
      }));
    } catch (error) {
      setPanelError(resolveErrorMessage(error));
    }
  }

  function handleClose(): void {
    setPanelError(null);
    setStatusText(null);
    setFieldPickerOpen(false);
    onClose();
  }

  async function handleSaveConnection(): Promise<void> {
    setSavingConnection(true);
    setPanelError(null);
    setStatusText(null);
    try {
      const saved = await saveTeableGlobalBinding({
        baseUrl: bindingDraft.baseUrl,
        spaceId: bindingDraft.spaceId,
        baseId: bindingDraft.baseId,
        authRef: bindingDraft.authRef || DEFAULT_TEABLE_AUTH_REF,
        authToken: bindingDraft.authToken,
        enabled: bindingDraft.enabled,
        mirrorMode: bindingDraft.mirrorMode
      });
      setBinding(saved);
      setStatusText(t("settings.teableBindingSaved"));
      showToast({ title: t("settings.teableBindingSaved"), tone: "success" });
      await loadAll();
    } catch (error) {
      const message = resolveErrorMessage(error);
      setPanelError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSavingConnection(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    setTestingConnection(true);
    setPanelError(null);
    setStatusText(null);
    try {
      const nextTableCatalog = await getTeableTableCatalog();
      setTableCatalog(nextTableCatalog);
      const message = t("settings.teableConnectionTestSuccess", {
        tableCount: nextTableCatalog.length
      });
      setStatusText(message);
      showToast({ title: message, tone: "success" });
    } catch (error) {
      const message = resolveErrorMessage(error);
      setPanelError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setTestingConnection(false);
    }
  }

  function handleAddSyncTable(table: SyncTableOption): void {
    setAddedSyncTableIds((current) => current.includes(table.tableId) ? current : [...current, table.tableId]);
    setSelectedTableId(table.tableId);
    if (!targetFieldsByTableId[table.tableId]) {
      void loadTableFields(table.tableId);
    }
  }

  function handleRemoveSyncTable(tableId: string): void {
    setAddedSyncTableIds((current) => current.filter((item) => item !== tableId));
    if (selectedTableId === tableId) {
      const nextTableId = addedSyncTableIds.find((item) => item !== tableId) ?? null;
      setSelectedTableId(nextTableId);
    }
  }

  function handleOpenFieldPicker(): void {
    const unmappedFields = selectedSourceFields
      .filter((field) => !selectedMappingDraft.items.some((item) => item.sourceField === field.key && item.targetFieldId))
      .map((field) => field.key);
    setFieldPickerSelection(unmappedFields.length > 0 ? unmappedFields : selectedSourceFields.map((field) => field.key));
    setFieldPickerOpen(true);
  }

  async function handleCreateAndMapFields(): Promise<void> {
    if (!selectedSyncTable) {
      return;
    }
    const fields = selectedSourceFields
      .filter((field) => fieldPickerSelection.includes(field.key))
      .map(buildAutoCreateFieldDraft);
    if (fields.length === 0) {
      setPanelError(t("settings.teableFieldAutoCreateEmptyError"));
      return;
    }

    setCreatingFields(true);
    setPanelError(null);
    setStatusText(null);
    try {
      const created = await createTeableTableFields({
        tableId: selectedSyncTable.tableId,
        fields
      });
      applyCreatedFieldMappings(created);
      await loadTableFields(selectedSyncTable.tableId);
      setFieldPickerOpen(false);
      const message = t("settings.teableFieldAutoCreateSuccess", { count: created.length });
      setStatusText(message);
      showToast({ title: message, tone: "success" });
    } catch (error) {
      const message = resolveErrorMessage(error);
      setPanelError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setCreatingFields(false);
    }
  }

  async function handleSaveSyncSettings(): Promise<void> {
    if (!selectedSyncTable) {
      return;
    }
    setSavingSyncSettings(true);
    setPanelError(null);
    setStatusText(null);
    try {
      const savedConfigs = await saveTeableWorkbenchSyncConfigs({
        items: [{
          sourceType: selectedMappingSourceType,
          enabled: true,
          targetTableId: selectedSyncTable.tableId,
          scope: selectedMirrorDraft.scope as Record<string, unknown>
        }]
      });
      const savedConfig = savedConfigs.find((item) => item.sourceType === selectedMappingSourceType);
      const configId = savedConfig?.configId ?? selectedMappingDraft.configId;
      await saveTeableFieldMappings({
        items: [{
          configId,
          sourceType: selectedMappingSourceType,
          targetTableId: selectedSyncTable.tableId,
          items: normalizeMappingItems(selectedMappingDraft.items)
        }]
      });
      setStatusText(t("settings.teableTableSyncSettingsSaved"));
      showToast({ title: t("settings.teableTableSyncSettingsSaved"), tone: "success" });
      await loadAll();
    } catch (error) {
      const message = resolveErrorMessage(error);
      setPanelError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSavingSyncSettings(false);
    }
  }

  async function handleRequestMirrorSync(): Promise<void> {
    setSyncing(true);
    setPanelError(null);
    setStatusText(null);
    try {
      const task = await requestTeableMirrorSync({ mirrorTypes: [selectedMappingSourceType] });
      const message = task.summary || t("settings.teableLatestTaskEmpty");
      setStatusText(message);
      showToast({ title: message, tone: "success" });
      await loadAll();
    } catch (error) {
      const message = resolveErrorMessage(error);
      setPanelError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSyncing(false);
    }
  }

  function updateSelectedMirrorDraft(updater: (draft: MirrorDraft) => MirrorDraft): void {
    setMirrorDrafts((current) => current.map((item) => item.sourceType === selectedMappingSourceType ? updater(item) : item));
  }

  function updateSelectedMappingItem(sourceField: TeableSourceFieldDefinitionDto, nextFieldId: string): void {
    const targetField = selectedTargetFields.find((item) => item.fieldId === nextFieldId) ?? null;
    setMappingDrafts((current) => ({
      ...current,
      [selectedMappingSourceType]: {
        ...current[selectedMappingSourceType],
        targetTableId: selectedSyncTable?.tableId ?? current[selectedMappingSourceType].targetTableId,
        items: selectedSourceFields.map((field) => {
          if (field.key !== sourceField.key) {
            return current[selectedMappingSourceType].items.find((item) => item.sourceField === field.key) ?? {
              sourceField: field.key,
              targetFieldId: "",
              targetFieldName: "",
              required: field.required
            };
          }
          return {
            sourceField: field.key,
            targetFieldId: nextFieldId,
            targetFieldName: targetField?.fieldName ?? "",
            required: field.required
          };
        }).filter((item) => item.targetFieldId)
      }
    }));
  }

  function applyCreatedFieldMappings(created: TeableCreatedFieldMappingDto[]): void {
    setMappingDrafts((current) => {
      const nextItemsBySourceField = new Map(current[selectedMappingSourceType].items.map((item) => [item.sourceField, item] as const));
      created.forEach((item) => {
        nextItemsBySourceField.set(item.sourceField, {
          sourceField: item.sourceField,
          targetFieldId: item.targetFieldId,
          targetFieldName: item.targetFieldName,
          required: item.required
        });
      });
      const nextItems = selectedSourceFields
        .map((field) => nextItemsBySourceField.get(field.key) ?? null)
        .filter((item): item is TeableFieldMappingDto["items"][number] => Boolean(item?.targetFieldId));
      return {
        ...current,
        [selectedMappingSourceType]: {
          ...current[selectedMappingSourceType],
          targetTableId: selectedSyncTable?.tableId ?? current[selectedMappingSourceType].targetTableId,
          items: nextItems
        }
      };
    });
  }

  const connectionPanel = (
    <div className="settings-teable-tab-panel">
      <ModalSection heading={t("settings.teableBindingSectionTitle")} description={t("settings.teableBindingSectionDescription")}>
        <ModalField label={t("settings.teableEnabledLabel")}>
          <div className="settings-teable-switch-field">
            <SettingsSwitch
              checked={bindingDraft.enabled}
              label={t("settings.teableEnabledLabel")}
              semanticRole="switch"
              onChange={(checked) => {
                setBindingDraft((current) => ({ ...current, enabled: checked }));
              }}
            />
            <span className="settings-teable-switch-caption">{bindingDraft.enabled ? t("common.enabled") : t("common.disabled")}</span>
          </div>
        </ModalField>
        <ModalField label={t("settings.teableBaseUrlLabel")} description={t("settings.teableBaseUrlDescription")} htmlFor="teable-base-url">
          <input
            id="teable-base-url"
            className="settings-text-input"
            value={bindingDraft.baseUrl}
            placeholder={t("settings.teableBaseUrlPlaceholder")}
            onChange={(event) => setBindingDraft((current) => ({ ...current, baseUrl: event.target.value }))}
          />
        </ModalField>
        <ModalField label={t("settings.teableSpaceIdLabel")} htmlFor="teable-space-id">
          <input id="teable-space-id" className="settings-text-input" value={bindingDraft.spaceId} placeholder={t("settings.teableSpaceIdPlaceholder")} onChange={(event) => setBindingDraft((current) => ({ ...current, spaceId: event.target.value }))} />
        </ModalField>
        <ModalField label={t("settings.teableBaseIdLabel")} htmlFor="teable-base-id">
          <input id="teable-base-id" className="settings-text-input" value={bindingDraft.baseId} placeholder={t("settings.teableBaseIdPlaceholder")} onChange={(event) => setBindingDraft((current) => ({ ...current, baseId: event.target.value }))} />
        </ModalField>
        <ModalField label={t("settings.teableAuthTokenLabel")} description={t("settings.teableAuthTokenDescription")} htmlFor="teable-auth-token">
          <input id="teable-auth-token" type="password" className="settings-text-input" value={bindingDraft.authToken} placeholder={t("settings.teableAuthTokenPlaceholder")} onChange={(event) => setBindingDraft((current) => ({ ...current, authToken: event.target.value }))} />
        </ModalField>
        <ModalField label={t("settings.teableMirrorModeLabel")} htmlFor="teable-mirror-mode">
          <select id="teable-mirror-mode" className="settings-select" value={bindingDraft.mirrorMode} onChange={(event) => setBindingDraft((current) => ({ ...current, mirrorMode: event.target.value as TeableMirrorModeDto }))}>
            {MIRROR_MODE_OPTIONS.map((item) => <option key={item} value={item}>{t(`settings.teableMirrorMode.${item}`)}</option>)}
          </select>
        </ModalField>
      </ModalSection>
    </div>
  );

  const tableSyncPanel = (
    <div className="settings-teable-tab-panel settings-teable-table-sync-layout">
      <ModalSection className="settings-teable-table-picker" heading={t("settings.teableTableSyncListTitle")}>
        {syncTableOptions.length === 0 ? (
          <ModalEmptyState title={t("settings.teableTablesCatalogEmptyTitle")} description={t("settings.teableTablesCatalogEmptyDescription")} compact />
        ) : (
          <div className="settings-teable-config-fields">
            <div className="settings-teable-table-add-panel">
              <ModalField label={t("settings.teableTableToAddLabel")} htmlFor="teable-table-to-add">
                <select
                  id="teable-table-to-add"
                  className="settings-select"
                  value={tableToAddId}
                  disabled={availableSyncTables.length === 0}
                  onChange={(event) => setTableToAddId(event.target.value)}
                >
                  {availableSyncTables.length === 0 ? (
                    <option value="">{t("settings.teableAllTablesAdded")}</option>
                  ) : (
                    availableSyncTables.map((table) => <option key={table.tableId} value={table.tableId}>{table.tableName}</option>)
                  )}
                </select>
              </ModalField>
              <button
                type="button"
                className="secondary-button"
                disabled={availableSyncTables.length === 0}
                onClick={() => {
                  const table = availableSyncTables.find((item) => item.tableId === tableToAddId) ?? availableSyncTables[0];
                  if (table) {
                    handleAddSyncTable(table);
                  }
                }}
              >
                {t("settings.teableAddSyncTableAction")}
              </button>
            </div>

            {addedSyncTables.length === 0 ? (
              <ModalEmptyState title={t("settings.teableSelectSyncTableTitle")} description={t("settings.teableSelectSyncTableDescription")} compact />
            ) : (
              <ModalList compact>
                {addedSyncTables.map((table) => (
                  <ModalListItem
                    key={table.tableId}
                    selected={selectedSyncTable?.tableId === table.tableId}
                    label={table.tableName}
                    trailing={(
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemoveSyncTable(table.tableId);
                        }}
                      >
                        {t("settings.teableRemoveSyncTableAction")}
                      </button>
                    )}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTableId(table.tableId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTableId(table.tableId);
                      }
                    }}
                  />
                ))}
              </ModalList>
            )}
          </div>
        )}
      </ModalSection>

      <ModalSection className="settings-teable-table-sync-main" heading={t("settings.teableTableSyncConfigTitle")} description={t("settings.teableTableSyncConfigDescription")}>
        {!selectedSyncTable ? (
          <ModalEmptyState title={t("settings.teableSelectSyncTableTitle")} description={t("settings.teableSelectSyncTableDescription")} compact />
        ) : (
          <div className="settings-teable-config-fields">
            <div className="settings-teable-table-summary">
              <div>
                <span>{t("settings.teableSelectedSyncTableLabel")}</span>
                <strong>{selectedTableName}</strong>
              </div>
            </div>

            <ModalField label={t("settings.teableSyncSourceLabel")} htmlFor="teable-sync-source">
              <select
                id="teable-sync-source"
                className="settings-select"
                value={selectedMappingSourceType}
                onChange={(event) => setSelectedMappingSourceType(event.target.value as TeableSyncSourceTypeDto)}
              >
                {MIRROR_SOURCE_TYPES.map((item) => <option key={item} value={item}>{t(`settings.teableSyncSource.${item}`)}</option>)}
              </select>
            </ModalField>

            {renderScopeControls()}

            <ModalSection
              heading={t("settings.teableFieldMappingTitle")}
              description={t("settings.teableFieldMappingInlineDescription")}
              actions={selectedSourceFields.length > 0 ? (
                <button type="button" className="secondary-button" disabled={creatingFields} onClick={handleOpenFieldPicker}>
                  {creatingFields ? t("common.loading") : t("settings.teableFieldAutoCreateAction")}
                </button>
              ) : null}
            >
              {selectedSourceFields.length === 0 ? (
                <div className="settings-field-hint">{t("settings.teableSourceFieldsEmpty")}</div>
              ) : (
                <ModalList compact>
                  {selectedSourceFields.map((sourceField) => {
                    const currentItem = selectedMappingDraft.items.find((item) => item.sourceField === sourceField.key) ?? {
                      sourceField: sourceField.key,
                      targetFieldId: "",
                      targetFieldName: "",
                      required: sourceField.required
                    };
                    return (
                      <ModalListItem key={sourceField.key} label={sourceField.label} description={`${sourceField.type} · ${sourceField.required ? t("settings.teableFieldRequired") : t("settings.teableFieldOptional")}`}>
                        <select
                          className="settings-select"
                          value={currentItem.targetFieldId}
                          onChange={(event) => updateSelectedMappingItem(sourceField, event.target.value)}
                        >
                          <option value="">{t("settings.teableFieldTargetPlaceholder")}</option>
                          {selectedTargetFields.map((field) => <option key={field.fieldId} value={field.fieldId}>{field.fieldName}</option>)}
                        </select>
                      </ModalListItem>
                    );
                  })}
                </ModalList>
              )}
            </ModalSection>

            <ModalSection heading={t("settings.teableSyncActionSectionTitle")} description={t("settings.teableSyncActionSectionDescription")}>
              <ModalList compact>
                <ModalListItem
                  label={t("settings.teableLatestTaskTitle")}
                  description={overview?.latestMirrorSyncTask?.summary ?? t("settings.teableLatestTaskEmpty")}
                  trailing={overview?.latestMirrorSyncTask ? <ModalTag tone={resolveTaskTone(overview.latestMirrorSyncTask.state)}>{t(`settings.teableTaskState.${overview.latestMirrorSyncTask.state}`)}</ModalTag> : null}
                />
              </ModalList>
            </ModalSection>

            <div className="settings-teable-inline-actions">
              <button type="button" className="secondary-button" disabled={savingSyncSettings || loading} onClick={() => { void handleSaveSyncSettings(); }}>
                {savingSyncSettings ? t("common.loading") : t("settings.teableSaveTableSyncSettingsAction")}
              </button>
              <button type="button" className="primary-button" disabled={syncing || loading} onClick={() => { void handleRequestMirrorSync(); }}>
                {syncing ? t("common.loading") : t("settings.teableSyncNowAction")}
              </button>
            </div>
          </div>
        )}
      </ModalSection>
    </div>
  );

  function renderScopeControls() {
    if (selectedMappingSourceType === "sessions") {
      const scope = selectedMirrorDraft.scope as { mode?: string; workspaceIds?: string[] };
      const selectedWorkspaceIds = Array.isArray(scope.workspaceIds) ? scope.workspaceIds : [];
      return (
        <ModalField label={t("settings.teableWorkspaceScopeLabel")}>
          <div className="settings-teable-radio-group">
            <label className="settings-teable-radio-line">
              <input
                type="radio"
                name="teable-session-workspace-scope"
                checked={scope.mode !== "selected_workspaces"}
                onChange={() => updateSelectedMirrorDraft((draft) => ({ ...draft, scope: { mode: "all_workspaces" } }))}
              />
              <span>{t("settings.teableWorkspaceScopeAll")}</span>
            </label>
            <label className="settings-teable-radio-line">
              <input
                type="radio"
                name="teable-session-workspace-scope"
                checked={scope.mode === "selected_workspaces"}
                onChange={() => updateSelectedMirrorDraft((draft) => ({ ...draft, scope: { mode: "selected_workspaces", workspaceIds: [] } }))}
              />
              <span>{t("settings.teableWorkspaceScopeSelected")}</span>
            </label>
          </div>
          {scope.mode === "selected_workspaces" ? renderWorkspaceCheckboxes(selectedWorkspaceIds, (workspaceIds) => {
            updateSelectedMirrorDraft((draft) => ({ ...draft, scope: { mode: "selected_workspaces", workspaceIds } }));
          }) : null}
        </ModalField>
      );
    }

    if (selectedMappingSourceType === "todos") {
      const scope = selectedMirrorDraft.scope as { includeWorkspaceTodos?: boolean; includeAffairsTodos?: boolean; workspaceIds?: string[] };
      const selectedWorkspaceIds = Array.isArray(scope.workspaceIds) ? scope.workspaceIds : [];
      const selectedOnly = selectedWorkspaceIds.length > 0;
      return (
        <div className="settings-teable-config-fields">
          <ModalField label={t("settings.teableTodoSourceLabel")}>
            <div className="settings-teable-choice-list">
              <label className="settings-teable-choice-row">
                <input
                  type="checkbox"
                  checked={scope.includeWorkspaceTodos !== false}
                  onChange={(event) => updateSelectedMirrorDraft((draft) => ({
                    ...draft,
                    scope: {
                      ...scope,
                      includeWorkspaceTodos: event.target.checked,
                      includeAffairsTodos: scope.includeAffairsTodos !== false,
                      workspaceIds: selectedWorkspaceIds
                    }
                  }))}
                />
                <span className="settings-teable-choice-copy">
                  <strong>{t("settings.teableTodoWorkspaceSource")}</strong>
                </span>
              </label>
              <label className="settings-teable-choice-row">
                <input
                  type="checkbox"
                  checked={scope.includeAffairsTodos !== false}
                  onChange={(event) => updateSelectedMirrorDraft((draft) => ({
                    ...draft,
                    scope: {
                      ...scope,
                      includeWorkspaceTodos: scope.includeWorkspaceTodos !== false,
                      includeAffairsTodos: event.target.checked,
                      workspaceIds: selectedWorkspaceIds
                    }
                  }))}
                />
                <span className="settings-teable-choice-copy">
                  <strong>{t("settings.teableTodoAffairsSource")}</strong>
                </span>
              </label>
            </div>
          </ModalField>
          <ModalField label={t("settings.teableWorkspaceScopeLabel")}>
            <div className="settings-teable-radio-group">
              <label className="settings-teable-radio-line">
                <input
                  type="radio"
                  name="teable-todo-workspace-scope"
                  checked={!selectedOnly}
                  onChange={() => updateSelectedMirrorDraft((draft) => ({
                    ...draft,
                    scope: {
                      includeWorkspaceTodos: scope.includeWorkspaceTodos !== false,
                      includeAffairsTodos: scope.includeAffairsTodos !== false,
                      workspaceIds: []
                    }
                  }))}
                />
                <span>{t("settings.teableWorkspaceScopeAll")}</span>
              </label>
              <label className="settings-teable-radio-line">
                <input
                  type="radio"
                  name="teable-todo-workspace-scope"
                  checked={selectedOnly}
                  onChange={() => updateSelectedMirrorDraft((draft) => ({
                    ...draft,
                    scope: {
                      includeWorkspaceTodos: scope.includeWorkspaceTodos !== false,
                      includeAffairsTodos: scope.includeAffairsTodos !== false,
                      workspaceIds: normalizedWorkspaceOptions[0] ? [normalizedWorkspaceOptions[0].id] : []
                    }
                  }))}
                />
                <span>{t("settings.teableWorkspaceScopeSelected")}</span>
              </label>
            </div>
            {selectedOnly ? renderWorkspaceCheckboxes(selectedWorkspaceIds, (workspaceIds) => {
              updateSelectedMirrorDraft((draft) => ({
                ...draft,
                scope: {
                  includeWorkspaceTodos: scope.includeWorkspaceTodos !== false,
                  includeAffairsTodos: scope.includeAffairsTodos !== false,
                  workspaceIds
                }
              }));
            }) : null}
          </ModalField>
        </div>
      );
    }

    const scope = selectedMirrorDraft.scope as { rootTagIds?: string[] };
    const selectedRootTagIds = Array.isArray(scope.rootTagIds) ? scope.rootTagIds : [];
    return (
      <ModalField label={t("settings.teableDocumentTagRootsLabel")} description={t("settings.teableDocumentTagRootsDescription")}>
        {tagRootOptions.length === 0 ? (
          <div className="settings-field-hint">{t("settings.teableDocumentTagRootsEmpty")}</div>
        ) : (
          <div className="settings-teable-choice-list">
            {tagRootOptions.map((item) => {
              const checked = selectedRootTagIds.includes(item.tag.id);
              return (
                <label key={item.key} className="settings-teable-choice-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextIds = event.target.checked
                        ? [...selectedRootTagIds, item.tag.id]
                        : selectedRootTagIds.filter((value) => value !== item.tag.id);
                      updateSelectedMirrorDraft((draft) => ({ ...draft, scope: { rootTagIds: Array.from(new Set(nextIds)) } }));
                    }}
                  />
                  <span className="settings-teable-choice-copy">
                    <strong>{item.tag.path}</strong>
                    <small>{t("shell.affairsTagTreeDocumentCount", { count: item.tag.documentCount })}</small>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </ModalField>
    );
  }

  function renderWorkspaceCheckboxes(selectedWorkspaceIds: string[], onChange: (workspaceIds: string[]) => void) {
    if (normalizedWorkspaceOptions.length === 0) {
      return <div className="settings-field-hint">{t("settings.teableWorkspaceScopeEmpty")}</div>;
    }
    return (
      <div className="settings-teable-choice-list settings-teable-workspace-list">
        {normalizedWorkspaceOptions.map((workspace) => {
          const checked = selectedWorkspaceIds.includes(workspace.id);
          return (
            <label key={workspace.id} className="settings-teable-choice-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const nextIds = event.target.checked
                    ? [...selectedWorkspaceIds, workspace.id]
                    : selectedWorkspaceIds.filter((value) => value !== workspace.id);
                  onChange(Array.from(new Set(nextIds)));
                }}
              />
              <span className="settings-teable-choice-copy">
                <strong>{workspace.name}</strong>
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  function renderFieldPickerModal() {
    const content = (
      <div className="settings-teable-field-picker">
        <ModalSection heading={t("settings.teableFieldAutoCreateModalSectionTitle")} description={t("settings.teableFieldAutoCreateModalSectionDescription", { table: selectedTableName })}>
          <ModalList compact>
            {selectedSourceFields.map((field) => {
              const checked = fieldPickerSelection.includes(field.key);
              const existingMapping = selectedMappingDraft.items.find((item) => item.sourceField === field.key && item.targetFieldId);
              return (
                <ModalListItem
                  key={field.key}
                  label={field.label}
                  description={existingMapping ? t("settings.teableFieldAlreadyMappedDescription", { field: existingMapping.targetFieldName }) : `${field.type} · ${field.required ? t("settings.teableFieldRequired") : t("settings.teableFieldOptional")}`}
                  leading={(
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setFieldPickerSelection((current) => event.target.checked
                          ? Array.from(new Set([...current, field.key]))
                          : current.filter((item) => item !== field.key));
                      }}
                    />
                  )}
                />
              );
            })}
          </ModalList>
        </ModalSection>
        <ModalActions align="end" stack>
          <button type="button" className="secondary-button" onClick={() => setFieldPickerOpen(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button" disabled={creatingFields || fieldPickerSelection.length === 0} onClick={() => { void handleCreateAndMapFields(); }}>
            {creatingFields ? t("common.loading") : t("settings.teableFieldAutoCreateConfirmAction")}
          </button>
        </ModalActions>
      </div>
    );

    return mobile ? (
      <MobileSheet
        open={fieldPickerOpen}
        title={t("settings.teableFieldAutoCreateModalTitle")}
        description={t("settings.teableFieldAutoCreateModalDescription")}
        height="three-quarter"
        kind="form"
        showHandle
        onClose={() => setFieldPickerOpen(false)}
      >
        {content}
      </MobileSheet>
    ) : (
      <DesktopModal
        open={fieldPickerOpen}
        title={t("settings.teableFieldAutoCreateModalTitle")}
        description={t("settings.teableFieldAutoCreateModalDescription")}
        size="compact"
        layout="form"
        onClose={() => setFieldPickerOpen(false)}
      >
        {content}
      </DesktopModal>
    );
  }

  const syncLogsPanel = (
    <div className="settings-teable-tab-panel">
      <ModalSection
        heading={t("settings.teableSyncLogsTitle")}
        description={t("settings.teableSyncLogsDescription")}
        actions={(
          <button type="button" className="secondary-button" disabled={loading} onClick={() => { void loadAll(); }}>
            {loading ? t("common.loading") : t("settings.teableSyncLogsRefreshAction")}
          </button>
        )}
      >
        {syncLogs.length === 0 ? (
          <ModalEmptyState
            title={t("settings.teableSyncLogsEmptyTitle")}
            description={t("settings.teableSyncLogsEmptyDescription")}
            compact
          />
        ) : (
          <ModalList compact>
            {syncLogs.map((log) => (
              <ModalListItem
                key={log.logId}
                label={log.summary}
                description={formatSyncLogDescription(log)}
                trailing={<ModalTag tone={resolveTaskTone(log.state)}>{t(`settings.teableTaskState.${log.state}`)}</ModalTag>}
              />
            ))}
          </ModalList>
        )}
      </ModalSection>
    </div>
  );

  function renderActivePanel() {
    if (activeTab === "connection") {
      return connectionPanel;
    }
    if (activeTab === "syncLogs") {
      return syncLogsPanel;
    }
    return tableSyncPanel;
  }

  const body = (
    <div className="settings-teable-modal-layout">
      <div className="settings-teable-tabs" role="tablist" aria-label={t("settings.teableModalTitle")}>
        {settingsTabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "settings-teable-tab active" : "settings-teable-tab"} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {renderActivePanel()}
      {statusText ? <p className="settings-release-status">{statusText}</p> : null}
      {panelError ? <p className="settings-release-status">{panelError}</p> : null}
      {activeTab === "connection" ? (
        <ModalActions className="settings-teable-modal-actions" align="end" stack>
          <button type="button" className="secondary-button" disabled={testingConnection || loading} onClick={() => { void handleTestConnection(); }}>
            {testingConnection ? t("common.loading") : t("settings.teableTestConnectionAction")}
          </button>
          <button type="button" className="primary-button" disabled={savingConnection || loading} onClick={() => { void handleSaveConnection(); }}>
            {savingConnection ? t("common.loading") : t("settings.teableSaveBindingAction")}
          </button>
          <button type="button" className="secondary-button" onClick={handleClose}>{t("common.cancel")}</button>
        </ModalActions>
      ) : null}
    </div>
  );

  return mobile ? (
    <>
      <MobileSheet open={open} title={t("settings.teableModalTitle")} height="full" kind="form" showHandle onClose={handleClose}>
        {body}
      </MobileSheet>
      {renderFieldPickerModal()}
    </>
  ) : (
    <>
      <DesktopModal open={open} title={t("settings.teableModalTitle")} size="regular" layout="form" className="settings-teable-modal" bodyClassName="settings-teable-modal-body" onClose={handleClose}>
        {body}
      </DesktopModal>
      {renderFieldPickerModal()}
    </>
  );
}

function createBindingDraft(binding: TeableGlobalBindingDto | null): TeableBindingDraft {
  return {
    baseUrl: binding?.baseUrl ?? "",
    spaceId: binding?.spaceId ?? "",
    baseId: binding?.baseId ?? "",
    authRef: binding?.authRef ?? DEFAULT_TEABLE_AUTH_REF,
    authToken: "",
    enabled: binding?.enabled ?? false,
    mirrorMode: binding?.mirrorMode ?? "manual"
  };
}

function createMirrorDrafts(configs: TeableWorkbenchSyncConfigDto[]): MirrorDraft[] {
  const configMap = new Map(configs.map((item) => [item.sourceType, item] as const));
  return MIRROR_SOURCE_TYPES.map((sourceType) => {
    const current = configMap.get(sourceType);
    return {
      configId: current?.configId ?? `draft-${sourceType}`,
      sourceType,
      enabled: current?.enabled ?? false,
      targetTableId: current?.targetTableId ?? "",
      scope: current?.scope ?? getDefaultScope(sourceType)
    };
  });
}

function getDefaultScope(sourceType: TeableSyncSourceTypeDto): TeableWorkbenchSyncConfigDto["scope"] {
  switch (sourceType) {
    case "tags":
      return { rootTagIds: [] };
    case "sessions":
      return { mode: "all_workspaces" };
    case "todos":
      return { includeWorkspaceTodos: true, includeAffairsTodos: true, workspaceIds: [] };
    default:
      return { rootTagIds: [] };
  }
}

function createEmptyFieldMappingDraft(sourceType: TeableSyncSourceTypeDto): FieldMappingDraft {
  return {
    configId: `draft-${sourceType}`,
    sourceType,
    targetTableId: "",
    items: []
  };
}

function buildMappingDrafts(
  configs: TeableWorkbenchSyncConfigDto[],
  mappings: TeableFieldMappingDto[]
): Record<TeableSyncSourceTypeDto, FieldMappingDraft> {
  const configByType = new Map(configs.map((item) => [item.sourceType, item] as const));
  const mappingBySourceType = new Map(mappings.map((item) => [item.sourceType, item] as const));
  return {
    tags: buildSingleMappingDraft("tags", configByType.get("tags") ?? null, mappingBySourceType.get("tags") ?? null),
    sessions: buildSingleMappingDraft("sessions", configByType.get("sessions") ?? null, mappingBySourceType.get("sessions") ?? null),
    todos: buildSingleMappingDraft("todos", configByType.get("todos") ?? null, mappingBySourceType.get("todos") ?? null)
  };
}

function buildSingleMappingDraft(
  sourceType: TeableSyncSourceTypeDto,
  config: TeableWorkbenchSyncConfigDto | null,
  mapping: TeableFieldMappingDto | null
): FieldMappingDraft {
  return {
    configId: config?.configId ?? `draft-${sourceType}`,
    sourceType,
    targetTableId: mapping?.targetTableId ?? config?.targetTableId ?? "",
    items: mapping?.items ?? []
  };
}

function buildSyncTableOptions(
  tables: TeableTableCatalogItemDto[],
  drafts: MirrorDraft[]
): SyncTableOption[] {
  const sourceTypeByTableId = new Map<string, TeableSyncSourceTypeDto>();
  drafts.forEach((draft) => {
    const tableId = draft.targetTableId.trim();
    if (tableId) {
      sourceTypeByTableId.set(tableId, draft.sourceType);
    }
  });
  return tables
    .map((table) => ({
      tableId: table.tableId,
      tableName: table.tableName,
      assignedSourceType: sourceTypeByTableId.get(table.tableId) ?? null
    } satisfies SyncTableOption))
    .sort((left, right) => left.tableName.localeCompare(right.tableName, "zh-Hans-CN"));
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeMappingItems(items: TeableFieldMappingDto["items"]): TeableFieldMappingDto["items"] {
  return items.filter((item) => item.sourceField.trim() && item.targetFieldId.trim() && item.targetFieldName.trim());
}

function buildAutoCreateFieldDraft(sourceField: TeableSourceFieldDefinitionDto): FieldAutoCreateDraft {
  return {
    sourceField: sourceField.key,
    fieldName: sourceField.label,
    fieldType: resolveTeableCreateFieldType(sourceField.type),
    required: sourceField.required
  };
}

function resolveTeableCreateFieldType(sourceType: TeableSourceFieldDefinitionDto["type"]): FieldAutoCreateDraft["fieldType"] {
  switch (sourceType) {
    case "datetime":
      return "date";
    default:
      return "singleLineText";
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return t("settings.teableLoadFailed");
}

function formatSyncLogDescription(log: TeableSyncLogDto): string {
  const sourceText = log.sourceTypes.map((item) => t(`settings.teableSyncSource.${item}`)).join("、") || t("common.none");
  const triggerText = t(`settings.teableSyncLogTrigger.${log.triggerType}`);
  const timeText = formatTeableLogTime(log.finishedAt ?? log.updatedAt ?? log.createdAt);
  const countText = formatSyncLogCounts(log);
  const segments = [
    t("settings.teableSyncLogDescription", {
      trigger: triggerText,
      source: sourceText,
      time: timeText
    })
  ];
  if (countText) {
    segments.push(countText);
  }
  if (log.errorDetail?.trim()) {
    segments.push(log.errorDetail.trim());
  }
  return segments.join(" · ");
}

function formatSyncLogCounts(log: TeableSyncLogDto): string {
  const totals = Object.values(log.counts).reduce((acc, item) => {
    if (!item) {
      return acc;
    }
    return {
      created: acc.created + (item.created ?? 0),
      updated: acc.updated + (item.updated ?? 0),
      deleted: acc.deleted + (item.deleted ?? 0),
      skipped: acc.skipped + (item.skipped ?? 0)
    };
  }, { created: 0, updated: 0, deleted: 0, skipped: 0 });
  if (totals.created + totals.updated + totals.deleted + totals.skipped === 0) {
    return "";
  }
  return t("settings.teableSyncLogCounts", totals);
}

function formatTeableLogTime(value: string | null): string {
  if (!value) {
    return t("common.none");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function resolveTaskTone(state: string): "default" | "success" | "warning" | "danger" {
  switch (state) {
    case "succeeded":
      return "success";
    case "partial_failed":
    case "queued":
    case "running":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "default";
  }
}
