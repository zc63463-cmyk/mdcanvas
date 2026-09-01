/**
 * 结构布局注册表（v1）：组织架构(org) / 横向时间轴(timeline) / 鱼骨(fishbone)。
 * 共享工具来自 mindmap.ts（buildLayoutTree/annotateTree/collectLayout/layoutBounds）。
 * 布局类型经根节点 note.layout 持久化（正文单一事实源；旧文件缺省回退 mindmap）。
 */
import type { EditableNode } from '../tree/treeOps.js';
import {
  annotateTree,
  buildLayoutTree,
  collectLayout,
  H_GAP,
  layoutMindmap,
  layoutBounds,
  orgBeamLink,
  placeSubtree,
  subtreeHeightCached,
  V_GAP,
  type LayoutNode,
  type LayoutResult,
  type MeasureFn,
} from './mindmap.js';

export type LayoutKind = 'mindmap' | 'org' | 'timeline' | 'fishbone' | 'logic-right' | 'logic-left';

export type LayoutFunc = (
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
) => LayoutResult;

const SUB_GAP = 28;

// ---------- org：自顶向下行式（同层同行、子行下沉） ----------
function subtreeWidth(ln: LayoutNode): number {
  if (ln.children.length === 0) return ln.box.w;
  const cw =
    ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
  return Math.max(ln.box.w, cw);
}

function placeOrg(ln: LayoutNode, cx: number, y: number): void {
  ln.box.x = cx - ln.box.w / 2;
  ln.box.y = y;
  if (ln.children.length > 0) {
    const total =
      ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
    const childY = y + ln.box.h + V_GAP;
    let x = cx - total / 2;
    for (const c of ln.children) {
      placeOrg(c, x + subtreeWidth(c) / 2, childY);
      x += subtreeWidth(c) + SUB_GAP;
    }
  }
}

export function layoutOrg(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  placeOrg(tree, 0, 0);
  const { nodes, links } = collectLayout(tree, (p, c) =>
    orgBeamLink(p, c, (p.box.y + p.box.h + Math.min(...p.children.map((k) => k.box.y))) / 2),
  );
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- timeline：横向时间轴（深度列向右展开，列内垂直堆叠） ----------

export function layoutTimeline(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  const byDepth = new Map<number, LayoutNode[]>();
  const walk = (ln: LayoutNode): void => {
    const list = byDepth.get(ln.depth) ?? [];
    list.push(ln);
    byDepth.set(ln.depth, list);
    for (const c of ln.children) walk(c);
  };
  walk(tree);
  const colX = new Map<number, number>();
  let cursorX = 0;
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    colX.set(d, cursorX);
    const maxW = byDepth.get(d)?.reduce((m, n) => Math.max(m, n.box.w), 0) ?? 0;
    cursorX += maxW + H_GAP;
  }
  for (const d of depths) {
    let y = 0;
    for (const n of byDepth.get(d) ?? []) {
      n.box.x = colX.get(d) ?? 0;
      n.box.y = y;
      y += n.box.h + V_GAP;
    }
  }
  const { nodes, links } = collectLayout(tree);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- fishbone：根左侧，一级分支上下交错（+1/-1），后代同侧延续 ----------

function placeFishbone(
  ln: LayoutNode,
  cursor: { up: number; down: number },
  columnX: number,
): void {
  const side = ln.side;
  ln.box.x = columnX;
  if (side > 0) {
    ln.box.y = cursor.up - ln.box.h;
    cursor.up -= ln.box.h + V_GAP;
  } else {
    ln.box.y = cursor.down;
    cursor.down += ln.box.h + V_GAP;
  }
  const childCol = columnX + ln.box.w + H_GAP;
  for (const c of ln.children) placeFishbone(c, cursor, childCol);
}

export function layoutFishbone(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  tree.box.x = 0;
  tree.box.y = 0;
  // 一级分支按文档序 +1/-1 交替，后代继承侧向
  const assignSides = (ln: LayoutNode, side: -1 | 0 | 1): void => {
    ln.side = side;
    for (const c of ln.children) assignSides(c, side);
  };
  let next: -1 | 1 = 1;
  for (const c of tree.children) {
    assignSides(c, next);
    next = next === 1 ? -1 : 1;
  }
  placeFishbone(tree, { up: 0, down: 0 }, 0);
  const { nodes, links } = collectLayout(tree);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- logic：单侧逻辑图（全部同侧延伸；direction=1 右 / -1 左） ----------

export function layoutLogic(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  direction: 1 | -1,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  tree.box.x = -tree.box.w / 2;
  tree.box.y = -tree.box.h / 2;
  const forceSide = (ln: LayoutNode): void => {
    ln.side = direction;
    for (const c of ln.children) forceSide(c);
  };
  for (const c of tree.children) forceSide(c);
  const total =
    tree.children.reduce((s, c) => s + subtreeHeightCached(c), 0) +
    V_GAP * Math.max(0, tree.children.length - 1);
  let cursor = -total / 2;
  for (const child of tree.children) {
    placeSubtree(child, direction, cursor, direction > 0 ? tree.box.x + tree.box.w : tree.box.x);
    cursor += subtreeHeightCached(child) + V_GAP;
  }
  const { nodes, links } = collectLayout(tree);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- 注册表 ----------

const REGISTRY: Record<LayoutKind, LayoutFunc> = {
  mindmap: layoutMindmap,
  org: layoutOrg,
  timeline: layoutTimeline,
  fishbone: layoutFishbone,
  'logic-right': (r, m, c) => layoutLogic(r, m, c, 1),
  'logic-left': (r, m, c) => layoutLogic(r, m, c, -1),
};

export function getLayout(kind: LayoutKind): LayoutFunc {
  return REGISTRY[kind] ?? layoutMindmap;
}

export function isLayoutKind(value: string | undefined): value is LayoutKind {
  return typeof value === 'string' && value in REGISTRY;
}
