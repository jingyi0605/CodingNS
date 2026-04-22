import {
  RELAY_TUNNEL_PROTOCOL_VERSION,
  type RelayTunnelEncryptedFrame,
  type RelayTunnelFrameDirection
} from "./relay-tunnel-protocol";

const RELAY_TUNNEL_FRAME_IV_LENGTH = 12;
const RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH = 16;
const RELAY_TUNNEL_DIRECTION_CLIENT_TO_HOST = 0;
const RELAY_TUNNEL_DIRECTION_HOST_TO_CLIENT = 1;

export function encodeRelayTunnelEncryptedFramePayload(frame: RelayTunnelEncryptedFrame): Uint8Array {
  const sessionIdBytes = new TextEncoder().encode(frame.sessionId);
  const output = new Uint8Array(
    12 + sessionIdBytes.length + frame.iv.length + frame.authTag.length + frame.ciphertext.length
  );
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  if (sessionIdBytes.length > 0xffff) {
    throw new Error("sessionId 过长，无法编码 relay-tunnel 二进制加密帧");
  }

  view.setUint8(0, frame.version);
  view.setUint8(1, encodeDirection(frame.direction));
  view.setBigUint64(2, BigInt(frame.sequence), false);
  view.setUint16(10, sessionIdBytes.length, false);
  output.set(sessionIdBytes, 12);

  let offset = 12 + sessionIdBytes.length;
  output.set(frame.iv, offset);
  offset += frame.iv.length;
  output.set(frame.authTag, offset);
  offset += frame.authTag.length;
  output.set(frame.ciphertext, offset);

  return output;
}

export function decodeRelayTunnelEncryptedFramePayload(payload: Uint8Array | ArrayBuffer): RelayTunnelEncryptedFrame {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

  if (bytes.byteLength < 12 + RELAY_TUNNEL_FRAME_IV_LENGTH + RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH) {
    throw new Error("relay-tunnel 二进制加密帧长度不足");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  const direction = decodeDirection(view.getUint8(1));
  const sequence = Number(view.getBigUint64(2, false));
  const sessionIdLength = view.getUint16(10, false);
  const sessionIdOffset = 12;
  const ivOffset = sessionIdOffset + sessionIdLength;
  const authTagOffset = ivOffset + RELAY_TUNNEL_FRAME_IV_LENGTH;
  const ciphertextOffset = authTagOffset + RELAY_TUNNEL_FRAME_AUTH_TAG_LENGTH;

  if (bytes.byteLength < ciphertextOffset) {
    throw new Error("relay-tunnel 二进制加密帧中的 sessionId 长度非法");
  }

  return {
    version,
    cipherSuite: "x25519-hkdf-sha256-aes-256-gcm",
    sessionId: new TextDecoder().decode(bytes.subarray(sessionIdOffset, ivOffset)),
    direction,
    sequence,
    iv: bytes.subarray(ivOffset, authTagOffset),
    authTag: bytes.subarray(authTagOffset, ciphertextOffset),
    ciphertext: bytes.subarray(ciphertextOffset)
  };
}

export function isRelayTunnelEncryptedFramePayload(payload: Uint8Array | ArrayBuffer): boolean {
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
