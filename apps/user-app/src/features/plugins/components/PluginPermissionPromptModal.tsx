import { useMemo } from "react";

import { DesktopModal } from "../../../components/DesktopModal";
import { MobileSheet } from "../../../components/MobileSheet";
import { ModalActions, ModalEmptyState, ModalList, ModalListItem, ModalSection, ModalTag } from "../../../components/ModalAtoms";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import type { PluginPermissionGrantDto } from "../api/plugins-api";
import {
  getPluginPermissionGrantModeLabel,
  getPluginPermissionLabel,
  getPluginPermissionScopeLabel
} from "./plugin-permission-copy";

export interface PluginPermissionRequestState {
  pluginId: string;
  pluginName: string;
  runtimeSessionId: string;
  permissionKey: PluginPermissionGrantDto["permissionKey"];
  scopeType: "workspace" | "directory" | "file";
  scopePath: string | null;
  grantOptions: Array<"once" | "session" | "persistent">;
}

interface PluginPermissionPromptModalProps {
  readonly open: boolean;
  readonly request: PluginPermissionRequestState | null;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onApprove: (input: {
    scopeType: PluginPermissionGrantDto["scopeType"];
    scopePath: string | null;
    grantMode: PluginPermissionGrantDto["grantMode"];
  }) => void;
}

interface GrantChoice {
  id: string;
  label: string;
  description: string;
  grantMode: PluginPermissionGrantDto["grantMode"];
  scopeType: PluginPermissionGrantDto["scopeType"];
  scopePath: string | null;
}

export function PluginPermissionPromptModal({
  open,
  request,
  submitting,
  onClose,
  onApprove
}: PluginPermissionPromptModalProps) {
  const platform = usePlatform();
  const choices = useMemo(() => buildGrantChoices(request), [request]);

  if (!request) {
    return null;
  }

  const content = (
    <div className="plugins-permission-prompt">
      <ModalSection
        heading={t("plugins.permissionPromptSummaryTitle")}
        description={t("plugins.permissionPromptSummaryDescription", {
          pluginName: request.pluginName
        })}
      >
        <ModalList compact>
          <ModalListItem
            label={t("plugins.permissionPromptPermissionLabel")}
            description={getPluginPermissionLabel(request.permissionKey)}
            trailing={<ModalTag tone="warning">{t("plugins.permissionPromptPendingTag")}</ModalTag>}
          />
          <ModalListItem
            label={t("plugins.permissionPromptTargetLabel")}
            description={getPluginPermissionScopeLabel(request.scopeType, request.scopePath)}
          />
        </ModalList>
      </ModalSection>

      <ModalSection
        heading={t("plugins.permissionPromptOptionsTitle")}
        description={t("plugins.permissionPromptOptionsDescription")}
      >
        {choices.length === 0 ? (
          <ModalEmptyState
            title={t("plugins.permissionPromptNoOptionTitle")}
            description={t("plugins.permissionPromptNoOptionDescription")}
            compact
          />
        ) : (
          <ModalList>
            {choices.map((choice) => (
              <ModalListItem
                key={choice.id}
                as="button"
                disabled={submitting}
                label={choice.label}
                description={choice.description}
                trailing={<ModalTag>{getPluginPermissionGrantModeLabel(choice.grantMode)}</ModalTag>}
                onClick={() => {
                  onApprove({
                    scopeType: choice.scopeType,
                    scopePath: choice.scopePath,
                    grantMode: choice.grantMode
                  });
                }}
              />
            ))}
          </ModalList>
        )}
      </ModalSection>

      <ModalActions align="end">
        <button
          type="button"
          className="secondary-button"
          disabled={submitting}
          onClick={onClose}
        >
          {t("plugins.permissionPromptDenyAction")}
        </button>
      </ModalActions>
    </div>
  );

  if (platform.isMobile) {
    return (
      <MobileSheet
        open={open}
        title={t("plugins.permissionPromptTitle")}
        description={t("plugins.permissionPromptDescription")}
        height="three-quarter"
        kind="form"
        onClose={onClose}
        footer={null}
      >
        {content}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("plugins.permissionPromptTitle")}
      description={t("plugins.permissionPromptDescription")}
      size="regular"
      layout="form"
      onClose={onClose}
      footer={null}
    >
      {content}
    </DesktopModal>
  );
}

function buildGrantChoices(request: PluginPermissionRequestState | null): GrantChoice[] {
  if (!request) {
    return [];
  }

  const choices: GrantChoice[] = [];
  const normalizedScopePath = request.scopePath?.trim() || null;

  if (request.grantOptions.includes("once")) {
    choices.push({
      id: "once-file",
      label: t("plugins.permissionPromptOptionOnce"),
      description: t("plugins.permissionPromptOptionOnceDescription"),
      grantMode: "once",
      scopeType: request.scopeType === "workspace" ? "workspace" : "file",
      scopePath: request.scopeType === "workspace" ? null : normalizedScopePath
    });
  }

  if (request.grantOptions.includes("session")) {
    choices.push({
      id: "session-current",
      label: t("plugins.permissionPromptOptionSession"),
      description: t("plugins.permissionPromptOptionSessionDescription"),
      grantMode: "session",
      scopeType: request.scopeType === "workspace" ? "workspace" : "file",
      scopePath: request.scopeType === "workspace" ? null : normalizedScopePath
    });
  }

  if (
    request.grantOptions.includes("persistent")
    && normalizedScopePath
    && request.scopeType !== "workspace"
  ) {
    const directoryScopePath = deriveDirectoryScopePath(normalizedScopePath);
    if (directoryScopePath) {
      choices.push({
        id: "persistent-directory",
        label: t("plugins.permissionPromptOptionDirectory"),
        description: t("plugins.permissionPromptOptionDirectoryDescription", {
          scopePath: directoryScopePath
        }),
        grantMode: "persistent",
        scopeType: "directory",
        scopePath: directoryScopePath
      });
    }
  }

  return choices;
}

function deriveDirectoryScopePath(scopePath: string): string | null {
  const normalized = scopePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.length <= 1) {
    return normalized;
  }

  return segments.slice(0, -1).join("/");
}
