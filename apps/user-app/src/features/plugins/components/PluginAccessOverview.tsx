import { ModalEmptyState, ModalList, ModalListItem, ModalSection, ModalTag } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import type { PluginAuditEventDto, PluginPermissionGrantDto } from "../api/plugins-api";
import {
  getPluginPermissionGrantModeLabel,
  getPluginPermissionLabel,
  getPluginPermissionScopeLabel
} from "./plugin-permission-copy";

interface PluginAccessOverviewProps {
  readonly grants: PluginPermissionGrantDto[];
  readonly auditEvents: PluginAuditEventDto[];
  readonly loading: boolean;
  readonly revokingGrantId: string | null;
  readonly onRevokeGrant?: (grant: PluginPermissionGrantDto) => void;
}

export function PluginAccessOverview({
  grants,
  auditEvents,
  loading,
  revokingGrantId,
  onRevokeGrant
}: PluginAccessOverviewProps) {
  const permissionEvents = auditEvents.filter((event) => (
    event.eventType === "plugin.permission_granted"
    || event.eventType === "plugin.permission_revoked"
    || event.eventType === "plugin.permission_denied"
  ));

  return (
    <>
      <ModalSection
        heading={t("plugins.grantedPermissionTitle")}
        description={t("plugins.grantedPermissionDescription")}
      >
        {loading ? (
          <p className="plugins-hint-text">{t("plugins.permissionGrantLoading")}</p>
        ) : grants.length === 0 ? (
          <ModalEmptyState
            title={t("plugins.grantedPermissionEmptyTitle")}
            description={t("plugins.grantedPermissionEmptyDescription")}
            compact
          />
        ) : (
          <ModalList compact>
            {grants.map((grant) => (
              <ModalListItem
                key={grant.id}
                label={getPluginPermissionLabel(grant.permissionKey)}
                description={`${getPluginPermissionScopeLabel(grant.scopeType, grant.scopePath)} · ${getPluginPermissionGrantModeLabel(grant.grantMode)}`}
                trailing={onRevokeGrant ? (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={revokingGrantId === grant.id}
                    onClick={() => onRevokeGrant(grant)}
                  >
                    {t("plugins.revokeGrantAction")}
                  </button>
                ) : (
                  <ModalTag>{getPluginPermissionGrantModeLabel(grant.grantMode)}</ModalTag>
                )}
              />
            ))}
          </ModalList>
        )}
      </ModalSection>

      <ModalSection
        heading={t("plugins.permissionAuditTitle")}
        description={t("plugins.permissionAuditDescription")}
      >
        {permissionEvents.length === 0 ? (
          <ModalEmptyState
            title={t("plugins.permissionAuditEmptyTitle")}
            description={t("plugins.permissionAuditEmptyDescription")}
            compact
          />
        ) : (
          <ModalList compact>
            {permissionEvents.slice(0, 10).map((event) => (
              <ModalListItem
                key={event.id}
                label={describePermissionEvent(event)}
                description={describePermissionEventDetail(event)}
                trailing={<ModalTag>{event.createdAt}</ModalTag>}
              />
            ))}
          </ModalList>
        )}
      </ModalSection>
    </>
  );
}

function describePermissionEvent(event: PluginAuditEventDto): string {
  const payload = parsePayload(event.payloadJson);
  const permissionKey = readPermissionKey(payload.permissionKey);
  const permissionLabel = permissionKey ? getPluginPermissionLabel(permissionKey) : t("plugins.permissionEventUnknown");

  if (event.eventType === "plugin.permission_granted") {
    return t("plugins.permissionEventGranted", {
      permission: permissionLabel
    });
  }

  if (event.eventType === "plugin.permission_revoked") {
    return t("plugins.permissionEventRevoked", {
      permission: permissionLabel
    });
  }

  return t("plugins.permissionEventDenied", {
    permission: permissionLabel
  });
}

function describePermissionEventDetail(event: PluginAuditEventDto): string {
  const payload = parsePayload(event.payloadJson);
  const scopeType = readScopeType(payload.scopeType);
  const scopePath = typeof payload.scopePath === "string" ? payload.scopePath : null;
  const scopeLabel = scopeType
    ? getPluginPermissionScopeLabel(scopeType, scopePath)
    : t("plugins.permissionScopeUnknown");

  if (event.eventType === "plugin.permission_denied") {
    const reason = payload.reason === "declaration_missing"
      ? t("plugins.permissionEventReasonDeclarationMissing")
      : t("plugins.permissionEventReasonGrantRequired");
    return `${scopeLabel} · ${reason}`;
  }

  const grantMode = readGrantMode(payload.grantMode);
  if (!grantMode) {
    return scopeLabel;
  }

  return `${scopeLabel} · ${getPluginPermissionGrantModeLabel(grantMode)}`;
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readPermissionKey(value: unknown): PluginPermissionGrantDto["permissionKey"] | null {
  if (
    value === "workspace.read_file"
    || value === "workspace.list_dir"
    || value === "workspace.write_file"
    || value === "desktop.open_file"
    || value === "desktop.reveal_in_file_manager"
  ) {
    return value;
  }

  return null;
}

function readScopeType(value: unknown): PluginPermissionGrantDto["scopeType"] | null {
  if (value === "workspace" || value === "directory" || value === "file") {
    return value;
  }

  return null;
}

function readGrantMode(value: unknown): PluginPermissionGrantDto["grantMode"] | null {
  if (value === "once" || value === "session" || value === "persistent") {
    return value;
  }

  return null;
}
