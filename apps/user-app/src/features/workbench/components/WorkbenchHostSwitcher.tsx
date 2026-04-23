import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import {
  buildRelayEntryConfigPatch,
  resolveRelayEntryConfigInputFromBaseUrl
} from "../../../config/relay-entry";
import {
  getActiveHost,
  getEffectiveActiveHostId,
  isDiscoveredHostProfile,
  type HostProfile,
  type RuntimeHostProfile
} from "../../../config/client-config-types";
import { HostSwitchError, hostSwitchCoordinator } from "../../../config/host-switch-coordinator";
import {
  getVisibleDiscoveredHosts,
  localHostDiscoveryStore
} from "../../../config/local-host-discovery-store";
import { normalizeServerBaseUrl } from "../../../config/server-config-shared";
import {
  clearRememberedLoginCredentials,
  persistRememberedLoginCredentials,
  readRememberedLoginCredentials
} from "../../auth/store/remembered-login";
import { authStore, useAuthSelector } from "../../auth/store/auth-store";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  resolveActiveConnectionRouteLabelKey,
  useActiveConnectionRouteSummary
} from "../../../config/active-connection-route";
import { ButlerAnchoredPopover } from "../../butler/components/ButlerAnchoredPopover";
import { httpClient } from "../../../network/http-client";
import { useRelaySessionTrafficSummary } from "../../../network/relay-session-traffic-store";

interface WorkbenchHostSwitcherProps {
  readonly collapsed?: boolean;
}

type RelayLatencyState =
  | {
      status: "idle" | "probing" | "error";
      latencyMs: null;
    }
  | {
      status: "ready";
      latencyMs: number;
    };

const INITIAL_RELAY_LATENCY_STATE: RelayLatencyState = {
  status: "idle",
  latencyMs: null
};

