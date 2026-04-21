import { createHash } from "node:crypto";

export function buildSnapshotRevision(payload: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function withSnapshotRevision<TSnapshot extends object>(
  snapshot: TSnapshot
): TSnapshot & { revision: string } {
  return {
    ...snapshot,
    revision: buildSnapshotRevision(snapshot)
  };
}
