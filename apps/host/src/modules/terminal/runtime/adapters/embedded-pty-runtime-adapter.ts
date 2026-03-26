import type { TerminalRuntimeAdapter } from "../terminal-runtime-adapter.js";

export class EmbeddedPtyRuntimeAdapter implements TerminalRuntimeAdapter {
  readonly type = "embedded-pty" as const;
  readonly survivesHostRestart = false;

  createPersistentSession() {
    return {
      alive: true,
      shellPid: null,
      detail: null
    };
  }

  inspectPersistentSession() {
    return {
      alive: false,
      shellPid: null,
      detail: "EMBEDDED_RUNTIME_NOT_RECOVERABLE"
    };
  }

  buildHostAttachmentLaunch(input: Parameters<TerminalRuntimeAdapter["buildHostAttachmentLaunch"]>[0]) {
    return {
      command: input.terminal.shell,
      args: [],
      cwd: input.terminal.cwd,
      env: input.env
    };
  }

  terminatePersistentSession(): void {
    // embedded-pty 的真实生命周期跟当前 Host attach 绑定，这里不需要额外动作。
  }
}
