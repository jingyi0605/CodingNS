/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  CodingNSDesktop?: import("./platform/desktop/codingns-desktop-bridge").CodingNSDesktopBridge;
  __CODINGNS_DESKTOP_BRIDGE_INSTALLED__?: boolean;
}

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_TRUSTED_ENTRY_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
