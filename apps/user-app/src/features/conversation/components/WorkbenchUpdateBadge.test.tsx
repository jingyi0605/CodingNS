import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import type { DesktopReleaseState } from "../../../config/client-config-types";
import { recordDesktopUpdateState, resetDesktopUpdateState } from "../../../platform/desktop/desktop-update-store";
import { I18nProvider, t } from "../../../shared/i18n";
import { WorkbenchUpdateBadge } from "./WorkbenchUpdateBadge";

describe("WorkbenchUpdateBadge", () => {
  beforeEach(() => {
    resetDesktopUpdateState();
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
  });

  it("检测到新版本后显示入口，并点击跳到更新设置", async () => {
    const onOpenSoftwareUpdate = vi.fn();
    recordDesktopUpdateState(createDesktopReleaseState());

    render(
      <I18nProvider language="zh-CN">
        <WorkbenchUpdateBadge onOpenSoftwareUpdate={onOpenSoftwareUpdate} />
      </I18nProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: t("settings.releaseUpdateBadge") }));

    expect(onOpenSoftwareUpdate).toHaveBeenCalledTimes(1);
  });

  it("没有新版本时不显示入口", () => {
    recordDesktopUpdateState(createDesktopReleaseState({ hasUpdate: false, manifest: null }));

    render(
      <I18nProvider language="zh-CN">
        <WorkbenchUpdateBadge onOpenSoftwareUpdate={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.queryByRole("button", { name: t("settings.releaseUpdateBadge") })).not.toBeInTheDocument();
  });
});

function createDesktopReleaseState(
  overrides: Partial<DesktopReleaseState> = {}
): DesktopReleaseState {
  return {
    checkedAt: "2026-04-16T08:00:00.000Z",
    currentVersion: "0.3.6",
    hasUpdate: true,
    manifest: {
      channel: "stable",
      platform: "macos-universal",
      version: "0.3.7",
      tagName: "v0.3.7",
      title: "v0.3.7",
      notes: "",
      packageUrl: null,
      signature: null,
      htmlUrl: "https://example.com/releases/v0.3.7",
      publishedAt: "2026-04-16T07:00:00.000Z"
    },
    runtimeInfo: {
      version: "0.3.6",
      appDataDir: null
    },
    ...overrides
  };
}
