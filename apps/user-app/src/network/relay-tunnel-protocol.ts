export const RELAY_TUNNEL_PROTOCOL_VERSION = 1;
export const RELAY_TUNNEL_CIPHER_SUITE = "x25519-hkdf-sha256-aes-256-gcm" as const;

const RELAY_TUNNEL_FRAME_IV_LENGTH = 12;
const RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH = 16;
const RELAY_TUNNEL_FRAME_KEY_LENGTH = 32;

export type RelayTunnelCipherSuite = typeof RELAY_TUNNEL_CIPHER_SUITE;
export type RelayTunnelEndpointRole = "client";
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
  readonly clientEphemeralPrivateKey: CryptoKey;
  readonly clientHello: RelayTunnelClientHello;
}

export interface RelayTunnelSession {
  readonly sessionId: string;
  readonly role: RelayTunnelEndpointRole;
  readonly cipherSuite: RelayTunnelCipherSuite;
  readonly peerHostFingerprint: string;
  sendSequence: number;
  receiveSequence: number;
  readonly sendKey: CryptoKey;
  readonly receiveKey: CryptoKey;
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

export async function buildRelayTunnelPublicKeyFingerprint(publicKeyPem: string): Promise<string> {
  const der = decodePemBody(publicKeyPem, "PUBLIC KEY");
  const digest = await getSubtleCrypto().digest("SHA-256", asBufferSource(der));

  return `SHA256:${encodeBase64(new Uint8Array(digest))}`;
}

export async function createRelayTunnelClientHandshake(input: {
  expectedHostPublicKey: string;
  expectedHostFingerprint: string;
}): Promise<{
  pendingHandshake: RelayTunnelPendingClientHandshake;
  clientHello: RelayTunnelClientHello;
}> {
  const expectedHostFingerprint = normalizeRequiredText(
    input.expectedHostFingerprint,
    "expectedHostFingerprint"
  );
  const expectedHostPublicKey = normalizeRequiredText(
    input.expectedHostPublicKey,
    "expectedHostPublicKey"
  );
  const actualFingerprint = await buildRelayTunnelPublicKeyFingerprint(expectedHostPublicKey);

  if (actualFingerprint !== expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "客户端持有的 Host 公钥和指纹不一致"
    );
  }

  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(X25519_ALGORITHM, true, ["deriveBits"]) as CryptoKeyPair;
  const clientHello: RelayTunnelClientHello = {
    version: RELAY_TUNNEL_PROTOCOL_VERSION,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    clientEphemeralPublicKey: encodeBase64Url(
      new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey))
    ),
    clientNonce: encodeBase64Url(randomBytes(16)),
    expectedHostFingerprint
  };

  return {
    pendingHandshake: {
      expectedHostPublicKey,
      expectedHostFingerprint,
      clientEphemeralPrivateKey: keyPair.privateKey,
      clientHello
    },
    clientHello
  };
}

export async function finalizeRelayTunnelClientHandshake(input: {
  pendingHandshake: RelayTunnelPendingClientHandshake;
  serverHello: RelayTunnelServerHello;
}): Promise<RelayTunnelSession> {
  validateHandshakeEnvelope(input.pendingHandshake.clientHello);
  validateServerHelloEnvelope(input.serverHello);

  if (input.serverHello.hostKeyFingerprint !== input.pendingHandshake.expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "服务端返回的 Host 指纹和客户端预期不一致"
    );
  }

  const actualFingerprint = await buildRelayTunnelPublicKeyFingerprint(input.serverHello.hostPublicKey);

  if (actualFingerprint !== input.pendingHandshake.expectedHostFingerprint) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_FINGERPRINT_MISMATCH",
      "服务端返回的 Host 公钥与指纹不一致"
    );
  }

  if (
    normalizePem(input.serverHello.hostPublicKey)
    !== normalizePem(input.pendingHandshake.expectedHostPublicKey)
  ) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HOST_PUBLIC_KEY_MISMATCH",
      "服务端返回的 Host 公钥和客户端持有的公钥不一致"
    );
  }

  const transcriptHash = await buildHandshakeTranscriptHash(
    input.pendingHandshake.clientHello,
    input.serverHello
  );
  const hostStaticPublicKey = await importX25519PublicKeyFromPem(
    input.pendingHandshake.expectedHostPublicKey
  );
  const serverEphemeralPublicKey = await importX25519PublicKeyFromSpkiBase64Url(
    input.serverHello.serverEphemeralPublicKey
  );
  const staticShared = await deriveX25519Bits(
    input.pendingHandshake.clientEphemeralPrivateKey,
    hostStaticPublicKey
  );
  const ephemeralShared = await deriveX25519Bits(
    input.pendingHandshake.clientEphemeralPrivateKey,
    serverEphemeralPublicKey
  );
  const ikm = concatBytes([staticShared, ephemeralShared]);
  const expectedProof = await createHandshakeProof(ikm, transcriptHash);
  const expectedProofBytes = textEncoder.encode(expectedProof);
  const actualProofBytes = textEncoder.encode(input.serverHello.proof);

  if (!constantTimeEqual(expectedProofBytes, actualProofBytes)) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_HANDSHAKE_PROOF_INVALID",
      "服务端握手证明无效"
    );
  }

  return await createRelayTunnelSession({
    sessionId: input.serverHello.sessionId,
    peerHostFingerprint: input.serverHello.hostKeyFingerprint,
    ikm,
    transcriptHash
  });
}