export function WorkbenchHostSwitcher({ collapsed = false }: WorkbenchHostSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [pendingHostId, setPendingHostId] = useState<string | null>(null);
  const [pendingDeleteHostId, setPendingDeleteHostId] = useState<string | null>(null);
  const [confirmDeleteHostId, setConfirmDeleteHostId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [relayLatency, setRelayLatency] = useState<RelayLatencyState>(INITIAL_RELAY_LATENCY_STATE);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const detailButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailPopoverRef = useRef<HTMLDivElement | null>(null);
  const runtimeConfig = useClientConfigSelector((state) => state);
  const session = useAuthSelector((state) => state.session);
  const { showToast } = useToast();
  const activeHost = getActiveHost(runtimeConfig);
  const activeHostId = getEffectiveActiveHostId(runtimeConfig);
  const activeRoute = useActiveConnectionRouteSummary();
  const relaySessionTraffic = useRelaySessionTrafficSummary(activeHostId);
  const orderedHosts = useMemo(
    () => sortHosts(runtimeConfig.hosts, activeHostId),
    [activeHostId, runtimeConfig.hosts]
  );
  const discoveredHosts = useMemo(
    () => sortHosts(getVisibleDiscoveredHosts(runtimeConfig), activeHostId),
    [activeHostId, runtimeConfig]
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
      setDetailOpen(false);
      setRelayLatency(INITIAL_RELAY_LATENCY_STATE);
      return;
    }

    void localHostDiscoveryStore.refresh();

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        !anchorRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
        && !detailPopoverRef.current?.contains(event.target)
      ) {
        setOpen(false);
        setFormOpen(false);
        setDetailOpen(false);
        setConfirmDeleteHostId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setFormOpen(false);
        setDetailOpen(false);
        setConfirmDeleteHostId(null);
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

  useEffect(() => {
    if (!detailOpen || !open || activeRoute?.kind !== "relay") {
      setRelayLatency(INITIAL_RELAY_LATENCY_STATE);
      return;
    }

    let cancelled = false;
    const startedAt = performance.now();

    setRelayLatency({
      status: "probing",
      latencyMs: null
    });

    void httpClient.request("/api/client/runtime-config").then(() => {
      if (cancelled) {
        return;
      }

      setRelayLatency({
        status: "ready",
        latencyMs: performance.now() - startedAt
      });
    }).catch(() => {
      if (cancelled) {
        return;
      }

      setRelayLatency({
        status: "error",
        latencyMs: null
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeRoute?.kind, detailOpen, open]);

  async function handleSwitchHost(host: RuntimeHostProfile): Promise<void> {
    if (pendingHostId || pendingDeleteHostId || host.id === activeHostId) {
      setOpen(false);
      return;
    }

    setPendingHostId(host.id);

    try {
      await hostSwitchCoordinator.switchHost(host.id);
      setOpen(false);
      setFormOpen(false);
      setDetailOpen(false);
      setConfirmDeleteHostId(null);
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
    if (host.id === activeHostId || pendingHostId || pendingDeleteHostId) {
      return;
    }

    if (confirmDeleteHostId !== host.id) {
      setConfirmDeleteHostId(host.id);
      return;
    }

    setPendingDeleteHostId(host.id);

    try {
      await clientConfigStore.update({
        hosts: runtimeConfig.hosts.filter((item) => item.id !== host.id)
      });
      clearRememberedLoginCredentials(host.id);
      authStore.clearHostSession(host.id);
      setConfirmDeleteHostId(null);
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
    if (addingHost) {
      return;
    }

    const trimmedName = nameDraft.trim();
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

    setAddingHost(true);

    try {
      const relayEntryInput = await resolveRelayEntryConfigInputFromBaseUrl(normalizedBaseUrl);
      const latestConfig = clientConfigStore.getState();
      const latestActiveHost = getActiveHost(latestConfig);
      const duplicateHost = relayEntryInput
        ? latestConfig.hosts.find((host) =>
          host.baseUrl === normalizedBaseUrl
          || (
            Boolean(relayEntryInput.bindingId)
            && host.relayTunnel?.bindingId === relayEntryInput.bindingId
          )
        )
        : latestConfig.hosts.find((host) => host.baseUrl === normalizedBaseUrl);

      if (duplicateHost) {
        showToast({
          title: t("shell.hostAddDuplicate"),
          tone: "error"
        });
        return;
      }

      const shouldPromoteActiveDiscoveredHost =
        isDiscoveredHostProfile(latestActiveHost) && latestActiveHost.baseUrl === normalizedBaseUrl;

      if (shouldPromoteActiveDiscoveredHost) {
        localHostDiscoveryStore.setActiveDiscoveredHost(null);
      }

      let savedHostId: string;
      let savedHostName: string;

      if (relayEntryInput) {
        const nextState = await clientConfigStore.update(
          buildRelayEntryConfigPatch(latestConfig, relayEntryInput, {
            activate: shouldPromoteActiveDiscoveredHost,
            displayName: trimmedName
          })
        );
        const savedHost = nextState.hosts.find((host) =>
          matchesRelayEntryHost(host, normalizedBaseUrl, relayEntryInput.bindingId ?? null)
        );

        if (!savedHost) {
          throw new Error("relay entry host missing after save");
        }

        savedHostId = savedHost.id;
        savedHostName = savedHost.name;
      } else {
        const now = new Date().toISOString();
        const nextHost: HostProfile = {
          id: createHostId(),
          name: trimmedName || buildHostDisplayName(normalizedBaseUrl),
          baseUrl: normalizedBaseUrl,
          kind: classifyHostKind(normalizedBaseUrl),
          createdAt: now,
          updatedAt: now,
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null
        };

        await clientConfigStore.update({
          hosts: [...latestConfig.hosts, nextHost],
          activeHostId: shouldPromoteActiveDiscoveredHost ? nextHost.id : latestConfig.activeHostId
        });
        savedHostId = nextHost.id;
        savedHostName = nextHost.name;
      }

      if (trimmedUsername && passwordDraft) {
        persistRememberedLoginCredentials({
          hostId: savedHostId,
          username: trimmedUsername,
          password: passwordDraft
        });
      }
      resetFormDrafts();
      setFormOpen(false);
      setConfirmDeleteHostId(null);
      showToast({
        title: t("shell.hostAddSuccess", { name: savedHostName })
      });
    } catch {
      showToast({
        title: t("shell.hostAddFailed"),
        tone: "error"
      });
    } finally {
      setAddingHost(false);
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
  const detailStatusLabel = activeRoute?.kind === "relay"
    ? t("shell.hostSwitcherDetailStatusRelay")
    : t("shell.hostSwitcherDetailStatusDirect");
  const detailRouteLabel = activeRoute
    ? t(resolveActiveConnectionRouteLabelKey(activeRoute.kind))
    : t("common.unknown");

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
                <div className="workbench-host-switcher-section-label">
                  {t("shell.hostSwitcherSavedSection")}
                </div>
                {orderedHosts.map((host) => {
                  const isActive = host.id === activeHostId;
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
                      {isActive ? (
                        <button
                          ref={detailButtonRef}
                          type="button"
                          className="workbench-host-switcher-item-action"
                          aria-label={t("shell.hostSwitcherDetailAriaLabel", { name: host.name })}
                          aria-expanded={detailOpen}
                          aria-haspopup="dialog"
                          data-tone="detail"
                          onClick={() => {
                            setDetailOpen((current) => !current);
                            setConfirmDeleteHostId(null);
                          }}
                        >
                          {t("shell.hostSwitcherDetailAction")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="workbench-host-switcher-item-action"
                          aria-label={t("shell.hostDeleteAriaLabel", { name: host.name })}
                          title={
                            confirmDeleteHostId === host.id
                              ? t("shell.hostDeleteConfirmAction")
                              : t("shell.hostDeleteAction")
                          }
                          data-confirming={confirmDeleteHostId === host.id}
                          disabled={pendingHostId !== null || pendingDeleteHostId !== null}
                          onClick={() => {
                            void handleDeleteHost(host);
                          }}
                        >
                          {pendingDeleteHostId === host.id
                            ? t("shell.hostDeleteBusy")
                            : confirmDeleteHostId === host.id
                              ? t("shell.hostDeleteConfirmAction")
                              : <TrashIcon />}
                        </button>
                      )}
                    </div>
                  );
                })}
                {discoveredHosts.length > 0 ? (
                  <>
                    <div className="workbench-host-switcher-section-label">
                      {t("shell.hostSwitcherDiscoveredSection")}
                    </div>
                    {discoveredHosts.map((host) => {
                      const isActive = host.id === activeHostId;
                      const rememberedLogin = readRememberedLoginCredentials(host.id);
                      const status = isActive
                        ? session?.user.username ?? rememberedLogin?.username ?? host.baseUrl
                        : rememberedLogin?.username ?? host.baseUrl;

                      return (
                        <div
                          key={host.id}
                          className="workbench-host-switcher-item"
                          data-active={isActive}
                          data-discovered="true"
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
                                <span className="workbench-host-switcher-item-badge" data-tone="discovered">
                                  {t("shell.hostSwitcherDiscoveredBadge")}
                                </span>
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
                          {isActive ? (
                            <button
                              ref={detailButtonRef}
                              type="button"
                              className="workbench-host-switcher-item-action"
                              aria-label={t("shell.hostSwitcherDetailAriaLabel", { name: host.name })}
                              aria-expanded={detailOpen}
                              aria-haspopup="dialog"
                              data-tone="detail"
                              onClick={() => {
                                setDetailOpen((current) => !current);
                                setConfirmDeleteHostId(null);
                              }}
                            >
                              {t("shell.hostSwitcherDetailAction")}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                ) : null}
                {runtimeConfig.localHostDiscovery.status === "refreshing" ? (
                  <div className="workbench-host-switcher-state-row">
                    {t("shell.hostDiscoveryRefreshing")}
                  </div>
                ) : null}
                {runtimeConfig.localHostDiscovery.status === "failed" ? (
                  <div className="workbench-host-switcher-state-row" data-tone="error">
                    {t("shell.hostDiscoveryFailed")}
                  </div>
                ) : null}
              </div>

              {formOpen ? (
                <div className="workbench-host-switcher-form">
                  <label className="workbench-host-switcher-field">
                    <span>{t("shell.hostSwitcherNameLabel")}</span>
                    <input
                      value={nameDraft}
                      disabled={addingHost}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder={t("shell.hostSwitcherNamePlaceholder")}
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("shell.hostSwitcherUrlLabel")}</span>
                    <input
                      value={baseUrlDraft}
                      disabled={addingHost}
                      onChange={(event) => setBaseUrlDraft(event.target.value)}
                      placeholder={t("shell.hostSwitcherUrlPlaceholder")}
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.username")}</span>
                    <input
                      value={usernameDraft}
                      disabled={addingHost}
                      onChange={(event) => setUsernameDraft(event.target.value)}
                      autoComplete="username"
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.password")}</span>
                    <input
                      type="password"
                      value={passwordDraft}
                      disabled={addingHost}
                      onChange={(event) => setPasswordDraft(event.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <div className="workbench-host-switcher-form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={addingHost}
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
                      disabled={addingHost}
                      onClick={() => {
                        void handleAddHost();
                      }}
                    >
                      {addingHost ? t("common.loading") : t("shell.hostSwitcherSaveAction")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="workbench-host-switcher-add"
                  onClick={() => {
                    setFormOpen(true);
                    setConfirmDeleteHostId(null);
                  }}
                >
                  <PlusIcon />
                  {t("shell.hostSwitcherAddAction")}
                </button>
              )}
              <ButlerAnchoredPopover
                open={detailOpen && activeRoute !== null && detailButtonRef.current !== null}
                className="workbench-host-switcher-detail-popover"
                anchorRef={detailButtonRef}
                popoverRef={detailPopoverRef}
                labelledBy="workbench-host-switcher-detail-title"
              >
                <div className="workbench-host-switcher-detail-header">
                  <strong id="workbench-host-switcher-detail-title">
                    {t("shell.hostSwitcherDetailTitle")}
                  </strong>
                </div>
                <div className="workbench-host-switcher-detail-grid">
                  <div className="workbench-host-switcher-detail-row">
                    <span className="workbench-host-switcher-detail-label">
                      {t("shell.hostSwitcherDetailStatusLabel")}
                    </span>
                    <span className="workbench-host-switcher-detail-value">{detailStatusLabel}</span>
                  </div>
                  <div className="workbench-host-switcher-detail-row">
                    <span className="workbench-host-switcher-detail-label">
                      {t("shell.hostSwitcherDetailRouteLabel")}
                    </span>
                    <span className="workbench-host-switcher-detail-value">{detailRouteLabel}</span>
                  </div>
                  <div className="workbench-host-switcher-detail-row">
                    <span className="workbench-host-switcher-detail-label">
                      {t("shell.hostSwitcherDetailAddressLabel")}
                    </span>
                    <span className="workbench-host-switcher-detail-value" data-multiline="true">
                      {activeRoute?.url ?? activeHost.baseUrl}
                    </span>
                  </div>
                  {activeRoute?.kind === "relay" ? (
                    <>
                      <div className="workbench-host-switcher-detail-row">
                        <span className="workbench-host-switcher-detail-label">
                          {t("shell.hostSwitcherDetailLatencyLabel")}
                        </span>
                        <span className="workbench-host-switcher-detail-value">
                          {formatRelayLatency(relayLatency)}
                        </span>
                      </div>
                      <div className="workbench-host-switcher-detail-row">
                        <span className="workbench-host-switcher-detail-label">
                          {t("shell.hostSwitcherDetailTrafficLabel")}
                        </span>
                        <span className="workbench-host-switcher-detail-value">
                          {formatTrafficBytes(relaySessionTraffic.totalBytes)}
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              </ButlerAnchoredPopover>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function sortHosts<T extends Pick<HostProfile, "id" | "createdAt" | "updatedAt" | "lastConnectedAt">>(
  hosts: readonly T[],
  activeHostId: string | null
): T[] {
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

function matchesRelayEntryHost(
  host: Pick<HostProfile, "baseUrl" | "relayTunnel">,
  relayBaseUrl: string,
  bindingId: string | null
): boolean {
  if (host.baseUrl === relayBaseUrl) {
    return true;
  }

  if (bindingId && host.relayTunnel?.bindingId === bindingId) {
    return true;
  }

  return false;
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

function formatRelayLatency(state: RelayLatencyState): string {
  if (state.status === "probing") {
    return t("shell.hostSwitcherDetailLatencyLoading");
  }

  if (state.status === "error") {
    return t("shell.hostSwitcherDetailUnavailable");
  }

  if (state.status === "ready") {
    return `${Math.max(1, Math.round(state.latencyMs))} ms`;
  }

  return t("shell.hostSwitcherDetailUnavailable");
}

function formatTrafficBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) {
    return `${Math.max(0, Math.round(value))} B`;
  }

  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  return `${(value / 1024 ** 3).toFixed(2)} GB`;
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
