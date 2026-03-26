import { EventEmitter } from "node:events";

import type { TerminalInstance, TerminalRuntimeSession } from "../../../types/domain.js";
import { EmbeddedPtyRuntimeAdapter } from "./adapters/embedded-pty-runtime-adapter.js";
import { TmuxRuntimeAdapter } from "./adapters/tmux-runtime-adapter.js";
import {
  PtyHostAttachmentManager,
  type HostAttachmentExitEvent
} from "./pty-host-attachment-manager.js";
import type {
  PersistentSessionInspection,
  TerminalRuntimeAdapter
} from "./terminal-runtime-adapter.js";

type CloseIntent = "detach" | "terminate";

interface AttachmentRecord {
  terminal: TerminalInstance;
  session: TerminalRuntimeSession;
  adapter: TerminalRuntimeAdapter;
}

export interface RuntimeAttachmentExitEvent {
  terminalId: string;
  exitCode: number | null;
  requestedClose: boolean;
  sessionAlive: boolean;
  sessionDetail: string | null;
  shellPid: number | null;
}

export declare interface TerminalRuntimeManager {
  on(event: "output", listener: (event: { terminalId: string; content: string }) => void): this;
  on(event: "exit", listener: (event: RuntimeAttachmentExitEvent) => void): this;
  emit(event: "output", eventPayload: { terminalId: string; content: string }): boolean;
  emit(event: "exit", eventPayload: RuntimeAttachmentExitEvent): boolean;
}

export class TerminalRuntimeManager extends EventEmitter {
  private readonly attachmentManager = new PtyHostAttachmentManager();
  private readonly adapters = new Map<string, TerminalRuntimeAdapter>([
    ["embedded-pty", new EmbeddedPtyRuntimeAdapter()],
    ["tmux", new TmuxRuntimeAdapter()]
  ]);
  private readonly attachments = new Map<string, AttachmentRecord>();
  private readonly closeIntents = new Map<string, CloseIntent>();

  constructor() {
    super();

    this.attachmentManager.on("output", (event) => {
      this.emit("output", {
        terminalId: event.attachmentId,
        content: event.content
      });
    });
    this.attachmentManager.on("exit", (event) => {
      this.handleAttachmentExit(event);
    });
  }

  createPersistentSession(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    env: Record<string, string>
  ): PersistentSessionInspection {
    return this.getAdapter(session).createPersistentSession({
      terminal,
      session,
      env
    });
  }

  inspectPersistentSession(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession
  ): PersistentSessionInspection {
    const adapter = this.getAdapter(session);

    if (this.isAttached(terminal.id) && !adapter.survivesHostRestart) {
      return {
        alive: true,
        shellPid: this.attachmentManager.getProcessId(terminal.id),
        detail: null
      };
    }

    return adapter.inspectPersistentSession({
      terminal,
      session
    });
  }

  ensureAttached(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    env: Record<string, string>
  ): number | null {
    if (this.isAttached(terminal.id)) {
      return this.attachmentManager.getProcessId(terminal.id);
    }

    const adapter = this.getAdapter(session);
    const launch = adapter.buildHostAttachmentLaunch({
      terminal,
      session,
      env
    });

    const processId = this.attachmentManager.start(terminal.id, launch);
    this.attachments.set(terminal.id, {
      terminal,
      session,
      adapter
    });

    return processId;
  }

  write(terminalId: string, content: string): void {
    this.attachmentManager.write(terminalId, content);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.attachmentManager.resize(terminalId, cols, rows);
  }

  detach(terminalId: string): void {
    if (!this.isAttached(terminalId)) {
      return;
    }

    this.closeIntents.set(terminalId, "detach");
    this.attachmentManager.close(terminalId);
  }

  terminateSession(terminal: TerminalInstance, session: TerminalRuntimeSession): boolean {
    const adapter = this.getAdapter(session);
    const hadAttachment = this.isAttached(terminal.id);

    if (hadAttachment) {
      this.closeIntents.set(terminal.id, "terminate");
    }

    adapter.terminatePersistentSession({
      terminal,
      session
    });

    if (hadAttachment) {
      this.attachmentManager.close(terminal.id);
    }

    return hadAttachment;
  }

  isAttached(terminalId: string): boolean {
    return this.attachmentManager.isRunning(terminalId);
  }

  closeAllAttachments(): void {
    for (const terminalId of this.attachments.keys()) {
      this.closeIntents.set(terminalId, "detach");
    }

    this.attachmentManager.closeAll();
  }

  private handleAttachmentExit(event: HostAttachmentExitEvent): void {
    const attachment = this.attachments.get(event.attachmentId);
    const intent = this.closeIntents.get(event.attachmentId) ?? null;

    this.attachments.delete(event.attachmentId);
    this.closeIntents.delete(event.attachmentId);

    if (!attachment) {
      this.emit("exit", {
        terminalId: event.attachmentId,
        exitCode: event.exitCode,
        requestedClose: event.requestedClose,
        sessionAlive: false,
        sessionDetail: null,
        shellPid: null
      });
      return;
    }

    const inspection = attachment.adapter.inspectPersistentSession({
      terminal: attachment.terminal,
      session: attachment.session
    });

    this.emit("exit", {
      terminalId: event.attachmentId,
      exitCode: event.exitCode,
      requestedClose: intent === "terminate" ? true : false,
      sessionAlive: inspection.alive,
      sessionDetail: inspection.detail,
      shellPid: inspection.shellPid
    });
  }

  private getAdapter(session: TerminalRuntimeSession): TerminalRuntimeAdapter {
    const adapter = this.adapters.get(session.runtimeType);

    if (!adapter) {
      throw new Error(`Missing terminal runtime adapter: ${session.runtimeType}`);
    }

    return adapter;
  }
}
