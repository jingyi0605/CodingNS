import { useEffect, useState } from "react";

import { t } from "../../../shared/i18n";
import type {
  ContextUsageDto,
  ProviderCapabilitiesDto,
  ProviderModelOptionDto
} from "../../conversation/api/conversation-api";
import {
  getProviderCapabilities,
  getSessionMessages,
  getSessionRuntime
} from "../../conversation/api/conversation-api";
import type { SessionMessageViewModel } from "../../conversation/runtime/session-runtime-machine";
import { toViewMessage } from "../../conversation/runtime/session-runtime-machine";
import type {
  ButlerControlEventDto,
  ButlerControlSessionDto,
  ButlerOverviewDto,
  ButlerProfileDto,
  ButlerProfilePayload,
  ButlerProviderId
} from "../api/butler-api";
import {
  getButlerOverview,
  getButlerProfile,
  getCurrentButlerControlSession,
  initButlerProfile,
  listButlerControlEvents,
  sendButlerControlMessage,
  startButlerControlSession,
  updateButlerProfile
} from "../api/butler-api";

type ButlerRuntimeListener = () => void;
type ButlerHistoryState = "idle" | "loading" | "ready" | "error";

export interface ButlerRuntimeState {
  loading: boolean;
  sending: boolean;
  switchingProvider: boolean;
  initialized: boolean;
  profile: ButlerProfileDto | null;
  activeProvider: ButlerProviderId;
  controlSession: ButlerControlSessionDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  messages: SessionMessageViewModel[];
  historyState: ButlerHistoryState;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ContextUsageDto | null;
  error: string | null;
}

const BUTLER_MESSAGE_PAGE_SIZE = 60;

export class ButlerRuntimeStore {
  private state: ButlerRuntimeState;
  private listeners = new Set<ButlerRuntimeListener>();

  constructor(private readonly workspaceId: string) {
    this.state = {
      loading: true,
      sending: false,
      switchingProvider: false,
      initialized: false,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: createButlerFallbackCapabilities("codex"),
      overview: null,
      events: [],
      messages: [],
      historyState: "idle",
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      error: null
    };
  }

  subscribe = (listener: ButlerRuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    this.patch({
      loading: true,
      error: null
    });

    try {
      const profileResponse = await getButlerProfile();

      if (!profileResponse.initialized || !profileResponse.profile) {
        this.patch({
          loading: false,
          initialized: false,
          profile: null,
          activeProvider: "codex",
          capabilities: createButlerFallbackCapabilities("codex"),
          controlSession: null,
          messages: [],
          historyState: "idle",
          overview: null,
          events: [],
          runtimeHasActiveRun: null,
          runtimeCanInterrupt: null,
          contextUsage: null
        });
        return;
      }

      const profile = profileResponse.profile;
      this.patch({
        initialized: true,
        profile,
        activeProvider: profile.providerId,
        capabilities: createButlerFallbackCapabilities(profile.providerId)
      });
      await this.reloadForProvider(profile.providerId);
      this.patch({
        loading: false
      });
    } catch (error) {
      this.patch({
        loading: false,
        error: toErrorMessage(error)
      });
    }
  }

