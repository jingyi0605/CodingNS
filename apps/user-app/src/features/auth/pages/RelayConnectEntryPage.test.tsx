import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { I18nProvider } from "../../../shared/i18n";
import { RelayConnectEntryPage } from "./RelayConnectEntryPage";

describe("RelayConnectEntryPage", () => {
  beforeEach(() => {
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

  it("会把当前活动 Host 切到 relay 入口并跳回登录页", async () => {
    render(
      <I18nProvider language="zh-CN">
        <MemoryRouter
          initialEntries={[
            "/connect/demo.channel.codingns.com?controlBaseUrl=https%3A%2F%2Fchannel.codingns.com&bindingId=binding_demo&hostFingerprint=SHA256%3Ademo"
          ]}
        >
          <Routes>
            <Route path="/connect/:tunnelDomain" element={<RelayConnectEntryPage />} />
            <Route path="/login" element={<div>login-page</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    );

    expect(await screen.findByText("login-page")).toBeInTheDocument();
    expect(clientConfigStore.getState().activeHostId).toBe("relay-entry:binding_demo");
    expect(clientConfigStore.getState().hosts[0]).toMatchObject({
      baseUrl: "https://demo.channel.codingns.com",
      relayTunnel: {
        tunnelDomain: "demo.channel.codingns.com",
        controlBaseUrl: "https://channel.codingns.com",
        bindingId: "binding_demo",
        hostFingerprint: "SHA256:demo"
      }
    });
  });

  it("会把控制站端口带到四级域名入口地址里", async () => {
    render(
      <I18nProvider language="zh-CN">
        <MemoryRouter
          initialEntries={[
            "/connect/demo.channel.codingns.com?controlBaseUrl=https%3A%2F%2Fchannel.codingns.com%3A1443&bindingId=binding_demo&hostFingerprint=SHA256%3Ademo"
          ]}
        >
          <Routes>
            <Route path="/connect/:tunnelDomain" element={<RelayConnectEntryPage />} />
            <Route path="/login" element={<div>login-page</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    );

    expect(await screen.findByText("login-page")).toBeInTheDocument();
    expect(clientConfigStore.getState().hosts[0]).toMatchObject({
      baseUrl: "https://demo.channel.codingns.com:1443",
      relayTunnel: {
        controlBaseUrl: "https://channel.codingns.com:1443"
      }
    });
  });
});
