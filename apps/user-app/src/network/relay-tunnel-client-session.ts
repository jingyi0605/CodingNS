import {
  createRelayTunnelClientHandshake,
  decryptRelayTunnelFrame,
  encryptRelayTunnelFrame,
  finalizeRelayTunnelClientHandshake,
  type RelayTunnelClientHello,
  type RelayTunnelEncryptedFrame,
  type RelayTunnelServerHello,
  type RelayTunnelSession
} from "./relay-tunnel-protocol";
import {
  deserializeRelayTunnelPacket,
  serializeRelayTunnelPacket,
  type RelayTunnelGatewayPacket
} from "./relay-tunnel-packets";

export interface RelayTunnelRawChannel {
  send(payload: string): void | Promise<void>;
  subscribe(listener: (payload: string) => void): () => void;
  close(code?: number, reason?: string): void;
}

export interface RelayTunnelPacketSession {
  send(packet: RelayTunnelGatewayPacket): void;
  subscribe(listener: (packet: RelayTunnelGatewayPacket) => void): () => void;
}

interface RelayTunnelClientHelloEnvelope {
  type: "client_hello";
  hello: RelayTunnelClientHello;
}

interface RelayTunnelServerHelloEnvelope {
  type: "server_hello";
  hello: RelayTunnelServerHello;
}

interface RelayTunnelEncryptedFrameEnvelope {
  type: "encrypted_frame";
  frame: RelayTunnelEncryptedFrame;
}

interface RelayTunnelErrorEnvelope {
  type: "error";
  errorCode: string;
  detail: string;
}

type RelayTunnelControlEnvelope =
  | RelayTunnelClientHelloEnvelope
  | RelayTunnelServerHelloEnvelope
  | RelayTunnelEncryptedFrameEnvelope
  | RelayTunnelErrorEnvelope;

export class RelayTunnelClientSession implements RelayTunnelPacketSession {
  private readonly listeners = new Set<(packet: RelayTunnelGatewayPacket) => void>();
  private readonly unsubscribeFromChannel: () => void;
  private connectPromise: Promise<void> | null = null;
  private readonly textEncoder = new TextEncoder();
  private handshakeState:
    | {
        status: "idle";
      }
    | {
        status: "waiting_server_hello";
        pendingHandshake: Awaited<ReturnType<typeof createRelayTunnelClientHandshake>>["pendingHandshake"];
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | {
        status: "ready";
        session: RelayTunnelSession;
      }
    | {
        status: "failed";
        error: Error;
      } = {
        status: "idle"
      };

  constructor(
    private readonly channel: RelayTunnelRawChannel,
    private readonly options: {
      expectedHostPublicKey: string;
      expectedHostFingerprint: string;
      onWireBytes?: (direction: "upstream" | "downstream", bytes: number) => void;
    }
  ) {
    this.unsubscribeFromChannel = channel.subscribe((payload) => {
      void this.handleIncomingPayload(payload);
    });
  }

  async connect(): Promise<void> {
    if (this.handshakeState.status === "ready") {
      return;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    if (this.handshakeState.status === "failed") {
      throw this.handshakeState.error;
    }

    const { pendingHandshake, clientHello } = await createRelayTunnelClientHandshake({
      expectedHostPublicKey: this.options.expectedHostPublicKey,
      expectedHostFingerprint: this.options.expectedHostFingerprint
    });

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.handshakeState = {
        status: "waiting_server_hello",
        pendingHandshake,
        resolve,
        reject
      };
      void this.sendControlPayload(
        JSON.stringify({
          type: "client_hello",
          hello: clientHello
        } satisfies RelayTunnelClientHelloEnvelope)
      );
    });

    return await this.connectPromise;
  }

  send(packet: RelayTunnelGatewayPacket): void {
    const state = this.requireReadySession();

    void encryptRelayTunnelFrame(state.session, serializeRelayTunnelPacket(packet)).then((frame) => {
      return this.sendControlPayload(
        JSON.stringify({
          type: "encrypted_frame",
          frame
        } satisfies RelayTunnelEncryptedFrameEnvelope)
      );
    }).catch((error) => {
      this.failSession(toError(error));
    });
  }

  subscribe(listener: (packet: RelayTunnelGatewayPacket) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(code?: number, reason?: string): void {
    this.unsubscribeFromChannel();
    this.channel.close(code, reason);
  }

  private async handleIncomingPayload(payload: string): Promise<void> {
    this.recordWireBytes("downstream", payload);
    const envelope = JSON.parse(payload) as RelayTunnelControlEnvelope;

    if (envelope.type === "server_hello") {
      await this.handleServerHello(envelope);
      return;
    }

    if (envelope.type === "encrypted_frame") {
      await this.handleEncryptedFrame(envelope);
      return;
    }

    if (envelope.type === "error") {
      this.failSession(new Error(`${envelope.errorCode}: ${envelope.detail}`));
    }
  }

  private async handleServerHello(envelope: RelayTunnelServerHelloEnvelope): Promise<void> {
    if (this.handshakeState.status !== "waiting_server_hello") {
      return;
    }

    try {
      const session = await finalizeRelayTunnelClientHandshake({
        pendingHandshake: this.handshakeState.pendingHandshake,
        serverHello: envelope.hello
      });
      const resolve = this.handshakeState.resolve;

      this.handshakeState = {
        status: "ready",
        session
      };
      this.connectPromise = null;
      resolve();
    } catch (error) {
      this.failSession(toError(error));
    }
  }

  private async handleEncryptedFrame(envelope: RelayTunnelEncryptedFrameEnvelope): Promise<void> {
    const state = this.requireReadySession();

    try {
      const plaintext = await decryptRelayTunnelFrame(state.session, envelope.frame);
      const packet = deserializeRelayTunnelPacket(new TextDecoder().decode(plaintext));

      for (const listener of this.listeners) {
        listener(packet);
      }
    } catch (error) {
      this.failSession(toError(error));
    }
  }

  private requireReadySession(): Extract<typeof this.handshakeState, { status: "ready" }> {
    if (this.handshakeState.status !== "ready") {
      throw new Error("当前公共隧道会话尚未建立完成");
    }

    return this.handshakeState;
  }

  private failSession(error: Error): void {
    if (this.handshakeState.status === "waiting_server_hello") {
      const reject = this.handshakeState.reject;

      this.handshakeState = {
        status: "failed",
        error
      };
      this.connectPromise = null;
      reject(error);
      return;
    }

    this.handshakeState = {
      status: "failed",
      error
    };
    this.connectPromise = null;
  }

  private sendControlPayload(payload: string): void | Promise<void> {
    this.recordWireBytes("upstream", payload);
    return this.channel.send(payload);
  }

  private recordWireBytes(direction: "upstream" | "downstream", payload: string): void {
    this.options.onWireBytes?.(direction, this.textEncoder.encode(payload).byteLength);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
