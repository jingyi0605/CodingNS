import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync
} from "node:crypto";

export function createRelayTunnelHostClaimProof(input: {
  challengeId: string;
  bindingId: string;
  tunnelDomain: string;
  hostFingerprint: string;
  relayNonce: string;
  relayPublicKey: string;
  hostPrivateKeyPem: string;
}): string {
  const transcript = Buffer.from(
    JSON.stringify({
      challengeId: input.challengeId.trim(),
      bindingId: input.bindingId.trim(),
      tunnelDomain: input.tunnelDomain.trim().toLowerCase(),
      hostFingerprint: input.hostFingerprint.trim(),
      relayPublicKey: input.relayPublicKey.trim(),
      relayNonce: input.relayNonce.trim()
    }),
    "utf8"
  );
  const transcriptHash = createHash("sha256").update(transcript).digest();
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey(input.hostPrivateKeyPem),
    publicKey: createPublicKey({
      key: Buffer.from(input.relayPublicKey, "base64url"),
      type: "spki",
      format: "der"
    })
  });
  const proofKey = Buffer.from(
    hkdfSync(
      "sha256",
      sharedSecret,
      transcriptHash,
      Buffer.from("codingns-relay-host-claim-proof", "utf8"),
      32
    )
  );

  return createHmac("sha256", proofKey)
    .update(transcriptHash)
    .digest("base64url");
}