export async function encryptRelayTunnelFrame(
  session: RelayTunnelSession,
  payload: Uint8Array | ArrayBuffer | string
): Promise<RelayTunnelEncryptedFrame> {
  const subtle = getSubtleCrypto();
  const nextSequence = session.sendSequence + 1;
  const direction = "client_to_host";
  const iv = randomBytes(RELAY_TUNNEL_FRAME_IV_LENGTH);
  const aad = buildFrameAad({
    sessionId: session.sessionId,
    direction,
    sequence: nextSequence
  });
  const plaintext = normalizePayload(payload);
  const encrypted = new Uint8Array(
    await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(aad),
        tagLength: RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH * 8
      },
      session.sendKey,
      asBufferSource(plaintext)
    )
  );

  session.sendSequence = nextSequence;

  return {
    version: RELAY_TUNNEL_PROTOCOL_VERSION,
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    sessionId: session.sessionId,
    direction,
    sequence: nextSequence,
    iv: encodeBase64Url(iv),
    authTag: encodeBase64Url(encrypted.slice(-RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH)),
    ciphertext: encodeBase64Url(encrypted.slice(0, -RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH))
  };
}

export async function decryptRelayTunnelFrame(
  session: RelayTunnelSession,
  frame: RelayTunnelEncryptedFrame
): Promise<Uint8Array> {
  validateFrameEnvelope(frame);

  if (frame.sessionId !== session.sessionId) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_SESSION_MISMATCH",
      "加密帧的会话标识和当前会话不匹配"
    );
  }

  if (frame.direction !== "host_to_client") {
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

  const subtle = getSubtleCrypto();
  const aad = buildFrameAad({
    sessionId: frame.sessionId,
    direction: frame.direction,
    sequence: frame.sequence
  });
  const ciphertext = decodeBase64Url(frame.ciphertext);
  const authTag = decodeBase64Url(frame.authTag);
  const payload = concatBytes([ciphertext, authTag]);

  try {
    const plaintext = new Uint8Array(
      await subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asBufferSource(decodeBase64Url(frame.iv)),
          additionalData: asBufferSource(aad),
          tagLength: RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH * 8
        },
        session.receiveKey,
        asBufferSource(payload)
      )
    );
    session.receiveSequence = frame.sequence;
    return plaintext;
  } catch {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_FRAME_AUTH_INVALID",
      "加密帧完整性校验失败"
    );
  }
}

