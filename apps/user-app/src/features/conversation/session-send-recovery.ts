import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import {
  isSessionRunning,
  type SessionActivityDisplayInput
} from "./session-activity-display";

interface UseSessionSendRecoveryInput {
  sending: boolean;
  setSending: Dispatch<SetStateAction<boolean>>;
  session: SessionActivityDisplayInput | null | undefined;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
}

export function useSessionSendRecovery(input: UseSessionSendRecoveryInput): void {
  const {
    sending,
    setSending,
    session,
    runtimeHasActiveRun,
    runtimeCanInterrupt
  } = input;
  const sawAuthoritativeActivitySinceSendRef = useRef(false);

  useEffect(() => {
    if (!sending) {
      sawAuthoritativeActivitySinceSendRef.current = false;
      return;
    }

    if (hasRuntimeActivityEvidence(session, runtimeHasActiveRun, runtimeCanInterrupt)) {
      sawAuthoritativeActivitySinceSendRef.current = true;
      return;
    }

    if (!sawAuthoritativeActivitySinceSendRef.current) {
      return;
    }

    sawAuthoritativeActivitySinceSendRef.current = false;
    setSending(false);
  }, [runtimeCanInterrupt, runtimeHasActiveRun, sending, session, setSending]);
}

export function hasRuntimeActivityEvidence(
  session: SessionActivityDisplayInput | null | undefined,
  runtimeHasActiveRun: boolean | null,
  runtimeCanInterrupt: boolean | null
): boolean {
  if (runtimeHasActiveRun === true || runtimeCanInterrupt === true) {
    return true;
  }

  if (session?.runningState === "stale" || session?.runningState === "unknown") {
    return true;
  }

  return isSessionRunning(session);
}
