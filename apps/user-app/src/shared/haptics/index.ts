import { usePlatform } from "../../platform/platform-provider";

export type { HapticPattern } from "../../platform/platform-adapter";

export function useHaptics() {
  return usePlatform().haptics;
}
