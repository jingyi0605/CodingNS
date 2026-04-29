let pageUnloading = false;
let listenersRegistered = false;

export function isPageUnloading(): boolean {
  ensureListeners();
  return pageUnloading;
}

export function resetPageUnloadStateForTesting(): void {
  pageUnloading = false;
}

export function setPageUnloadStateForTesting(nextState: boolean): void {
  pageUnloading = nextState;
}

function ensureListeners(): void {
  if (listenersRegistered || typeof window === "undefined") {
    return;
  }

  listenersRegistered = true;

  window.addEventListener("beforeunload", markPageUnloading, { capture: true });
  window.addEventListener("pagehide", markPageUnloading, { capture: true });
  window.addEventListener("pageshow", clearPageUnloading, { capture: true });
}

function markPageUnloading(): void {
  pageUnloading = true;
}

function clearPageUnloading(): void {
  pageUnloading = false;
}
