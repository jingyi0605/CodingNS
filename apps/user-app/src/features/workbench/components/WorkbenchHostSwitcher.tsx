import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import { getActiveHost, type HostProfile } from "../../../config/client-config-types";
import { HostSwitchError, hostSwitchCoordinator } from "../../../config/host-switch-coordinator";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";
import {
  clearRememberedLoginCredentials,
  persistRememberedLoginCredentials
} from "../../auth/store/remembered-login";
import { authStore, useAuthSelector } from "../../auth/store/auth-store";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";

interface WorkbenchHostSwitcherProps {
  readonly collapsed?: boolean;
}

export function WorkbenchHostSwitcher({ collapsed = false }: WorkbenchHostSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [pendingHostId, setPendingHostId] = useState<string | null>(null);
  const [pendingDeleteHostId, setPendingDeleteHostId] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const runtimeConfig = useClientConfigSelector((state) => state);
  const session = useAuthSelector((state) => state.session);
  const { showToast } = useToast();
  const activeHost = getActiveHost(runtimeConfig);
  const orderedHosts = useMemo(
    () => sortHosts(runtimeConfig.hosts, runtimeConfig.activeHostId),
    [runtimeConfig.activeHostId, runtimeConfig.hosts]
  );
  const updateMenuStyle = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const anchor = anchorRef.current;

    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edgePadding = 16;
    const gap = 8;
    const preferredWidth = 320;
    const width = Math.min(preferredWidth, Math.max(240, viewportWidth - edgePadding * 2));
    const left = collapsed
      ? Math.min(
          Math.max(edgePadding, rect.right + gap),
          Math.max(edgePadding, viewportWidth - width - edgePadding)
        )
      : Math.min(
          Math.max(edgePadding, rect.left),
          Math.max(edgePadding, viewportWidth - width - edgePadding)
        );
    const estimatedHeight = formOpen ? 440 : 240;
    const top = collapsed ? rect.top : rect.bottom + gap;
    const clampedTop = Math.min(
      Math.max(edgePadding, top),
      Math.max(edgePadding, viewportHeight - estimatedHeight - edgePadding)
    );

    setMenuStyle({
      position: "fixed",
      top: clampedTop,
      left,
      width,
      maxWidth: viewportWidth - edgePadding * 2
    });
  }, [collapsed, formOpen]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        !anchorRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
        setFormOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setFormOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuStyle);
    window.addEventListener("scroll", updateMenuStyle, true);
    updateMenuStyle();
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuStyle);
      window.removeEventListener("scroll", updateMenuStyle, true);
    };
  }, [open, updateMenuStyle]);

  async function handleSwitchHost(host: HostProfile): Promise<void> {
    if (pendingHostId || pendingDeleteHostId || host.id === runtimeConfig.activeHostId) {
      setOpen(false);
      return;
    }

    setPendingHostId(host.id);

    try {
      await hostSwitchCoordinator.switchHost(host.id);
      setOpen(false);
      setFormOpen(false);
    } catch (error) {
      showToast({
        title: resolveHostSwitchErrorMessage(error, host.name),
        tone: "error"
      });
    } finally {
      setPendingHostId(null);
    }
  }

  async function handleDeleteHost(host: HostProfile): Promise<void> {
    if (host.id === runtimeConfig.activeHostId || pendingHostId || pendingDeleteHostId) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        t("shell.hostDeleteConfirm", { name: host.name })
      );

      if (!confirmed) {
        return;
      }
    }

    setPendingDeleteHostId(host.id);

    try {
      await clientConfigStore.update({
        hosts: runtimeConfig.hosts.filter((item) => item.id !== host.id)
      });
      clearRememberedLoginCredentials(host.id);
      authStore.clearHostSession(host.id);
      showToast({
        title: t("shell.hostDeleteSuccess", { name: host.name })
      });
    } catch {
      showToast({
        title: t("shell.hostDeleteFailed", { name: host.name }),
        tone: "error"
      });
    } finally {
      setPendingDeleteHostId(null);
    }
  }

  async function handleAddHost(): Promise<void> {
    const trimmedUsername = usernameDraft.trim();
    const hasCredentialInput = trimmedUsername.length > 0 || passwordDraft.length > 0;

    if (hasCredentialInput && (!trimmedUsername || !passwordDraft)) {
      showToast({
        title: t("shell.hostAddIncompleteCredentials"),
        tone: "error"
      });
      return;
    }

    let normalizedBaseUrl: string;

    try {
      normalizedBaseUrl = normalizeServerBaseUrl(baseUrlDraft);
    } catch {
      showToast({
        title: t("shell.hostAddInvalidUrl"),
        tone: "error"
      });
      return;
    }

    if (runtimeConfig.hosts.some((host) => host.baseUrl === normalizedBaseUrl)) {
      showToast({
        title: t("shell.hostAddDuplicate"),
        tone: "error"
      });
      return;
    }

    const now = new Date().toISOString();
    const nextHost: HostProfile = {
      id: createHostId(),
      name: nameDraft.trim() || buildHostDisplayName(normalizedBaseUrl),
      baseUrl: normalizedBaseUrl,
      kind: classifyHostKind(normalizedBaseUrl),
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: null,
      lastUserId: null,
      lastUsername: null
    };

    try {
      await clientConfigStore.update({
        hosts: [...runtimeConfig.hosts, nextHost]
      });
      if (trimmedUsername && passwordDraft) {
        persistRememberedLoginCredentials({
          hostId: nextHost.id,
          username: trimmedUsername,
          password: passwordDraft
        });
      }
      resetFormDrafts();
      setFormOpen(false);
      showToast({
        title: t("shell.hostAddSuccess", { name: nextHost.name })
      });
    } catch {
      showToast({
        title: t("shell.hostAddFailed"),
        tone: "error"
      });
    }
  }

  function resetFormDrafts(): void {
    setNameDraft("");
    setBaseUrlDraft("");
    setUsernameDraft("");
    setPasswordDraft("");
  }

  if (!activeHost) {
    return null;
  }

  const buttonTitle = session?.user.username
    ? `${activeHost.baseUrl} · ${session.user.username}`
    : activeHost.baseUrl;

  return (
    <div
      ref={anchorRef}
      className="workbench-host-switcher-anchor"
      data-collapsed={collapsed}
    >
      <button
        type="button"
        className={collapsed
          ? "workbench-nav-toolbar-button workbench-collapsed-button"
          : "workbench-nav-toolbar-button"}
        aria-label={t("shell.hostSwitcherAriaLabel")}
        title={buttonTitle}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setFormOpen(false);
        }}
      >
        <ServerIcon />
      </button>

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="workbench-host-switcher-menu"
              style={menuStyle}
              role="menu"
              aria-label={t("shell.hostSwitcherTitle")}
            >
              <div className="workbench-host-switcher-menu-header">
                <strong>{t("shell.hostSwitcherTitle")}</strong>
              </div>
              <div className="workbench-host-switcher-list">
                {orderedHosts.map((host) => {
                  const isActive = host.id === runtimeConfig.activeHostId;
                  const status = isActive
                    ? session?.user.username ?? host.lastUsername ?? host.baseUrl
                    : host.lastUsername ?? host.baseUrl;

                  return (
                    <div
                      key={host.id}
                      className="workbench-host-switcher-item"
                      data-active={isActive}
                    >
                      <button
                        type="button"
                        className="workbench-host-switcher-item-main"
                        disabled={pendingHostId !== null || pendingDeleteHostId !== null}
                        onClick={() => {
                          void handleSwitchHost(host);
                        }}
                      >
                        <span className="workbench-host-switcher-item-copy">
                          <span className="workbench-host-switcher-item-title">
                            {host.name}
                            {isActive ? (
                              <span className="workbench-host-switcher-item-badge">
                                {t("shell.hostSwitcherCurrentBadge")}
                              </span>
                            ) : null}
                          </span>
                          <span className="workbench-host-switcher-item-meta">{status}</span>
                        </span>
                        <span className="workbench-host-switcher-item-trailing">
                          {pendingHostId === host.id ? (
                            t("shell.hostSwitcherSwitching")
                          ) : isActive ? (
                            <CheckIcon />
                          ) : (
                            <ChevronRightIcon />
                          )}
                        </span>
                      </button>
                      {!isActive ? (
                        <button
                          type="button"
                          className="workbench-host-switcher-item-action"
                          aria-label={t("shell.hostDeleteAriaLabel", { name: host.name })}
                          title={t("shell.hostDeleteAction")}
                          disabled={pendingHostId !== null || pendingDeleteHostId !== null}
                          onClick={() => {
                            void handleDeleteHost(host);
                          }}
                        >
                          {pendingDeleteHostId === host.id ? t("shell.hostDeleteBusy") : <TrashIcon />}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {formOpen ? (
                <div className="workbench-host-switcher-form">
                  <label className="workbench-host-switcher-field">
                    <span>{t("shell.hostSwitcherNameLabel")}</span>
                    <input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder={t("shell.hostSwitcherNamePlaceholder")}
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("shell.hostSwitcherUrlLabel")}</span>
                    <input
                      value={baseUrlDraft}
                      onChange={(event) => setBaseUrlDraft(event.target.value)}
                      placeholder={t("shell.hostSwitcherUrlPlaceholder")}
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.username")}</span>
                    <input
                      value={usernameDraft}
                      onChange={(event) => setUsernameDraft(event.target.value)}
                      autoComplete="username"
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.password")}</span>
                    <input
                      type="password"
                      value={passwordDraft}
                      onChange={(event) => setPasswordDraft(event.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <div className="workbench-host-switcher-form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setFormOpen(false);
                        resetFormDrafts();
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        void handleAddHost();
                      }}
                    >
                      {t("shell.hostSwitcherSaveAction")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="workbench-host-switcher-add"
                  onClick={() => {
                    setFormOpen(true);
                  }}
                >
                  <PlusIcon />
                  {t("shell.hostSwitcherAddAction")}
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function sortHosts(hosts: readonly HostProfile[], activeHostId: string | null): HostProfile[] {
  return [...hosts].sort((left, right) => {
    if (left.id === activeHostId) {
      return -1;
    }

    if (right.id === activeHostId) {
      return 1;
    }

    const leftScore = left.lastConnectedAt ?? left.updatedAt ?? left.createdAt;
    const rightScore = right.lastConnectedAt ?? right.updatedAt ?? right.createdAt;
    return rightScore.localeCompare(leftScore);
  });
}

function buildHostDisplayName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.host}${pathname}`;
  } catch {
    return baseUrl;
  }
}

function classifyHostKind(baseUrl: string): HostProfile["kind"] {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();

    if (
      hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "[::1]"
    ) {
      return "local";
    }

    if (
      /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return "lan";
    }

    return "remote";
  } catch {
    return "custom";
  }
}

function createHostId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `host-${crypto.randomUUID()}`;
  }

  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveHostSwitchErrorMessage(error: unknown, hostName: string): string {
  if (!(error instanceof HostSwitchError)) {
    return t("shell.hostSwitchFailed");
  }

  if (error.code === "HOST_UNREACHABLE") {
    return t("shell.hostSwitchUnreachable", { name: hostName });
  }

  return t("shell.hostSwitchMissing");
}

function ServerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="6.5" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="16" height="6.5" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 7.75h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 16.25h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7.5" cy="7.75" r="1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="16.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5L10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3.5v9M3.5 8h9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6.5 2.75h3M5 4.5v7.25a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4.5M6.75 6.5v4M9.25 6.5v4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}
