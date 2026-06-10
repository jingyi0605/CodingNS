import type { InstanceRelayTunnelIdentityRepository } from "../../storage/repositories/instance-relay-tunnel-identity-repository.js";
import { readHostPackageVersion } from "../client/client-service.js";

export const PEER_HOST_API_COMPATIBILITY = "2026-06-peer-host-proxy-v1";
export const HOST_HANDSHAKE_PRODUCT = "CodingNS";

export interface HostHandshakeDto {
  product: typeof HOST_HANDSHAKE_PRODUCT;
  version: string;
  apiCompatibility: string;
  hostFingerprint: string | null;
  time: string;
}

export class HostHandshakeService {
  constructor(
    private readonly relayTunnelIdentityRepository?: Pick<
      InstanceRelayTunnelIdentityRepository,
      "findIdentity"
    >,
  ) {}

  getHandshake(): HostHandshakeDto {
    return {
      product: HOST_HANDSHAKE_PRODUCT,
      version: readHostPackageVersion(),
      apiCompatibility: PEER_HOST_API_COMPATIBILITY,
      hostFingerprint:
        this.relayTunnelIdentityRepository?.findIdentity()?.keyFingerprint ??
        null,
      time: new Date().toISOString(),
    };
  }
}
