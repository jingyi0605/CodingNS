import { describe, expect, it } from "vitest";

import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import {
  createAffairsShortcutAppState,
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
    expect(state.layoutLocked).toBe(true);
    expect(state.shortcutApps).toEqual([]);
  });

  it("能读回已经保存的事务工作台状态", () => {
    const state = createDefaultAffairsDashboardState("workspace-2", "2026-06-04T08:41:00.000Z");
    state.shortcutApps = [
      createAffairsShortcutAppState(
        {
          title: "会员工具",
          workspaceId: "workspace-2",
          entryPath: "tools/members/index.html"
        },
        "2026-06-04T08:41:00.000Z"
      )
    ];
    writeAffairsDashboardState(state);

    expect(readAffairsDashboardState("workspace-2")).toEqual(state);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-2");
  });

  it("快照损坏时会回退到安全默认布局，并过滤非法快捷应用", () => {
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
      shortcutApps: [
        {
          id: "shortcut-1",
          title: "报表",
          workspaceId: "workspace-bad",
          sourceId: "reports/index.html",
          entryPath: "reports/index.html",
          createdAt: "2026-06-04T08:42:00.000Z",
          updatedAt: "2026-06-04T08:42:00.000Z"
        },
        {
          id: "shortcut-2",
          title: "not-html",
          sourceId: "docs/readme.md",
          entryPath: "docs/readme.md",
          createdAt: "2026-06-04T08:42:00.000Z",
          updatedAt: "2026-06-04T08:42:00.000Z"
        }
      ],
      updatedAt: "2026-06-04T08:42:00.000Z"
    });

    const state = readAffairsDashboardState("workspace-bad");

    expect(state).toMatchObject({
      workspaceId: "workspace-bad",
      layoutLocked: true,
      activeTabId: "tab-1",
      shortcutApps: [
        {
          id: "shortcut-1",
          workspaceId: "workspace-bad",
          entryPath: "reports/index.html"
        }
      ],
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

  it("会把旧版 html_app/html_stat/html_embed 快照迁成统一 html + variant 模型", () => {
    writeViewSnapshot("workbench.affairs.dashboard.workspace-legacy-html", {
      workspaceId: "workspace-legacy-html",
      version: 2,
      activeTabId: "tab-html",
      tabs: [
        {
          id: "tab-html",
          title: "旧工作台",
          widgets: [
            {
              id: "widget-app",
              type: "html_app",
              title: "",
              sourceRef: {
                kind: "html_shortcut",
                sourceId: "tools/app/index.html"
              },
              config: {},
              createdAt: "2026-06-04T08:50:00.000Z",
              updatedAt: "2026-06-04T08:50:00.000Z"
            },
            {
              id: "widget-stat",
              type: "html_stat",
              title: "",
              sourceRef: {
                kind: "html_shortcut",
                sourceId: "tools/stat/index.html"
              },
              config: {
                variant: "stat"
              },
              createdAt: "2026-06-04T08:50:00.000Z",
              updatedAt: "2026-06-04T08:50:00.000Z"
            },
            {
              id: "widget-embed",
              type: "html_embed",
              title: "嵌入页",
              sourceRef: {
                kind: "html_shortcut",
                sourceId: "tools/embed/index.html"
              },
              config: {},
              createdAt: "2026-06-04T08:50:00.000Z",
              updatedAt: "2026-06-04T08:50:00.000Z"
            }
          ],
          layout: [
            { widgetId: "widget-app", x: 0, y: 0, w: 6, h: 5 },
            { widgetId: "widget-stat", x: 6, y: 0, w: 4, h: 4 },
            { widgetId: "widget-embed", x: 0, y: 5, w: 12, h: 7 }
          ],
          createdAt: "2026-06-04T08:50:00.000Z",
          updatedAt: "2026-06-04T08:50:00.000Z"
        }
      ],
      shortcutApps: [],
      updatedAt: "2026-06-04T08:50:00.000Z"
    });

    const state = ensureAffairsDashboardState("workspace-legacy-html");

    expect(state.version).toBe(5);
    expect(state.layoutLocked).toBe(true);
    expect(state.tabs[0].widgets).toMatchObject([
      {
        id: "widget-app",
        type: "html",
        variant: "app",
        title: "index.html",
        sourceRef: {
          sourceId: "tools/app/index.html"
        }
      },
      {
        id: "widget-stat",
        type: "html",
        variant: "stat",
        title: "index.html",
        sourceRef: {
          sourceId: "tools/stat/index.html"
        },
        config: {}
      },
      {
        id: "widget-embed",
        type: "html",
        variant: "embed",
        title: "嵌入页",
        sourceRef: {
          sourceId: "tools/embed/index.html"
        }
      }
    ]);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-legacy-html");
  });

  it("缺少快照时会自动创建并保存默认工作台状态", () => {
    const state = ensureAffairsDashboardState("workspace-3");

    expect(state.workspaceId).toBe("workspace-3");
    expect(state.layoutLocked).toBe(true);
    expect(state.tabs).toHaveLength(1);
    expect(readAffairsDashboardState("workspace-3")).toEqual(state);

    clearViewSnapshot("workbench.affairs.dashboard.workspace-3");
  });
});
