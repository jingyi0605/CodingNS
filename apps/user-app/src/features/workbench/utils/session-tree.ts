export interface SessionTreeNode<T> {
  item: T;
  depth: number;
  children: SessionTreeNode<T>[];
}

interface BuildSessionTreeOptions<T> {
  getId: (item: T) => string;
  getParentId: (item: T) => string | null;
  compare: (left: T, right: T) => number;
}

export function buildSessionTree<T>(
  items: readonly T[],
  options: BuildSessionTreeOptions<T>
): SessionTreeNode<T>[] {
  const itemById = new Map(items.map((item) => [options.getId(item), item] as const));
  const childrenByParentId = new Map<string, T[]>();
  const rootItems: T[] = [];

  for (const item of items) {
    const parentId = resolveValidParentId(item, itemById, options);

    if (!parentId) {
      rootItems.push(item);
      continue;
    }

    const siblings = childrenByParentId.get(parentId) ?? [];
    childrenByParentId.set(parentId, [...siblings, item]);
  }

  return [...rootItems]
    .sort(options.compare)
    .map((item) => buildSessionTreeNode(item, 0, childrenByParentId, options, new Set<string>()));
}

export function getSessionTreeChildren<T>(
  node: Pick<SessionTreeNode<T>, "children"> | null | undefined
): SessionTreeNode<T>[] {
  return Array.isArray(node?.children) ? node.children : [];
}

export function flattenSessionTree<T>(nodes: readonly SessionTreeNode<T>[]): T[] {
  return nodes.flatMap((node) => [node.item, ...flattenSessionTree(getSessionTreeChildren(node))]);
}

export function flattenSessionTreeNodes<T>(
  nodes: readonly SessionTreeNode<T>[]
): SessionTreeNode<T>[] {
  return nodes.flatMap((node) => [node, ...flattenSessionTreeNodes(getSessionTreeChildren(node))]);
}

export function someSessionTreeNode<T>(
  nodes: readonly SessionTreeNode<T>[],
  predicate: (item: T) => boolean
): boolean {
  return nodes.some((node) => predicate(node.item) || someSessionTreeNode(getSessionTreeChildren(node), predicate));
}

export function treeContainsSessionId<T>(
  node: SessionTreeNode<T> | null | undefined,
  sessionId: string,
  getId: (item: T) => string
): boolean {
  if (!node) {
    return false;
  }

  if (getId(node.item) === sessionId) {
    return true;
  }

  return getSessionTreeChildren(node).some((child) => treeContainsSessionId(child, sessionId, getId));
}

export function findSessionTreeAncestorIds<T>(
  nodes: readonly SessionTreeNode<T>[],
  sessionId: string,
  getId: (item: T) => string
): string[] {
  for (const node of nodes) {
    const nodeId = getId(node.item);

    if (nodeId === sessionId) {
      return [];
    }

    const childAncestorIds = findSessionTreeAncestorIds(getSessionTreeChildren(node), sessionId, getId);

    if (treeContainsSessionId(node, sessionId, getId) && childAncestorIds.length >= 0) {
      return [nodeId, ...childAncestorIds];
    }
  }

  return [];
}

function buildSessionTreeNode<T>(
  item: T,
  depth: number,
  childrenByParentId: ReadonlyMap<string, T[]>,
  options: BuildSessionTreeOptions<T>,
  visitedIds: ReadonlySet<string>
): SessionTreeNode<T> {
  const itemId = options.getId(item);
  const nextVisitedIds = new Set(visitedIds);
  nextVisitedIds.add(itemId);

  const children = [...(childrenByParentId.get(itemId) ?? [])]
    .filter((child) => !nextVisitedIds.has(options.getId(child)))
    .sort(options.compare)
    .map((child) =>
      buildSessionTreeNode(child, depth + 1, childrenByParentId, options, nextVisitedIds)
    );

  return {
    item,
    depth,
    children
  };
}

function resolveValidParentId<T>(
  item: T,
  itemById: ReadonlyMap<string, T>,
  options: BuildSessionTreeOptions<T>
): string | null {
  const parentId = normalizeSessionId(options.getParentId(item));

  if (!parentId) {
    return null;
  }

  const parentItem = itemById.get(parentId);

  if (!parentItem) {
    return null;
  }

  const visitedIds = new Set<string>([options.getId(item)]);
  let cursor: T | undefined = parentItem;

  while (cursor) {
    const cursorId = options.getId(cursor);

    if (visitedIds.has(cursorId)) {
      return null;
    }

    visitedIds.add(cursorId);
    const nextParentId = normalizeSessionId(options.getParentId(cursor));

    if (!nextParentId) {
      return parentId;
    }

    cursor = itemById.get(nextParentId);

    if (!cursor) {
      return parentId;
    }
  }

  return parentId;
}

function normalizeSessionId(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
