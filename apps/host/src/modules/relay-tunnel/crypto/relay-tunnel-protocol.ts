import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  type KeyObject
} from "node:crypto";

import type { InstanceRelayTunnelIdentity } from "../../../types/domain.js";
import { buildRelayTunnelPublicKeyFingerprint } from "./relay-tunnel-identity-service.js";

export const RELAY_TUNNEL_PROTOCOL_VERSION = 1;
export const RELAY_TUNNEL_CIPHER_SUITE = "x25519-hkdf-sha256-aes-256-gcm" as const;

const RELAY_TUNNEL_KEY_ALGORITHM = "x25519";
const RELAY_TUNNEL_FRAME_ALGORITHM = "aes-256-gcm";
const RELAY_TUNNEL_FRAME_IV_LENGTH = 12;
const RELAY_TUNNEL_FRAME_KEY_LENGTH = 32;

export type RelayTunnelCipherSuite = typeof RELAY_TUNNEL_CIPHER_SUITE;
export type RelayTunnelEndpointRole = "client" | "host";
export type RelayTunnelFrameDirection = "client_to_host" | "host_to_client";

export interface RelayTunnelClientHello {
  version: number;
  cipherSuite: RelayTunnelCipherSuite;
  clientEphemeralPublicKey: string;
  clientNonce: string;
  expectedHostFingerprint: string;
}

export interface RelayTunnelServerHello {
  version: number;
  cipherSuite: RelayTunnelCipherSuite;
  sessionId: string;
  hostPublicKey: string;
  hostKeyFingerprint: string;
  serverEphemeralPublicKey: string;
  serverNonce: string;
  proof: string;
}

