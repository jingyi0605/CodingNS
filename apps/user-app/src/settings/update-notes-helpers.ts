import type {
  AndroidApkManifest,
  ManagedServicePackageInfo,
  ReleaseManifest,
  UpdateNotesSummary
} from "../config/client-config-types";

export function releaseManifestToUpdateNotes(
  manifest: ReleaseManifest
): UpdateNotesSummary | null {
  if (!manifest.notes) {
    return null;
  }

  return {
    version: manifest.version,
    title: manifest.title || undefined,
    publishedAt: manifest.publishedAt || undefined,
    content: manifest.notes,
    channel: manifest.channel,
    source: "desktop"
  };
}

export function androidManifestToUpdateNotes(
  manifest: AndroidApkManifest
): UpdateNotesSummary | null {
  if (!manifest.notes) {
    return null;
  }

  return {
    version: manifest.version,
    publishedAt: manifest.publishedAt || undefined,
    content: manifest.notes,
    channel: manifest.channel,
    source: "android"
  };
}

export function servicePackageToUpdateNotes(
  pkg: ManagedServicePackageInfo
): UpdateNotesSummary | null {
  if (!pkg.latestNotes || !pkg.latestVersion) {
    return null;
  }

  return {
    version: pkg.latestVersion,
    title: pkg.latestTitle || undefined,
    publishedAt: pkg.latestPublishedAt || undefined,
    content: pkg.latestNotes,
    channel: pkg.channel,
    source: "service"
  };
}
