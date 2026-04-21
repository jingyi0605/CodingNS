import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrustedEntryLandingPage } from "./TrustedEntryLandingPage";

describe("TrustedEntryLandingPage", () => {
  it("会提示用户从远程访问地址重新进入", () => {
    render(<TrustedEntryLandingPage />);

    expect(screen.getByRole("heading", { name: "Open This Through Your Remote Access URL" })).toBeInTheDocument();
    expect(screen.getByText(/This trusted frontend only loads the connection UI/)).toBeInTheDocument();
  });
});
