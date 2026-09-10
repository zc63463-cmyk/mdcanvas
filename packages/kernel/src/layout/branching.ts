/**
 * 分支布局（D2′ 思想分叉）：节点级生长方向 note.dir 的分组调度。
 *
 * 从 layouts.ts 拆出：分支调度已是独立职责（基准布局 + 只平移声明者 + 邻侧防叠），
 * 与原「结构布局注册表」混在一起会让 layouts.ts 越过 600 行预算线。
 * 依赖方向单向：本模块 → layouts/mindmap（基础布局与连线构造器），无回流。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { GrowDir } from './mindmap.js';
import { isGrowDir } from './mindmap.js';
import {
  bezierLink,
  H_GAP,
  layoutBounds,
  layoutMindmap,
  orgBeamLink,
  orgBeamLinkUp,
  V_GAP,
  type LayoutNode,
  type LayoutResult,
  type MeasureFn,
} from './mindmap.js';
import { SUB_GAP, subtreeBBox, translateSubtree, type BBox } from './layouts.js';
import type { BranchLayoutOptions } from './layouts.js';

/**
 * 扫全树收集显式 dir 声明（nodeId → GrowDir）。
 *
 * 只收合法四向值；非法值在此静默忽略——**诊断归读侧**（react/render/growDir.ts 的
 * readGrowDir 会给出「取值非法已按继承处理」的中文诊断）。kernel 只做纯布局消费。
 */
