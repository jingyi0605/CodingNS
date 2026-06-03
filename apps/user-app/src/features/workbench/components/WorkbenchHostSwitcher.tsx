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
import { httpClient } from "../../../network/http-client";
import { useRelaySessionTrafficSummary } from "../../../network/relay-session-traffic-store";
import {
  fetchHostResourceSnapshot,
  type HostResourceSnapshotView
} from "../../../platform/server/host-resource-manager";

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

type HostResourceState =
  | {
      status: "idle" | "loading" | "error";
      snapshot: null;
    }
  | {
      status: "ready" | "refreshing";
      snapshot: HostResourceSnapshotView;
    };

const INITIAL_HOST_RESOURCE_STATE: HostResourceState = {
  status: "idle",
  snapshot: null
};

type HostResourceMetricTone = "neutral" | "good" | "warning" | "danger";
type HostResourceMetricContrast = "dark" | "light";
type HostResourceMetricFillTextTone = "neutral-dark" | "warning-dark" | "light";

interface HostResourceMetricView {
  key: "cpu" | "memory" | "disk";
  label: string;
  summary: string;
  progressLabel: string | null;
  ratio: number | null;
  tone: HostResourceMetricTone;
  contrast: HostResourceMetricContrast;
  fillTextTone: HostResourceMetricFillTextTone;
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
  const [confirmDeleteHostId, setConfirmDeleteHostId] = useState<string | null>(null);
  const [detailHostId, setDetailHostId] = useState<string | null>(null);
  const [addingHost, setAddingHost] = useState(false);
  const [relayLatency, setRelayLatency] = useState<RelayLatencyState>(INITIAL_RELAY_LATENCY_STATE);
  const [hostResourceState, setHostResourceState] = useState<HostResourceState>(INITIAL_HOST_RESOURCE_STATE);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    const preferredWidth = 360;
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
    const estimatedHeight = formOpen ? 520 : detailHostId ? 600 : 320;
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
  }, [collapsed, detailHostId, formOpen]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      setDetailHostId(null);
      setRelayLatency(INITIAL_RELAY_LATENCY_STATE);
      setHostResourceState(INITIAL_HOST_RESOURCE_STATE);
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
      ) {
        setOpen(false);
        setFormOpen(false);
        setDetailHostId(null);
        setConfirmDeleteHostId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setFormOpen(false);
        setDetailHostId(null);
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
    if (!detailHostId || detailHostId !== activeHostId || !open || activeRoute?.kind !== "relay") {
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
  }, [activeHostId, activeRoute?.kind, detailHostId, open]);

  useEffect(() => {
    if (!detailHostId || detailHostId !== activeHostId || !open) {
      setHostResourceState(INITIAL_HOST_RESOURCE_STATE);
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    async function loadResources(silent: boolean): Promise<void> {
      if (!silent) {
        setHostResourceState((current) =>
          current.snapshot
            ? { status: "refreshing", snapshot: current.snapshot }
            : { status: "loading", snapshot: null }
        );
      }

      try {
        const snapshot = await fetchHostResourceSnapshot();

        if (cancelled) {
          return;
        }

        setHostResourceState({
          status: "ready",
          snapshot
        });
      } catch {
        if (cancelled) {
          return;
        }

        setHostResourceState((current) =>
          current.snapshot
            ? current
            : { status: "error", snapshot: null }
        );
      }
    }

    void loadResources(false);
    timerId = window.setInterval(() => {
      void loadResources(true);
    }, 5_000);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [activeHostId, detailHostId, open]);

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
      setDetailHostId(null);
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

  const activeHostBaseUrl = activeHost.baseUrl;
  const buttonTitle = session?.user.username
    ? `${activeHost.baseUrl} · ${session.user.username}`
    : activeHost.baseUrl;
  const detailStatusLabel = activeRoute?.kind === "relay"
    ? t("shell.hostSwitcherDetailStatusRelay")
    : t("shell.hostSwitcherDetailStatusDirect");
  const detailRouteLabel = activeRoute
    ? t(resolveActiveConnectionRouteLabelKey(activeRoute.kind))
    : t("common.unknown");

  function renderHostItem(
    host: RuntimeHostProfile,
    options: {
      readonly statusText: string;
      readonly discovered?: boolean;
      readonly deletable?: boolean;
    }
  ) {
    const isActive = host.id === activeHostId;
    const detailExpanded = isActive && detailHostId === host.id;

    return (
      <div
        key={host.id}
        className="workbench-host-switcher-item"
        data-active={isActive}
        data-discovered={options.discovered ? "true" : undefined}
        data-expanded={detailExpanded}
      >
        <div className="workbench-host-switcher-item-row">
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
                {options.discovered ? (
                  <span className="workbench-host-switcher-item-badge" data-tone="discovered">
                    {t("shell.hostSwitcherDiscoveredBadge")}
                  </span>
                ) : null}
                {isActive ? (
                  <span className="workbench-host-switcher-item-badge">
                    {t("shell.hostSwitcherCurrentBadge")}
                  </span>
                ) : null}
              </span>
              <span className="workbench-host-switcher-item-meta">{options.statusText}</span>
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
              type="button"
              className="workbench-host-switcher-item-action"
              aria-label={t("shell.hostSwitcherDetailAriaLabel", { name: host.name })}
              aria-expanded={detailExpanded}
              data-tone="detail"
              onClick={() => {
                setDetailHostId((current) => current === host.id ? null : host.id);
                setConfirmDeleteHostId(null);
              }}
            >
              {t("shell.hostSwitcherDetailAction")}
            </button>
          ) : options.deletable ? (
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
          ) : null}
        </div>
        {detailExpanded ? (
          <div className="workbench-host-switcher-detail-panel" role="region" aria-label={t("shell.hostSwitcherDetailTitle")}>
            <div className="workbench-host-switcher-detail-header">
              <strong>{t("shell.hostSwitcherDetailTitle")}</strong>
            </div>
            <div className="workbench-host-switcher-detail-section">
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
                    {activeRoute?.url ?? activeHostBaseUrl}
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
            </div>
            <div className="workbench-host-switcher-detail-section">
              <div className="workbench-host-switcher-detail-section-title">
                {t("shell.hostSwitcherDetailResourceTitle")}
              </div>
              <div className="workbench-host-switcher-resource-list">
                {buildHostResourceMetrics(hostResourceState).map((metric) => (
                  <div
                    key={metric.key}
                    className="workbench-host-switcher-resource-item"
                    data-tone={metric.tone}
                    data-contrast={metric.contrast}
                  >
                    <span className="workbench-host-switcher-resource-label">{metric.label}</span>
                    <div className="workbench-host-switcher-resource-bar">
                      <span
                        className="workbench-host-switcher-resource-bar-fill"
                        style={{ width: `${Math.max(0, Math.min(100, Math.round((metric.ratio ?? 0) * 100)))}%` }}
                      />
                      <span className="workbench-host-switcher-resource-bar-content">
                        <span className="workbench-host-switcher-resource-summary">
                          {metric.summary}
                        </span>
                        {metric.progressLabel ? (
                          <span className="workbench-host-switcher-resource-percent">
                            {metric.progressLabel}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="workbench-host-switcher-resource-bar-content workbench-host-switcher-resource-bar-content-overlay"
                        data-fill-tone={metric.fillTextTone}
                        aria-hidden="true"
                        style={{
                          clipPath: `inset(0 ${Math.max(0, 100 - Math.max(0, Math.min(100, Math.round((metric.ratio ?? 0) * 100))))}% 0 0)`
                        }}
                      >
                        <span className="workbench-host-switcher-resource-summary">
                          {metric.summary}
                        </span>
                        {metric.progressLabel ? (
                          <span className="workbench-host-switcher-resource-percent">
                            {metric.progressLabel}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

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
          setDetailHostId(null);
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
                <section className="workbench-host-switcher-section">
                  <div className="workbench-host-switcher-section-label">
                    {t("shell.hostSwitcherSavedSection")}
                  </div>
                  <div className="workbench-host-switcher-section-card">
                    {orderedHosts.map((host) => renderHostItem(host, {
                      statusText: host.id === activeHostId
                        ? session?.user.username ?? host.lastUsername ?? host.baseUrl
                        : host.lastUsername ?? host.baseUrl,
                      deletable: true
                    }))}
                  </div>
                </section>
                {discoveredHosts.length > 0 ? (
                  <section className="workbench-host-switcher-section">
                    <div className="workbench-host-switcher-section-label">
                      {t("shell.hostSwitcherDiscoveredSection")}
                    </div>
                    <div className="workbench-host-switcher-section-card">
                      {discoveredHosts.map((host) => {
                      const rememberedLogin = readRememberedLoginCredentials(host.id);
                      const status = host.id === activeHostId
                        ? session?.user.username ?? rememberedLogin?.username ?? host.baseUrl
                        : rememberedLogin?.username ?? host.baseUrl;

                        return renderHostItem(host, {
                          statusText: status,
                          discovered: true
                        });
                      })}
                    </div>
                  </section>
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

function formatHostCpuValue(state: HostResourceState): string {
  if (state.status === "loading" || state.status === "idle") {
    return t("common.loading");
  }

  if (!state.snapshot) {
    return t("shell.hostSwitcherDetailUnavailable");
  }

  return t("shell.hostSwitcherDetailCpuValue", {
    usage: `${Math.max(0, Math.round(state.snapshot.cpu.usedRatio * 100))}%`,
    cores: state.snapshot.cpu.logicalCoreCount
  });
}

function formatHostMemoryValue(state: HostResourceState): string {
  if (state.status === "loading" || state.status === "idle") {
    return t("common.loading");
  }

  if (!state.snapshot) {
    return t("shell.hostSwitcherDetailUnavailable");
  }

  return `${formatTrafficBytes(state.snapshot.memory.usedBytes)} / ${formatTrafficBytes(state.snapshot.memory.totalBytes)}`;
}

function formatHostDiskValue(state: HostResourceState): string {
  if (state.status === "loading" || state.status === "idle") {
    return t("common.loading");
  }

  if (!state.snapshot) {
    return t("shell.hostSwitcherDetailUnavailable");
  }

  return `${formatTrafficBytes(state.snapshot.disk.freeBytes)} / ${formatTrafficBytes(state.snapshot.disk.totalBytes)}`;
}

function buildHostResourceMetrics(state: HostResourceState): HostResourceMetricView[] {
  if (state.status === "loading" || state.status === "idle") {
    return [
      {
        key: "cpu",
        label: t("shell.hostSwitcherDetailCpuLabel"),
        summary: t("common.loading"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      },
      {
        key: "memory",
        label: t("shell.hostSwitcherDetailMemoryLabel"),
        summary: t("common.loading"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      },
      {
        key: "disk",
        label: t("shell.hostSwitcherDetailDiskLabel"),
        summary: t("common.loading"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      }
    ];
  }

  if (!state.snapshot) {
    return [
      {
        key: "cpu",
        label: t("shell.hostSwitcherDetailCpuLabel"),
        summary: t("shell.hostSwitcherDetailUnavailable"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      },
      {
        key: "memory",
        label: t("shell.hostSwitcherDetailMemoryLabel"),
        summary: t("shell.hostSwitcherDetailUnavailable"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      },
      {
        key: "disk",
        label: t("shell.hostSwitcherDetailDiskLabel"),
        summary: t("shell.hostSwitcherDetailUnavailable"),
        progressLabel: null,
        ratio: null,
        tone: "neutral",
        contrast: "dark",
        fillTextTone: "neutral-dark"
      }
    ];
  }

  const cpuRatio = clampProgressRatio(state.snapshot.cpu.usedRatio);
  const memoryRatio = clampProgressRatio(
    state.snapshot.memory.totalBytes > 0
      ? state.snapshot.memory.usedBytes / state.snapshot.memory.totalBytes
      : 0
  );
  const diskFreeRatio = clampProgressRatio(
    state.snapshot.disk.totalBytes > 0
      ? state.snapshot.disk.freeBytes / state.snapshot.disk.totalBytes
      : 0
  );

  return [
    {
      key: "cpu",
      label: t("shell.hostSwitcherDetailCpuLabel"),
      summary: formatHostCpuValue(state),
      progressLabel: `${Math.round(cpuRatio * 100)}%`,
      ratio: cpuRatio,
      tone: resolveUsageTone(cpuRatio),
      contrast: resolveMetricContrast(cpuRatio),
      fillTextTone: resolveFillTextTone("good", cpuRatio)
    },
    {
      key: "memory",
      label: t("shell.hostSwitcherDetailMemoryLabel"),
      summary: formatHostMemoryValue(state),
      progressLabel: `${Math.round(memoryRatio * 100)}%`,
      ratio: memoryRatio,
      tone: resolveUsageTone(memoryRatio),
      contrast: resolveMetricContrast(memoryRatio),
      fillTextTone: resolveFillTextTone(resolveUsageTone(memoryRatio), memoryRatio)
    },
    {
      key: "disk",
      label: t("shell.hostSwitcherDetailDiskLabel"),
      summary: formatHostDiskValue(state),
      progressLabel: `${Math.round(diskFreeRatio * 100)}%`,
      ratio: diskFreeRatio,
      tone: resolveFreeSpaceTone(diskFreeRatio),
      contrast: resolveMetricContrast(diskFreeRatio),
      fillTextTone: resolveFillTextTone(resolveFreeSpaceTone(diskFreeRatio), diskFreeRatio)
    }
  ];
}

function clampProgressRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function resolveUsageTone(ratio: number): HostResourceMetricTone {
  if (ratio >= 0.85) {
    return "danger";
  }

  if (ratio >= 0.65) {
    return "warning";
  }

  return "good";
}

function resolveFreeSpaceTone(ratio: number): HostResourceMetricTone {
  if (ratio <= 0.15) {
    return "danger";
  }

  if (ratio <= 0.3) {
    return "warning";
  }

  return "good";
}

function resolveMetricContrast(ratio: number): HostResourceMetricContrast {
  return ratio >= 0.58 ? "light" : "dark";
}

function resolveFillTextTone(
  tone: HostResourceMetricTone,
  ratio: number
): HostResourceMetricFillTextTone {
  if (tone === "danger") {
    return "light";
  }

  if (ratio >= 0.72) {
    return "light";
  }

  if (tone === "warning") {
    return "warning-dark";
  }

  return "neutral-dark";
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

  if (value < 1024 ** 4) {
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
  }

  return `${(value / 1024 ** 4).toFixed(1)} TB`;
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
