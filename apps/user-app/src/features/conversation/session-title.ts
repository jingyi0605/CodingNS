const SESSION_TITLE_MAX_LENGTH = 48;

function normalizeSessionTitleText(title: string | null | undefined) {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
}

export function buildSessionTitlePresentation(
  title: string | null | undefined,
  fallback: string
) {
  const fullTitle = normalizeSessionTitleText(title) || fallback;
  const displayTitle =
    fullTitle.length > SESSION_TITLE_MAX_LENGTH
      ? fullTitle.slice(0, SESSION_TITLE_MAX_LENGTH).trimEnd()
      : fullTitle;

  return {
    fullTitle,
    displayTitle
  };
}

