import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n";
import { ConnectionBanner } from "./ConnectionBanner";

const toastMocks = vi.hoisted(() => ({
  useToast: vi.fn()
}));

const routeMocks = vi.hoisted(() => ({
  useActiveConnectionRouteSummary: vi.fn(),
  resolveActiveConnectionRouteLabelKey: vi.fn()
}));

vi.mock("../../../shared/toast", () => ({
  useToast: toastMocks.useToast
}));

vi.mock("../../../config/active-connection-route", () => ({
  useActiveConnectionRouteSummary: routeMocks.useActiveConnectionRouteSummary,
  resolveActiveConnectionRouteLabelKey: routeMocks.resolveActiveConnectionRouteLabelKey
}));

describe("ConnectionBanner", () => {
  const showToast = vi.fn();
  const dismissToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    toastMocks.useToast.mockReturnValue({
      showToast,
      dismissToast
    });
    routeMocks.useActiveConnectionRouteSummary.mockReturnValue({
      kind: "lan",
      url: "http://192.168.50.8:3002",
      endpointId: "host_reported:http://192.168.50.8:3002",
      autoDirect: true,
      probeInProgress: false
    });
    routeMocks.resolveActiveConnectionRouteLabelKey.mockReturnValue("common.connectionRouteLan");
  });

  it("重连中提示会带上当前链路来源", () => {
    render(
      <I18nProvider language="zh-CN">
        <ConnectionBanner connectionState="reconnecting" onReconnect={() => undefined} />
      </I18nProvider>
    );

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conversation-connection-state",
        title: "Reconnecting",
        description: "The realtime link is broken. The system is replaying missing messages. Current route: LAN Direct.",
        tone: "info"
      })
    );
  });

  it("重连失败提示会带上当前链路来源", () => {
    const onReconnect = vi.fn();

    render(
      <I18nProvider language="zh-CN">
        <ConnectionBanner connectionState="reconnect_failed" onReconnect={onReconnect} />
      </I18nProvider>
    );

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conversation-connection-state",
        title: "Reconnect failed",
        description: "Automatic recovery failed. Retry manually, or reopen the session later. Current route: LAN Direct.",
        tone: "warning",
        action: expect.objectContaining({
          label: "Restore Realtime Sync"
        })
      })
    );
  });
});
