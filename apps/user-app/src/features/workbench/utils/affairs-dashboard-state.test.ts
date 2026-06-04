import { describe, expect, it } from "vitest";

import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  createDefaultAffairsDashboardState,
  ensureAffairsDashboardState,
  readAffairsDashboardState,
  writeAffairsDashboardState
} from "./affairs-dashboard-state";

describe("affairs-dashboard-state", () => {
  it("会创建带默认标签页和默认块的事务工作台状态", () => {
    const state = createDefaultAffairsDashboardState("workspace-1", "2026-06-04T08:40:00.000Z");

    expect(state.workspaceId).toBe("workspace-1");
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0].id);
    expect(state.tabs[0].title).toBeTruthy();
    expect(state.tabs[0].widgets.map((widget) => widget.type)).toEqual(["todo", "automation"]);
    expect(state.tabs[0].layout.map((layout) => layout.widgetId)).toEqual(
      state.tabs[0].widgets.map((widget) => widget.id)
    );
  });

  it("能读回已经保存的事务工作台状态", () => {
    const state = createDefaultAffairsDashboardState("workspace-2", "2026-06-04T08:41:00.000Z");
    writeAffairsDashboardState(state);

    expect(readAffairsDashboardState("workspace-2")).toEqual(state);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-2");
  });

  it("快照损坏时会回退到安全默认布局", () => {
    writeViewSnapshot("workbench.affairs.dashboard.workspace-bad", {
      workspaceId: "workspace-bad",
      version: 1,
      activeTabId: "missing-tab",
      tabs: [
        {
          id: "tab-1",
          title: "",
          widgets: [
            {
              id: "widget-1",
              type: "todo",
              title: "",
              config: {},
              createdAt: "2026-06-04T08:42:00.000Z",
              updatedAt: "2026-06-04T08:42:00.000Z"
            },
            {
              id: "widget-2",
              type: "html_embed",
              title: "坏块",
              config: {},
              createdAt: "2026-06-04T08:42:00.000Z",
              updatedAt: "2026-06-04T08:42:00.000Z"
            }
          ],
          layout: [
            {
              widgetId: "widget-1",
              x: 0,
              y: 0,
              w: 6,
              h: 5
            }
          ],
          createdAt: "2026-06-04T08:42:00.000Z",
          updatedAt: "2026-06-04T08:42:00.000Z"
        }
      ],
      updatedAt: "2026-06-04T08:42:00.000Z"
    });

    const state = readAffairsDashboardState("workspace-bad");

    expect(state).toMatchObject({
      workspaceId: "workspace-bad",
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          widgets: [
            {
              id: "widget-1",
              type: "todo"
            }
          ]
        }
      ]
    });
    expect(state?.tabs[0].layout).toHaveLength(1);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-bad");
  });

  it("缺少快照时会自动创建并保存默认工作台状态", () => {
    const state = ensureAffairsDashboardState("workspace-3");

    expect(state.workspaceId).toBe("workspace-3");
    expect(state.tabs).toHaveLength(1);
    expect(readAffairsDashboardState("workspace-3")).toEqual(state);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-3");
  });
});
