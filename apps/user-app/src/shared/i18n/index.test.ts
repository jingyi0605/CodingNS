import { afterEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../config/client-config-store";
import type { ClientRuntimeConfig } from "../../config/client-config-types";
import { t } from "./index";

function createConfig(language: ClientRuntimeConfig["language"]): ClientRuntimeConfig {
  return {
    platform: "web",
    hostBaseUrl: "http://127.0.0.1:3002",
    releaseChannel: "stable",
    autoReconnect: true,
    autoCheckUpdate: false,
    language,
    defaultPermissionMode: "default"
  };
}

const initialConfig = clientConfigStore.getState();

afterEach(() => {
  clientConfigStore.hydrate(initialConfig);
});

describe("i18n", () => {
  it("根据当前语言返回设置和登录页文案", () => {
    clientConfigStore.hydrate(createConfig("zh-CN"));
    expect(t("common.language")).toBe("语言");
    expect(t("settings.language")).toBe("语言");

    clientConfigStore.hydrate(createConfig("en-US"));
    expect(t("common.language")).toBe("Language");
    expect(t("settings.language")).toBe("Language");
    expect(t("auth.serverSettings")).toBe("Server Settings");
  });

  it("英文词典缺失时回退到中文，而不是返回 key", () => {
    clientConfigStore.hydrate(createConfig("en-US"));

    expect(t("conversation.headerCapability")).toBe("Capability Summary");
    expect(t("conversation.fileViewerHint")).toBe("Opened in {language} mode. Preview and save after editing are supported.");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });
});
