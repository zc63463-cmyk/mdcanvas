/**
 * 思维导图布局引擎（自研，零依赖）：
 * 经典左右平衡 —— 根居中，一级分支按子树高度贪心分配至左右两侧；
 * 每侧垂直堆叠（子树根节点在其子树槽位内垂直居中），水平按层外扩。
 * 连线：三次贝塞尔（水平切线，控制点取中点 x）。
 */

import type { EditableNode } from '../tree/treeOps.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LinkGeometry {
  path: string;
  depth: number;
  fromId: string;
  toId: string;
}

export interface LayoutNode {
  node: EditableNode;
  box: Box;
  /** -1 左 / 0 根 / 1 右 */
  side: -1 | 0 | 1;
  depth: number;
  parentId: string | null;
  children: LayoutNode[];
}

export interface LayoutResult {
  /** 前序遍历的所有可见节点 */
  nodes: LayoutNode[];
  links: LinkGeometry[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export type MeasureFn = (node: EditableNode) => { w: number; h: number };

export const H_GAP = 64;
export const V_GAP = 14;

/**
 * 增量布局缓存（M5-T6）：按 EditableNode 身份缓存「子树高度 / 已构建子树 / 放置戳」。
 * 前置契约（调用方保证，违反只影响提速、不影响正确性——结果恒等于全量）：
 * - collapsedIds 集合对象身份变化（任何折叠增删）→ 须传入新 cache 或调 reset()
 * - measure 语义变化（字体/实体/展开态等）→ 换 measureKey 或 reset()
 * 不可变树的编辑（updateNode/addChild/removeNode/moveNode）不改未变子树的对象身份，
 * 缓存可跨调用命中 → 仅重算受影响分支。
 */
export class LayoutCache {
  /** 子树高度（EditableNode 身份键；折叠节点不入缓存） */
  heights = new WeakMap<EditableNode, number>();
  /** 上次构建的 LayoutNode（子树复用载体；含盒/子节点） */
  nodes = new WeakMap<EditableNode, LayoutNode>();
  /** 放置戳（LayoutNode → 上次放置参数；相同则跳过重放） */
  stamps = new WeakMap<LayoutNode, { side: -1 | 1; top: number; xEdge: number }>();
  /** 子树收集缓存（前序节点 + 连线；放置重放时失效——连线由盒坐标决定） */
  collects = new WeakMap<LayoutNode, { nodes: LayoutNode[]; links: LinkGeometry[] }>();
  /** 子树包围盒缓存（放置重放时失效） */
  bounds = new WeakMap<LayoutNode, { minX: number; minY: number; maxX: number; maxY: number }>();
  /** 缓存有效键 */
  collapsedKey: Set<string> | null = null;
  measureKey: string | null = null;

  reset(): void {
    this.heights = new WeakMap();
    this.nodes = new WeakMap();
    this.stamps = new WeakMap();
    this.collects = new WeakMap();
    this.bounds = new WeakMap();
    this.collapsedKey = null;
    this.measureKey = null;
  }
}

export interface LayoutOptions {
  /** 增量缓存（提供且键匹配 → 仅重算受影响分支；缺省 = 全量） */
  cache?: LayoutCache;
  /** 度量语义键（字体/实体/展开态变化应换键 → 强制全量） */
  measureKey?: string;
}

/**
 * HP1: subtreeHeightCached 真正的 WeakMap 缓存。
 * 每个 LayoutNode 的子树高度只计算一次，之后直接命中。
 * 导出供测试与外部诊断读取（注意 WeakMap 没有 .size，需逐个 .has() 校验）。
 */
export const __subtreeHeightCache = new WeakMap<LayoutNode, number>();

export function layoutMindmap(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: LayoutOptions = {},
): LayoutResult {
  const cache = opts.cache;
  const cacheValid =
    cache !== undefined &&
    cache.collapsedKey === collapsedIds &&
    cache.measureKey === (opts.measureKey ?? null);
  if (cache && !cacheValid) {
    // 折叠或度量语义变化 → 缓存作废，全量重算（结果仍与全量一致）
    cache.reset();
    cache.collapsedKey = collapsedIds;
    cache.measureKey = opts.measureKey ?? null;
  }
  const heights = cache ? cache.heights : new WeakMap<EditableNode, number>();

  // 子树高度（含折叠剪枝；EditableNode 身份缓存——未变子树 O(1) 命中）
  const subtreeHeightOf = (node: EditableNode): number => {
    if (collapsedIds.has(node.id)) return measure(node).h;
    const hit = heights.get(node);
    if (hit !== undefined) return hit;
    const m = measure(node);
    let hh = m.h;
    if (node.children.length > 0) {
      let sum = 0;
      for (const c of node.children) sum += subtreeHeightOf(c) + V_GAP;
      hh = Math.max(m.h, sum - V_GAP);
    }
    heights.set(node, hh);
    return hh;
  };

  // 构建（子树复用：身份 + side/depth/parentId 全匹配 → 整棵复用，跳过 measure 与递归。
  // 折叠一致性由缓存键保证：collapsedIds 集合身份不变 → 复用子树内的折叠态与缓存时一致）
  const build = (
    node: EditableNode,
    depth: number,
    side: -1 | 0 | 1,
    parentId: string | null,
  ): LayoutNode => {
    if (cache) {
      const cached = cache.nodes.get(node);
      if (
        cached &&
        cached.side === side &&
        cached.depth === depth &&
        cached.parentId === parentId
      ) {
        return cached;
      }
    }
    const m = measure(node);
    const children: LayoutNode[] = !collapsedIds.has(node.id)
      ? node.children.map((c) => build(c, depth + 1, side, node.id))
      : [];
    const ln: LayoutNode = {
      node,
      box: { x: 0, y: 0, w: m.w, h: m.h },
      side,
      depth,
      parentId,
      children,
    };
    if (cache) cache.nodes.set(node, ln);
    return ln;
  };

  // 3. 根的子女分配左右（按子树高度贪心均衡，保持文档顺序；高度全走缓存）
  const rootChildrenSide = new Map<string, -1 | 1>();
  let leftH = 0;
  let rightH = 0;
  for (const child of root.children) {
    const h = subtreeHeightOf(child);
    // 平局归右（首个分支去右侧，符合思维导图惯例）
    const side: -1 | 1 = leftH + h / 2 < rightH + h / 2 ? -1 : 1;
    if (side === -1) leftH += h + V_GAP;
    else rightH += h + V_GAP;
    rootChildrenSide.set(child.id, side);
  }

  // 4. 根盒居中于原点 + 直接以正确 side 构建（side 翻转的子树自动重算）
  const rootMeasure = measure(root);
  const rootNode: LayoutNode = {
    node: root,
    box: { x: -rootMeasure.w / 2, y: -rootMeasure.h / 2, w: rootMeasure.w, h: rootMeasure.h },
    side: 0,
    depth: 0,
    parentId: null,
    children: root.children.map((c) => build(c, 1, rootChildrenSide.get(c.id) ?? 1, root.id)),
  };

  // 5. 两侧垂直堆叠（放置戳相同 → 跳过整棵重放；改变的分支递归只重算受影响路径）
  for (const side of [1, -1] as const) {
    const sideChildren = rootNode.children.filter((c) => c.side === side);
    if (sideChildren.length === 0) continue;
    let total = 0;
    for (const c of sideChildren) total += subtreeHeightOf(c.node);
    total += V_GAP * (sideChildren.length - 1);
    let cursor = -total / 2;
    for (const child of sideChildren) {
      placeSubtreeIncremental(
        child,
        side,
        cursor,
        side > 0 ? rootNode.box.x + rootNode.box.w : rootNode.box.x,
        cache,
      );
      cursor += subtreeHeightOf(child.node) + V_GAP;
    }
  }

  // 5b. 预热根（HP1 契约：每个节点都存在于 subtreeHeight 缓存；未变子树全部命中，仅变更路径实际计算）
  subtreeHeightCached(rootNode);

  // 6. 收集前序 + 连线（复用子树直接取缓存收集——连线 path 是最重开销，O(1) 命中）
  const { nodes, links } = collectCached(rootNode, cache);

  // 7. 包围盒（复用子树取缓存盒，根级仅并集 O(分支 × 深度)）
  const bounds = boundsOf(rootNode, cache);

  return { nodes, links, bounds };
}

/** 增量收集：子树未变（放置未重放）→ 直接取缓存的前序/连线；否则递归收集并缓存 */
function collectCached(
  ln: LayoutNode,
  cache: LayoutCache | undefined,
): { nodes: LayoutNode[]; links: LinkGeometry[] } {
  const hit = cache?.collects.get(ln);
  if (hit) return hit;
  const nodes: LayoutNode[] = [ln];
  const links: LinkGeometry[] = [];
  for (const c of ln.children) {
    const cc = collectCached(c, cache);
    for (const n of cc.nodes) nodes.push(n);
    links.push({ path: bezierLink(ln, c), depth: ln.depth, fromId: ln.node.id, toId: c.node.id });
    for (const l of cc.links) links.push(l);
  }
  const result = { nodes, links };
  if (cache) cache.collects.set(ln, result);
  return result;
}

/** 增量包围盒：复用子树取缓存盒，仅并集路径实际计算 */
function boundsOf(
  ln: LayoutNode,
  cache: LayoutCache | undefined,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const hit = cache?.bounds.get(ln);
  if (hit) return hit;
  let minX = ln.box.x;
  let minY = ln.box.y;
  let maxX = ln.box.x + ln.box.w;
  let maxY = ln.box.y + ln.box.h;
  for (const c of ln.children) {
    const b = boundsOf(c, cache);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const result = { minX, minY, maxX, maxY };
  if (cache) cache.bounds.set(ln, result);
  return result;
}

/**
 * 增量放置：放置参数（side/top/xEdge）与上次一致 → 跳过整棵（坐标是这些参数的确定性函数）；
 * 否则递归重放——子节点同样按戳跳过，改变路径之外的兄弟保持原位。
 */
function placeSubtreeIncremental(
  ln: LayoutNode,
  side: -1 | 1,
  top: number,
  xEdge: number,
  cache: LayoutCache | undefined,
): void {
  const prev = cache?.stamps.get(ln);
  if (prev && prev.side === side && prev.top === top && prev.xEdge === xEdge) return;
  // 实际重放 → 该子树收集/包围盒缓存失效（盒坐标变了）
  cache?.collects.delete(ln);
  cache?.bounds.delete(ln);
  const sh = subtreeHeightCached(ln);
  ln.box.y = top + (sh - ln.box.h) / 2;
  ln.box.x = side > 0 ? xEdge + H_GAP : xEdge - H_GAP - ln.box.w;
  if (ln.children.length > 0) {
    const childXEdge = side > 0 ? ln.box.x + ln.box.w : ln.box.x;
    const total =
      ln.children.reduce((s, c) => s + subtreeHeightCached(c), 0) +
      V_GAP * (ln.children.length - 1);
    let cursor = top + (sh - total) / 2;
    for (const c of ln.children) {
      placeSubtreeIncremental(c, side, cursor, childXEdge, cache);
      cursor += subtreeHeightCached(c) + V_GAP;
    }
  }
  cache?.stamps.set(ln, { side, top, xEdge });
}

export function placeSubtree(ln: LayoutNode, side: -1 | 1, top: number, xEdge: number): void {
  const sh = subtreeHeightCached(ln);
  ln.box.y = top + (sh - ln.box.h) / 2;
  ln.box.x = side > 0 ? xEdge + H_GAP : xEdge - H_GAP - ln.box.w;
  if (ln.children.length > 0) {
    const childXEdge = side > 0 ? ln.box.x + ln.box.w : ln.box.x;
    const total =
      ln.children.reduce((s, c) => s + subtreeHeightCached(c), 0) +
      V_GAP * (ln.children.length - 1);
    let cursor = top + (sh - total) / 2;
    for (const c of ln.children) {
      placeSubtree(c, side, cursor, childXEdge);
      cursor += subtreeHeightCached(c) + V_GAP;
    }
  }
}

export function subtreeHeightCached(ln: LayoutNode): number {
  // HP1: WeakMap 缓存命中 → O(1) 直接返回
  const cached = __subtreeHeightCache.get(ln);
  if (cached !== undefined) return cached;
  let result: number;
  if (ln.children.length === 0) {
    result = ln.box.h;
  } else {
    const childrenH =
      ln.children.reduce((s, c) => s + subtreeHeightCached(c), 0) +
      V_GAP * (ln.children.length - 1);
    result = Math.max(ln.box.h, childrenH);
  }
  __subtreeHeightCache.set(ln, result);
  return result;
}

/** 紧凑三次贝塞尔（curvature 归一化弧高；支持左右双向） */
export function compactBezier(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  curvature = 0.4,
): string {
  const dx = Math.abs(ex - sx) * curvature;
  const dy = Math.abs(ey - sy) * curvature;
  const dir = ex >= sx ? 1 : -1;
  return `M ${sx} ${sy} C ${sx + dir * dx} ${sy + dy / 2}, ${ex - dir * dx} ${ey - dy / 2}, ${ex} ${ey}`;
}

/** 父边线型构建器：由布局方按类型注入 */
export type LinkBuilder = (parent: LayoutNode, child: LayoutNode) => string;

/** 水平紧凑贝塞尔（端点贴父/子左右边界，子在其右取左右缘，反之为左缘） */
export const bezierLink: LinkBuilder = (parent, child) => {
  const fromRight = child.box.x > parent.box.x;
  const sx = fromRight ? parent.box.x + parent.box.w : parent.box.x;
  const ex = fromRight ? child.box.x : child.box.x + child.box.w;
  return compactBezier(sx, parent.box.y + parent.box.h / 2, ex, child.box.y + child.box.h / 2);
};

// ---------- 共享布局工具（其他结构布局复用：树构建 / 收集 / 连线） ----------

/** 构建可见布局树（折叠节点不展开子女；side 默认同侧继承根=0） */
export function buildLayoutTree(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  side: -1 | 0 | 1 = 0,
): LayoutNode {
  const m = measure(root);
  const children = !collapsedIds.has(root.id)
    ? root.children.map((c) => buildLayoutTree(c, measure, collapsedIds, side))
    : [];
  return {
    node: root,
    box: { x: 0, y: 0, w: m.w, h: m.h },
    side,
    depth: 0,
    parentId: null,
    children,
  };
}

/** 重建深度/parentId/侧向（结构布局在 placement 阶段统一深度） */
export function annotateTree(ln: LayoutNode, depth: number, parentId: string | null): LayoutNode {
  return {
    ...ln,
    depth,
    parentId,
    children: ln.children.map((c) => annotateTree(c, depth + 1, ln.node.id)),
  };
}

/** 前序收集节点 + 父子贝塞尔连线（深度=父深度；可注入线型） */
export function collectLayout(
  rootNode: LayoutNode,
  link: LinkBuilder = bezierLink,
): { nodes: LayoutNode[]; links: LinkGeometry[] } {
  const nodes: LayoutNode[] = [];
  const links: LinkGeometry[] = [];
  const walk = (ln: LayoutNode): void => {
    nodes.push(ln);
    for (const c of ln.children) {
      links.push({ path: link(ln, c), depth: ln.depth, fromId: ln.node.id, toId: c.node.id });
      walk(c);
    }
  };
  walk(rootNode);
  return { nodes, links };
}

/** 正交折线 → SVG path（轴对齐航点，拐角圆角 r，借鉴 markvault-js waypointsToSVGPath） */
export function orthogonalPath(pts: Array<{ x: number; y: number }>, r = 5): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const inLen = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y) || 1;
    const outLen = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y) || 1;
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const inD = {
      x: curr.x === prev.x ? 0 : (curr.x - prev.x) / Math.abs(curr.x - prev.x),
      y: curr.y === prev.y ? 0 : (curr.y - prev.y) / Math.abs(curr.y - prev.y),
    };
    const outD = {
      x: next.x === curr.x ? 0 : (next.x - curr.x) / Math.abs(next.x - curr.x),
      y: next.y === curr.y ? 0 : (next.y - curr.y) / Math.abs(next.y - curr.y),
    };
    d += ` L ${curr.x - inD.x * rr} ${curr.y - inD.y * rr}`;
    d += ` Q ${curr.x} ${curr.y}, ${curr.x + outD.x * rr} ${curr.y + outD.y * rr}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** 组织图梁线：父底中心垂直下 → 共享梁（beamY）水平 → 子顶中心垂直下 */
export function orgBeamLink(parent: LayoutNode, child: LayoutNode, beamY: number): string {
  return orthogonalPath([
    { x: parent.box.x + parent.box.w / 2, y: parent.box.y + parent.box.h },
    { x: parent.box.x + parent.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: child.box.y },
  ]);
}

/** 布局包围盒 */
export function layoutBounds(nodes: LayoutNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.box.x);
    minY = Math.min(minY, n.box.y);
    maxX = Math.max(maxX, n.box.x + n.box.w);
    maxY = Math.max(maxY, n.box.y + n.box.h);
  }
  return { minX, minY, maxX, maxY };
}
