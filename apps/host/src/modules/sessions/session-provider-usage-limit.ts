export type ProviderUsageLimitSource = "error" | "error_detail" | "message";

export interface NormalizedProviderUsageLimit {
  category: "usage_limit";
  providerId: string | null;
  source: ProviderUsageLimitSource;
  retryAt: string | null;
  retryAfterSeconds: number | null;
  rawText: string;
  summary: string;
}

export interface NormalizeProviderUsageLimitInput {
  providerId?: string | null;
  text: string | null | undefined;
  referenceAt?: string | Date;
  source?: ProviderUsageLimitSource;
}

interface ParsedRetryWindow {
  retryAt: string | null;
  retryAfterSeconds: number | null;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

interface CalendarDateTimeParts extends CalendarDateParts {
  hour: number;
  minute: number;
  second: number;
}

const GEMINI_DAILY_RESET_TIME_ZONE = "America/Los_Angeles";

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

const STRONG_USAGE_LIMIT_PATTERNS = [
  /hit your usage limit/i,
  /usage limit(?: reached| exceeded)?/i,
  /quota (?:exceeded|exhausted|reached)/i,
  /daily quota/i,
  /weekly limit reached/i,
  /would exceed your account's rate limit/i,
  /reached your rate limit/i,
  /rate limit exceeded/i,
  /rate_limit_error/i,
  /free tier limits have been reached/i,
  /purchase more credits/i,
  /upgrade to pro/i,
  /billing quota/i,
  /额度(?:已)?达(?:到)?上限/,
  /配额(?:已)?达(?:到)?上限/
];

const TIME_ONLY_RESET_PATTERNS = [
  /\byour limit will reset at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i,
  /\breset(?:s|ting)? at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i,
  /\btry again at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i,
  /\bretry at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i
] as const;

const MONTH_DAY_TIME_PATTERNS = [
  /\btry again at\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?(?:,\s*|\s+)\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i,
  /\breset(?:s|ting)?(?: at)?\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?(?:,\s*|\s+)\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i,
  /\bresets?\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?,\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*\(([^)]+)\))?/i
] as const;

const RELATIVE_RETRY_PATTERNS = [
  /\b(?:retry after|try again in|available in|please retry in)\s+((?:\d+(?:\.\d+)?\s*(?:weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*){1,5})/i,
  /"retryDelay"\s*:\s*"([^"]+)"/i,
  /\bretryDelay\s*[:=]\s*"?(.*?)"?(?:[,}\]])/i
] as const;

export function normalizeProviderUsageLimit(
  input: NormalizeProviderUsageLimitInput
): NormalizedProviderUsageLimit | null {
  const rawText = input.text?.trim();

  if (!rawText) {
    return null;
  }

  if (!hasStrongUsageLimitSignal(rawText)) {
    return null;
  }

  const referenceAt = resolveReferenceAt(input.referenceAt);
  const providerId = input.providerId?.trim() || null;
  const retryWindow = resolveRetryWindow(rawText, providerId, referenceAt);

  return {
    category: "usage_limit",
    providerId,
    source: input.source ?? "error",
    retryAt: retryWindow.retryAt,
    retryAfterSeconds: retryWindow.retryAfterSeconds,
    rawText,
    summary: buildUsageLimitSummary(retryWindow.retryAt)
  };
}

