export const BUTLER_INBOX_UPDATED_EVENT = "butler:inbox-updated";

export function dispatchButlerInboxUpdatedEvent(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(BUTLER_INBOX_UPDATED_EVENT));
}
