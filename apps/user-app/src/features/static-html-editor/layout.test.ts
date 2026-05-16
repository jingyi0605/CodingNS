import { describe, expect, it } from "vitest";

import type { DocumentNode, DocumentProject } from "./model";
import { alignBoxes, applyBoxesToProject, clampLayoutBox, markNodeWithDraftBox, resolveBoundingBox, resolveBoxAnchorPoints } from "./layout";

describe("static html layout helpers", () => {
  it("会给几何覆盖节点补上 draft-box 标记，并约束最小尺寸", () => {
    const node = {
      id: "node-1",
      type: "text",
      name: "标题",
      editable: true,
      lockedReason: null,
      box: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        zIndex: 0
      },
      style: {},
      content: {
        text: "标题"
      },
      children: [],
      sourceRef: null,
      patchStrategy: "text_and_style",
      runtimeFlags: []
    } satisfies DocumentNode;

    const nextNode = markNodeWithDraftBox(node, {
      x: 12.4,
      y: 18.6,
      width: 3,
      height: 5,
      zIndex: 0
    });

    expect(nextNode.runtimeFlags).toContain("draft-box");
    expect(nextNode.box).toEqual({
      x: 12,
      y: 19,
      width: 24,
      height: 24,
      zIndex: 0
    });
  });

  it("会批量把几何结果写回项目节点", () => {
    const project = {
      id: "project-1",
      schemaVersion: 1,
      mode: "presentation",
      source: {
        kind: "codingns",
        path: "demo.html",
        version: "v1",
        entryHtmlHash: "hash"
      },
      canvas: {
        width: 1600,
        height: 900,
        unit: "px",
        aspectRatioLocked: true
      },
      pages: [],
      nodes: {
        "node-1": {
          id: "node-1",
          type: "text",
          name: "标题",
          editable: true,
          lockedReason: null,
          box: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            zIndex: 0
          },
          style: {},
          content: {
            text: "标题"
          },
          children: [],
          sourceRef: null,
          patchStrategy: "text_and_style",
          runtimeFlags: []
        }
      },
      assets: [],
      warnings: [],
      meta: {
        originalTitle: null,
        pageDetectionStrategy: "section-slide"
      }
    } satisfies DocumentProject;

    const nextProject = applyBoxesToProject(project, {
      "node-1": {
        x: 120,
        y: 180,
        width: 320,
        height: 96,
        zIndex: 2
      }
    });

    expect(nextProject.nodes["node-1"]?.box).toEqual({
      x: 120,
      y: 180,
      width: 320,
      height: 96,
      zIndex: 2
    });
    expect(nextProject.nodes["node-1"]?.runtimeFlags).toContain("draft-box");
  });

  it("会按当前选区包围盒做左右上下对齐", () => {
    const boxes = {
      a: {
        x: 40,
        y: 80,
        width: 100,
        height: 60,
        zIndex: 0
      },
      b: {
        x: 140,
        y: 20,
        width: 80,
        height: 40,
        zIndex: 0
      }
    };

    expect(alignBoxes(boxes, "left")).toEqual({
      a: clampLayoutBox(boxes.a),
      b: {
        ...clampLayoutBox(boxes.b),
        x: 40
      }
    });

    expect(alignBoxes(boxes, "right")).toEqual({
      a: {
        ...clampLayoutBox(boxes.a),
        x: 120
      },
      b: clampLayoutBox(boxes.b)
    });

    expect(alignBoxes(boxes, "top")).toEqual({
      a: {
        ...clampLayoutBox(boxes.a),
        y: 20
      },
      b: clampLayoutBox(boxes.b)
    });

    expect(alignBoxes(boxes, "bottom")).toEqual({
      a: clampLayoutBox(boxes.a),
      b: {
        ...clampLayoutBox(boxes.b),
        y: 100
      }
    });
  });

  it("会计算多选包围盒和九宫格锚点", () => {
    const boundingBox = resolveBoundingBox([
      { x: 40, y: 80, width: 100, height: 60, zIndex: 0 },
      { x: 140, y: 20, width: 80, height: 40, zIndex: 2 }
    ]);

    expect(boundingBox).toEqual({
      x: 40,
      y: 20,
      width: 180,
      height: 120,
      zIndex: 2
    });

    expect(resolveBoxAnchorPoints(boundingBox!)).toEqual({
      verticals: [40, 130, 220],
      horizontals: [20, 80, 140]
    });
  });

  it("画布中心线和边缘也能作为吸附参考点来源", () => {
    const canvasBox = { x: 0, y: 0, width: 1600, height: 900, zIndex: 0 };

    expect(resolveBoxAnchorPoints(canvasBox)).toEqual({
      verticals: [0, 800, 1600],
      horizontals: [0, 450, 900]
    });
  });
});
