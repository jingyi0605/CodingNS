import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { usePlatform } from "../../platform/platform-provider";

const BUILD_APP_VERSION = __APP_VERSION__;

const AppVersionContext = createContext<string>(BUILD_APP_VERSION);

export function AppVersionProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const [version, setVersion] = useState(BUILD_APP_VERSION);

  useEffect(() => {
    let disposed = false;

    if (!platform.isDesktop) {
      setVersion(BUILD_APP_VERSION);
      return () => {
        disposed = true;
      };
    }

    // 桌面端优先展示壳运行时版本，失败时退回构建版本，保证页面始终只有一个版本来源。
    void platform.bridge.getRuntimeInfo().then((result) => {
      if (disposed) {
        return;
      }

      const runtimeVersion = result.ok ? result.value?.version?.trim() : "";
      setVersion(runtimeVersion || BUILD_APP_VERSION);
    });

    return () => {
      disposed = true;
    };
  }, [platform]);

  return <AppVersionContext.Provider value={version}>{children}</AppVersionContext.Provider>;
}

export function useAppVersion(): string {
  return useContext(AppVersionContext);
}
