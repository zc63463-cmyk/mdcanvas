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

const SUB_GAP = 28;

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
  /** 增量缓存（透传 layoutMindmap 回退路径；分支路径为全量，忽略缓存命中） */
  cache?: LayoutCache;
  /** 度量语义键（透传回退路径） */
  measureKey?: string;
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** 子树局部包围盒（含 node 自身盒） */
function subtreeBBox(ln: LayoutNode): BBox {
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
function translateSubtree(ln: LayoutNode, dx: number, dy: number): void {
  ln.box.x += dx;
  ln.box.y += dy;
  for (const c of ln.children) translateSubtree(c, dx, dy);
}

/** 全树是否存在任一显式 dir 声明（决定回退 vs 分支） */
function hasAnyExplicitDir(root: EditableNode, explicit: Map<string, GrowDir>): boolean {
  if (explicit.size === 0) return false;
  let found = false;
  const walk = (n: EditableNode): void => {
    if (found) return;
    if (explicit.has(n.id)) {
      found = true;
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return found;
}

/**
 * 节点级生长方向布局：在经典 mindmap 之上叠加「思想分叉」。
 *
 * 行为：
 * - 全树无显式 dir → 直接委托 layoutMindmap（**字节级一致**，旧文件布局不变）
 * - 存在 dir → 每节点按有效 dir 将子节点分四组，各组递归布局 + 邻侧一次防叠
 *
 * 返回 LayoutResult（nodes 为前序遍历；links 按子方向选 bezier / 正交梁线）。
 */
export function layoutMindmapBranched(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: BranchLayoutOptions = {},
): LayoutResult {
  const explicit = opts.explicitDirByNodeId ?? new Map<string, GrowDir>();
  const islandDir: GrowDir = opts.islandDir ?? 'right';

  // 回归闸门：无任何显式 dir → 逐像素回退，保证旧文件布局零变更
  if (!hasAnyExplicitDir(root, explicit)) {
    return layoutMindmap(root, measure, collapsedIds, {
      cache: opts.cache,
      measureKey: opts.measureKey,
    });
  }

  // 子节点 → 有效方向映射（供连线选样式）
  const dirOf = new Map<string, GrowDir>();

  // ① 构建可见骨架（盒置于原点，折叠节点不展开子女——与 layoutMindmap 同语义）
  const buildSkeleton = (node: EditableNode, depth: number, parentId: string | null): LayoutNode => {
    const m = measure(node);
    const children: LayoutNode[] = !collapsedIds.has(node.id)
      ? node.children.map((c) => buildSkeleton(c, depth + 1, node.id))
      : [];
    return {
      node,
      box: { x: 0, y: 0, w: m.w, h: m.h },
      side: 0,
      depth,
      parentId,
      children,
    };
  };
  const rootLN = buildSkeleton(root, 0, null);

  // ② 递归：先放置各子树的局部布局（子根在原点），再按方向分组挂到父节点四周
  const place = (ln: LayoutNode, inheritedDir: GrowDir): void => {
    if (ln.children.length === 0) return;

    // 分组 + 记录每个子节点的有效方向
    const groups: Record<GrowDir, LayoutNode[]> = { right: [], left: [], down: [], up: [] };
    for (const c of ln.children) {
      const cd = explicit.get(c.node.id) ?? inheritedDir;
      dirOf.set(c.node.id, cd);
      groups[cd].push(c);
    }

    // 先递归放置每个孩子子树（此刻子根盒在原点，后代已相对子根布局）
    for (const c of ln.children) place(c, dirOf.get(c.node.id) ?? inheritedDir);

    const nb = ln.box;
    // ③ 每组沿父节点对应边堆叠；子根盒从原点平移到目标位置
    (['right', 'left', 'down', 'up'] as const).forEach((dir) => {
      const group = groups[dir];
      if (group.length === 0) return;

      if (dir === 'right' || dir === 'left') {
        // 垂直堆叠：总高 = Σ子树垂直跨度 + V_GAP*(n-1)
        const extents = group.map((c) => {
          const b = subtreeBBox(c);
          return { c, minY: b.minY, maxY: b.maxY, span: b.maxY - b.minY };
        });
        const total = extents.reduce((s, e) => s + e.span, 0) + V_GAP * (group.length - 1);
        let cursor = nb.y + nb.h / 2 - total / 2; // 相对父节点垂直居中
        for (const e of extents) {
          const slotCenterY = cursor + e.span / 2;
          const subCenterY = (e.minY + e.maxY) / 2;
          const dy = slotCenterY - subCenterY;
          const targetX =
            dir === 'right' ? nb.x + nb.w + H_GAP : nb.x - H_GAP - e.c.box.w;
          const dx = targetX - e.c.box.x;
          translateSubtree(e.c, dx, dy);
          cursor += e.span + V_GAP;
        }
      } else {
        // 水平堆叠（down/up）：总宽 = Σ子树水平跨度 + H_GAP*(n-1)
        const extents = group.map((c) => {
          const b = subtreeBBox(c);
          return { c, minX: b.minX, maxX: b.maxX, span: b.maxX - b.minX };
        });
        const total = extents.reduce((s, e) => s + e.span, 0) + H_GAP * (group.length - 1);
        let cursor = nb.x + nb.w / 2 - total / 2; // 相对父节点水平居中
        for (const e of extents) {
          const slotCenterX = cursor + e.span / 2;
          const subCenterX = (e.minX + e.maxX) / 2;
          const dx = slotCenterX - subCenterX;
          const targetY = dir === 'down' ? nb.y + nb.h + V_GAP : nb.y - H_GAP - e.c.box.h;
          const dy = targetY - e.c.box.y;
          translateSubtree(e.c, dx, dy);
          cursor += e.span + H_GAP;
        }
      }
    });

    // ④ 邻侧防叠：相邻方向组（right↔down 等）bounds 相交 → 一次推开（不迭代）
    const pushDx: Record<GrowDir, number> = { right: 0, left: 0, down: 0, up: 0 };
    const pushDy: Record<GrowDir, number> = { right: 0, left: 0, down: 0, up: 0 };
    const pairs: Array<[GrowDir, GrowDir]> = [
      ['right', 'down'],
      ['down', 'left'],
      ['left', 'up'],
      ['up', 'right'],
    ];
    for (const [a, b] of pairs) {
      const ga = groups[a];
      const gb = groups[b];
      if (ga.length === 0 || gb.length === 0) continue;
      const A = unionBBox(ga);
      const B = unionBBox(gb);
      if (!intersect(A, B)) continue;
      // a 沿其外向轴推开，b 沿其外向轴推开（一次成型）
      if (a === 'right') pushDx.right += Math.max(0, B.maxX - A.minX);
      if (a === 'left') pushDx.left += Math.min(0, B.minX - A.maxX);
      if (a === 'down') pushDy.down += Math.max(0, B.maxY - A.minY);
      if (a === 'up') pushDy.up += Math.min(0, B.minY - A.maxY);
      if (b === 'right') pushDx.right += Math.max(0, A.maxX - B.minX);
      if (b === 'left') pushDx.left += Math.min(0, A.minX - B.maxX);
      if (b === 'down') pushDy.down += Math.max(0, A.maxY - B.minY);
      if (b === 'up') pushDy.up += Math.min(0, A.minY - B.maxY);
    }
    (['right', 'left', 'down', 'up'] as const).forEach((dir) => {
      if (pushDx[dir] === 0 && pushDy[dir] === 0) return;
      for (const c of groups[dir]) translateSubtree(c, pushDx[dir], pushDy[dir]);
    });
  };

  place(rootLN, islandDir);

  // 根节点居中于原点（与 layoutMindmap 约定一致，便于视觉对齐）
  const rootCenterX = rootLN.box.x + rootLN.box.w / 2;
  const rootCenterY = rootLN.box.y + rootLN.box.h / 2;
  translateSubtree(rootLN, -rootCenterX, -rootCenterY);

  // ⑤ 收集节点 + 连线（按子方向选线型）
  const nodes: LayoutNode[] = [];
  const links: LayoutResult['links'] = [];
  const walk = (ln: LayoutNode): void => {
    nodes.push(ln);
    for (const c of ln.children) {
      links.push(makeLinkByDir(ln, c, dirOf.get(c.node.id) ?? 'right', dirOf));
      walk(c);
    }
  };
  walk(rootLN);

  return { nodes, links, bounds: layoutBounds(nodes) };
}

/** 多子树并集包围盒 */
function unionBBox(group: LayoutNode[]): BBox {
  let acc: BBox | null = null;
  for (const c of group) {
    const b = subtreeBBox(c);
    if (acc === null) {
      acc = { ...b };
    } else {
      acc.minX = Math.min(acc.minX, b.minX);
      acc.minY = Math.min(acc.minY, b.minY);
      acc.maxX = Math.max(acc.maxX, b.maxX);
      acc.maxY = Math.max(acc.maxY, b.maxY);
    }
  }
  return acc ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** 轴对齐矩形相交判定 */
function intersect(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 父→子连线：right/left 用贝塞尔；down 用正交梁线（向下）；up 用正交梁线（向上）。
 *  方向经参数显式注入（复审修复：原模块级可变桥接 _dirOf 从未被 bindDirOf 填充，
 *  会导致全部连线回退贝塞尔——且模块级可变状态在并发布局下不安全，已删除）。 */
function makeLinkByDir(
  parent: LayoutNode,
  child: LayoutNode,
  dir: GrowDir,
  dirOf: ReadonlyMap<string, GrowDir>,
): LayoutResult['links'][number] {
  const dirOfChild = (c: LayoutNode): GrowDir => dirOf.get(c.node.id) ?? 'right';
  if (dir === 'right' || dir === 'left') {
    return {
      path: bezierLink(parent, child),
      depth: parent.depth,
      fromId: parent.node.id,
      toId: child.node.id,
    };
  }
  if (dir === 'down') {
    const tops = parent.children
      .filter((c) => dirOfChild(c) === 'down')
      .map((c) => c.box.y);
    const beamY = (parent.box.y + parent.box.h + (tops.length ? Math.min(...tops) : parent.box.y)) / 2;
    return {
      path: orgBeamLink(parent, child, beamY),
      depth: parent.depth,
      fromId: parent.node.id,
      toId: child.node.id,
    };
  }
  // up
  const bottoms = parent.children.filter((c) => dirOfChild(c) === 'up').map((c) => c.box.y + c.box.h);
  const beamY = (parent.box.y + (bottoms.length ? Math.max(...bottoms) : parent.box.y + parent.box.h)) / 2;
  return {
    path: orgBeamLinkUp(parent, child, beamY),
    depth: parent.depth,
    fromId: parent.node.id,
    toId: child.node.id,
  };
}