export interface RelayTunnelEncryptedFrame {
  version: number;
  cipherSuite: RelayTunnelCipherSuite;
  sessionId: string;
  direction: RelayTunnelFrameDirection;
  sequence: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface RelayTunnelPendingClientHandshake {
  readonly expectedHostPublicKey: string;
  readonly expectedHostFingerprint: string;
  readonly clientEphemeralPrivateKey: KeyObject;
  readonly clientHello: RelayTunnelClientHello;
}

export interface RelayTunnelSession {
  readonly sessionId: string;
  readonly role: RelayTunnelEndpointRole;
  readonly cipherSuite: RelayTunnelCipherSuite;
  readonly peerHostFingerprint: string;
  sendSequence: number;
  receiveSequence: number;
  readonly sendKey: Buffer;
  readonly receiveKey: Buffer;
}

export class RelayTunnelProtocolError extends Error {
  constructor(
    readonly code:
      | "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED"
      | "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH"
      | "RELAY_TUNNEL_HOST_PUBLIC_KEY_MISMATCH"
      | "RELAY_TUNNEL_HANDSHAKE_PROOF_INVALID"
      | "RELAY_TUNNEL_FRAME_SESSION_MISMATCH"
      | "RELAY_TUNNEL_FRAME_DIRECTION_MISMATCH"
      | "RELAY_TUNNEL_FRAME_SEQUENCE_MISMATCH"
      | "RELAY_TUNNEL_FRAME_AUTH_INVALID",
    message: string
  ) {
    super(message);
    this.name = "RelayTunnelProtocolError";
  }
}

export function createRelayTunnelClientHandshake(input: {
  expectedHostPublicKey: string;
  expectedHostFingerprint: string;
}): {
  pendingHandshake: RelayTunnelPendingClientHandshake;
  clientHello: RelayTunnelClientHello;
} {
  const expectedHostFingerprint = normalizeRequiredText(
    input.expectedHostFingerprint,
    "expectedHostFingerprint"
  );
  const expectedHostPublicKey = normalizeRequiredText(
    input.expectedHostPublicKey,
    "expectedHostPublicKey"
  );
  const actualFingerprint = buildRelayTunnelPublicKeyFingerprint(expectedHostPublicKey);

  if (actualFingerprint !== expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "客户端持有的 Host 公钥和指纹不一致"
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync(RELAY_TUNNEL_KEY_ALGORITHM);
  const clientHello: RelayTunnelClientHello = {
    version: RELAY_TUNNEL_PROTOCOL_VERSION,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    clientEphemeralPublicKey: exportPublicKeyAsSpkiBase64Url(publicKey),
    clientNonce: randomBytes(16).toString("base64url"),
    expectedHostFingerprint
  };

  return {
    pendingHandshake: {
      expectedHostPublicKey,
      expectedHostFingerprint,
      clientEphemeralPrivateKey: privateKey,
      clientHello
    },
    clientHello
  };
}

export function acceptRelayTunnelClientHandshake(input: {
  hostIdentity: InstanceRelayTunnelIdentity;
  clientHello: RelayTunnelClientHello;
}): {
  serverHello: RelayTunnelServerHello;
  session: RelayTunnelSession;
} {
  validateHandshakeEnvelope(input.clientHello);

  if (input.clientHello.expectedHostFingerprint !== input.hostIdentity.keyFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "客户端请求的 Host 指纹和当前 Host 身份不匹配"
    );
  }

  const clientEphemeralPublicKey = importPublicKeyFromSpkiBase64Url(
    input.clientHello.clientEphemeralPublicKey
  );
  const hostStaticPrivateKey = createPrivateKey(input.hostIdentity.privateKeyPem);
  const { privateKey: serverEphemeralPrivateKey, publicKey: serverEphemeralPublicKey } =
    generateKeyPairSync(RELAY_TUNNEL_KEY_ALGORITHM);
  const serverHello: RelayTunnelServerHello = {
    version: RELAY_TUNNEL_PROTOCOL_VERSION,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    sessionId: randomUUID(),
    hostPublicKey: input.hostIdentity.publicKeyPem,
    hostKeyFingerprint: input.hostIdentity.keyFingerprint,
    serverEphemeralPublicKey: exportPublicKeyAsSpkiBase64Url(serverEphemeralPublicKey),
    serverNonce: randomBytes(16).toString("base64url"),
    proof: ""
  };
  const transcriptHash = buildHandshakeTranscriptHash(input.clientHello, serverHello);
  const ikm = deriveHandshakeInputKeyMaterial({
    clientEphemeralPublicKey,
    clientEphemeralPrivateKey: null,
    hostStaticPrivateKey,
    hostStaticPublicKey: null,
    serverEphemeralPrivateKey,
    serverEphemeralPublicKey: null
  });

  serverHello.proof = createHandshakeProof(ikm, transcriptHash);

  return {
    serverHello,
    session: createRelayTunnelSession({
      sessionId: serverHello.sessionId,
      role: "host",
      peerHostFingerprint: input.hostIdentity.keyFingerprint,
      ikm,
      transcriptHash
    })
  };
}

export function finalizeRelayTunnelClientHandshake(input: {
  pendingHandshake: RelayTunnelPendingClientHandshake;
  serverHello: RelayTunnelServerHello;
}): RelayTunnelSession {
  validateHandshakeEnvelope(input.pendingHandshake.clientHello);
  validateServerHelloEnvelope(input.serverHello);

  if (input.serverHello.hostKeyFingerprint !== input.pendingHandshake.expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "服务端返回的 Host 指纹和客户端预期不一致"
    );
  }

  const actualFingerprint = buildRelayTunnelPublicKeyFingerprint(input.serverHello.hostPublicKey);

  if (actualFingerprint !== input.pendingHandshake.expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "服务端返回的 Host 公钥与指纹不一致"
    );
  }

  if (normalizePem(input.serverHello.hostPublicKey) !== normalizePem(input.pendingHandshake.expectedHostPublicKey)) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_PUBLIC_KEY_MISMATCH",
      "服务端返回的 Host 公钥和客户端持有的公钥不一致"
    );
  }

  const transcriptHash = buildHandshakeTranscriptHash(
    input.pendingHandshake.clientHello,
    input.serverHello
  );
  const ikm = deriveHandshakeInputKeyMaterial({
    clientEphemeralPublicKey: null,
    clientEphemeralPrivateKey: input.pendingHandshake.clientEphemeralPrivateKey,
    hostStaticPrivateKey: null,
    hostStaticPublicKey: createPublicKey(input.pendingHandshake.expectedHostPublicKey),
    serverEphemeralPrivateKey: null,
    serverEphemeralPublicKey: importPublicKeyFromSpkiBase64Url(
      input.serverHello.serverEphemeralPublicKey
    )
  });
  const expectedProof = createHandshakeProof(ikm, transcriptHash);
  const expectedProofBuffer = Buffer.from(expectedProof, "utf8");
  const actualProofBuffer = Buffer.from(input.serverHello.proof, "utf8");

  if (
    expectedProofBuffer.length !== actualProofBuffer.length
    || !timingSafeEqual(expectedProofBuffer, actualProofBuffer)
  ) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HANDSHAKE_PROOF_INVALID",
      "服务端握手证明无效"
    );
  }

  return createRelayTunnelSession({
    sessionId: input.serverHello.sessionId,
    role: "client",
    peerHostFingerprint: input.serverHello.hostKeyFingerprint,
    ikm,
    transcriptHash
  });
}