export function collectDirByNodeId(root: EditableNode): Map<string, GrowDir> {
  const idx = new Map<string, GrowDir>();
  const walk = (n: EditableNode): void => {
    const raw = n.note?.dir;
    if (typeof raw === 'string' && isGrowDir(raw)) idx.set(n.id, raw);
    n.children.forEach(walk);
  };
  walk(root);
  return idx;
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
  // 未注入时自行收集（接线点不必各自扫树；非法值由读侧诊断层负责，
  // 此处只取合法四向——与 react/render/growDir.ts 的 readGrowDir 同判据）
  const explicit = opts.explicitDirByNodeId ?? collectDirByNodeId(root);
  const islandDir: GrowDir = opts.islandDir ?? 'right';

  // 回归闸门：无任何显式 dir → 逐像素回退，保证旧文件布局零变更
  if (!hasAnyExplicitDir(root, explicit)) {
    const fb =
      opts.fallback ??
      ((r: EditableNode, m: MeasureFn, c: Set<string>) =>
        layoutMindmap(r, m, c, { cache: opts.cache, measureKey: opts.measureKey }));
    return fb(root, measure, collapsedIds);
  }

  // 子树（含自身）是否含显式 dir 声明——决定是否需要递归展开内部分叉
  const subtreeHasDir = new Map<string, boolean>();
  {
    const calc = (n: EditableNode): boolean => {
      let has = explicit.has(n.id);
      for (const c of n.children) has = calc(c) || has;
      subtreeHasDir.set(n.id, has);
      return has;
    };
    calc(root);
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

  // 骨架 id 索引（经典基准写回 + 递归定位用）
  const skeletonById = new Map<string, LayoutNode>();
  {
    const idx = (ln: LayoutNode): void => {
      skeletonById.set(ln.node.id, ln);
      ln.children.forEach(idx);
    };
    idx(rootLN);
  }

  // ★ 全局基准（局部性的根基）：先按经典 layoutMindmap 把整棵树排一遍并写回骨架。
  //   这就是「没有引入方向特性时的原样布局」。之后**只把显式声明方向的子树**从它的
  //   基准位置平移到对应侧，其余节点逐像素不动。
  //   注意：不能在每个子层级以该节点为根重跑经典布局——经典布局只在文档根层做左右
  //   平衡，子层重跑会引入根层特有的分配行为（实测把未声明的兄弟甩到另一侧）。
  {
    const base = layoutMindmap(root, measure, collapsedIds);
    for (const bn of base.nodes) {
      const t = skeletonById.get(bn.node.id);
      if (t) t.box = { ...bn.box };
    }
  }

  // ② 递归：先放置各子树的局部布局（子根在原点），再按方向分组挂到父节点四周
  const place = (ln: LayoutNode, inheritedDir: GrowDir): void => {
    if (ln.children.length === 0) return;

    // 分组规则（局部性优先）：
    //   ① 自身显式声明方向 → 进入方向组，会被平移到对应侧
    //   ② 自身未声明、但**父节点自身有显式声明** → 跟随父方向（思想分叉的意图）
    //   ③ 其余（父无声明）→ 保持经典基准位置，不动；仅当子树内含 dir 时递归展开内部
    const parentDir = explicit.get(ln.node.id);
    const groups: Record<GrowDir, LayoutNode[]> = { right: [], left: [], down: [], up: [] };
    const anchored: LayoutNode[] = [];
    for (const c of ln.children) {
      const cd = explicit.get(c.node.id);
      if (cd !== undefined) {
        dirOf.set(c.node.id, cd);
        groups[cd].push(c);
      } else if (parentDir !== undefined) {
        dirOf.set(c.node.id, parentDir);
        groups[parentDir].push(c);
      } else {
        dirOf.set(c.node.id, inheritedDir);
        anchored.push(c);
      }
    }

    const nb = ln.box;
    // 递归展开（必须在方向组平移之前、且基于已有基准位置）：
    // 方向组与 anchored 子树都要递归——只递归一边会让孙节点停在基准位置（实测层距为负）。
    for (const dir of ['right', 'left', 'down', 'up'] as const) {
      for (const c of groups[dir]) place(c, dir);
    }
    for (const k of anchored) {
      if (subtreeHasDir.get(k.node.id) === true) place(k, dirOf.get(k.node.id) ?? inheritedDir);
    }

    // 避让基准 = 父节点 + 保持原位的子树（方向组要排在它们之外）
    let occ: BBox = { minX: nb.x, minY: nb.y, maxX: nb.x + nb.w, maxY: nb.y + nb.h };
    for (const k of anchored) {
      const b = subtreeBBox(k);
      occ = {
        minX: Math.min(occ.minX, b.minX),
        minY: Math.min(occ.minY, b.minY),
        maxX: Math.max(occ.maxX, b.maxX),
        maxY: Math.max(occ.maxY, b.maxY),
      };
    }
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
            dir === 'right'
              ? Math.max(nb.x + nb.w, occ.maxX) + H_GAP
              : Math.min(nb.x, occ.minX) - H_GAP - e.c.box.w;
          const dx = targetX - e.c.box.x;
          translateSubtree(e.c, dx, dy);
          cursor += e.span + V_GAP;
        }
      } else {
        // 水平堆叠（down/up）：总宽 = Σ子树水平跨度 + SUB_GAP*(n-1)
        // 常量与经典 org 布局（placeOrg）对齐：层间距 V_GAP、子树间距 SUB_GAP——
        // 让 up/down 生长出的形状与既有组织架构图完全一致。
        // （复审修复：此前 up 分支误用 H_GAP 作层间距，导致「上」比「下」远 4 倍多，
        //   上下生长严重不对称——浏览器实测：down 14px、up 64px。）
        const extents = group.map((c) => {
          const b = subtreeBBox(c);
          return { c, minX: b.minX, maxX: b.maxX, span: b.maxX - b.minX };
        });
        const total = extents.reduce((s, e) => s + e.span, 0) + SUB_GAP * (group.length - 1);
        let cursor = nb.x + nb.w / 2 - total / 2; // 相对父节点水平居中
        for (const e of extents) {
          const slotCenterX = cursor + e.span / 2;
          const subCenterX = (e.minX + e.maxX) / 2;
          const dx = slotCenterX - subCenterX;
          const targetY =
            dir === 'down'
              ? Math.max(nb.y + nb.h, occ.maxY) + V_GAP
              : Math.min(nb.y, occ.minY) - V_GAP - e.c.box.h;
          const dy = targetY - e.c.box.y;
          translateSubtree(e.c, dx, dy);
          cursor += e.span + SUB_GAP;
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