  async initializeProfile(payload: ButlerProfilePayload): Promise<void> {
    this.patch({
      loading: true,
      error: null
    });

    try {
      const response = await initButlerProfile(payload);

      if (!response.initialized || !response.profile) {
        throw new Error("BUTLER_PROFILE_INIT_FAILED");
      }

      this.patch({
        initialized: true,
        profile: response.profile,
        activeProvider: response.profile.providerId,
        capabilities: createButlerFallbackCapabilities(response.profile.providerId)
      });
      await this.reloadForProvider(response.profile.providerId);
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        loading: false
      });
    }
  }

  async switchProvider(providerId: ButlerProviderId): Promise<void> {
    if (!this.state.initialized || !this.state.profile || this.state.activeProvider === providerId) {
      return;
    }

    const previousState = {
      activeProvider: this.state.activeProvider,
      profile: this.state.profile,
      controlSession: this.state.controlSession,
      capabilities: this.state.capabilities,
      overview: this.state.overview,
      events: this.state.events,
      messages: this.state.messages,
      historyState: this.state.historyState,
      runtimeHasActiveRun: this.state.runtimeHasActiveRun,
      runtimeCanInterrupt: this.state.runtimeCanInterrupt,
      contextUsage: this.state.contextUsage
    } satisfies Pick<
      ButlerRuntimeState,
      | "activeProvider"
      | "profile"
      | "controlSession"
      | "capabilities"
      | "overview"
      | "events"
      | "messages"
      | "historyState"
      | "runtimeHasActiveRun"
      | "runtimeCanInterrupt"
      | "contextUsage"
    >;

    // 切换 provider 必须先清空页面状态，避免不同 provider 的上下文串味。
    this.patch({
      switchingProvider: true,
      error: null,
      activeProvider: providerId,
      controlSession: null,
      messages: [],
      historyState: "idle",
      overview: null,
      events: [],
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      capabilities: createButlerFallbackCapabilities(providerId)
    });

    try {
      const response = await updateButlerProfile({
        providerId
      });

      if (!response.initialized || !response.profile) {
        throw new Error("BUTLER_PROFILE_UPDATE_FAILED");
      }

      this.patch({
        initialized: true,
        profile: response.profile,
        activeProvider: response.profile.providerId
      });
      await Promise.all([
        this.refreshCapabilities(response.profile.providerId),
        this.refreshOverview(),
        this.refreshEvents()
      ]);
      await this.startFreshSession({
        preserveSwitchingState: true
      });
    } catch (error) {
      this.patch({
        ...previousState,
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        switchingProvider: false
      });
    }
  }

  async sendMessage(
    content: string,
    options?: {
      model?: string | null;
      reasoningLevel?: string | null;
      permissionMode?: string | null;
    }
  ): Promise<void> {
    const normalizedContent = content.trim();

    if (!normalizedContent || !this.state.initialized) {
      return;
    }

    this.patch({
      sending: true,
      error: null
    });

    try {
      const currentControlSession = this.state.controlSession;

      if (!currentControlSession) {
        const started = await startButlerControlSession({
          content: normalizedContent,
          model: options?.model ?? null,
          reasoningLevel: options?.reasoningLevel ?? null,
          permissionMode: options?.permissionMode ?? null
        });
        this.patch({
          controlSession: started.controlSession
        });
      } else {
        const sent = await sendButlerControlMessage({
          content: normalizedContent,
          model: options?.model ?? null,
          reasoningLevel: options?.reasoningLevel ?? null,
          permissionMode: options?.permissionMode ?? null
        });
        this.patch({
          controlSession: sent.controlSession
        });
      }

      await this.reloadControlSession();
      await Promise.all([this.refreshOverview(), this.refreshEvents()]);
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        sending: false
      });
    }
  }

  async retryMessage(clientRequestId: string): Promise<void> {
    const targetMessage = this.state.messages.find(
      (message) => message.clientRequestId === clientRequestId
    );

    if (!targetMessage || !targetMessage.content.trim()) {
      return;
    }

    await this.sendMessage(targetMessage.content);
  }

  async startFreshSession(options?: { preserveSwitchingState?: boolean }): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    this.patch({
      sending: true,
      error: null,
      controlSession: null,
      messages: [],
      historyState: "loading",
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null
    });

    try {
      const started = await startButlerControlSession({});
      this.patch({
        controlSession: started.controlSession
      });
      await this.reloadControlSession();
      await Promise.all([this.refreshOverview(), this.refreshEvents()]);
    } catch (error) {
      this.patch({
        historyState: "error",
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        sending: false,
        switchingProvider: options?.preserveSwitchingState ? this.state.switchingProvider : false
      });
    }
  }

  async refreshAll(): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    this.patch({
      loading: true,
      error: null
    });

    try {
      await this.reloadForProvider(this.state.activeProvider);
    } finally {
      this.patch({
        loading: false
      });
    }
  }

  async reloadEventsAndOverview(): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    await Promise.all([this.refreshOverview(), this.refreshEvents()]);
  }

  private async reloadForProvider(providerId: ButlerProviderId): Promise<void> {
    await Promise.all([this.refreshCapabilities(providerId), this.refreshOverview(), this.refreshEvents()]);
    await this.reloadControlSession();
  }

  private async reloadControlSession(): Promise<void> {
    this.patch({
      historyState: "loading"
    });

    try {
      const response = await getCurrentButlerControlSession();
      const controlSession = response.controlSession;

      if (!controlSession) {
        this.patch({
          controlSession: null,
          messages: [],
          historyState: "ready",
          runtimeHasActiveRun: null,
          runtimeCanInterrupt: null,
          contextUsage: null
        });
        return;
      }

      const [historyPage, runtime] = await Promise.all([
        getSessionMessages(controlSession.session.sessionId, null, BUTLER_MESSAGE_PAGE_SIZE, "forward"),
        getSessionRuntime(controlSession.session.sessionId)
      ]);
      const viewMessages = historyPage.messages.map((message) =>
        toViewMessage(controlSession.session.sessionId, message)
      );

      this.patch({
        controlSession,
        messages: viewMessages,
        historyState: "ready",
        runtimeHasActiveRun: runtime.hasActiveRun,
        runtimeCanInterrupt: runtime.canInterrupt,
        contextUsage: runtime.contextUsage
      });
    } catch (error) {
      this.patch({
        historyState: "error",
        error: toErrorMessage(error)
      });
    }
  }

  private async refreshCapabilities(providerId: ButlerProviderId): Promise<void> {
    try {
      const capabilities = await getProviderCapabilities(providerId, this.workspaceId);
      this.patch({
        capabilities
      });
    } catch {
      this.patch({
        capabilities: createButlerFallbackCapabilities(providerId)
      });
    }
  }

  private async refreshOverview(): Promise<void> {
    try {
      const response = await getButlerOverview();
      this.patch({
        overview: response.overview
      });
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
    }
  }

  private async refreshEvents(): Promise<void> {
    try {
      const response = await listButlerControlEvents();
      this.patch({
        events: response.items
      });
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
    }
  }

  private patch(partial: Partial<ButlerRuntimeState>): void {
    this.state = {
      ...this.state,
      ...partial
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function useButlerRuntimeStore<T>(
  store: ButlerRuntimeStore,
  selector: (state: ButlerRuntimeState) => T
): T {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    setValue(selector(store.getState()));
    return store.subscribe(() => {
      setValue(selector(store.getState()));
    });
  }, [selector, store]);

  return value;
}

function createButlerFallbackCapabilities(provider: ButlerProviderId): ProviderCapabilitiesDto {
  const modelOptions: ProviderModelOptionDto[] = [
    {
      id: "provider-default",
      name: t("conversation.modelUseCliDefault"),
      usesProviderDefault: true
    }
  ];

  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: provider === "claude-code" ? "streaming_guidance" : "none",
    supportsSubagents: false,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsQueueWhileRunning: false,
    supportsRunSteering: false,
    supportsSlashMenu: false,
    supportsReasoningSelector: true,
    modelOptions,
    defaultReasoningLevel: null,
    limitations: []
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