function hasStrongUsageLimitSignal(text: string): boolean {
  if (STRONG_USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return looksLikeGeminiQuotaPayload(text);
}

function looksLikeGeminiQuotaPayload(text: string): boolean {
  return (
    /RESOURCE_EXHAUSTED/i.test(text)
    && /(quota|QuotaFailure|retryDelay|generativelanguage\.googleapis\.com|cloudcode-pa\.googleapis\.com)/i.test(text)
  );
}

function resolveReferenceAt(value: string | Date | undefined): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getTime());
  }

  if (typeof value === "string") {
    const parsed = new Date(value);

    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function resolveRetryWindow(text: string, providerId: string | null, referenceAt: Date): ParsedRetryWindow {
  const explicitDateTime = resolveRetryAtFromMonthDayTime(text, referenceAt);

  if (explicitDateTime) {
    return explicitDateTime;
  }

  const timeOnly = resolveRetryAtFromTimeOnly(text, referenceAt);

  if (timeOnly) {
    return timeOnly;
  }

  const geminiDaily = resolveGeminiDailyResetWindow(text, providerId, referenceAt);

  if (geminiDaily) {
    return geminiDaily;
  }

  const relative = resolveRetryWindowFromRelativeDuration(text, referenceAt);

  if (relative) {
    return relative;
  }

  return {
    retryAt: null,
    retryAfterSeconds: null
  };
}

function resolveRetryAtFromMonthDayTime(text: string, referenceAt: Date): ParsedRetryWindow | null {
  for (const pattern of MONTH_DAY_TIME_PATTERNS) {
    const matched = text.match(pattern);
    const dateTimeLabel = matched?.[1]?.trim();

    if (!dateTimeLabel) {
      continue;
    }

    const parsed = parseMonthDayTimeLabel(dateTimeLabel, referenceAt, matched?.[2] ?? null);

    if (!parsed) {
      continue;
    }

    return {
      retryAt: parsed.toISOString(),
      retryAfterSeconds: Math.max(1, Math.round((parsed.getTime() - referenceAt.getTime()) / 1000))
    };
  }

  return null;
}

function resolveRetryAtFromTimeOnly(text: string, referenceAt: Date): ParsedRetryWindow | null {
  for (const pattern of TIME_ONLY_RESET_PATTERNS) {
    const matched = text.match(pattern);
    const timeLabel = matched?.[1]?.trim();

    if (!timeLabel) {
      continue;
    }

    const parsed = parseTimeOnlyLabel(timeLabel, referenceAt, matched?.[2] ?? null);

    if (!parsed) {
      continue;
    }

    return {
      retryAt: parsed.toISOString(),
      retryAfterSeconds: Math.max(1, Math.round((parsed.getTime() - referenceAt.getTime()) / 1000))
    };
  }

  return null;
}

function resolveGeminiDailyResetWindow(
  text: string,
  providerId: string | null,
  referenceAt: Date
): ParsedRetryWindow | null {
  const normalizedProviderId = providerId?.toLowerCase() ?? null;
  const shouldInspectGeminiSignal =
    normalizedProviderId === "gemini" || looksLikeGeminiQuotaPayload(text);

  if (!shouldInspectGeminiSignal) {
    return null;
  }

  if (!/(PerDay|daily quota|per day)/i.test(text)) {
    return null;
  }

  const nextMidnightPacific = resolveNextMidnightInTimeZone(referenceAt, GEMINI_DAILY_RESET_TIME_ZONE);

  if (!nextMidnightPacific) {
    return null;
  }

  return {
    retryAt: nextMidnightPacific.toISOString(),
    retryAfterSeconds: Math.max(1, Math.round((nextMidnightPacific.getTime() - referenceAt.getTime()) / 1000))
  };
}

function resolveRetryWindowFromRelativeDuration(text: string, referenceAt: Date): ParsedRetryWindow | null {
  for (const pattern of RELATIVE_RETRY_PATTERNS) {
    const matched = text.match(pattern);
    const durationLabel = matched?.[1]?.trim();

    if (!durationLabel) {
      continue;
    }

    const retryAfterSeconds = parseDurationSeconds(durationLabel);

    if (retryAfterSeconds === null) {
      continue;
    }

    return {
      retryAt: new Date(referenceAt.getTime() + retryAfterSeconds * 1000).toISOString(),
      retryAfterSeconds
    };
  }

  return null;
}

function parseDurationSeconds(value: string): number | null {
  const matches = Array.from(
    value.matchAll(/(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi)
  );

  if (matches.length === 0) {
    return null;
  }

  let totalSeconds = 0;

  for (const match of matches) {
    const amount = Number.parseFloat(match[1] ?? "");
    const seconds = convertDurationToSeconds(amount, match[2] ?? "");

    if (seconds === null) {
      return null;
    }

    totalSeconds += seconds;
  }

  return totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds)) : null;
}

function convertDurationToSeconds(amount: number, unit: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const normalizedUnit = unit.trim().toLowerCase();

  if (normalizedUnit.startsWith("w")) {
    return amount * 7 * 24 * 3600;
  }

  if (normalizedUnit.startsWith("d")) {
    return amount * 24 * 3600;
  }

  if (normalizedUnit.startsWith("h")) {
    return amount * 3600;
  }

  if (normalizedUnit.startsWith("m")) {
    return amount * 60;
  }

  if (normalizedUnit.startsWith("s")) {
    return amount;
  }

  return null;
}

function parseMonthDayTimeLabel(
  value: string,
  referenceAt: Date,
  timeZone: string | null
): Date | null {
  const normalized = value
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const matched = normalized.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?(?:,\s*|\s+)(\d{1,2}(?::\d{2})?\s*(?:AM|PM))$/i
  );

  if (!matched) {
    return null;
  }

  const month = MONTH_INDEX_BY_NAME[matched[1]?.trim().toLowerCase() ?? ""];
  const day = Number.parseInt(matched[2] ?? "", 10);
  const year = matched[3] ? Number.parseInt(matched[3], 10) : null;
  const timeParts = parseTimeOfDay(matched[4] ?? "");

  if (!month || !Number.isFinite(day) || !timeParts) {
    return null;
  }

  const resolvedYear = year ?? resolveDefaultYear(referenceAt, month, day, timeParts, timeZone);
  return buildDateFromParts(
    {
      year: resolvedYear,
      month,
      day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0
    },
    timeZone
  );
}

function parseTimeOnlyLabel(
  value: string,
  referenceAt: Date,
  timeZone: string | null
): Date | null {
  const timeParts = parseTimeOfDay(value);

  if (!timeParts) {
    return null;
  }

  const referenceDate = resolveCalendarDate(referenceAt, timeZone);

  if (!referenceDate) {
    return null;
  }

  let candidate = buildDateFromParts(
    {
      ...referenceDate,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0
    },
    timeZone
  );

  if (!candidate) {
    return null;
  }

  if (candidate.getTime() <= referenceAt.getTime()) {
    const nextDay = addDays(referenceDate, 1);
    candidate = buildDateFromParts(
      {
        ...nextDay,
        hour: timeParts.hour,
        minute: timeParts.minute,
        second: 0
      },
      timeZone
    );
  }

  return candidate;
}

