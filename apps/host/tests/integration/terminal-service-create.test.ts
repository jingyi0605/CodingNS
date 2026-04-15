import { describe, expect, it, vi } from "vitest";

import { TerminalService } from "../../src/modules/terminal/terminal-service.js";
import type { TerminalInstance } from "../../src/types/domain.js";

describe("TerminalService.createTerminal", () => {
  it("同目录创建多个默认终端时会自动追加递增序号", async () => {
    const createdTerminals: TerminalInstance[] = [];
    const runtimeSessionCreates: Array<{ id: string; terminalId: string }> = [];
    const terminalRepository = {
      listByWorkspace: vi.fn(() => createdTerminals),
      create: vi.fn((terminal: TerminalInstance) => {
        createdTerminals.push(terminal);
        return terminal;
      }),
      updateLifecycle: vi.fn((input: Partial<TerminalInstance> & { id: string }) => {
        const index = createdTerminals.findIndex((terminal) => terminal.id === input.id);

        if (index === -1) {
          return;
        }

        createdTerminals[index] = {
          ...createdTerminals[index],
          ...input
        };
      }),
      findById: vi.fn((id: string) => createdTerminals.find((terminal) => terminal.id === id) ?? null),
      listRecoverable: vi.fn(() => [])
    };
    const runtimeRepository = {
      create: vi.fn((session: { id: string; terminalId: string }) => {
        runtimeSessionCreates.push(session);
        return session;
      }),
      updateState: vi.fn(),
      findById: vi.fn(() => null),
      deleteByTerminalId: vi.fn()
    };
    const workspaceService = {
      getWorkspaceOrThrow: vi.fn(() => ({
        id: "workspace-1",
        path: "/Users/jackson/Code/CodingNS"
      }))
    };
    const service = new TerminalService(
      {
        transaction: (callback: () => void) => callback
      } as never,
      terminalRepository as never,
      runtimeRepository as never,
      workspaceService as never,
      900
    );

    (service as any).runtimeManager = {
      createPersistentSession: vi.fn(async () => ({
        agentPid: 1001,
        shellPid: 2001,
        detail: null
      })),
      ensureAttached: vi.fn(async () => 2001)
    };

    const firstTerminal = await service.createTerminal({
      workspaceId: "workspace-1",
      cwd: "/Users/jackson/Code/CodingNS/apps/user-app",
      createdByUserId: "user-1"
    });
    const secondTerminal = await service.createTerminal({
      workspaceId: "workspace-1",
      cwd: "/Users/jackson/Code/CodingNS/apps/user-app",
      createdByUserId: "user-1"
    });

    expect(firstTerminal.name).toBe("user-app 1");
    expect(secondTerminal.name).toBe("user-app 2");
    expect(runtimeSessionCreates).toHaveLength(2);
  });
});
