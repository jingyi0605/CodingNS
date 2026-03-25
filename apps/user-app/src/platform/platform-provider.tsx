import { createContext, useContext, useEffect, type ReactNode } from "react";

import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter";

const PlatformContext = createContext<PlatformAdapter | null>(null);

function applyPlatformDatasets(adapter: PlatformAdapter) {
  if (typeof document === "undefined") {
    return;
  }

  const { documentElement, body } = document;

  documentElement.dataset.runtimePlatform = adapter.platform;
  documentElement.dataset.osFamily = adapter.ui.osFamily;
  documentElement.dataset.windowControls = adapter.ui.windowControlsStyle;
  body.dataset.runtimePlatform = adapter.platform;
  body.dataset.osFamily = adapter.ui.osFamily;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const adapter = createPlatformAdapter();

  useEffect(() => {
    applyPlatformDatasets(adapter);
  }, [adapter]);

  return <PlatformContext.Provider value={adapter}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  return context ?? createPlatformAdapter();
}
