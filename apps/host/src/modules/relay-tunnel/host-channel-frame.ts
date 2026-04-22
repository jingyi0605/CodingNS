import type { RawData } from "ws";

const HOST_CHANNEL_FRAME_TYPE_SESSION = 0x01;

export interface HostChannelSessionFrame {
  type: "session.frame";
  sessionId: string;
  payload: Buffer;
}

export function encodeHostChannelSessionFrame(sessionId: string, payload: Buffer): Buffer {
  const sessionIdBuffer = Buffer.from(sessionId, "utf8");

  if (sessionIdBuffer.byteLength > 0xffff) {
    throw new Error("sessionId 过长，无法编码为 host channel 二进制帧");
  }

  const output = Buffer.allocUnsafe(3 + sessionIdBuffer.byteLength + payload.byteLength);

  output.writeUInt8(HOST_CHANNEL_FRAME_TYPE_SESSION, 0);
  output.writeUInt16BE(sessionIdBuffer.byteLength, 1);
  sessionIdBuffer.copy(output, 3);
  payload.copy(output, 3 + sessionIdBuffer.byteLength);

  return output;
}

export function decodeHostChannelSessionFrame(payload: RawData): HostChannelSessionFrame {
  const buffer = toBuffer(payload);

  if (buffer.byteLength < 3) {
    throw new Error("host channel 二进制帧长度不足");
  }

  const frameType = buffer.readUInt8(0);

  if (frameType !== HOST_CHANNEL_FRAME_TYPE_SESSION) {
    throw new Error(`不支持的 host channel 二进制帧类型: ${frameType}`);
  }

  const sessionIdLength = buffer.readUInt16BE(1);
  const payloadOffset = 3 + sessionIdLength;

  if (buffer.byteLength < payloadOffset) {
    throw new Error("host channel 二进制帧中的 sessionId 长度非法");
  }

  return {
    type: "session.frame",
    sessionId: buffer.subarray(3, payloadOffset).toString("utf8"),
    payload: buffer.subarray(payloadOffset)
  };
}

function toBuffer(payload: RawData): Buffer {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (typeof payload === "string") {
    return Buffer.from(payload, "utf8");
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload);
  }

  if (Array.isArray(payload)) {
    return Buffer.concat(payload.map((item) => Buffer.from(item)));
  }

  return Buffer.from(payload);
}
