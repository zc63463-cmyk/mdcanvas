/**
 * 结构布局注册表（v1）：组织架构(org) / 横向时间轴(timeline) / 鱼骨(fishbone)。
 * 共享工具来自 mindmap.ts（buildLayoutTree/annotateTree/collectLayout/layoutBounds）。
 * 布局类型经根节点 note.layout 持久化（正文单一事实源；旧文件缺省回退 mindmap）。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { GrowDir } from './mindmap.js'; // 复审修复：取型自基座，打破 forest↔layouts 循环
import {
  annotateTree,
  bezierLink,
  buildLayoutTree,
  collectLayout,
  H_GAP,
  isGrowDir,
  layoutMindmap,
  layoutBounds,
  orgBeamLink,
  orgBeamLinkUp,
  placeSubtree,
  subtreeHeightCached,
  V_GAP,
  type LayoutCache,
  type LayoutNode,
  type LayoutResult,
  type LinkBuilder,
  type MeasureFn,
} from './mindmap.js';

export type LayoutKind =
  | 'mindmap'
  | 'org'
  /** 组织架构向上生长（G6′ 四向：与 org 镜像） */
  | 'org-up'
  | 'timeline'
  | 'fishbone'
  | 'logic-right'
  | 'logic-left';

export type LayoutFunc = (
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
) => LayoutResult;

export const SUB_GAP = 28;

// ---------- org：自顶向下行式（同层同行、子行下沉） ----------
function subtreeWidth(ln: LayoutNode): number {
  if (ln.children.length === 0) return ln.box.w;
  const cw =
    ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
  return Math.max(ln.box.w, cw);
}

function placeOrg(ln: LayoutNode, cx: number, y: number, dir: 1 | -1): void {
  ln.box.x = cx - ln.box.w / 2;
  ln.box.y = y;
  if (ln.children.length > 0) {
    const total =
      ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
    // dir=1 子行下沉（自顶向下）；dir=-1 子行上浮（自底向上）
    const childY = y + dir * (ln.box.h + V_GAP);
    let x = cx - total / 2;
    for (const c of ln.children) {
      placeOrg(c, x + subtreeWidth(c) / 2, childY, dir);
      x += subtreeWidth(c) + SUB_GAP;
    }
  }
}

/**
 * 组织架构布局（G6′：支持 direction，1 = 自顶向下 / -1 = 自底向上）。
 * 缺省 1，与既有行为逐位一致。
 */
export function layoutOrg(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  direction: 1 | -1 = 1,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  placeOrg(tree, 0, 0, direction);
  const link: LinkBuilder =
    direction > 0
      ? (p, c) =>
          orgBeamLink(
            p,
            c,
            (p.box.y + p.box.h + Math.min(...p.children.map((k) => k.box.y))) / 2,
          )
      : (p, c) =>
          orgBeamLinkUp(
            p,
            c,
            (p.box.y + Math.max(...p.children.map((k) => k.box.y + k.box.h))) / 2,
          );
  const { nodes, links } = collectLayout(tree, link);
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
  'org-up': (r, m, c) => layoutOrg(r, m, c, -1),
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

// ============================================================================
// D2′ 节点级生长方向（思想分叉）布局分组调度
//
// 设计（设计文档 §5 D2′）：
// - 每节点把子节点按**有效 dir** 分 right/left/up/down 四组，每组递归布局，
//   各组挂对应侧——天然实现「同节点多向分叉」
// - 邻侧防叠：right↔down、down↔left、left↔up、up↔right 相邻组 bounds 检测 +
//   **布局期一次推开**（参考 PG resolveSubtreeOverlaps，但不迭代、不运行期）
// - 缺省 = 继承（最近显式 dir 祖先 → islandDir）；非法值由读侧（growDir.ts）过滤，
//   本层只消费合法 GrowDir
// - 无 dir 声明（或 dir 映射为空/全树无命中）→ 逐像素回退经典 layoutMindmap
//   （保证旧文件布局零变更）
// - kernel 零 DOM：dir 信息经 opts.explicitDirByNodeId 注入，不读取任何 note
// ============================================================================

/** 布局入参：节点级有效方向信息（由 pipeline 解析 note.dir 后注入；本模块纯消费） */
export interface BranchLayoutOptions {
  /**
   * 显式 dir 声明：nodeId → GrowDir（来自 note.dir，已通过读侧校验）。
   * 缺失 = 继承（取父节点的有效 dir；根取 islandDir）。
   */
  explicitDirByNodeId?: Map<string, GrowDir>;
  /** 岛/根缺省方向（无显式 dir 时的归宿）。缺省 'right'（与 forest.DEFAULT_ROOT_DIR 一致） */
  islandDir?: GrowDir;
  /**
   * 无 dir 声明时的回退布局。缺省 layoutMindmap（经典左右平衡，管线无岛路径用）。
   * 岛内必须传 LAYOUT_BY_DIR[dir]——岛内原语义是「整棵朝该方向生长」，
   * 与经典 mindmap 的左右平衡不同（接线实测：直接回退 layoutMindmap 会破坏
   * forest 四向生长测试）。
   */
  fallback?: (r: EditableNode, m: MeasureFn, c: Set<string>) => LayoutResult;
  /** 增量缓存（透传 layoutMindmap 回退路径；分支路径为全量，忽略缓存命中） */
  cache?: LayoutCache;
  /** 度量语义键（透传回退路径） */
  measureKey?: string;
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** 子树局部包围盒（含 node 自身盒） */
export function subtreeBBox(ln: LayoutNode): BBox {
  const b: BBox = {
    minX: ln.box.x,
    minY: ln.box.y,
    maxX: ln.box.x + ln.box.w,
    maxY: ln.box.y + ln.box.h,
  };
  for (const c of ln.children) {
    const cb = subtreeBBox(c);
    if (cb.minX < b.minX) b.minX = cb.minX;
    if (cb.minY < b.minY) b.minY = cb.minY;
    if (cb.maxX > b.maxX) b.maxX = cb.maxX;
    if (cb.maxY > b.maxY) b.maxY = cb.maxY;
  }
  return b;
}

/** 平移整棵子树（盒 + 后代盒） */
export function translateSubtree(ln: LayoutNode, dx: number, dy: number): void {
  ln.box.x += dx;
  ln.box.y += dy;
  for (const c of ln.children) translateSubtree(c, dx, dy);
}