function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const matched = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);

  if (!matched) {
    return null;
  }

  const rawHour = Number.parseInt(matched[1] ?? "", 10);
  const minute = Number.parseInt(matched[2] ?? "0", 10);
  const meridiem = matched[3]?.toUpperCase();

  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  let hour = rawHour;

  if (meridiem === "AM") {
    hour = rawHour === 12 ? 0 : rawHour;
  } else if (meridiem === "PM") {
    hour = rawHour === 12 ? 12 : rawHour + 12;
  } else {
    return null;
  }

  return { hour, minute };
}

function resolveDefaultYear(
  referenceAt: Date,
  month: number,
  day: number,
  timeParts: { hour: number; minute: number },
  timeZone: string | null
): number {
  const referenceDate = resolveCalendarDate(referenceAt, timeZone);

  if (!referenceDate) {
    return referenceAt.getFullYear();
  }

  const baseCandidate = buildDateFromParts(
    {
      year: referenceDate.year,
      month,
      day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0
    },
    timeZone
  );

  if (baseCandidate && baseCandidate.getTime() > referenceAt.getTime()) {
    return referenceDate.year;
  }

  return referenceDate.year + 1;
}

function resolveCalendarDate(referenceAt: Date, timeZone: string | null): CalendarDateParts | null {
  if (timeZone) {
    const zoned = getTimeZoneDateTimeParts(referenceAt, timeZone);

    if (!zoned) {
      return null;
    }

    return {
      year: zoned.year,
      month: zoned.month,
      day: zoned.day
    };
  }

  return {
    year: referenceAt.getFullYear(),
    month: referenceAt.getMonth() + 1,
    day: referenceAt.getDate()
  };
}

function addDays(value: CalendarDateParts, days: number): CalendarDateParts {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + days));

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
}

function resolveNextMidnightInTimeZone(referenceAt: Date, timeZone: string): Date | null {
  const referenceDate = resolveCalendarDate(referenceAt, timeZone);

  if (!referenceDate) {
    return null;
  }

  const nextDay = addDays(referenceDate, 1);
  return buildDateFromParts(
    {
      ...nextDay,
      hour: 0,
      minute: 0,
      second: 0
    },
    timeZone
  );
}

function buildDateFromParts(value: CalendarDateTimeParts, timeZone: string | null): Date | null {
  if (!timeZone) {
    const candidate = new Date(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
      0
    );

    return Number.isFinite(candidate.getTime()) ? candidate : null;
  }

  return buildDateInTimeZone(value, timeZone);
}

function buildDateInTimeZone(value: CalendarDateTimeParts, timeZone: string): Date | null {
  let candidate = new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
      0
    )
  );

  if (!Number.isFinite(candidate.getTime())) {
    return null;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMilliseconds(candidate, timeZone);

    if (offsetMs === null) {
      return null;
    }

    const next = new Date(
      Date.UTC(
        value.year,
        value.month - 1,
        value.day,
        value.hour,
        value.minute,
        value.second,
        0
      ) - offsetMs
    );

    if (!Number.isFinite(next.getTime())) {
      return null;
    }

    if (Math.abs(next.getTime() - candidate.getTime()) < 1000) {
      return next;
    }

    candidate = next;
  }

  return candidate;
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string): number | null {
  const zoned = getTimeZoneDateTimeParts(date, timeZone);

  if (!zoned) {
    return null;
  }

  return Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
    0
  ) - date.getTime();
}

function getTimeZoneDateTimeParts(date: Date, timeZone: string): CalendarDateTimeParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23"
    });
    const parts = formatter.formatToParts(date);
    const year = Number.parseInt(parts.find((part) => part.type === "year")?.value ?? "", 10);
    const month = Number.parseInt(parts.find((part) => part.type === "month")?.value ?? "", 10);
    const day = Number.parseInt(parts.find((part) => part.type === "day")?.value ?? "", 10);
    const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "", 10);
    const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "", 10);
    const second = Number.parseInt(parts.find((part) => part.type === "second")?.value ?? "", 10);

    if (
      !Number.isFinite(year)
      || !Number.isFinite(month)
      || !Number.isFinite(day)
      || !Number.isFinite(hour)
      || !Number.isFinite(minute)
      || !Number.isFinite(second)
    ) {
      return null;
    }

    return {
      year,
      month,
      day,
      hour,
      minute,
      second
    };
  } catch {
    return null;
  }
}

function buildUsageLimitSummary(retryAt: string | null): string {
  if (!retryAt) {
    return "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。";
  }

  return `检测到 provider 额度已达上限，系统会在 ${formatLocalTimeLabel(retryAt)} 后自动重试。`;
}

function formatLocalTimeLabel(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}
