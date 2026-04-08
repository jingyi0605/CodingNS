const BUTLER_RECORDS_UPDATED_EVENT = "butler:records-updated";

export function dispatchButlerRecordsUpdatedEvent() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(BUTLER_RECORDS_UPDATED_EVENT));
}

export function subscribeButlerRecordsUpdated(
  listener: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => {
    listener();
  };

  window.addEventListener(BUTLER_RECORDS_UPDATED_EVENT, handler);
  return () => {
    window.removeEventListener(BUTLER_RECORDS_UPDATED_EVENT, handler);
  };
}
