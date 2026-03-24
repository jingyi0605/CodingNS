import { useEffect, useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import {
  closeTerminal,
  listWorkspaceTerminals,
  type TerminalDto
} from "../../terminal/api/terminal-api";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";

interface TerminalManagerPanelProps {
  currentWorkspaceId: string | null;
  navigationGroups: WorkspaceSessionGroup[];
}

interface WorkspaceOption {
  id: string;
  name: string;
}

function collectWorkspaceOptions(groups: WorkspaceSessionGroup[]): WorkspaceOption[] {
  return groups.map((group) => ({
    id: group.workspace.id,
    name: group.workspace.name
  }));
}

function formatDate(value: string | null): string {
  if (!value) {
    return t("common.unknown");
  }

  return new Date(value).toLocaleString();
}

export function TerminalManagerPanel({
  currentWorkspaceId,
  navigationGroups
}: TerminalManagerPanelProps) {
  const workspaceOptions = useMemo(
    () => collectWorkspaceOptions(navigationGroups),
    [navigationGroups]
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(currentWorkspaceId ?? "");
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [closingTerminalId, setClosingTerminalId] = useState<string | null>(null);

  useEffect(() => {
    const fallbackWorkspaceId = currentWorkspaceId ?? workspaceOptions[0]?.id ?? "";

    setSelectedWorkspaceId((current) =>
      workspaceOptions.some((workspace) => workspace.id === current) ? current : fallbackWorkspaceId
    );
  }, [currentWorkspaceId, workspaceOptions]);

  async function loadTerminals(workspaceId: string) {
    setLoading(true);
    setPanelError(null);

    try {
      const response = await listWorkspaceTerminals(workspaceId);
      setTerminals(response.items);
    } catch (error) {
      setTerminals([]);
      setPanelError(error instanceof Error ? error.message : t("terminalManager.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setTerminals([]);
      return;
    }

    void loadTerminals(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  async function handleCloseTerminal(terminalId: string) {
    if (!selectedWorkspaceId) {
      return;
    }

    setClosingTerminalId(terminalId);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await closeTerminal(terminalId);
      await loadTerminals(selectedWorkspaceId);
      setPanelMessage(t("terminalManager.closeSuccess"));
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : t("terminalManager.closeFailed"));
    } finally {
      setClosingTerminalId(null);
    }
  }

  if (!workspaceOptions.length) {
    return (
      <section className="workbench-empty-state minimal">
        <p>{t("terminalManager.emptyWorkspaceBody")}</p>
      </section>
    );
  }

  return (
    <section className="conversation-panel surface-card terminal-manager-panel">
      <div className="terminal-manager-header">
        <div className="field-group">
          <span>{t("terminalManager.workspaceField")}</span>
          <select
            value={selectedWorkspaceId}
            onChange={(event) => {
              setSelectedWorkspaceId(event.target.value);
            }}
          >
            {workspaceOptions.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="ghost-button"
          type="button"
          disabled={!selectedWorkspaceId || loading}
          onClick={() => {
            if (selectedWorkspaceId) {
              void loadTerminals(selectedWorkspaceId);
            }
          }}
        >
          {t("terminalManager.refresh")}
        </button>
      </div>

      {panelError ? (
        <p className="status-text" data-tone="error">
          {panelError}
        </p>
      ) : null}

      {panelMessage ? (
        <p className="status-text" data-tone="success">
          {panelMessage}
        </p>
      ) : null}

      {loading ? (
        <p className="status-text">{t("common.loading")}</p>
      ) : terminals.length ? (
        <div className="terminal-manager-list">
          {terminals.map((terminal) => (
            <article key={terminal.id} className="terminal-manager-card">
              <div className="terminal-manager-card-header">
                <div>
                  <strong>{terminal.name}</strong>
                  <p className="status-text">{terminal.cwd}</p>
                </div>
                <span
                  className="badge"
                  data-tone={terminal.status === "running" ? "success" : undefined}
                >
                  {terminal.status}
                </span>
              </div>

              <div className="terminal-manager-meta">
                <span className="status-text">{terminal.shell}</span>
                <span className="status-text">
                  {t("terminalManager.lastActiveAt")} {formatDate(terminal.lastActiveAt)}
                </span>
                <span className="status-text">
                  {t("terminalManager.exitCode")}{" "}
                  {terminal.exitCode === null ? t("terminalManager.runningValue") : terminal.exitCode}
                </span>
              </div>

              {terminal.statusDetail ? (
                <p className="status-text">{terminal.statusDetail}</p>
              ) : null}

              <div className="terminal-manager-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={terminal.status !== "running" || closingTerminalId === terminal.id}
                  onClick={() => {
                    void handleCloseTerminal(terminal.id);
                  }}
                >
                  {closingTerminalId === terminal.id
                    ? t("terminalManager.closing")
                    : t("terminalManager.closeAction")}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="workbench-empty-state minimal">
          <p>{t("terminalManager.emptyTerminalBody")}</p>
        </section>
      )}
    </section>
  );
}
