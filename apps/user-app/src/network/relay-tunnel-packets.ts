export type RelayTunnelGatewayPacket =
  | RelayTunnelHttpRequestPacket
  | RelayTunnelHttpResponsePacket
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

export interface RelayTunnelWsOpenPacket {
  type: "ws.open";
  streamId: string;
  path: string;
  headers: Record<string, string>;
}

export interface RelayTunnelWsOpenedPacket {
  type: "ws.opened";
  streamId: string;
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
