import {
  createHash,
  createPublicKey,
  generateKeyPairSync
} from "node:crypto";

import { nowIso } from "../../../shared/utils/time.js";
import type { InstanceRelayTunnelIdentityRepository } from "../../../storage/repositories/instance-relay-tunnel-identity-repository.js";
import type { InstanceRelayTunnelIdentity } from "../../../types/domain.js";

export class RelayTunnelIdentityService {
  constructor(
    private readonly repository: InstanceRelayTunnelIdentityRepository
  ) {}

  getIdentity(): InstanceRelayTunnelIdentity | null {
    return this.repository.findIdentity();
  }

  ensureIdentity(): InstanceRelayTunnelIdentity {
    const existing = this.repository.findIdentity();

    if (existing) {
      return existing;
    }

    const createdAt = nowIso();
    const generated = generateRelayTunnelIdentity(createdAt);
    this.repository.upsertIdentity(generated);
    return generated;
  }
}

export function generateRelayTunnelIdentity(timestamp = nowIso()): InstanceRelayTunnelIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem"
  }).toString();
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();

  return {
    keyAlgorithm: "x25519",
    privateKeyPem,
    publicKeyPem,
    keyFingerprint: buildRelayTunnelPublicKeyFingerprint(publicKeyPem),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function buildRelayTunnelPublicKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der"
  });

  return `SHA256:${createHash("sha256").update(der).digest("base64")}`;
}
