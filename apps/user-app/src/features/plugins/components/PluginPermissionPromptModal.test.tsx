import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { PlatformProvider } from "../../../platform/platform-provider";
import { PluginPermissionPromptModal, type PluginPermissionRequestState } from "./PluginPermissionPromptModal";

function renderModal(request: PluginPermissionRequestState, onApprove = vi.fn(), onClose = vi.fn()) {
  return {
    onApprove,
    onClose,
    ...render(
      <PlatformProvider>
        <I18nProvider language="zh-CN">
          <ThemeProvider>
            <PluginPermissionPromptModal
              open
              request={request}
              submitting={false}
              onClose={onClose}
              onApprove={onApprove}
            />
          </ThemeProvider>
        </I18nProvider>
      </PlatformProvider>
    )
  };
}

describe("PluginPermissionPromptModal", () => {
  it("文件权限会显示一次、本次会话和目录长期授权选项", async () => {
    const onApprove = vi.fn();
    renderModal({
      pluginId: "demo.plugin",
      pluginName: "演示插件",
      runtimeSessionId: "runtime-1",
      permissionKey: "workspace.write_file",
      scopeType: "file",
      scopePath: "reports/output.txt",
      grantOptions: ["once", "session", "persistent"]
    }, onApprove);

    expect(screen.getByText(t("plugins.permissionPromptSummaryTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionNameWriteFile"))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionScopeFile", {
      scopePath: "reports/output.txt"
    }))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionPromptOptionOnce"))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionPromptOptionSession"))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionPromptOptionDirectory"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("plugins.permissionPromptOptionDirectory")) }));

    expect(onApprove).toHaveBeenCalledWith({
      scopeType: "directory",
      scopePath: "reports",
      grantMode: "persistent"
    });
  });

  it("工作区级权限不会给目录长期授权选项，并支持拒绝", async () => {
    const onClose = vi.fn();
    renderModal({
      pluginId: "demo.plugin",
      pluginName: "演示插件",
      runtimeSessionId: "runtime-1",
      permissionKey: "workspace.list_dir",
      scopeType: "workspace",
      scopePath: null,
      grantOptions: ["once", "session", "persistent"]
    }, vi.fn(), onClose);

    expect(screen.getByText(t("plugins.permissionScopeWorkspace"))).toBeInTheDocument();
    expect(screen.queryByText(t("plugins.permissionPromptOptionDirectory"))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("plugins.permissionPromptDenyAction") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("没有可用授权方式时显示空态", () => {
    renderModal({
      pluginId: "demo.plugin",
      pluginName: "演示插件",
      runtimeSessionId: "runtime-1",
      permissionKey: "desktop.open_file",
      scopeType: "file",
      scopePath: "report.txt",
      grantOptions: []
    });

    expect(screen.getByText(t("plugins.permissionPromptNoOptionTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("plugins.permissionPromptNoOptionDescription"))).toBeInTheDocument();
  });
});
