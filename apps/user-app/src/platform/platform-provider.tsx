import { createContext, useContext, type ReactNode } from "react";

import { createPlatformAdapter, type PlatformAdapter } from "./platform-adapter";

const PlatformContext = createContext<PlatformAdapter | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  return (
    <PlatformContext.Provider value={createPlatformAdapter()}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformAdapter {
  const context = useContext(PlatformContext);

  if (!context) {
    throw new Error("Platform context is unavailable.");
  }

  return context;
}
