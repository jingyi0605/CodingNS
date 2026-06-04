import { describe, expect, it } from "vitest";

import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { createDefaultAffairsLibraryLandingState, readAffairsViewState } from "./workbench-mode";

describe("workbench-mode", () => {
  it("进入事务模式时会默认落到文档页根目录，同时保留基础视图偏好", () => {
    const state = createDefaultAffairsLibraryLandingState("workspace-1", {
      primarySection: "conversation",
      selectedNodeId: "conversation:draft:lightweight:codex",
      selectedObjectId: "object-1",
      toolbarExpanded: true,
      detailViewerCollapsed: true,
      auxiliaryTab: "assistant",
      browseMode: "tag",
      viewMode: "list",
      selectedFolderPath: "客户资料",
      selectedFolderEntryPath: null,
      selectedTagPath: "时间/最近7天",
      selectedTagPaths: ["时间/最近7天"],
      selectedDocumentId: "doc-1",
      selectedFavoriteId: "favorite-1"
    });

    expect(state).toMatchObject({
      workspaceId: "workspace-1",
      primarySection: "library",
      selectedNodeId: "library",
      selectedObjectId: null,
      toolbarExpanded: true,
      detailViewerCollapsed: true,
      auxiliaryTab: "assistant",
      browseMode: "folder",
      viewMode: "list",
      selectedFolderPath: null,
      selectedFolderEntryPath: null,
      selectedTagPath: null,
      selectedTagPaths: [],
      selectedDocumentId: null,
      selectedFavoriteId: null
    });
  });

  it("读取旧 todo 分区快照时会迁移到 workbench", () => {
    writeViewSnapshot("workbench.affairs.state.workspace-legacy-todo", {
      workspaceId: "workspace-legacy-todo",
      primarySection: "todo",
      selectedNodeId: "todo:all",
      selectedObjectId: null
    });

    expect(readAffairsViewState("workspace-legacy-todo")).toMatchObject({
      workspaceId: "workspace-legacy-todo",
      primarySection: "workbench",
      selectedNodeId: "workbench:todo:all"
    });

    clearViewSnapshot("workbench.affairs.state.workspace-legacy-todo");
  });

  it("读取旧 automation 分区快照时会迁移到 workbench", () => {
    writeViewSnapshot("workbench.affairs.state.workspace-legacy-automation", {
      workspaceId: "workspace-legacy-automation",
      primarySection: "automation",
      selectedNodeId: "automation:all",
      selectedObjectId: null
    });

    expect(readAffairsViewState("workspace-legacy-automation")).toMatchObject({
      workspaceId: "workspace-legacy-automation",
      primarySection: "workbench",
      selectedNodeId: "workbench:overview"
    });

    clearViewSnapshot("workbench.affairs.state.workspace-legacy-automation");
  });
});
