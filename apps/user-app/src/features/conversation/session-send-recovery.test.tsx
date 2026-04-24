import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useSessionSendRecovery } from "./session-send-recovery";
import type { SessionActivityDisplayInput } from "./session-activity-display";

function SessionSendRecoveryHarness({
  session,
  runtimeHasActiveRun = false,
  runtimeCanInterrupt = false
}: {
  session: SessionActivityDisplayInput | null;
  runtimeHasActiveRun?: boolean | null;
  runtimeCanInterrupt?: boolean | null;
}) {
  const [sending, setSending] = useState(true);

  useSessionSendRecovery({
    sending,
    setSending,
    session,
    runtimeHasActiveRun,
    runtimeCanInterrupt
  });

  return <div data-testid="sending-state">{sending ? "sending" : "idle"}</div>;
}

describe("useSessionSendRecovery", () => {
  it("运行结束后会清掉卡死的本地发送态", async () => {
    const { rerender } = render(
      <SessionSendRecoveryHarness
        session={{
          runningState: "running",
          activityState: "running"
        }}
      />
    );

    expect(screen.getByTestId("sending-state")).toHaveTextContent("sending");

    rerender(
      <SessionSendRecoveryHarness
        session={{
          runningState: "completed",
          activityState: "idle"
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("sending-state")).toHaveTextContent("idle");
    });
  });

  it("从未观察到真实运行态时不会过早清掉发送态", async () => {
    const { rerender } = render(
      <SessionSendRecoveryHarness
        session={{
          runningState: "idle",
          activityState: "idle"
        }}
      />
    );

    rerender(
      <SessionSendRecoveryHarness
        session={{
          runningState: "completed",
          activityState: "idle"
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("sending-state")).toHaveTextContent("sending");
    });
  });
});
