import { describe, expect, it, vi } from "vitest";

import { TeableGlobalBindingService } from "../../../src/modules/workspace/teable-global-binding-service.js";
import type { UserTeableGlobalSettingRecord } from "../../../src/types/domain.js";

function createRepository(record: UserTeableGlobalSettingRecord | null = null) {
  let current = record;
  return {
    findByUserId: vi.fn(() => current),
    upsert: vi.fn((next: UserTeableGlobalSettingRecord) => {
      current = next;
      return next;
    })
  };
}

function createCredentialService() {
  return {
    saveToken: vi.fn(),
    loadToken: vi.fn(() => "token-123")
  };
}

describe("TeableGlobalBindingService", () => {
  it("能保存并读取全局 Teable 绑定", () => {
    const repository = createRepository();
    const credentialService = createCredentialService();
    const service = new TeableGlobalBindingService(repository as never, credentialService as never);

    const saved = service.saveGlobalBinding("user-1", {
      baseUrl: "https://teable.example.com/",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/token",
      authToken: "token-123",
      enabled: true,
      mirrorMode: "manual"
    });

    expect(saved).toMatchObject({
      baseUrl: "https://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/token",
      enabled: true,
      mirrorMode: "manual"
    });
    expect(credentialService.saveToken).toHaveBeenCalledWith("user-1", "secret://teable/token", "token-123");
    expect(service.getGlobalBinding("user-1")).toEqual(saved);
  });

  it("未绑定时会返回 unbound 总览", () => {
    const service = new TeableGlobalBindingService(
      createRepository() as never,
      createCredentialService() as never
    );

    expect(service.getOverview("user-1")).toEqual({
      binding: null,
      status: "unbound",
      summary: "当前事务工作台还没有绑定 Teable 实例。",
      updatedAt: null
    });
  });

  it("禁用状态会返回 disabled 总览", () => {
    const service = new TeableGlobalBindingService(createRepository({
      userId: "user-1",
      baseUrl: "https://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/token",
      enabled: false,
      mirrorMode: "scheduled",
      createdAt: "2026-06-05T01:00:00.000Z",
      updatedAt: "2026-06-05T02:00:00.000Z"
    }) as never, createCredentialService() as never);

    expect(service.getOverview("user-1")).toEqual({
      binding: {
        baseUrl: "https://teable.example.com",
        spaceId: "space-1",
        baseId: "base-1",
        authRef: "secret://teable/token",
        enabled: false,
        mirrorMode: "scheduled",
        updatedAt: "2026-06-05T02:00:00.000Z"
      },
      status: "disabled",
      summary: "当前已保存 Teable 配置，但还没有启用同步。",
      updatedAt: "2026-06-05T02:00:00.000Z"
    });
  });

  it("配置不完整时会返回 config_invalid 总览", () => {
    const service = new TeableGlobalBindingService(createRepository({
      userId: "user-1",
      baseUrl: "https://teable.example.com",
      spaceId: null,
      baseId: "base-1",
      authRef: "secret://teable/token",
      enabled: true,
      mirrorMode: "manual",
      createdAt: "2026-06-05T01:00:00.000Z",
      updatedAt: "2026-06-05T02:00:00.000Z"
    } as any) as never, createCredentialService() as never);

    expect(service.getOverview("user-1")).toEqual({
      binding: null,
      status: "config_invalid",
      summary: "当前 Teable 配置不完整，请补齐站点、空间和认证引用。",
      updatedAt: "2026-06-05T02:00:00.000Z"
    });
  });

  it("允许保存 HTTP 站点地址", () => {
    const service = new TeableGlobalBindingService(
      createRepository() as never,
      createCredentialService() as never
    );

    const saved = service.saveGlobalBinding("user-1", {
      baseUrl: "http://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/token",
      enabled: true,
      mirrorMode: "manual"
    });

    expect(saved.baseUrl).toBe("http://teable.example.com");
  });

  it("会拒绝非法协议地址", () => {
    const service = new TeableGlobalBindingService(
      createRepository() as never,
      createCredentialService() as never
    );

    expect(() => service.saveGlobalBinding("user-1", {
      baseUrl: "ftp://teable.example.com",
      spaceId: "space-1",
      baseId: "base-1",
      authRef: "secret://teable/token",
      enabled: true,
      mirrorMode: "manual"
    })).toThrowError(/HTTP 或 HTTPS/);
  });
});
