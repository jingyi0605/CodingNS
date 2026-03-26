import { describe, expect, it } from "vitest";

import type { TerminalDto } from "../api/terminal-api";
import { pickActiveTerminalAfterReload } from "./terminal-active-selection";

describe("pickActiveTerminalAfterReload", () => {
  it("优先恢复明确指定且仍在运行的终端", () => {
    const terminals = [buildTerminal("terminal-1", "closed"), buildTerminal("terminal-2", "running")];

    expect(
      pickActiveTerminalAfterReload({
        terminals,
        preferredTerminalId: "terminal-2",
        currentActiveTerminalId: "terminal-1",
        persistedTerminalId: "terminal-1"
      })?.id
    ).toBe("terminal-2");
  });

  it("持久化终端已关闭时，会自动回退到仍可写的 running 终端", () => {
    const terminals = [buildTerminal("terminal-1", "closed"), buildTerminal("terminal-2", "running")];

    expect(
      pickActiveTerminalAfterReload({
        terminals,
        persistedTerminalId: "terminal-1"
      })?.id
    ).toBe("terminal-2");
  });

  it("没有 running 终端时，仍会保留原来的持久化选择", () => {
    const terminals = [buildTerminal("terminal-1", "closed"), buildTerminal("terminal-2", "error")];

    expect(
      pickActiveTerminalAfterReload({
        terminals,
        persistedTerminalId: "terminal-1"
      })?.id
    ).toBe("terminal-1");
  });
});

function buildTerminal(
  id: string,
  status: TerminalDto["status"],
  overrides: Partial<TerminalDto> = {}
): TerminalDto {
  return {
    id,
    workspaceId: "workspace-1",
    name: id,
    cwd: "/tmp",
    shell: "/bin/zsh",
    status,
    createdByUserId: "user-1",
    createdAt: "2026-03-26T09:00:00.000Z",
    lastActiveAt: "2026-03-26T09:00:00.000Z",
    closedAt: status === "running" ? null : "2026-03-26T09:00:05.000Z",
    exitCode: null,
    statusDetail: null,
    ...overrides
  };
}
