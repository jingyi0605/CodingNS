import { describe, expect, it, vi } from "vitest";

import { TeableCredentialService } from "../../../src/modules/workspace/teable-credential-service.js";
import type { UserTeableCredentialRecord } from "../../../src/types/domain.js";

function createRepository(record: UserTeableCredentialRecord | null = null) {
  let current = record;
  return {
    findByUserIdAndAuthRef: vi.fn(() => current),
    upsert: vi.fn((next: UserTeableCredentialRecord) => {
      current = next;
      return next;
    }),
    delete: vi.fn()
  };
}

describe("TeableCredentialService", () => {
  it("能加密保存并解密读取 token", () => {
    const repository = createRepository();
    const service = new TeableCredentialService(repository as never, "secret-key");

    service.saveToken("user-1", "secret://teable/main", "token-123");
    expect(service.loadToken("user-1", "secret://teable/main")).toBe("token-123");
  });
});