export function encryptRelayTunnelFrame(
  session: RelayTunnelSession,
  payload: Buffer | Uint8Array | string
): RelayTunnelEncryptedFrame {
  const nextSequence = session.sendSequence + 1;
  const direction = resolveSendDirection(session.role);
  const iv = randomBytes(RELAY_TUNNEL_FRAME_IV_LENGTH);
  const cipher = createCipheriv(RELAY_TUNNEL_FRAME_ALGORITHM, session.sendKey, iv);
  const plaintext = normalizePayload(payload);
  const aad = buildFrameAad({
    sessionId: session.sessionId,
    direction,
    sequence: nextSequence
  });

  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  session.sendSequence = nextSequence;

  return {
    version: RELAY_TUNNEL_PROTOCOL_VERSION,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    sessionId: session.sessionId,
    direction,
    sequence: nextSequence,
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptRelayTunnelFrame(
  session: RelayTunnelSession,
  frame: RelayTunnelEncryptedFrame
): Buffer {
  validateFrameEnvelope(frame);

  if (frame.sessionId !== session.sessionId) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_SESSION_MISMATCH",
      "加密帧的会话标识和当前会话不匹配"
    );
  }

  const expectedDirection = resolveReceiveDirection(session.role);

  if (frame.direction !== expectedDirection) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_DIRECTION_MISMATCH",
      "加密帧方向和当前接收方向不匹配"
    );
  }

  const expectedSequence = session.receiveSequence + 1;

  if (frame.sequence !== expectedSequence) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_SEQUENCE_MISMATCH",
      `加密帧序号错误，期望 ${expectedSequence}，实际 ${frame.sequence}`
    );
  }

  const decipher = createDecipheriv(
    RELAY_TUNNEL_FRAME_ALGORITHM,
    session.receiveKey,
    Buffer.from(frame.iv, "base64url")
  );
  const aad = buildFrameAad({
    sessionId: frame.sessionId,
    direction: frame.direction,
    sequence: frame.sequence
  });

  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(frame.authTag, "base64url"));

  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(frame.ciphertext, "base64url")),
      decipher.final()
    ]);
    session.receiveSequence = frame.sequence;
    return plaintext;
  } catch {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_AUTH_INVALID",
      "加密帧完整性校验失败"
    );
  }
}

function createRelayTunnelSession(input: {
  sessionId: string;
  role: RelayTunnelEndpointRole;
  peerHostFingerprint: string;
  ikm: Buffer;
  transcriptHash: Buffer;
}): RelayTunnelSession {
  const clientToHostKey = deriveSessionKey(
    input.ikm,
    input.transcriptHash,
    "codingns-relay-client-to-host"
  );
  const hostToClientKey = deriveSessionKey(
    input.ikm,
    input.transcriptHash,
    "codingns-relay-host-to-client"
  );

  return {
    sessionId: input.sessionId,
    role: input.role,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    peerHostFingerprint: input.peerHostFingerprint,
    sendSequence: 0,
    receiveSequence: 0,
    sendKey: input.role === "client" ? clientToHostKey : hostToClientKey,
    receiveKey: input.role === "client" ? hostToClientKey : clientToHostKey
  };
}

function validateHandshakeEnvelope(hello: RelayTunnelClientHello): void {
  if (
    hello.version !== RELAY_TUNNEL_PROTOCOL_VERSION
    || hello.cipherSuite !== RELAY_TUNNEL_CIPHER_SUITE
  ) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      "客户端握手协议版本或套件不受支持"
    );
  }
}

function validateServerHelloEnvelope(hello: RelayTunnelServerHello): void {
  if (
    hello.version !== RELAY_TUNNEL_PROTOCOL_VERSION
    || hello.cipherSuite !== RELAY_TUNNEL_CIPHER_SUITE
  ) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      "服务端握手协议版本或套件不受支持"
    );
  }
}

