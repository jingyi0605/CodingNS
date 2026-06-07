import { useEffect, useMemo, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import {
  createManagedUser,
  deleteManagedUser,
  fetchManagedUsers,
  fetchUserUsage,
  updateManagedUser,
  updateManagedUserStatus,
  type ManagedUserDto,
  type UserUsageItemDto,
  type UserUsagePeriod,
  type UserUsageSnapshotDto,
  type UserUsageUserSnapshotDto
} from "../features/settings/api/user-management-api";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type UserManagementTab = "users" | "usage";
type UserFormMode = "create" | "edit" | null;
type PendingAction =
  | "load-users"
  | "load-usage"
  | "save-user"
  | "status-user"
  | "delete-user"
  | null;

interface UserDraft {
  username: string;
  password: string;
}

const EMPTY_DRAFT: UserDraft = {
  username: "",
  password: ""
};

export function UserManagementPanel({ compact = false, mobile = false }: { compact?: boolean; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<UserManagementTab>("users");
  const [users, setUsers] = useState<ManagedUserDto[]>([]);
  const [usage, setUsage] = useState<UserUsageSnapshotDto | null>(null);
  const [period, setPeriod] = useState<UserUsagePeriod>("day");
  const [selectedUsageUserId, setSelectedUsageUserId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<UserFormMode>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(EMPTY_DRAFT);
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadUsers();
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== "usage") {
      return;
    }

    void loadUsage(period);
  }, [activeTab, open, period]);

  const selectedUsage = useMemo(() => {
    const items = usage?.users ?? [];
    return items.find((item) => item.user.userId === selectedUsageUserId) ?? items[0] ?? null;
  }, [selectedUsageUserId, usage]);

  async function loadUsers(): Promise<void> {
    setPendingAction("load-users");
    setErrorText(null);

    try {
      const result = await fetchManagedUsers();
      setUsers(result.items);
    } catch (error) {
      setErrorText(resolveUserManagementError(error, "settings.userManagementLoadFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function loadUsage(nextPeriod: UserUsagePeriod): Promise<void> {
    setPendingAction("load-usage");
    setErrorText(null);

    try {
      const result = await fetchUserUsage(nextPeriod);
      setUsage(result);
      setSelectedUsageUserId((current) =>
        current && result.users.some((item) => item.user.userId === current)
          ? current
          : result.users[0]?.user.userId ?? null
      );
    } catch (error) {
      setErrorText(resolveUserManagementError(error, "settings.userManagementUsageLoadFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  function openCreateForm(): void {
    setFormMode("create");
    setEditingUserId(null);
    setDraft(EMPTY_DRAFT);
    setPendingDeleteUserId(null);
    setStatusText(null);
    setErrorText(null);
  }

  function openEditForm(user: ManagedUserDto): void {
    setFormMode("edit");
    setEditingUserId(user.userId);
    setDraft({
      username: user.username,
      password: ""
    });
    setPendingDeleteUserId(null);
    setStatusText(null);
    setErrorText(null);
  }

  function closeForm(): void {
    setFormMode(null);
    setEditingUserId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function handleSaveUser(): Promise<void> {
    setPendingAction("save-user");
    setStatusText(null);
    setErrorText(null);

    try {
      if (formMode === "create") {
        await createManagedUser({
          username: draft.username,
          password: draft.password
        });
        setStatusText(t("settings.userManagementCreateSuccess"));
      } else if (formMode === "edit" && editingUserId) {
        await updateManagedUser(editingUserId, {
          username: draft.username,
          password: draft.password.trim().length > 0 ? draft.password : undefined
        });
        setStatusText(t("settings.userManagementUpdateSuccess"));
      }

      closeForm();
      await loadUsers();
      if (activeTab === "usage") {
        await loadUsage(period);
      }
    } catch (error) {
      setErrorText(resolveUserManagementError(error, "settings.userManagementSaveFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleStatusChange(user: ManagedUserDto): Promise<void> {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    setPendingAction("status-user");
    setStatusText(null);
    setErrorText(null);

    try {
      await updateManagedUserStatus(user.userId, nextStatus);
      setStatusText(
        nextStatus === "active"
          ? t("settings.userManagementEnableSuccess")
          : t("settings.userManagementDisableSuccess")
      );
      await loadUsers();
      if (activeTab === "usage") {
        await loadUsage(period);
      }
    } catch (error) {
      setErrorText(resolveUserManagementError(error, "settings.userManagementStatusFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDeleteUser(): Promise<void> {
    if (!pendingDeleteUserId) {
      return;
    }

    setPendingAction("delete-user");
    setStatusText(null);
    setErrorText(null);

    try {
      await deleteManagedUser(pendingDeleteUserId);
      setPendingDeleteUserId(null);
      setStatusText(t("settings.userManagementDeleteSuccess"));
      await loadUsers();
      if (activeTab === "usage") {
        await loadUsage(period);
      }
    } catch (error) {
      setErrorText(resolveUserManagementError(error, "settings.userManagementDeleteFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  function closeModal(): void {
    if (pendingAction === "save-user" || pendingAction === "delete-user") {
      return;
    }

    setOpen(false);
    setFormMode(null);
    setEditingUserId(null);
    setPendingDeleteUserId(null);
    setStatusText(null);
    setErrorText(null);
  }

  const triggerClassName = compact ? "settings-mobile-primary-button" : "settings-button";

  return (
    <>
      <div className={`settings-user-management-entry${compact ? " settings-user-management-entry-compact" : ""}`}>
        <button className={triggerClassName} type="button" onClick={() => setOpen(true)}>
          {t("settings.userManagementOpenAction")}
        </button>
      </div>

      {mobile ? (
        <MobileSheet
          open={open}
          title={t("settings.userManagementTitle")}
          description={t("settings.userManagementDescription")}
          height="full"
          kind="form"
          className="settings-user-management-sheet"
          bodyClassName="settings-user-management-modal-body"
          onClose={closeModal}
        >
          {renderContent()}
        </MobileSheet>
      ) : (
        <DesktopModal
          open={open}
          title={t("settings.userManagementTitle")}
          description={t("settings.userManagementDescription")}
          size="wide"
          layout="form"
          className="settings-user-management-modal"
          bodyClassName="settings-user-management-modal-body"
          onClose={closeModal}
        >
          {renderContent()}
        </DesktopModal>
      )}
    </>
  );

  function renderContent() {
    return (
      <div className="settings-user-management-shell">
        <div className="settings-user-management-tabs" role="tablist" aria-label={t("settings.userManagementTabsLabel")}>
          <button
            type="button"
            className="settings-user-management-tab"
            data-active={activeTab === "users" ? "true" : undefined}
            role="tab"
            aria-selected={activeTab === "users"}
            onClick={() => setActiveTab("users")}
          >
            {t("settings.userManagementUsersTab")}
          </button>
          <button
            type="button"
            className="settings-user-management-tab"
            data-active={activeTab === "usage" ? "true" : undefined}
            role="tab"
            aria-selected={activeTab === "usage"}
            onClick={() => setActiveTab("usage")}
          >
            {t("settings.userManagementUsageTab")}
          </button>
        </div>

        {statusText ? <p className="settings-release-status">{statusText}</p> : null}
        {errorText ? <p className="settings-release-status" data-tone="error">{errorText}</p> : null}

        {activeTab === "users" ? renderUsersTab() : renderUsageTab()}
      </div>
    );
  }

  function renderUsersTab() {
    const loading = pendingAction === "load-users" && users.length === 0;

    return (
      <div className="settings-user-management-panel" role="tabpanel">
        <ModalSection
          heading={t("settings.userManagementUsersTitle")}
          description={t("settings.userManagementUsersDescription")}
          actions={(
            <button className="settings-button" type="button" onClick={openCreateForm}>
              {t("settings.userManagementAddUser")}
            </button>
          )}
        >
          {loading ? (
            <ModalEmptyState title={t("common.loading")} description={t("settings.userManagementLoading")} />
          ) : users.length === 0 ? (
            <ModalEmptyState title={t("settings.userManagementUsersEmptyTitle")} description={t("settings.userManagementUsersEmptyDescription")} />
          ) : (
            <ModalList className="settings-user-list">
              {users.map((user) => (
                <ModalListItem
                  key={user.userId}
                  label={user.username}
                  description={t("settings.userManagementUserMeta", {
                    createdAt: formatDateTime(user.createdAt)
                  })}
                  trailing={(
                    <div className="settings-user-row-actions">
                      <ModalTag tone={user.status === "active" ? "success" : "warning"}>
                        {user.status === "active" ? t("settings.userManagementStatusActive") : t("settings.userManagementStatusDisabled")}
                      </ModalTag>
                      <button className="settings-button" type="button" onClick={() => openEditForm(user)}>
                        {t("settings.userManagementEditUser")}
                      </button>
                      <button className="settings-button" type="button" onClick={() => void handleStatusChange(user)}>
                        {user.status === "active" ? t("settings.userManagementDisableUser") : t("settings.userManagementEnableUser")}
                      </button>
                      <button className="settings-button settings-button-danger" type="button" onClick={() => setPendingDeleteUserId(user.userId)}>
                        {t("settings.userManagementDeleteUser")}
                      </button>
                    </div>
                  )}
                />
              ))}
            </ModalList>
          )}
        </ModalSection>

        {formMode ? renderUserForm() : null}
        {pendingDeleteUserId ? renderDeleteConfirm() : null}
      </div>
    );
  }

  function renderUserForm() {
    const isSaving = pendingAction === "save-user";
    const title = formMode === "create" ? t("settings.userManagementAddUser") : t("settings.userManagementEditUser");
    const description = formMode === "create"
      ? t("settings.userManagementAddDescription")
      : t("settings.userManagementEditDescription");

    return (
      <ModalSection heading={title} description={description} className="settings-user-form-section">
        <div className="settings-user-form">
          <ModalField label={t("settings.userManagementUsernameLabel")}>
            <input
              className="settings-text-input"
              value={draft.username}
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            />
          </ModalField>
          <ModalField
            label={t("settings.userManagementPasswordLabel")}
            description={formMode === "edit" ? t("settings.userManagementPasswordEditHint") : undefined}
          >
            <input
              className="settings-text-input"
              type="password"
              value={draft.password}
              autoComplete="new-password"
              onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            />
          </ModalField>
          <ModalActions>
            <button className="settings-button" type="button" onClick={closeForm} disabled={isSaving}>
              {t("common.cancel")}
            </button>
            <button className="settings-button" type="button" onClick={() => void handleSaveUser()} disabled={isSaving}>
              {isSaving ? t("common.loading") : t("common.save")}
            </button>
          </ModalActions>
        </div>
      </ModalSection>
    );
  }

  function renderDeleteConfirm() {
    const user = users.find((item) => item.userId === pendingDeleteUserId);
    const isDeleting = pendingAction === "delete-user";

    return (
      <ModalSection
        tone="danger"
        heading={t("settings.userManagementDeleteConfirmTitle")}
        description={t("settings.userManagementDeleteConfirmDescription", {
          username: user?.username ?? t("common.unknown")
        })}
      >
        <ModalActions>
          <button className="settings-button" type="button" disabled={isDeleting} onClick={() => setPendingDeleteUserId(null)}>
            {t("common.cancel")}
          </button>
          <button className="settings-button settings-button-danger" type="button" disabled={isDeleting} onClick={() => void handleDeleteUser()}>
            {isDeleting ? t("common.loading") : t("settings.userManagementDeleteUser")}
          </button>
        </ModalActions>
      </ModalSection>
    );
  }

  function renderUsageTab() {
    const usageItems = usage?.users ?? [];
    const loading = pendingAction === "load-usage" && !usage;

    return (
      <div className="settings-user-management-panel" role="tabpanel">
        <ModalSection
          heading={t("settings.userManagementUsageTitle")}
          description={t("settings.userManagementUsageDescription")}
          actions={(
            <div className="settings-user-period-tabs" role="tablist" aria-label={t("settings.userManagementPeriodLabel")}>
              {(["day", "week", "month"] as UserUsagePeriod[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="settings-user-period-tab"
                  data-active={period === item ? "true" : undefined}
                  onClick={() => setPeriod(item)}
                >
                  {getPeriodLabel(item)}
                </button>
              ))}
            </div>
          )}
        >
          {loading ? (
            <ModalEmptyState title={t("common.loading")} description={t("settings.userManagementUsageLoading")} />
          ) : usageItems.length === 0 ? (
            <ModalEmptyState title={t("settings.userManagementUsageEmptyTitle")} description={t("settings.userManagementUsageEmptyDescription")} />
          ) : (
            <div className="settings-user-usage-layout">
              <ModalList className="settings-user-usage-users">
                {usageItems.map((item) => (
                  <ModalListItem
                    key={item.user.userId}
                    as="button"
                    selected={selectedUsage?.user.userId === item.user.userId}
                    label={item.user.username}
                    description={t("settings.userManagementSessionCount", {
                      count: item.sessionCount
                    })}
                    trailing={(
                      <ModalTag tone={item.user.status === "active" ? "success" : "warning"}>
                        {item.user.status === "active" ? t("settings.userManagementStatusActive") : t("settings.userManagementStatusDisabled")}
                      </ModalTag>
                    )}
                    onClick={() => setSelectedUsageUserId(item.user.userId)}
                  />
                ))}
              </ModalList>
              {selectedUsage ? renderSelectedUsage(selectedUsage) : null}
            </div>
          )}
        </ModalSection>
      </div>
    );
  }

  function renderSelectedUsage(item: UserUsageUserSnapshotDto) {
    return (
      <div className="settings-user-usage-detail">
        <div className="settings-user-usage-summary">
          <SummaryMetric label={t("settings.userManagementMetricSessions")} value={formatNumber(item.sessionCount)} />
          <SummaryMetric label={t("settings.userManagementMetricTotalTokens")} value={formatNumber(item.tokenTotals.totalTokens)} />
          <SummaryMetric label={t("settings.userManagementMetricInputTokens")} value={formatNumber(item.tokenTotals.inputTokens)} />
          <SummaryMetric label={t("settings.userManagementMetricOutputTokens")} value={formatNumber(item.tokenTotals.outputTokens)} />
        </div>

        {!item.tokenUsageAvailable ? (
          <p className="settings-user-token-note">{t("settings.userManagementTokenUnavailable")}</p>
        ) : null}

        <TokenChart userUsage={item} />

        <div className="settings-user-usage-groups">
          <UsageGroup title={t("settings.userManagementModelUsage")} items={item.modelUsage} />
          <UsageGroup title={t("settings.userManagementCliProviderUsage")} items={item.cliProviderUsage} />
          <UsageGroup title={t("settings.userManagementModelProviderUsage")} items={item.modelProviderUsage} />
        </div>
      </div>
    );
  }
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-user-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TokenChart({ userUsage }: { userUsage: UserUsageUserSnapshotDto }) {
  const maxValue = Math.max(1, ...userUsage.timeline.map((item) => item.totalTokens));

  if (userUsage.timeline.length === 0) {
    return (
      <ModalEmptyState
        compact
        title={t("settings.userManagementTokenChartEmptyTitle")}
        description={t("settings.userManagementTokenChartEmptyDescription")}
      />
    );
  }

  return (
    <div className="settings-user-token-chart" aria-label={t("settings.userManagementTokenChartTitle")}>
      <div className="settings-user-token-chart-header">
        <strong>{t("settings.userManagementTokenChartTitle")}</strong>
      </div>
      <div className="settings-user-token-bars">
        {userUsage.timeline.map((bucket) => {
          const height = Math.max(6, Math.round((bucket.totalTokens / maxValue) * 96));

          return (
            <div key={bucket.bucket} className="settings-user-token-bar-item">
              <div className="settings-user-token-bar-track" aria-hidden="true">
                <span className="settings-user-token-bar" style={{ height }} />
              </div>
              <span className="settings-user-token-bar-value">{formatNumber(bucket.totalTokens)}</span>
              <span className="settings-user-token-bar-label">{bucket.bucket}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsageGroup({ title, items }: { title: string; items: UserUsageItemDto[] }) {
  const maxCount = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="settings-user-usage-group">
      <strong>{title}</strong>
      {items.length === 0 ? (
        <p className="settings-user-usage-empty">{t("settings.userManagementUsageGroupEmpty")}</p>
      ) : (
        <div className="settings-user-usage-bars">
          {items.map((item) => (
            <div key={item.label} className="settings-user-usage-bar-row">
              <span className="settings-user-usage-bar-label">{item.label}</span>
              <span className="settings-user-usage-bar-track" aria-hidden="true">
                <span className="settings-user-usage-bar" style={{ width: `${Math.max(6, Math.round((item.count / maxCount) * 100))}%` }} />
              </span>
              <span className="settings-user-usage-bar-value">{formatNumber(item.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getPeriodLabel(period: UserUsagePeriod): string {
  if (period === "week") {
    return t("settings.userManagementPeriodWeek");
  }

  if (period === "month") {
    return t("settings.userManagementPeriodMonth");
  }

  return t("settings.userManagementPeriodDay");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function resolveUserManagementError(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    return error.message || t(fallbackKey);
  }

  return error instanceof Error ? error.message : t(fallbackKey);
}
