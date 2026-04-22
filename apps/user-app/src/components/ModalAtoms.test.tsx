import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ModalActions,
  ModalEmptyState,
  ModalField,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "./ModalAtoms";

describe("ModalAtoms", () => {
  it("会渲染分组、字段、标签和空态结构", () => {
    render(
      <ModalSection
        heading="运行时方案"
        description="统一展示说明和分组内容。"
        actions={<ModalTag tone="warning">注意</ModalTag>}
      >
        <ModalField label="工作区" description="从固定列表里选择目标工作区。">
          <input id="workspace" defaultValue="Demo Workspace" />
        </ModalField>
        <ModalEmptyState
          title="当前没有候选项"
          description="请先创建数据，再回来继续操作。"
        />
      </ModalSection>
    );

    expect(screen.getByText("运行时方案")).toBeInTheDocument();
    expect(screen.getByText("统一展示说明和分组内容。")).toBeInTheDocument();
    expect(screen.getByText("注意")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("工作区")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Demo Workspace")).toBeInTheDocument();
    expect(screen.getByText("当前没有候选项")).toBeInTheDocument();
  });

  it("会渲染统一列表项和按钮区，并支持按钮项点击", () => {
    const onSelect = vi.fn();

    render(
      <>
        <ModalList role="list">
          <ModalListItem
            as="button"
            label="Docs Workspace"
            description="/Users/jackson/Code/Docs"
            selected
            trailing={<span>已选中</span>}
            onClick={onSelect}
          />
        </ModalList>
        <ModalActions align="between" stack>
          <button type="button">取消</button>
          <button type="button">确认</button>
        </ModalActions>
      </>
    );

    const listItem = screen.getByRole("button", { name: /Docs Workspace/ });
    const actions = screen.getByText("取消").closest(".modal-actions");

    if (!(actions instanceof HTMLDivElement)) {
      throw new Error("未找到统一按钮区");
    }

    fireEvent.click(listItem);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(listItem).toHaveAttribute("data-selected", "true");
    expect(actions).toHaveAttribute("data-align", "between");
    expect(actions).toHaveAttribute("data-stack", "true");
  });

  it("允许列表项承载块级内容和块级 trailing", () => {
    render(
      <ModalList>
        <ModalListItem
          as="button"
          trailing={(
            <div data-testid="modal-item-trailing-content">
              <span>已选中</span>
            </div>
          )}
        >
          <div data-testid="modal-item-copy-content">
            <strong>项目一</strong>
            <span>/repo/project-one</span>
          </div>
        </ModalListItem>
      </ModalList>
    );

    const listItem = screen.getByRole("button", { name: /项目一/ });
    const copyWrapper = screen.getByTestId("modal-item-copy-content").parentElement;
    const trailingWrapper = screen.getByTestId("modal-item-trailing-content").parentElement;

    expect(listItem).toHaveTextContent("项目一");
    expect(listItem).toHaveTextContent("/repo/project-one");
    expect(copyWrapper?.tagName).toBe("DIV");
    expect(trailingWrapper?.tagName).toBe("DIV");
  });
});
