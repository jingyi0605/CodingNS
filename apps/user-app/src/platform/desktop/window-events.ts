import type { WindowDescriptor } from "./window-descriptor";

export const DESKTOP_WINDOW_LIFECYCLE_EVENT = "desktop://window-lifecycle";

export interface DesktopWindowLifecycleEventPayload {
  descriptor: WindowDescriptor;
  isOpen: boolean;
}
