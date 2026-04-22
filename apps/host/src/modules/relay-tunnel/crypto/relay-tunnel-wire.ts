import {
  RELAY_TUNNEL_PROTOCOL_VERSION,
  type RelayTunnelEncryptedFrame,
  type RelayTunnelFrameDirection
} from "./relay-tunnel-protocol.js";

const RELAY_TUNNEL_FRAME_IV_LENGTH = 12;
const RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH = 16;
const RELAY_TUNNEL_DIRECTION_CLIENT_TO_HOST = 0;
const RELAY_TUNNEL_DIRECTION_HOST_TO_CLIENT = 1;

export function encodeRelayTunnelEncryptedFramePayload(frame: RelayTunnelEncryptedFrame): Buffer {
  const sessionIdBuffer = Buffer.from(frame.sessionId, "utf8");
  const iv = toBuffer(frame.iv);
  const authTag = toBuffer(frame.authTag);
  const ciphertext = toBuffer(frame.ciphertext);

  if (sessionIdBuffer.byteLength > 0xffff) {
    throw new Error("sessionId 过长，无法编码 relay-tunnel 二进制加密帧");
  }

  const output = Buffer.allocUnsafe(
    12 + sessionIdBuffer.byteLength + iv.byteLength + authTag.byteLength + ciphertext.byteLength
  );

  output.writeUInt8(frame.version, 0);
  output.writeUInt8(encodeDirection(frame.direction), 1);
  output.writeBigUInt64BE(BigInt(frame.sequence), 2);
  output.writeUInt16BE(sessionIdBuffer.byteLength, 10);
  sessionIdBuffer.copy(output, 12);

  let offset = 12 + sessionIdBuffer.byteLength;
  iv.copy(output, offset);
  offset += iv.byteLength;
  authTag.copy(output, offset);
  offset += authTag.byteLength;
  ciphertext.copy(output, offset);

  return output;
}

export function decodeRelayTunnelEncryptedFramePayload(payload: Buffer): RelayTunnelEncryptedFrame {
  if (payload.byteLength < 12 + RELAY_TUNNEL_FRAME_IV_LENGTH + RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH) {
    throw new Error("relay-tunnel 二进制加密帧长度不足");
  }

  const version = payload.readUInt8(0);
  const direction = decodeDirection(payload.readUInt8(1));
  const sequence = Number(payload.readBigUInt64BE(2));
  const sessionIdLength = payload.readUInt16BE(10);
  const sessionIdOffset = 12;
  const ivOffset = sessionIdOffset + sessionIdLength;
  const authTagOffset = ivOffset + RELAY_TUNNEL_FRAME_IV_LENGTH;
  const ciphertextOffset = authTagOffset + RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH;

  if (payload.byteLength < ciphertextOffset) {
    throw new Error("relay-tunnel 二进制加密帧中的 sessionId 长度非法");
  }

  return {
    version,
    cipherSuite: "x25519-hkdf-sha256-aes-256-gcm",
    sessionId: payload.subarray(sessionIdOffset, ivOffset).toString("utf8"),
    direction,
    sequence,
    iv: payload.subarray(ivOffset, authTagOffset),
    authTag: payload.subarray(authTagOffset, ciphertextOffset),
    ciphertext: payload.subarray(ciphertextOffset)
  };
}

export function isRelayTunnelEncryptedFramePayload(payload: Buffer): boolean {
  try {
    const frame = decodeRelayTunnelEncryptedFramePayload(payload);
    return frame.version === RELAY_TUNNEL_PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

function encodeDirection(direction: RelayTunnelFrameDirection): number {
  return direction === "client_to_host"
    ? RELAY_TUNNEL_DIRECTION_CLIENT_TO_HOST
    : RELAY_TUNNEL_DIRECTION_HOST_TO_CLIENT;
}

function decodeDirection(value: number): RelayTunnelFrameDirection {
  if (value === RELAY_TUNNEL_DIRECTION_CLIENT_TO_HOST) {
    return "client_to_host";
  }

  if (value === RELAY_TUNNEL_DIRECTION_HOST_TO_CLIENT) {
    return "host_to_client";
  }

  throw new Error(`未知的 relay-tunnel 帧方向编码: ${value}`);
}

function toBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value)
    ? value
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
