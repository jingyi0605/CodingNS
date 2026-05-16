import type { DocumentNode, DocumentNodeBox, DocumentProject } from "./model";

export type LayoutAlignCommand = "left" | "right" | "top" | "bottom";
export type LayoutGuideOrientation = "vertical" | "horizontal";

export interface LayoutGuideLine {
  orientation: LayoutGuideOrientation;
  position: number;
  start: number;
  end: number;
}

const MIN_LAYOUT_SIZE = 24;

export function clampLayoutBox(box: DocumentNodeBox): DocumentNodeBox {
  return {
    x: Number.isFinite(box.x) ? Math.round(box.x) : 0,
    y: Number.isFinite(box.y) ? Math.round(box.y) : 0,
    width: Math.max(MIN_LAYOUT_SIZE, Number.isFinite(box.width) ? Math.round(box.width) : MIN_LAYOUT_SIZE),
    height: Math.max(MIN_LAYOUT_SIZE, Number.isFinite(box.height) ? Math.round(box.height) : MIN_LAYOUT_SIZE),
    zIndex: Number.isFinite(box.zIndex) ? Math.round(box.zIndex) : 0
  };
}

export function markNodeWithDraftBox(
  node: DocumentNode,
  nextBox: DocumentNodeBox
): DocumentNode {
  const normalizedBox = clampLayoutBox(nextBox);
  const nextRuntimeFlags = node.runtimeFlags.includes("draft-box")
    ? node.runtimeFlags
    : [...node.runtimeFlags, "draft-box"];

  return {
    ...node,
    box: normalizedBox,
    runtimeFlags: nextRuntimeFlags
  };
}

export function applyBoxesToProject(
  project: DocumentProject,
  nextBoxesByNodeId: Record<string, DocumentNodeBox>
): DocumentProject {
  const nextNodes = {
    ...project.nodes
  };

  Object.entries(nextBoxesByNodeId).forEach(([nodeId, nextBox]) => {
    const currentNode = nextNodes[nodeId];

    if (!currentNode) {
      return;
    }

    nextNodes[nodeId] = markNodeWithDraftBox(currentNode, nextBox);
  });

  return {
    ...project,
    nodes: nextNodes
  };
}

export function alignBoxes(
  boxesByNodeId: Record<string, DocumentNodeBox>,
  command: LayoutAlignCommand
): Record<string, DocumentNodeBox> {
  const entries = Object.entries(boxesByNodeId);

  if (entries.length === 0) {
    return {};
  }

  const boundary = resolveAlignmentBoundary(entries.map(([, box]) => box), command);
  const nextBoxes: Record<string, DocumentNodeBox> = {};

  entries.forEach(([nodeId, box]) => {
    const normalizedBox = clampLayoutBox(box);

    if (command === "left") {
      nextBoxes[nodeId] = {
        ...normalizedBox,
        x: boundary
      };
      return;
    }

    if (command === "right") {
      nextBoxes[nodeId] = {
        ...normalizedBox,
        x: boundary - normalizedBox.width
      };
      return;
    }

    if (command === "top") {
      nextBoxes[nodeId] = {
        ...normalizedBox,
        y: boundary
      };
      return;
    }

    nextBoxes[nodeId] = {
      ...normalizedBox,
      y: boundary - normalizedBox.height
    };
  });

  return nextBoxes;
}

function resolveAlignmentBoundary(
  boxes: DocumentNodeBox[],
  command: LayoutAlignCommand
): number {
  if (command === "left") {
    return Math.min(...boxes.map((box) => box.x));
  }

  if (command === "right") {
    return Math.max(...boxes.map((box) => box.x + box.width));
  }

  if (command === "top") {
    return Math.min(...boxes.map((box) => box.y));
  }

  return Math.max(...boxes.map((box) => box.y + box.height));
}

export function resolveBoundingBox(boxes: DocumentNodeBox[]): DocumentNodeBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return clampLayoutBox({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    zIndex: Math.max(...boxes.map((box) => box.zIndex))
  });
}

export function resolveBoxAnchorPoints(box: DocumentNodeBox): {
  verticals: number[];
  horizontals: number[];
} {
  return {
    verticals: [
      box.x,
      box.x + (box.width / 2),
      box.x + box.width
    ],
    horizontals: [
      box.y,
      box.y + (box.height / 2),
      box.y + box.height
    ]
  };
}
