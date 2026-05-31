import type { RuntimeConfig } from "../../../contracts/src/index.js";
import type { ParserAdapter, ParserAvailability, ParserRouteKind } from "./parser-adapter.js";
import { createDefaultParserAdapters } from "./parser-router.js";

export type ParserCapabilityStatus = "primary" | "fallback" | "disabled";

export interface ParserCapabilityRecord {
  extension: string;
  adapterName: string;
  routeKind: ParserRouteKind;
  availability: ParserAvailability;
  status: ParserCapabilityStatus;
}

function normalizeRouteKind(adapter: ParserAdapter): ParserRouteKind {
  return adapter.routeKind ?? "primary";
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function statusFrom(routeKind: ParserRouteKind, availability: ParserAvailability): ParserCapabilityStatus {
  if (availability === "unavailable") {
    return "disabled";
  }
  return routeKind === "fallback" ? "fallback" : "primary";
}

export class ParserCapabilityRegistry {
  constructor(
    private readonly adapters: ParserAdapter[],
    private readonly extensions: string[],
    private readonly disabledExtensions: Set<string> = new Set(),
  ) {}

  static createDefault(config?: Pick<RuntimeConfig, "disabledParserExtensions">): ParserCapabilityRegistry {
    return new ParserCapabilityRegistry(createDefaultParserAdapters(), [
      ".md",
      ".mdx",
      ".txt",
      ".rtf",
      ".html",
      ".htm",
      ".xml",
      ".json",
      ".yaml",
      ".yml",
      ".tsv",
      ".csv",
      ".xlsx",
      ".ods",
      ".et",
      ".numbers",
      ".doc",
      ".docx",
      ".odt",
      ".wps",
      ".pdf",
      ".ppt",
      ".pptx",
      ".odp",
      ".key",
      ".xls",
    ], new Set((config?.disabledParserExtensions ?? []).map(normalizeExtension)));
  }

  async list(): Promise<ParserCapabilityRecord[]> {
    const records: ParserCapabilityRecord[] = [];

    for (const extension of this.extensions) {
      const supportingAdapters = this.adapters.filter(adapter => adapter.supports(extension));
      const isDisabled = this.disabledExtensions.has(extension);
      if (supportingAdapters.length === 0) {
        records.push({
          extension,
          adapterName: "none",
          routeKind: "fallback",
          availability: "unavailable",
          status: "disabled",
        });
        continue;
      }

      const primaryCandidate = supportingAdapters.find(adapter => normalizeRouteKind(adapter) === "primary");
      const fallbackCandidate = supportingAdapters.find(adapter => normalizeRouteKind(adapter) === "fallback");
      const preferred = isDisabled
        ? (fallbackCandidate ?? primaryCandidate ?? supportingAdapters[0])
        : (primaryCandidate ?? fallbackCandidate ?? supportingAdapters[0]);
      const preferredAvailability = await preferred.availability();
      const preferredRouteKind = normalizeRouteKind(preferred);
      const availability = isDisabled ? "unavailable" : preferredAvailability;
      const routeKind = isDisabled && fallbackCandidate
        ? normalizeRouteKind(fallbackCandidate)
        : preferredRouteKind;

      records.push({
        extension,
        adapterName: preferred.name,
        routeKind,
        availability,
        status: isDisabled ? "disabled" : statusFrom(routeKind, availability),
      });
    }

    return records;
  }
}
