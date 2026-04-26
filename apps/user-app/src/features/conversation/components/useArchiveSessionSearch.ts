import { useEffect, useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import {
  getSessionMessages,
  type HistoryMessageDto,
  type SessionSummaryDto
} from "../api/conversation-api";

const ARCHIVE_SEARCH_HISTORY_LIMIT = 12;
const ARCHIVE_SEARCH_SNIPPET_LIMIT = 3;
const ARCHIVE_SEARCH_MAX_LENGTH = 180;
const ARCHIVE_SEARCH_MESSAGE_MAX_LENGTH = 72;

export function useArchiveSessionSearch(
  open: boolean,
  sessions: readonly SessionSummaryDto[]
) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [summaryBySessionId, setSummaryBySessionId] = useState<Record<string, string>>({});
  const [loadedSummaryBySessionId, setLoadedSummaryBySessionId] = useState<Record<string, true>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearchOpen(false);
      setSearchKeyword("");
      setSummaryError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !searchOpen) {
      return;
    }

    const pendingSessions = sessions.filter((session) => loadedSummaryBySessionId[session.sessionId] !== true);

    if (pendingSessions.length === 0) {
      return;
    }

    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);

    void Promise.allSettled(
      pendingSessions.map(async (session) => {
        const response = await getSessionMessages(session.sessionId, null, ARCHIVE_SEARCH_HISTORY_LIMIT, "backward");

        return {
          sessionId: session.sessionId,
          summary: buildArchiveSessionSearchSummary(response.messages)
        };
      })
    )
      .then((results) => {
        if (cancelled) {
          return;
        }

        const loadedEntries: Record<string, true> = {};
        const summaryEntries: Record<string, string> = {};
        let failedCount = 0;

        pendingSessions.forEach((session) => {
          loadedEntries[session.sessionId] = true;
        });

        for (const result of results) {
          if (result.status === "fulfilled") {
            summaryEntries[result.value.sessionId] = result.value.summary;
            continue;
          }

          failedCount += 1;
        }

        setLoadedSummaryBySessionId((current) => ({
          ...current,
          ...loadedEntries
        }));

        if (Object.keys(summaryEntries).length > 0) {
          setSummaryBySessionId((current) => ({
            ...current,
            ...summaryEntries
          }));
        }

        setSummaryError(failedCount > 0 ? t("shell.archiveSearchSummaryFailed") : null);
      })
      .finally(() => {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadedSummaryBySessionId, open, searchOpen, sessions]);

  const filteredSessions = useMemo(() => {
    const normalizedKeyword = normalizeArchiveSearchText(searchKeyword);

    if (!normalizedKeyword) {
      return sessions;
    }

    return sessions.filter((session) => {
      const normalizedTitle = normalizeArchiveSearchText(session.title);

      if (normalizedTitle.includes(normalizedKeyword)) {
        return true;
      }

      const normalizedSummary = normalizeArchiveSearchText(summaryBySessionId[session.sessionId] ?? "");
      return normalizedSummary.includes(normalizedKeyword);
    });
  }, [searchKeyword, sessions, summaryBySessionId]);

  function toggleSearch() {
    setSearchOpen((current) => {
      const nextOpen = !current;

      if (!nextOpen) {
        setSearchKeyword("");
        setSummaryError(null);
      }

      return nextOpen;
    });
  }

  return {
    searchOpen,
    searchKeyword,
    filteredSessions,
    summaryLoading,
    summaryError,
    summaryBySessionId,
    setSearchKeyword,
    toggleSearch
  };
}

export function buildArchiveSessionSearchSummary(messages: readonly HistoryMessageDto[]) {
  const snippets = [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map(buildArchiveMessageSnippet)
    .filter((snippet) => snippet.length > 0);

  if (snippets.length === 0) {
    return "";
  }

  const combinedSummary = snippets.slice(-ARCHIVE_SEARCH_SNIPPET_LIMIT).join(" · ");
  return truncateArchiveSearchText(combinedSummary, ARCHIVE_SEARCH_MAX_LENGTH);
}

function buildArchiveMessageSnippet(message: HistoryMessageDto) {
  const normalizedContent = normalizeArchiveWhitespace(message.content);

  if (normalizedContent.length > 0) {
    return truncateArchiveSearchText(normalizedContent, ARCHIVE_SEARCH_MESSAGE_MAX_LENGTH);
  }

  if (message.toolCall?.name?.trim()) {
    return truncateArchiveSearchText(message.toolCall.name.trim(), ARCHIVE_SEARCH_MESSAGE_MAX_LENGTH);
  }

  return "";
}

function normalizeArchiveSearchText(value: string) {
  return normalizeArchiveWhitespace(value).toLocaleLowerCase();
}

function normalizeArchiveWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateArchiveSearchText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
