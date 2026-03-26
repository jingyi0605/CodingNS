import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { WorkbenchPlaceholderPage } from "./WorkbenchPlaceholderPage";

describe("WorkbenchPlaceholderPage", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      ...clientConfigStore.getState(),
      language: "zh-CN"
    });
  });

  it("显示用户友好的空会话引导", () => {
    render(<WorkbenchPlaceholderPage />);

    expect(screen.getByText("开始")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "先选一个会话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "继续" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新建" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "查看辅助信息" })).toBeInTheDocument();
    expect(screen.getByText("准备好后，从左侧选一个会话开始。")).toBeInTheDocument();
  });
});
