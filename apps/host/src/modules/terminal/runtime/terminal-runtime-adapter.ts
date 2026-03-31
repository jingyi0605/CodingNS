import type {
  TerminalInstance,
  TerminalRuntimeSession,
  TerminalRuntimeType
} from "../../../types/domain.js";

export interface PersistentSessionInspection {
  alive: boolean;
  shellPid: number | null;
  agentPid?: number | null;
  detail: string | null;
}

export interface HostAttachmentLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  closeStrategy?: "pty-kill" | "process-kill";
}

export interface TerminalRuntimeAdapter {
  readonly type: TerminalRuntimeType;
  readonly survivesHostRestart: boolean;

  createPersistentSession(input: {
    terminal: TerminalInstance;
    session: TerminalRuntimeSession;
    env: Record<string, string>;
  }): Promise<PersistentSessionInspection>;

  inspectPersistentSession(input: {
    terminal: TerminalInstance;
    session: TerminalRuntimeSession;
  }): Promise<PersistentSessionInspection>;

  buildHostAttachmentLaunch(input: {
    terminal: TerminalInstance;
    session: TerminalRuntimeSession;
    env: Record<string, string>;
  }): HostAttachmentLaunch;

  terminatePersistentSession(input: {
    terminal: TerminalInstance;
    session: TerminalRuntimeSession;
  }): Promise<void>;
}
