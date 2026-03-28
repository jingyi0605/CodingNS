import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { PlatformProvider } from "../../../platform/platform-provider";
import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { BootstrapPage } from "./BootstrapPage";

describe("BootstrapPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
  });

  it("初始化页不再默认填充密码", () => {
    render(
      <PlatformProvider>
        <I18nProvider language="zh-CN">
          <ThemeProvider>
            <MemoryRouter initialEntries={["/bootstrap"]}>
              <Routes>
                <Route path="/bootstrap" element={<BootstrapPage />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </I18nProvider>
      </PlatformProvider>
    );

    const passwordInputs = screen.getAllByLabelText(t("auth.password")) as HTMLInputElement[];
    const confirmInput = screen.getByLabelText(t("auth.confirmPassword")) as HTMLInputElement;

    expect(passwordInputs[0].value).toBe("");
    expect(confirmInput.value).toBe("");
  });
});
