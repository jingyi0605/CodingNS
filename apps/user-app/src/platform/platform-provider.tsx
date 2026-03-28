import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  documentElement.dataset.viewportClass = adapter.viewportClass;
  documentElement.dataset.overlayTitlebar = String(adapter.ui.prefersOverlayTitlebar);

  if (body) {
    body.dataset.runtimePlatform = adapter.platform;
    body.dataset.osFamily = adapter.ui.osFamily;
    body.dataset.windowControls = adapter.ui.windowControlsStyle;
    body.dataset.viewportClass = adapter.viewportClass;
    body.dataset.overlayTitlebar = String(adapter.ui.prefersOverlayTitlebar);
  }
}

function readViewportWidth() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.innerWidth;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [viewportWidth, setViewportWidth] = useState<number | undefined>(() => readViewportWidth());
  const adapter = useMemo(
    () => createPlatformAdapter({ viewportWidth }),
    [viewportWidth]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    applyPlatformDatasets(adapter);
  }, [adapter]);

  return <PlatformContext.Provider value={adapter}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);
  return context ?? createPlatformAdapter();
}
