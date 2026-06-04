import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { t } from "../../../shared/i18n";
import {
  butlerApiMock,
  createState,
  renderWorkbenchWithState,
  useButlerRuntimeStoreMock
} from "./AffairsWorkbenchView.test-support";

describe("AffairsWorkbenchView bootstrap guard", () => {
  it("事务模式未初始化时切到自动化分区也不会被强制打回对话初始化页", async () => {
    butlerApiMock.listAssistantAutomations.mockResolvedValue({ payload: { items: [] } });
    butlerApiMock.listRecentAssistantAutomationRuns.mockResolvedValue({ payload: { items: [] } });
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));
    renderWorkbenchWithState({
      ...createState(),
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    });

    expect(await screen.findByRole("tab", { name: t("shell.affairsWorkbenchNav") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(t("shell.affairsWorkbenchCanvasTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("shell.affairsWorkbenchDefaultTabShortTitle"))).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("shell.affairsLibraryNav") })).not.toBeDisabled();
    expect(screen.getByRole("tab", { name: t("shell.affairsWorkbenchNav") })).not.toBeDisabled();
  });

  it("事务模式未初始化时刷新到文档页会直接显示文档内容", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));

    renderWorkbenchWithState(createState());

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务连不上时文档主区也不会被不可用页接管", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      bootstrapErrorCode: "NETWORK_ERROR",
      error: "请求 http://127.0.0.1:4174/api/butler/profile 失败：fetch failed",
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));

    renderWorkbenchWithState(createState());

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务返回无效响应时文档主区也不会被不可用页接管", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: false,
      bootstrapErrorCode: "INVALID_RESPONSE",
      error: "服务返回了无效的 JSON 响应：Unexpected token '<'",
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));

    renderWorkbenchWithState(createState());

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsHostUnavailableTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("事务服务连接检查中时文档主区仍然直接显示文档内容", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: true,
      bootstrapErrorCode: null,
      error: null,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));

    renderWorkbenchWithState(createState());

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsInitRouteGuardHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("shell.affairsInitSubmit") })).not.toBeInTheDocument();
  });

  it("文档库视图正常显示时，右侧辅助面板不会再显示事务连接检查占位", async () => {
    useButlerRuntimeStoreMock.mockImplementation((_store, selector) => selector({
      initialized: false,
      loading: true,
      bootstrapErrorCode: null,
      error: null,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      hasOlderMessages: false,
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false,
      contextUsage: null,
      permissionRequests: [],
      sending: false
    }));

    renderWorkbenchWithState({
      ...createState(),
      primarySection: "library",
      auxiliaryTab: "detail",
      selectedNodeId: "library:folder:root"
    });

    expect(await screen.findByText("Exchange 分层通讯簿.txt")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingAuxiliaryEmpty"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.affairsConnectionCheckingDescription"))).not.toBeInTheDocument();
  });
});
