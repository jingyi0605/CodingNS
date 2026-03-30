import { EventEmitter } from "node:events";

import type { TerminalInstance, TerminalRuntimeSession } from "../../../types/domain.js";
import { ConptyRuntimeAdapter } from "./adapters/conpty-runtime-adapter.js";
import { EmbeddedPtyRuntimeAdapter } from "./adapters/embedded-pty-runtime-adapter.js";
import { TmuxRuntimeAdapter } from "./adapters/tmux-runtime-adapter.js";
import { buildConptyPipeName, isConptyRuntimeType } from "./conpty-runtime-shared.js";
import { PtyBrokerClient } from "./pty-broker-client.js";
import { buildPtyBrokerEndpoint } from "./pty-broker-shared.js";
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

interface BrokerAttachmentRecord {
  client: PtyBrokerClient;
  processId: number | null;
  agentPid: number | null;
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
    ["tmux", new TmuxRuntimeAdapter()],
    ["conpty-powershell", new ConptyRuntimeAdapter("conpty-powershell")],
    ["conpty-cmd", new ConptyRuntimeAdapter("conpty-cmd")],
    ["conpty-git-bash", new ConptyRuntimeAdapter("conpty-git-bash")]
  ]);
  private readonly attachments = new Map<string, AttachmentRecord>();
  private readonly brokerAttachments = new Map<string, BrokerAttachmentRecord>();
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
    if (this.isAttached(terminal.id)) {
      return {
        alive: true,
        shellPid: this.getAttachedProcessId(terminal.id),
        agentPid: this.getAttachedAgentPid(terminal.id),
        detail: null
      };
    }

    const adapter = this.getAdapter(session);
    return adapter.inspectPersistentSession({
      terminal,
      session
    });
  }

  async ensureAttached(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    env: Record<string, string>
  ): Promise<number | null> {
    if (this.isAttached(terminal.id)) {
      return this.getAttachedProcessId(terminal.id);
    }

    const adapter = this.getAdapter(session);

    if (session.runtimeType === "embedded-pty" || isConptyRuntimeType(session.runtimeType)) {
      const endpoint = session.runtimeType === "embedded-pty"
        ? buildPtyBrokerEndpoint(session.sessionKey)
        : buildConptyPipeName(session.sessionKey);
      const brokerClient = await PtyBrokerClient.connect(
        endpoint
      );

      brokerClient.on("output", (content) => {
        this.emit("output", {
          terminalId: terminal.id,
          content
        });
      });
      brokerClient.on("exit", (event) => {
        this.brokerAttachments.delete(terminal.id);
        this.handleAttachmentExit({
          attachmentId: terminal.id,
          exitCode: event.exitCode,
          requestedClose: event.requestedClose
        });
      });

      this.attachments.set(terminal.id, {
        terminal,
        session,
        adapter
      });
      this.brokerAttachments.set(terminal.id, {
        client: brokerClient,
        processId: brokerClient.getProcessId(),
        agentPid: brokerClient.getAgentPid()
      });
      return brokerClient.getProcessId();
    }

    return this.ensureLegacyAttached(terminal, session, env, adapter);
  }

  ensureLegacyAttached(
    terminal: TerminalInstance,
    session: TerminalRuntimeSession,
    env: Record<string, string>,
    adapter = this.getAdapter(session)
  ): number | null {
    if (this.isAttached(terminal.id)) {
      return this.getAttachedProcessId(terminal.id);
    }

    if (session.runtimeType === "embedded-pty") {
      throw new Error("embedded-pty 运行时必须通过 broker 异步附着");
    }

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
    const brokerAttachment = this.brokerAttachments.get(terminalId);

    if (brokerAttachment) {
      brokerAttachment.client.write(content);
      return;
    }

    this.attachmentManager.write(terminalId, content);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const brokerAttachment = this.brokerAttachments.get(terminalId);

    if (brokerAttachment) {
      brokerAttachment.client.resize(cols, rows);
      return;
    }

    this.attachmentManager.resize(terminalId, cols, rows);
  }

  detach(terminalId: string): void {
    if (!this.isAttached(terminalId)) {
      return;
    }

    this.closeIntents.set(terminalId, "detach");

    const brokerAttachment = this.brokerAttachments.get(terminalId);

    if (brokerAttachment) {
      brokerAttachment.client.close();
      return;
    }

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
      const brokerAttachment = this.brokerAttachments.get(terminal.id);

      if (brokerAttachment) {
        brokerAttachment.client.terminate();
        return hadAttachment;
      }

      this.attachmentManager.close(terminal.id);
    }

    return hadAttachment;
  }

  isAttached(terminalId: string): boolean {
    return this.attachmentManager.isRunning(terminalId) || this.brokerAttachments.has(terminalId);
  }

  getProcessId(terminalId: string): number | null {
    return this.getAttachedProcessId(terminalId);
  }

  closeAllAttachments(): void {
    for (const terminalId of this.attachments.keys()) {
      this.closeIntents.set(terminalId, "detach");
    }

    for (const brokerAttachment of this.brokerAttachments.values()) {
      brokerAttachment.client.close();
    }

    this.attachmentManager.closeAll();
  }

  private handleAttachmentExit(event: HostAttachmentExitEvent): void {
    const attachment = this.attachments.get(event.attachmentId);
    const intent = this.closeIntents.get(event.attachmentId) ?? null;

    this.attachments.delete(event.attachmentId);
    this.brokerAttachments.delete(event.attachmentId);
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

  private getAttachedProcessId(terminalId: string): number | null {
    return this.brokerAttachments.get(terminalId)?.processId
      ?? this.attachmentManager.getProcessId(terminalId);
  }

  private getAttachedAgentPid(terminalId: string): number | null {
    return this.brokerAttachments.get(terminalId)?.agentPid ?? null;
  }

  private getAdapter(session: TerminalRuntimeSession): TerminalRuntimeAdapter {
    const adapter = this.adapters.get(session.runtimeType);

    if (!adapter) {
      throw new Error(`Missing terminal runtime adapter: ${session.runtimeType}`);
    }

    return adapter;
  }
}
