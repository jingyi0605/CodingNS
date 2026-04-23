import { describe, expect, it } from "vitest";

import {
  getFixedRelayControlBaseUrl,
  inferRelayAccessConfig,
  resolveRelayControlBaseUrl
} from "./relay-control-site-config";

describe("relay-control-site-config", () => {
  it("会从公共访问地址反推出控制站地址并保留端口", () => {
    expect(inferRelayAccessConfig("https://test004.channel.jacksonz.cn:14443")).toEqual({
      tunnelDomain: "test004.channel.jacksonz.cn",
      controlBaseUrl: "https://channel.jacksonz.cn:14443",
      relayBaseUrl: "https://test004.channel.jacksonz.cn:14443"
    });
  });

  it("控制站地址本身不应再被识别成公共访问地址", () => {
    expect(inferRelayAccessConfig("https://channel.jacksonz.cn:14443")).toBeNull();
  });

  it("普通远端 Host 地址不应误判成 CodingNS Connect 入口", () => {
    expect(inferRelayAccessConfig("https://api.example.com:3002")).toBeNull();
  });

  it("正式客户端传入已保存的控制站地址时，也会优先使用该地址", () => {
    expect(resolveRelayControlBaseUrl("https://channel.jacksonz.cn:14443")).toBe(
      "https://channel.jacksonz.cn:14443"
    );
  });

  it("控制站地址为空时，会回退到官方固定地址", () => {
    expect(resolveRelayControlBaseUrl(undefined)).toBe(getFixedRelayControlBaseUrl());
  });
});
