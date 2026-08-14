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
import { ApiError } from "../../../shared/network/api-error";
import {
  HOST_TAG_COLOR_PRESETS,
  normalizeHostAliasLabel,
  resolveHostAliasTag
} from "../utils/host-alias";
import {
  checkPeerHost,
  createPeerHost,
  deletePeerHost,
  deletePeerHostSession,
  listPeerHosts,
  loginPeerHost,
  reconnectPeerHost,
  updatePeerHost,
  type PeerHostDto
} from "../api/peer-hosts-api";

interface WorkbenchHostSwitcherProps {
  readonly collapsed?: boolean;
}

type HostFormMode = "direct" | "peer";

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

interface PeerLoginDraft {
  username: string;
  password: string;
}

interface HostResourceTarget {
  hostId: string;
  targetHostId?: string;
}

interface HostHandshakeView {
  version: string;
}

type PeerConnectionState =
  | "disabled"
  | "reachable"
  | "unknown"
  | "unreachable"
  | "version_mismatch"
  | "unauthorized";

export function WorkbenchHostSwitcher({ collapsed = false }: WorkbenchHostSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<HostFormMode>("direct");
  const [nameDraft, setNameDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [hostAliasDraft, setHostAliasDraft] = useState("");
  const [pendingHostId, setPendingHostId] = useState<string | null>(null);
  const [pendingDeleteHostId, setPendingDeleteHostId] = useState<string | null>(null);
  const [confirmDeleteHostId, setConfirmDeleteHostId] = useState<string | null>(null);
  const [detailHostId, setDetailHostId] = useState<string | null>(null);
  const [aliasDraftByHostId, setAliasDraftByHostId] = useState<Record<string, string>>({});
  const [peerLoginDraftByHostId, setPeerLoginDraftByHostId] = useState<Record<string, PeerLoginDraft>>({});
  const [peerBusyHostId, setPeerBusyHostId] = useState<string | null>(null);
  const [tagPaletteHostId, setTagPaletteHostId] = useState<string | null>(null);
  const [savingTagColorHostId, setSavingTagColorHostId] = useState<string | null>(null);
  const [peerHostById, setPeerHostById] = useState<Record<string, PeerHostDto>>({});
  const [hostVersionById, setHostVersionById] = useState<Record<string, string | null>>({});
  const [addingHost, setAddingHost] = useState(false);
  const [relayLatency, setRelayLatency] = useState<RelayLatencyState>(INITIAL_RELAY_LATENCY_STATE);
  const [hostResourceStateById, setHostResourceStateById] = useState<Record<string, HostResourceState>>({});
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
  const activeSavedHost = useMemo(
    () => orderedHosts.find((host) => host.id === activeHostId) ?? null,
    [activeHostId, orderedHosts]
  );
  const peerHosts = useMemo(
    () => orderedHosts.filter((host) => host.id !== activeHostId && isManagedPeerHost(host)),
    [activeHostId, orderedHosts]
  );
  const directHosts = useMemo(
    () => orderedHosts.filter((host) => host.id !== activeHostId && !isManagedPeerHost(host)),
    [activeHostId, orderedHosts]
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
    const preferredWidth = 420;
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
    const estimatedHeight = formOpen ? 620 : detailHostId ? 760 : 320;
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
      setTagPaletteHostId(null);
      setRelayLatency(INITIAL_RELAY_LATENCY_STATE);
      setHostResourceStateById({});
      setHostVersionById({});
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
        setFormMode("direct");
        setDetailHostId(null);
        setTagPaletteHostId(null);
        setConfirmDeleteHostId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setFormOpen(false);
        setDetailHostId(null);
        setTagPaletteHostId(null);
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
    if (!open) {
      setHostResourceStateById({});
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const resourceTargets = resolveHostResourceTargets(runtimeConfig.hosts, activeHostId);

    if (resourceTargets.length === 0) {
      setHostResourceStateById({});
      return;
    }

    async function loadTarget(target: HostResourceTarget, silent: boolean): Promise<void> {
      if (!silent) {
        setHostResourceStateById((current) => {
          const previous = current[target.hostId];
          return {
            ...current,
            [target.hostId]: previous?.snapshot
              ? { status: "refreshing", snapshot: previous.snapshot }
              : { status: "loading", snapshot: null }
          };
        });
      }

      try {
        const snapshot = await fetchHostResourceSnapshot(target.targetHostId);

        if (cancelled) {
          return;
        }

        setHostResourceStateById((current) => ({
          ...current,
          [target.hostId]: {
            status: "ready",
            snapshot
          }
        }));
      } catch {
        if (cancelled) {
          return;
        }

        setHostResourceStateById((current) => ({
          ...current,
          [target.hostId]: current[target.hostId]?.snapshot
            ? current[target.hostId]
            : { status: "error", snapshot: null }
        }));
      }
    }

    function loadAll(silent: boolean): void {
      for (const target of resourceTargets) {
        void loadTarget(target, silent);
      }
    }

    loadAll(false);
    timerId = window.setInterval(() => {
      loadAll(true);
    }, 5_000);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [activeHostId, open, runtimeConfig.hosts]);

  useEffect(() => {
    if (!open) {
      setPeerHostById({});
      return;
    }

    let cancelled = false;

    void listPeerHosts().then((response) => {
      if (cancelled) {
        return;
      }

      setPeerHostById(Object.fromEntries(response.items.map((peerHost) => [peerHost.id, peerHost])));
    }).catch(() => {
      if (!cancelled) {
        setPeerHostById({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !activeHostId) {
      return;
    }

    let cancelled = false;

    void fetchCurrentHostVersion().then((version) => {
      if (cancelled) {
        return;
      }

      setHostVersionById((current) => ({
        ...current,
        [activeHostId]: version
      }));
    }).catch(() => {
      if (cancelled) {
        return;
      }

      setHostVersionById((current) => ({
        ...current,
        [activeHostId]: null
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeHostId, open]);

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
      setTagPaletteHostId(null);
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
      if (host.peerHostId) {
        try {
          await deletePeerHost(host.peerHostId);
        } catch (error) {
          if (!isPeerHostNotFoundError(error)) {
            throw error;
          }
        }
      }

      await clientConfigStore.update({
        hosts: runtimeConfig.hosts.filter((item) => item.id !== host.id)
      });
      clearRememberedLoginCredentials(host.id);
      authStore.clearHostSession(host.id);
      setPeerHostById((current) => {
        if (!host.peerHostId || !current[host.peerHostId]) {
          return current;
        }

        const next = { ...current };
        delete next[host.peerHostId];
        return next;
      });
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
    const isPeerMode = formMode === "peer";
    const hasCredentialInput = trimmedUsername.length > 0 || passwordDraft.length > 0;

    if (isPeerMode && (!trimmedUsername || !passwordDraft)) {
      showToast({
        title: t("shell.hostSwitcherPeerLoginRequired"),
        tone: "error"
      });
      return;
    }

    if (!isPeerMode && hasCredentialInput && (!trimmedUsername || !passwordDraft)) {
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

      let savedHost: HostProfile | null = null;

      if (relayEntryInput) {
        const nextState = await clientConfigStore.update(
          buildRelayEntryConfigPatch(latestConfig, relayEntryInput, {
            activate: shouldPromoteActiveDiscoveredHost,
            displayName: trimmedName
          })
        );
        savedHost = nextState.hosts.find((host) =>
          matchesRelayEntryHost(host, normalizedBaseUrl, relayEntryInput.bindingId ?? null)
        ) ?? null;

        if (!savedHost) {
          throw new Error("relay entry host missing after save");
        }
      } else {
        const now = new Date().toISOString();
        const hostName = trimmedName || buildHostDisplayName(normalizedBaseUrl);
        const alias = hostAliasDraft.trim()
          ? normalizeHostAlias(hostAliasDraft) ?? buildHostAlias(hostName, normalizedBaseUrl)
          : buildHostAlias(hostName, normalizedBaseUrl);
        const nextHost: HostProfile = {
          id: createHostId(),
          name: hostName,
          baseUrl: normalizedBaseUrl,
          kind: classifyHostKind(normalizedBaseUrl),
          alias,
          tagColor: null,
          peerEnabled: false,
          peerHostId: null,
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
        savedHost = nextHost;
      }

      if (!savedHost) {
        throw new Error("saved host missing after create");
      }

      if (hostAliasDraft.trim()) {
        await updateHostRecord(savedHost.id, (item) => ({
          ...item,
          alias: normalizeHostAlias(hostAliasDraft),
          updatedAt: new Date().toISOString()
        }));
        savedHost = {
          ...savedHost,
          alias: normalizeHostAlias(hostAliasDraft),
          updatedAt: new Date().toISOString()
        };
      }

      if (trimmedUsername && passwordDraft) {
        persistRememberedLoginCredentials({
          hostId: savedHost.id,
          username: trimmedUsername,
          password: passwordDraft
        });
      }

      if (isPeerMode) {
        const peerHost = await upsertPeerHostForProfile(savedHost);
        const checked = await checkPeerHost(peerHost.id);
        setPeerHostById((current) => ({
          ...current,
          [checked.id]: checked
        }));

        if (checked.status !== "reachable") {
          throw new Error(resolvePeerCheckFailureMessage(checked));
        }

        await loginPeerHost(checked.id, { username: trimmedUsername, password: passwordDraft });
        await updateHostRecord(savedHost.id, (item) => ({
          ...item,
          peerEnabled: true,
          peerHostId: checked.id,
          updatedAt: new Date().toISOString()
        }));
      }

      resetFormDrafts();
      setFormOpen(false);
      setFormMode("direct");
      setConfirmDeleteHostId(null);
      showToast({
        title: isPeerMode
          ? t("shell.hostSwitcherPeerEnableSuccess")
          : t("shell.hostAddSuccess", { name: savedHost.name })
      });
    } catch (error) {
      showToast({
        title: readErrorMessage(error, isPeerMode ? t("shell.hostSwitcherPeerEnableFailed") : t("shell.hostAddFailed")),
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
    setHostAliasDraft("");
  }

  async function updateHostRecord(hostId: string, updater: (host: HostProfile) => HostProfile): Promise<void> {
    const latestConfig = clientConfigStore.getState();
    await clientConfigStore.update({
      hosts: latestConfig.hosts.map((host) => host.id === hostId ? updater(host) : host)
    });
  }

  async function handleSaveAlias(host: HostProfile): Promise<void> {
    const alias = normalizeHostAlias(aliasDraftByHostId[host.id] ?? host.alias);

    await updateHostRecord(host.id, (item) => ({
      ...item,
      alias,
      updatedAt: new Date().toISOString()
    }));

    setAliasDraftByHostId((current) => ({
      ...current,
      [host.id]: normalizeEditableHostAlias(alias)
    }));

    if (host.peerHostId) {
      const updatedPeerHost = await updatePeerHost(host.peerHostId, {
        name: host.name,
        alias,
        baseUrl: host.baseUrl
      });
      setPeerHostById((current) => ({
        ...current,
        [updatedPeerHost.id]: updatedPeerHost
      }));
    }

    showToast({ title: t("shell.hostSwitcherAliasSaveSuccess") });
  }

  async function handleSaveHostTagColor(host: HostProfile, tagColor: string | null): Promise<void> {
    if (savingTagColorHostId) {
      return;
    }

    const normalizedTagColor = normalizeHostTagColor(tagColor);
    setSavingTagColorHostId(host.id);

    try {
      let nextTagColor = normalizedTagColor;

      if (host.peerHostId) {
        const updatedPeerHost = await updatePeerHost(host.peerHostId, {
          name: host.name,
          alias: normalizeHostAlias(host.alias),
          tagColor: normalizedTagColor,
          baseUrl: host.baseUrl
        });
        setPeerHostById((current) => ({
          ...current,
          [updatedPeerHost.id]: updatedPeerHost
        }));
        nextTagColor = normalizeHostTagColor(updatedPeerHost.tagColor);
      }

      await updateHostRecord(host.id, (item) => ({
        ...item,
        tagColor: nextTagColor,
        updatedAt: new Date().toISOString()
      }));
      showToast({ title: t("shell.hostSwitcherTagColorSaveSuccess") });
    } catch {
      showToast({
        title: t("shell.hostSwitcherTagColorSaveFailed"),
        tone: "error"
      });
    } finally {
      setSavingTagColorHostId(null);
    }
  }

  async function handleEnablePeerHost(host: HostProfile): Promise<void> {
    if (peerBusyHostId || host.id === activeHostId) {
      return;
    }

    const loginDraft = peerLoginDraftByHostId[host.id];
    const username = loginDraft?.username.trim() || "";
    const password = loginDraft?.password || "";
    const hasSavedPeerHost = Boolean(host.peerHostId);

    if (!hasSavedPeerHost && (!username || !password)) {
      showToast({
        title: t("shell.hostSwitcherPeerLoginRequired"),
        tone: "error"
      });
      return;
    }

    setPeerBusyHostId(host.id);

    try {
      const peerHost = await upsertPeerHostForProfile(host);
      const checked = hasSavedPeerHost
        ? await reconnectPeerHost(peerHost.id)
        : await checkPeerHost(peerHost.id);
      setPeerHostById((current) => ({
        ...current,
        [checked.id]: checked
      }));

      if (checked.status !== "reachable") {
        showToast({
          title: resolvePeerCheckFailureMessage(checked),
          tone: "error"
        });
        return;
      }

      if (!hasSavedPeerHost && username && password) {
        await loginPeerHost(checked.id, { username, password });
      }
      await updateHostRecord(host.id, (item) => ({
        ...item,
        peerEnabled: true,
        peerHostId: checked.id,
        updatedAt: new Date().toISOString()
      }));
      setPeerLoginDraftByHostId((current) => ({
        ...current,
        [host.id]: { username, password: "" }
      }));
      showToast({
        title: hasSavedPeerHost
          ? t("shell.hostSwitcherPeerReconnectSuccess")
          : t("shell.hostSwitcherPeerEnableSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: readErrorMessage(
          error,
          hasSavedPeerHost
            ? t("shell.hostSwitcherPeerReconnectFailed")
            : t("shell.hostSwitcherPeerEnableFailed")
        ),
        tone: "error"
      });
    } finally {
      setPeerBusyHostId(null);
    }
  }

  async function handleDisablePeerHost(host: HostProfile): Promise<void> {
    if (peerBusyHostId) {
      return;
    }

    setPeerBusyHostId(host.id);

    try {
      if (host.peerHostId) {
        await deletePeerHostSession(host.peerHostId).catch(() => undefined);
      }

      await updateHostRecord(host.id, (item) => ({
        ...item,
        peerEnabled: false,
        updatedAt: new Date().toISOString()
      }));
      showToast({ title: t("shell.hostSwitcherPeerDisableSuccess") });
    } catch {
      showToast({
        title: t("shell.hostSwitcherPeerDisableFailed"),
        tone: "error"
      });
    } finally {
      setPeerBusyHostId(null);
    }
  }

  async function upsertPeerHostForProfile(host: HostProfile): Promise<PeerHostDto> {
    const payload = {
      name: host.name,
      alias: normalizeHostAlias(host.alias),
      tagColor: normalizeHostTagColor(host.tagColor),
      baseUrl: host.baseUrl
    };

    if (host.peerHostId) {
      try {
        return await updatePeerHost(host.peerHostId, payload);
      } catch (error) {
        if (!isPeerHostNotFoundError(error)) {
          throw error;
        }
      }
    }

    try {
      return await createPeerHost(payload);
    } catch (error) {
      if (!isPeerHostBaseUrlExistsError(error)) {
        throw error;
      }

      const existing = await findPeerHostByBaseUrl(host.baseUrl);
      if (!existing) {
        throw error;
      }

      return await updatePeerHost(existing.id, payload);
    }
  }

  function updateAliasDraft(hostId: string, value: string): void {
    setAliasDraftByHostId((current) => ({
      ...current,
      [hostId]: normalizeEditableHostAlias(value)
    }));
  }

  function updatePeerLoginDraft(hostId: string, patch: Partial<PeerLoginDraft>): void {
    setPeerLoginDraftByHostId((current) => ({
      ...current,
      [hostId]: {
        username: current[hostId]?.username ?? "",
        password: current[hostId]?.password ?? "",
        ...patch
      }
    }));
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
      readonly role: "main" | "peer" | "direct" | "discovered";
    }
  ) {
    const isActive = host.id === activeHostId;
    const savedHost = isDiscoveredHostProfile(host) ? null : host;
    const detailExpanded = detailHostId === host.id;
    const tagPaletteExpanded = tagPaletteHostId === host.id;
    const aliasTag = savedHost ? resolveHostAliasTag(savedHost) : null;
    const resourceState = savedHost
      ? hostResourceStateById[savedHost.id] ?? INITIAL_HOST_RESOURCE_STATE
      : INITIAL_HOST_RESOURCE_STATE;
    const peerState = savedHost
      ? resolvePeerConnectionState(savedHost, peerHostById)
      : "disabled";
    const hostVersion = savedHost
      ? resolveHostVersion(savedHost, activeHostId, hostVersionById, peerHostById)
      : null;
    const metaText = formatHostMetaText(options.statusText, hostVersion);
    const switchable = options.role !== "peer";
    const mainContent = (
      <span className="workbench-host-switcher-item-copy">
        <span className="workbench-host-switcher-item-title">
          {aliasTag ? (
            <span
              className="workbench-host-switcher-alias-badge host-alias-badge"
              style={{ "--host-alias-color": aliasTag.color } as CSSProperties}
              role={savedHost ? "button" : undefined}
              tabIndex={savedHost ? 0 : undefined}
              aria-label={savedHost ? t("shell.hostSwitcherTagColorButton", { name: host.name }) : undefined}
              aria-expanded={savedHost ? tagPaletteExpanded : undefined}
              onClick={savedHost ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                setTagPaletteHostId((current) => current === host.id ? null : host.id);
                setDetailHostId(null);
                setConfirmDeleteHostId(null);
              } : undefined}
              onKeyDown={savedHost ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setTagPaletteHostId((current) => current === host.id ? null : host.id);
                setDetailHostId(null);
                setConfirmDeleteHostId(null);
              } : undefined}
            >
              {aliasTag.label}
            </span>
          ) : null}
          <span className="workbench-host-switcher-host-name">{host.name}</span>
          {options.role === "main" ? (
            <span className="workbench-host-switcher-item-badge">
              {t("shell.hostSwitcherCurrentBadge")}
            </span>
          ) : null}
          {options.discovered ? (
            <span className="workbench-host-switcher-item-badge" data-tone="discovered">
              {t("shell.hostSwitcherDiscoveredBadge")}
            </span>
          ) : null}
          {savedHost && options.role === "peer" ? (
            <span
              className="workbench-host-switcher-item-badge"
              data-tone={resolvePeerBadgeTone(peerState)}
            >
              {resolvePeerBadgeLabel(peerState)}
            </span>
          ) : null}
        </span>
        <span className="workbench-host-switcher-item-meta">{metaText}</span>
        {savedHost ? renderResourceStrip(resourceState, savedHost.peerEnabled || isActive) : null}
      </span>
    );

    return (
      <div
        key={host.id}
        className="workbench-host-switcher-item"
        data-active={isActive}
        data-discovered={options.discovered ? "true" : undefined}
        data-expanded={detailExpanded}
        data-role={options.role}
      >
        <div className="workbench-host-switcher-item-row">
          {switchable ? (
            <button
              type="button"
              className="workbench-host-switcher-item-main"
              disabled={pendingHostId !== null || pendingDeleteHostId !== null}
              onClick={() => {
                void handleSwitchHost(host);
              }}
            >
              {mainContent}
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
          ) : (
            <div className="workbench-host-switcher-item-main" data-static="true">
              {mainContent}
            </div>
          )}
          {savedHost ? (
            <button
              type="button"
              className="workbench-host-switcher-item-action"
              aria-label={t("shell.hostSwitcherDetailAriaLabel", { name: host.name })}
              aria-expanded={detailExpanded}
              data-tone="detail"
              onClick={() => {
                setDetailHostId((current) => current === host.id ? null : host.id);
                setAliasDraftByHostId((current) => ({
                  ...current,
                  [host.id]: current[host.id] ?? normalizeEditableHostAlias(savedHost.alias)
                }));
                setTagPaletteHostId(null);
                setConfirmDeleteHostId(null);
              }}
            >
              <MoreIcon />
            </button>
          ) : null}
          {!isActive && options.deletable && savedHost ? (
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
                void handleDeleteHost(savedHost);
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
        {tagPaletteExpanded && savedHost ? renderTagColorPalette(savedHost) : null}
        {detailExpanded && savedHost ? renderHostInspector(savedHost, isActive) : null}
      </div>
    );
  }

  function renderTagColorPalette(host: HostProfile) {
    const disabled = savingTagColorHostId === host.id;

    return (
      <div className="workbench-host-switcher-tag-palette-panel" role="group" aria-label={t("shell.hostSwitcherTagColorLabel")}>
        <div className="workbench-host-switcher-tag-palette-header">
          <span className="workbench-host-switcher-detail-section-title">
            {t("shell.hostSwitcherTagColorLabel")}
          </span>
          <button
            type="button"
            className="ghost-button workbench-host-switcher-tag-palette-clear"
            disabled={disabled || !host.tagColor}
            onClick={() => {
              void handleSaveHostTagColor(host, null);
            }}
          >
            {t("shell.manageWorkspaceColorClearAction")}
          </button>
        </div>
        <div className="workbench-manage-color-palette workbench-host-switcher-tag-palette" aria-label={t("shell.hostSwitcherTagColorLabel")}>
          {HOST_TAG_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              className="workbench-manage-color-swatch"
              aria-label={t("shell.manageWorkspaceColorSelectSwatch", { color })}
              aria-pressed={host.tagColor === color}
              data-selected={host.tagColor === color}
              disabled={disabled}
              style={{ backgroundColor: color }}
              onClick={() => {
                void handleSaveHostTagColor(host, color);
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  function renderResourceStrip(state: HostResourceState, available: boolean) {
    const metrics = buildHostResourceMetrics(available ? state : { status: "error", snapshot: null });

    return (
      <span className="workbench-host-switcher-resource-strip" aria-label={t("shell.hostSwitcherDetailResourceTitle")}>
        {metrics.map((metric) => (
          <span
            key={metric.key}
            className="workbench-host-switcher-resource-pill"
            data-tone={metric.tone}
          >
            <span>{metric.label}</span>
            <strong>{metric.progressLabel ?? metric.summary}</strong>
          </span>
        ))}
      </span>
    );
  }

  function openAddHostForm(mode: HostFormMode): void {
    resetFormDrafts();
    setFormMode(mode);
    setFormOpen(true);
    setConfirmDeleteHostId(null);
  }

  function renderHostInspector(host: HostProfile, isPrimary: boolean) {
    const loginDraft = peerLoginDraftByHostId[host.id] ?? { username: "", password: "" };
    const busy = peerBusyHostId === host.id;
    const aliasDraft = aliasDraftByHostId[host.id] ?? normalizeEditableHostAlias(host.alias);
    const resourceState = hostResourceStateById[host.id] ?? INITIAL_HOST_RESOURCE_STATE;
    const peerState = resolvePeerConnectionState(host, peerHostById);
    const hasSavedPeerHost = Boolean(host.peerHostId);
    const peerFailureDetail = resolvePeerFailureDetail(host, peerHostById);

    return (
      <div className="workbench-host-switcher-detail-panel" role="region" aria-label={t("shell.hostSwitcherDetailTitle")}>
        <div className="workbench-host-switcher-inspector-grid">
          <label className="workbench-host-switcher-field" data-inline="true">
            <span>{t("shell.hostSwitcherAliasLabel")}</span>
            <input
              value={aliasDraft}
              maxLength={4}
              onChange={(event) => updateAliasDraft(host.id, event.target.value)}
              placeholder={t("shell.hostSwitcherAliasPlaceholder")}
            />
          </label>
          <button
            type="button"
            className="secondary-button workbench-host-switcher-compact-button"
            onClick={() => { void handleSaveAlias(host); }}
          >
            {t("shell.hostSwitcherAliasSaveAction")}
          </button>
        </div>
        <p className="workbench-host-switcher-peer-note">{t("shell.hostSwitcherAliasRule")}</p>

        <div className="workbench-host-switcher-detail-grid">
          <div className="workbench-host-switcher-detail-row">
            <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherDetailAddressLabel")}</span>
            <span className="workbench-host-switcher-detail-value" data-multiline="true">
              {isPrimary ? activeRoute?.url ?? activeHostBaseUrl : host.baseUrl}
            </span>
          </div>
          <div className="workbench-host-switcher-detail-row">
            <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherDetailStatusLabel")}</span>
            <span className="workbench-host-switcher-detail-value">
              {isPrimary ? detailStatusLabel : resolvePeerDetailStatusLabel(peerState)}
            </span>
          </div>
          {!isPrimary && peerFailureDetail ? (
            <div className="workbench-host-switcher-detail-row">
              <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherPeerFailureReasonLabel")}</span>
              <span className="workbench-host-switcher-detail-value" data-multiline="true">
                {peerFailureDetail}
              </span>
            </div>
          ) : null}
          {isPrimary && activeRoute?.kind === "relay" ? (
            <>
              <div className="workbench-host-switcher-detail-row">
                <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherDetailRouteLabel")}</span>
                <span className="workbench-host-switcher-detail-value">{detailRouteLabel}</span>
              </div>
              <div className="workbench-host-switcher-detail-row">
                <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherDetailLatencyLabel")}</span>
                <span className="workbench-host-switcher-detail-value">{formatRelayLatency(relayLatency)}</span>
              </div>
              <div className="workbench-host-switcher-detail-row">
                <span className="workbench-host-switcher-detail-label">{t("shell.hostSwitcherDetailTrafficLabel")}</span>
                <span className="workbench-host-switcher-detail-value">{formatTrafficBytes(relaySessionTraffic.totalBytes)}</span>
              </div>
            </>
          ) : null}
        </div>

        <div className="workbench-host-switcher-resource-list" data-compact="true">
          {buildHostResourceMetrics(resourceState).map((metric) => (
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
                  <span className="workbench-host-switcher-resource-summary">{metric.summary}</span>
                  {metric.progressLabel ? (
                    <span className="workbench-host-switcher-resource-percent">{metric.progressLabel}</span>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>

        {isPrimary ? (
          <div className="workbench-host-switcher-peer-box" data-mode="peer-create">
            <p className="workbench-host-switcher-peer-note">
              {t("shell.hostSwitcherPeerDescription")}
            </p>
            <button
              type="button"
              className="primary-button workbench-host-switcher-compact-button"
              onClick={() => { openAddHostForm("peer"); }}
            >
              {t("shell.hostSwitcherAddPeerHostAction")}
            </button>
          </div>
        ) : null}

        {!isPrimary ? (
          <div className="workbench-host-switcher-peer-box" data-mode={hasSavedPeerHost ? "peer-connected" : "peer-enable"}>
            <p className="workbench-host-switcher-peer-note">
              {hasSavedPeerHost
                ? t("shell.hostSwitcherPeerReconnectDescription")
                : t("shell.hostSwitcherPeerDescription")}
            </p>
            {!hasSavedPeerHost ? (
              <>
                <p className="workbench-host-switcher-peer-note">{t("shell.hostSwitcherPeerPasswordOneTimeHint")}</p>
                <div className="workbench-host-switcher-peer-login" data-inline="true">
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.username")}</span>
                    <input
                      value={loginDraft.username}
                      disabled={busy}
                      autoComplete="username"
                      onChange={(event) => updatePeerLoginDraft(host.id, { username: event.target.value })}
                      placeholder={t("auth.username")}
                    />
                  </label>
                  <label className="workbench-host-switcher-field">
                    <span>{t("auth.password")}</span>
                    <input
                      type="password"
                      value={loginDraft.password}
                      disabled={busy}
                      autoComplete="current-password"
                      onChange={(event) => updatePeerLoginDraft(host.id, { password: event.target.value })}
                      placeholder={t("auth.password")}
                    />
                  </label>
                </div>
              </>
            ) : null}
            <div
              className="workbench-host-switcher-form-actions"
              data-layout={hasSavedPeerHost ? "peer-connected" : "peer-add"}
            >
              {hasSavedPeerHost ? (
                <>
                  <button
                    type="button"
                    className="secondary-button workbench-host-switcher-compact-button"
                    disabled={busy}
                    onClick={() => { void handleDisablePeerHost(host); }}
                  >
                    {busy ? t("common.loading") : t("shell.hostSwitcherPeerDisableAction")}
                  </button>
                  <button
                    type="button"
                    className="primary-button workbench-host-switcher-compact-button"
                    disabled={busy}
                    onClick={() => { void handleEnablePeerHost(host); }}
                  >
                    {busy ? t("shell.hostSwitcherPeerChecking") : t("shell.hostSwitcherPeerReconnectAction")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button workbench-host-switcher-compact-button"
                  disabled={busy}
                  onClick={() => { void handleEnablePeerHost(host); }}
                >
                  {busy ? t("shell.hostSwitcherPeerChecking") : t("shell.hostSwitcherAddPeerHostAction")}
                </button>
              )}
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
          setFormMode("direct");
          setDetailHostId(null);
          setTagPaletteHostId(null);
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
                {activeSavedHost ? (
                  <section className="workbench-host-switcher-section">
                    <div className="workbench-host-switcher-section-label">
                      {t("shell.hostSwitcherPrimaryHostTitle")}
                    </div>
                    <div className="workbench-host-switcher-section-card">
                      {renderHostItem(activeSavedHost, {
                        statusText: session?.user.username ?? activeSavedHost.lastUsername ?? activeSavedHost.baseUrl,
                        deletable: false,
                        role: "main"
                      })}
                    </div>
                  </section>
                ) : null}
                {directHosts.length > 0 ? (
                  <section className="workbench-host-switcher-section">
                    <div className="workbench-host-switcher-section-label">
                      {t("shell.hostSwitcherDirectSectionTitle")}
                    </div>
                    <div className="workbench-host-switcher-section-card">
                      {directHosts.map((host) => renderHostItem(host, {
                        statusText: host.lastUsername ?? host.baseUrl,
                        deletable: true,
                        role: "direct"
                      }))}
                    </div>
                  </section>
                ) : null}
                {peerHosts.length > 0 ? (
                  <section className="workbench-host-switcher-section">
                    <div className="workbench-host-switcher-section-label">
                      {t("shell.hostSwitcherPeerSectionTitle")}
                    </div>
                    <div className="workbench-host-switcher-section-card">
                      {peerHosts.map((host) => renderHostItem(host, {
                        statusText: host.lastUsername ?? host.baseUrl,
                        deletable: true,
                        role: "peer"
                      }))}
                    </div>
                  </section>
                ) : null}
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
                          discovered: true,
                          role: "discovered"
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
                <div className="workbench-host-switcher-form" data-mode={formMode}>
                  <label className="workbench-host-switcher-field">
                    <span>{formMode === "peer" ? t("shell.hostSwitcherAddPeerHostAction") : t("shell.hostSwitcherNameLabel")}</span>
                    <input
                      value={nameDraft}
                      disabled={addingHost}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder={formMode === "peer" ? t("shell.hostSwitcherNamePlaceholder") : t("shell.hostSwitcherNamePlaceholder")}
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
                    <span>{t("shell.hostSwitcherAliasLabel")}</span>
                    <input
                      value={hostAliasDraft}
                      maxLength={4}
                      disabled={addingHost}
                      onChange={(event) => setHostAliasDraft(normalizeEditableHostAlias(event.target.value))}
                      placeholder={t("shell.hostSwitcherAliasPlaceholder")}
                    />
                  </label>
                  <p className="workbench-host-switcher-peer-note">{t("shell.hostSwitcherAliasRule")}</p>
                  {formMode === "peer" ? (
                    <p className="workbench-host-switcher-peer-note">{t("shell.hostSwitcherPeerPasswordOneTimeHint")}</p>
                  ) : null}
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
                        setFormMode("direct");
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
                      {addingHost
                        ? t("common.loading")
                        : formMode === "peer"
                          ? t("shell.hostSwitcherAddPeerHostAction")
                          : t("shell.hostSwitcherSaveAction")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="workbench-host-switcher-add"
                  onClick={() => {
                    openAddHostForm("direct");
                  }}
                >
                  <PlusIcon />
                  {t("shell.hostSwitcherAddDirectHostAction")}
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

async function fetchCurrentHostVersion(): Promise<string | null> {
  const handshake = await httpClient.request<HostHandshakeView>("/api/public/host-handshake", {
    skipAuth: true,
    omitCompatibilityHeaders: true
  });
  return normalizeVersionLabel(handshake.version);
}

function resolveHostVersion(
  host: HostProfile,
  activeHostId: string | null,
  hostVersionById: Record<string, string | null>,
  peerHostById: Record<string, PeerHostDto>
): string | null {
  if (host.id === activeHostId) {
    return hostVersionById[host.id] ?? null;
  }

  if (!host.peerHostId) {
    return null;
  }

  return normalizeVersionLabel(peerHostById[host.peerHostId]?.remoteVersion);
}

function normalizeVersionLabel(version: string | null | undefined): string | null {
  const normalized = version?.trim();
  return normalized ? normalized : null;
}

function formatHostMetaText(text: string, version: string | null): string {
  if (!version) {
    return text;
  }

  return `${text} · v${version}`;
}

function resolveHostResourceTargets(
  hosts: readonly HostProfile[],
  activeHostId: string | null
): HostResourceTarget[] {
  return hosts.flatMap((host) => {
    if (host.id === activeHostId) {
      return [{ hostId: host.id }];
    }

    if (host.peerEnabled && host.peerHostId) {
      return [{ hostId: host.id, targetHostId: host.peerHostId }];
    }

    return [];
  });
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

function buildHostAlias(name: string, baseUrl: string): string {
  const fromName = normalizeHostAlias(name);

  if (fromName) {
    return fromName;
  }

  return normalizeHostAlias(buildHostDisplayName(baseUrl)) ?? normalizeHostAliasLabel(null);
}

function normalizeHostAlias(value: string | null | undefined): string | null {
  const normalized = value?.match(/[A-Za-z]/g)?.join("").toUpperCase().slice(0, 4);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeEditableHostAlias(value: string | null | undefined): string {
  return normalizeHostAlias(value) ?? "";
}

function normalizeHostTagColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalizedColor = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalizedColor) ? normalizedColor : null;
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

function resolvePeerCheckFailureMessage(peerHost: PeerHostDto): string {
  switch (peerHost.status) {
    case "version_mismatch":
      return peerHost.lastErrorDetail || t("shell.hostSwitcherPeerVersionMismatch", { hostName: peerHost.name });
    case "unauthorized":
      return peerHost.lastErrorDetail || t("shell.hostSwitcherPeerUnauthorized", { hostName: peerHost.name });
    case "unreachable":
      return peerHost.lastErrorDetail || t("shell.hostSwitcherPeerUnavailable", { hostName: peerHost.name });
    default:
      return peerHost.lastErrorDetail || t("shell.hostSwitcherPeerEnableFailed");
  }
}

function resolvePeerFailureDetail(
  host: Pick<HostProfile, "peerHostId">,
  peerHostById: Record<string, PeerHostDto>
): string | null {
  if (!host.peerHostId) {
    return null;
  }

  const peerHost = peerHostById[host.peerHostId];
  if (!peerHost || peerHost.status === "reachable") {
    return null;
  }

  return resolvePeerCheckFailureMessage(peerHost);
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

function isPeerHostBaseUrlExistsError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.errorCode === "PEER_HOST_BASE_URL_EXISTS";
}

function isPeerHostNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.errorCode === "PEER_HOST_NOT_FOUND";
}

async function findPeerHostByBaseUrl(baseUrl: string): Promise<PeerHostDto | null> {
  const normalized = normalizeServerBaseUrl(baseUrl);
  const response = await listPeerHosts();
  return response.items.find((item) => normalizeServerBaseUrl(item.baseUrl) === normalized) ?? null;
}

function resolvePeerConnectionState(
  host: Pick<HostProfile, "peerEnabled" | "peerHostId">,
  peerHostById: Record<string, PeerHostDto>
): PeerConnectionState {
  if (!host.peerHostId) {
    return host.peerEnabled ? "reachable" : "disabled";
  }

  const peerHost = peerHostById[host.peerHostId];

  if (!peerHost) {
    return host.peerEnabled ? "reachable" : "unknown";
  }

  return peerHost.status;
}

function resolvePeerBadgeTone(state: PeerConnectionState): "peer" | "muted" | "warning" | "danger" {
  switch (state) {
    case "reachable":
      return "peer";
    case "version_mismatch":
    case "unauthorized":
      return "warning";
    case "unknown":
    case "unreachable":
      return "danger";
    default:
      return "muted";
  }
}

function resolvePeerBadgeLabel(state: PeerConnectionState): string {
  switch (state) {
    case "reachable":
      return t("shell.hostSwitcherPeerBadge");
    case "version_mismatch":
      return t("shell.hostSwitcherPeerVersionMismatchBadge");
    case "unauthorized":
      return t("shell.hostSwitcherPeerUnauthorizedBadge");
    case "unknown":
    case "unreachable":
      return t("shell.hostSwitcherPeerUnavailableBadge");
    default:
      return t("common.disabled");
  }
}

function resolvePeerDetailStatusLabel(state: PeerConnectionState): string {
  switch (state) {
    case "reachable":
      return t("common.enabled");
    case "version_mismatch":
      return t("shell.hostSwitcherPeerVersionMismatchBadge");
    case "unauthorized":
      return t("shell.hostSwitcherPeerUnauthorizedBadge");
    case "unknown":
    case "unreachable":
      return t("shell.hostSwitcherPeerUnavailableBadge");
    default:
      return t("common.disabled");
  }
}

function isManagedPeerHost(host: Pick<HostProfile, "peerEnabled" | "peerHostId">): boolean {
  return Boolean(host.peerEnabled || host.peerHostId);
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

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12" cy="8" r="1.15" fill="currentColor" />
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