async function createRelayTunnelSession(input: {
  sessionId: string;
  peerHostFingerprint: string;
  ikm: Uint8Array;
  transcriptHash: Uint8Array;
}): Promise<RelayTunnelSession> {
  const clientToHostKeyBytes = await deriveSessionKey(
    input.ikm,
    input.transcriptHash,
    "codingns-relay-client-to-host"
  );
  const hostToClientKeyBytes = await deriveSessionKey(
    input.ikm,
    input.transcriptHash,
    "codingns-relay-host-to-client"
  );

  return {
    sessionId: input.sessionId,
    role: "client",
    cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
    peerHostFingerprint: input.peerHostFingerprint,
    sendSequence: 0,
    receiveSequence: 0,
    sendKey: await importAesKey(clientToHostKeyBytes, "encrypt"),
    receiveKey: await importAesKey(hostToClientKeyBytes, "decrypt")
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

async function buildHandshakeTranscriptHash(
  clientHello: RelayTunnelClientHello,
  serverHello: RelayTunnelServerHello
): Promise<Uint8Array> {
  const text = JSON.stringify({
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
  });

  return new Uint8Array(await getSubtleCrypto().digest("SHA-256", textEncoder.encode(text)));
}

async function createHandshakeProof(ikm: Uint8Array, transcriptHash: Uint8Array): Promise<string> {
  const proofKey = await hkdfBytes(ikm, transcriptHash, "codingns-relay-handshake-proof");
  const key = await getSubtleCrypto().importKey(
    "raw",
    asBufferSource(proofKey),
    HMAC_SHA256_ALGORITHM,
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await getSubtleCrypto().sign("HMAC", key, asBufferSource(transcriptHash))
  );

  return encodeBase64Url(signature);
}

async function deriveSessionKey(
  ikm: Uint8Array,
  transcriptHash: Uint8Array,
  info: string
): Promise<Uint8Array> {
  return await hkdfBytes(ikm, transcriptHash, info);
}

async function hkdfBytes(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const hkdfKey = await subtle.importKey(
    "raw",
    asBufferSource(ikm),
    "HKDF",
    false,
    ["deriveBits"]
  );
  const derived = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBufferSource(salt),
      info: asBufferSource(textEncoder.encode(info))
    },
    hkdfKey,
    RELAY_TUNNEL_FRAME_KEY_LENGTH * 8
  );

  return new Uint8Array(derived);
}

async function importAesKey(bytes: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return await getSubtleCrypto().importKey(
    "raw",
    asBufferSource(bytes),
    AES_GCM_ALGORITHM,
    false,
    [usage]
  );
}

async function importX25519PublicKeyFromPem(publicKeyPem: string): Promise<CryptoKey> {
  return await getSubtleCrypto().importKey(
    "spki",
    asBufferSource(decodePemBody(publicKeyPem, "PUBLIC KEY")),
    X25519_ALGORITHM,
    false,
    []
  );
}

async function importX25519PublicKeyFromSpkiBase64Url(value: string): Promise<CryptoKey> {
  return await getSubtleCrypto().importKey(
    "spki",
    asBufferSource(decodeBase64Url(value)),
    X25519_ALGORITHM,
    false,
    []
  );
}

async function deriveX25519Bits(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  const derived = await getSubtleCrypto().deriveBits(
    {
      ...X25519_ALGORITHM,
      public: publicKey
    } as AlgorithmIdentifier,
    privateKey,
    256
  );

  return new Uint8Array(derived);
}

function buildFrameAad(input: {
  sessionId: string;
  direction: RelayTunnelFrameDirection;
  sequence: number;
}): Uint8Array {
  return textEncoder.encode(
    JSON.stringify({
      version: RELAY_TUNNEL_PROTOCOL_VERSION,
      cipherSuite: RELAY_TUNNEL_CIPHER_SUITE,
      sessionId: input.sessionId,
      direction: input.direction,
      sequence: input.sequence
    })
  );
}

function normalizePayload(payload: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof payload === "string") {
    return textEncoder.encode(payload);
  }

  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
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

function decodePemBody(pem: string, label: string): Uint8Array {
  const normalized = normalizePem(pem);
  const markerStart = `-----BEGIN ${label}-----`;
  const markerEnd = `-----END ${label}-----`;

  if (!normalized.includes(markerStart) || !normalized.includes(markerEnd)) {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      `无效的 ${label} PEM`
    );
  }

  const base64 = normalized
    .replace(markerStart, "")
    .replace(markerEnd, "")
    .replace(/\s+/g, "");

  return decodeBase64(base64);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  getCryptoApi().getRandomValues(output);
  return output;
}

function encodeBase64(bytes: Uint8Array): string {
  return encodeBinary(bytes);
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBinary(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(base64: string): Uint8Array {
  return decodeBinary(base64);
}

function decodeBase64Url(base64url: string): Uint8Array {
  const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeBinary(padded);
}

function encodeBinary(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_SIZE));
  }

  return btoa(binary);
}

function decodeBinary(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;
}

function getCryptoApi(): Crypto {
  if (typeof globalThis.crypto === "undefined") {
    throw new RelayTunnelProtocolError(
      "RELAY_TUNNEL_PROTOCOL_UNSUPPORTED",
      "当前运行环境不支持 Web Crypto"
    );
  }

  return globalThis.crypto;
}

function getSubtleCrypto(): SubtleCrypto {
  return getCryptoApi().subtle;
}

const textEncoder = new TextEncoder();
const BASE64_CHUNK_SIZE = 0x8000;
const X25519_ALGORITHM = { name: "X25519" } as const;
const AES_GCM_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const HMAC_SHA256_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;
