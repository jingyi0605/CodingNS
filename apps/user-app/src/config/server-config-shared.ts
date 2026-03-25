function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

export function normalizeServerBaseUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("EMPTY_SERVER_URL");
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const parsed = new URL(candidate);

  if (!isHttpProtocol(parsed.protocol)) {
    throw new Error("INVALID_SERVER_PROTOCOL");
  }

  parsed.hash = "";
  parsed.search = "";

  const pathname = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
}
