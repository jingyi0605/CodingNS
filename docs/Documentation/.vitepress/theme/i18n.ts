export type DocLocale = "zh" | "en";

type TranslationPair = {
  zh: string;
  en: string;
};

type SectionFallback = {
  zhPrefix: string;
  enPrefix: string;
  zh: string;
  en: string;
};

const TRANSLATION_PAIRS: TranslationPair[] = [
  { zh: "index.md", en: "en/index.md" },
  { zh: "overview/docs-overview.md", en: "en/overview/docs-overview.md" },
  { zh: "overview/product-overview.md", en: "en/overview/product-overview.md" },
  { zh: "overview/core-features.md", en: "en/overview/core-features.md" },
  { zh: "overview/platforms-and-scenarios.md", en: "en/overview/platforms-and-scenarios.md" },
  { zh: "quick-install/installation-paths.md", en: "en/quick-install/installation-paths.md" },
  { zh: "quick-install/host-installation.md", en: "en/quick-install/host-installation.md" },
  { zh: "quick-install/client-connection.md", en: "en/quick-install/client-connection.md" },
  { zh: "quick-install/first-login.md", en: "en/quick-install/first-login.md" },
  { zh: "user-guide/workspaces-and-sessions.md", en: "en/user-guide/workspaces-and-sessions.md" },
  { zh: "user-guide/conversation-workbench.md", en: "en/user-guide/conversation-workbench.md" },
  { zh: "user-guide/files-git-and-terminal.md", en: "en/user-guide/files-git-and-terminal.md" },
  { zh: "user-guide/settings-and-updates.md", en: "en/user-guide/settings-and-updates.md" },
  { zh: "remote-access/remote-access-overview.md", en: "en/remote-access/remote-access-overview.md" },
  { zh: "remote-access/tailscale-access.md", en: "en/remote-access/tailscale-access.md" },
  { zh: "remote-access/tunnel-service.md", en: "en/remote-access/tunnel-service.md" },
  { zh: "remote-access/safe-access-tips.md", en: "en/remote-access/safe-access-tips.md" },
  { zh: "community/community-overview.md", en: "en/community/community-overview.md" },
  { zh: "community/official-links.md", en: "en/community/official-links.md" },
  { zh: "community/feedback-and-support.md", en: "en/community/feedback-and-support.md" }
];

const SECTION_FALLBACKS: SectionFallback[] = [
  {
    zhPrefix: "overview/",
    enPrefix: "en/overview/",
    zh: "overview/docs-overview.md",
    en: "en/overview/docs-overview.md"
  },
  {
    zhPrefix: "quick-install/",
    enPrefix: "en/quick-install/",
    zh: "quick-install/installation-paths.md",
    en: "en/quick-install/installation-paths.md"
  },
  {
    zhPrefix: "user-guide/",
    enPrefix: "en/user-guide/",
    zh: "user-guide/workspaces-and-sessions.md",
    en: "en/user-guide/workspaces-and-sessions.md"
  },
  {
    zhPrefix: "remote-access/",
    enPrefix: "en/remote-access/",
    zh: "remote-access/remote-access-overview.md",
    en: "en/remote-access/remote-access-overview.md"
  },
  {
    zhPrefix: "community/",
    enPrefix: "en/community/",
    zh: "community/community-overview.md",
    en: "en/community/community-overview.md"
  }
];

const zhToEnMap = new Map(TRANSLATION_PAIRS.map((pair) => [pair.zh, pair.en]));
const enToZhMap = new Map(TRANSLATION_PAIRS.map((pair) => [pair.en, pair.zh]));

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function findSectionFallback(relativePath: string, targetLocale: DocLocale) {
  return SECTION_FALLBACKS.find((section) =>
    targetLocale === "en"
      ? relativePath.startsWith(section.zhPrefix)
      : relativePath.startsWith(section.enPrefix)
  );
}

export function getDocLocale(relativePath: string): DocLocale {
  return normalizeRelativePath(relativePath).startsWith("en/") ? "en" : "zh";
}

export function getLocaleLabel(locale: DocLocale) {
  return locale === "en" ? "English" : "简体中文";
}

export function relativePathToLink(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);

  if (normalized === "index.md") {
    return "/";
  }

  const withoutIndex = normalized.replace(/(^|\/)index\.md$/, "$1");
  const withoutExt = withoutIndex.replace(/\.md$/, "");
  const link = withoutExt.startsWith("/") ? withoutExt : `/${withoutExt}`;

  return link || "/";
}

export function getAlternateRelativePath(relativePath: string, targetLocale: DocLocale) {
  const normalized = normalizeRelativePath(relativePath);
  const currentLocale = getDocLocale(normalized);

  if (currentLocale === targetLocale) {
    return normalized;
  }

  const exactMatch =
    targetLocale === "en" ? zhToEnMap.get(normalized) : enToZhMap.get(normalized);

  if (exactMatch) {
    return exactMatch;
  }

  const sectionFallback = findSectionFallback(normalized, targetLocale);
  if (sectionFallback) {
    return targetLocale === "en" ? sectionFallback.en : sectionFallback.zh;
  }

  return targetLocale === "en" ? "en/index.md" : "index.md";
}

export function getAlternateLink(relativePath: string, targetLocale: DocLocale) {
  return relativePathToLink(getAlternateRelativePath(relativePath, targetLocale));
}