function validateFrameEnvelope(frame: RelayTunnelEncryptedFrame): void {
  if (
    frame.version !== RELAY_TUNNEL_PROTOCOL_VERSION
    || frame.cipherSuite !== RELAY_TUNNEL_CIPHER_SUITE
  ) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      "加密帧协议版本或套件不受支持"
    );
  }
}

function deriveHandshakeInputKeyMaterial(input: {
  clientEphemeralPublicKey: KeyObject | null;
  clientEphemeralPrivateKey: KeyObject | null;
  hostStaticPrivateKey: KeyObject | null;
  hostStaticPublicKey: KeyObject | null;
  serverEphemeralPrivateKey: KeyObject | null;
  serverEphemeralPublicKey: KeyObject | null;
}): Buffer {
  const staticShared = input.hostStaticPrivateKey
    ? diffieHellman({
      privateKey: input.hostStaticPrivateKey,
      publicKey: input.clientEphemeralPublicKey!
    })
    : diffieHellman({
      privateKey: input.clientEphemeralPrivateKey!,
      publicKey: input.hostStaticPublicKey!
    });
  const ephemeralShared = input.serverEphemeralPrivateKey
    ? diffieHellman({
      privateKey: input.serverEphemeralPrivateKey,
      publicKey: input.clientEphemeralPublicKey!
    })
    : diffieHellman({
      privateKey: input.clientEphemeralPrivateKey!,
      publicKey: input.serverEphemeralPublicKey!
    });

  return Buffer.concat([staticShared, ephemeralShared]);
}

function buildHandshakeTranscriptHash(
  clientHello: RelayTunnelClientHello,
  serverHello: RelayTunnelServerHello
): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: RELAY_TUNNEL_PROTOCOL_VERSION,
        cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
        clientEphemeralPublicKey: clientHello.clientEphemeralPublicKey,
        clientNonce: clientHello.clientNonce,
        expectedHostFingerprint: clientHello.expectedHostFingerprint,
        hostPublicKey: normalizePem(serverHello.hostPublicKey),
        hostKeyFingerprint: serverHello.hostKeyFingerprint,
        serverEphemeralPublicKey: serverHello.serverEphemeralPublicKey,
        serverNonce: serverHello.serverNonce,
        sessionId: serverHello.sessionId
      })
    )
    .digest();
}

function createHandshakeProof(ikm: Buffer, transcriptHash: Buffer): string {
  const proofKey = hkdfBuffer(ikm, transcriptHash, "codingns-relay-handshake-proof");

  return createHmac("sha256", proofKey)
    .update(transcriptHash)
    .digest("base64url");
}

function deriveSessionKey(ikm: Buffer, transcriptHash: Buffer, info: string): Buffer {
  return hkdfBuffer(ikm, transcriptHash, info);
}

function hkdfBuffer(ikm: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from(info, "utf8"),
      RELAY_TUNNEL_FRAME_KEY_LENGTH
    )
  );
}

function buildFrameAad(input: {
  sessionId: string;
  direction: RelayTunnelFrameDirection;
  sequence: number;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: RELAY_TUNNEL_PROTOCOL_VERSION,
      cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
      sessionId: input.sessionId,
      direction: input.direction,
      sequence: input.sequence
    }),
    "utf8"
  );
}

function exportPublicKeyAsSpkiBase64Url(key: KeyObject): string {
  return key.export({
    type: "spki",
    format: "der"
  }).toString("base64url");
}

function importPublicKeyFromSpkiBase64Url(value: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(value, "base64url"),
    type: "spki",
    format: "der"
  });
}

function normalizePayload(payload: Buffer | Uint8Array | string): Buffer {
  if (typeof payload === "string") {
    return Buffer.from(payload, "utf8");
  }

  return Buffer.from(payload);
}

function resolveSendDirection(role: RelayTunnelEndpointRole): RelayTunnelFrameDirection {
  return role === "client" ? "client_to_host" : "host_to_client";
}

function resolveReceiveDirection(role: RelayTunnelEndpointRole): RelayTunnelFrameDirection {
  return role === "client" ? "host_to_client" : "client_to_host";
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      `${field} 不能为空`
    );
  }

  return normalized;
}

function normalizePem(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}
