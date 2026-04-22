export type RelayTunnelGatewayPacket =
  | RelayTunnelHttpRequestPacket
  | RelayTunnelHttpResponsePacket
  | RelayTunnelHttpResponseStartPacket
  | RelayTunnelHttpResponseChunkPacket
  | RelayTunnelHttpResponseEndPacket
  | RelayTunnelWsOpenPacket
  | RelayTunnelWsOpenedPacket
  | RelayTunnelWsMessagePacket
  | RelayTunnelWsClosedPacket
  | RelayTunnelErrorPacket;

export interface RelayTunnelHttpRequestPacket {
  type: "http.request";
  streamId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyBase64Url: string | null;
}

export interface RelayTunnelHttpResponsePacket {
  type: "http.response";
  streamId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64Url: string | null;
}

export interface RelayTunnelHttpResponseStartPacket {
  type: "http.response.start";
  streamId: string;
  status: number;
  headers: Record<string, string>;
}

export interface RelayTunnelHttpResponseChunkPacket {
  type: "http.response.chunk";
  streamId: string;
  bodyChunkBase64Url: string;
}

export interface RelayTunnelHttpResponseEndPacket {
  type: "http.response.end";
  streamId: string;
}

export interface RelayTunnelWsOpenPacket {
  type: "ws.open";
  streamId: string;
  path: string;
  headers: Record<string, string>;
  protocols?: string[];
}

export interface RelayTunnelWsOpenedPacket {
  type: "ws.opened";
  streamId: string;
  selectedProtocol?: string | null;
}

export interface RelayTunnelWsMessagePacket {
  type: "ws.message";
  streamId: string;
  binary: boolean;
  dataBase64Url: string;
}

export interface RelayTunnelWsClosedPacket {
  type: "ws.closed";
  streamId: string;
  code: number;
  reason: string | null;
}

export interface RelayTunnelErrorPacket {
  type: "error";
  streamId: string | null;
  errorCode: string;
  detail: string;
}

export function serializeRelayTunnelPacket(packet: RelayTunnelGatewayPacket): string {
  return JSON.stringify(packet);
}

export function deserializeRelayTunnelPacket(payload: string): RelayTunnelGatewayPacket {
  return JSON.parse(payload) as RelayTunnelGatewayPacket;
}
