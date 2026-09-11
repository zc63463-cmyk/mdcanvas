/**
 * 分支布局（D2′ 思想分叉）：节点级生长方向 note.dir 的分组调度。
 *
 * 从 layouts.ts 拆出：分支调度已是独立职责（基准布局 + 只平移声明者 + 碰撞消解），
 * 与原「结构布局注册表」混在一起会让 layouts.ts 越过 600 行预算线。
 * 依赖方向单向：本模块 → layouts / separate / mindmap（基础布局与连线构造器），无回流。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { GrowDir } from './mindmap.js';
import { isGrowDir } from './mindmap.js';
import {
  bezierControls,
  bezierPath,
  H_GAP,
  layoutBounds,
  layoutMindmap,
  orthogonalPath,
  sampleBezier,
  V_GAP,
  type Box,
  type LayoutNode,
  type LayoutResult,
  type MeasureFn,
} from './mindmap.js';
import { SUB_GAP, subtreeBBox, translateSubtree, type BBox } from './layouts.js';
import type { BranchLayoutOptions } from './layouts.js';
import {
  beamXLeft,
  beamXRight,
  beamXVariants,
  clampBeamGroupVertical,
  groupGapOf,
  linkLen,
} from './beamSide.js';
import {
  collectNodes,
  LINK_CLEAR_MARGIN,
  NodeIndex,
  pickClearGeometry,
  type LinkGeometry,
} from './linkClear.js';
import {
  clearParentEdges,
  PARENT_EDGE_ROUNDS,
  separateTree,
  SEPARATE_MARGIN,
} from './separate.js';

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
 * - 存在 dir → 每节点按有效 dir 将子节点分四组，各组递归布局 → 自底向上碰撞消解
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
  //    ancestors = 有效祖先盒集（判据见 occ 注释）：仅锚定链累积，被叉节点传 []。
  const place = (ln: LayoutNode, inheritedDir: GrowDir, ancestors: readonly BBox[]): void => {
    if (ln.children.length === 0) return;

    // 分组规则（局部性优先）：
    //   ① 自身显式声明方向 → 进入方向组，会被平移到对应侧
    //   ② 自身未声明、但**父节点自身有显式声明** → 跟随父方向（思想分叉的意图）
    //   ③ 其余（父无声明）→ 保持经典基准位置，不动；仅当子树内含 dir 时递归展开内部
    const parentDir = explicit.get(ln.node.id);
    const nb = ln.box;
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
        // B″：锚定子节点的**有效方向以基线实际落位为准**，而不是继承方向——经典布局会
        // 把第二个子节点放到父的另一侧，若生长轴仍记继承方向（right），消解/避障就会沿
        // +x 把它推回父与兄弟之间的走廊（实测「速读 → 成为速读技巧大师 / 培养速读技巧」
        // 被排成链式且贯穿）。以基线定轴后沿真正所在的那一侧推开，走廊不再被侵入；
        // 布局本身零移动（锚定语义不变），经典左右平衡也得以保留。
        const d = baselineDirOf(c.box, nb, inheritedDir);
        dirOf.set(c.node.id, d);
        anchored.push(c);
      }
    }

    // 递归展开（基于已有基准位置）：分叉子节点传 []（上方祖先盒失效）；
    // 锚定子节点继承有效集 + 父盒（锚定链不移动，基线即终局）。
    for (const dir of ['right', 'left', 'down', 'up'] as const) {
      for (const c of groups[dir]) place(c, dir, []);
    }
    for (const k of anchored) {
      if (subtreeHasDir.get(k.node.id) === true) place(k, dirOf.get(k.node.id) ?? inheritedDir, [...ancestors, toBBox(nb)]);
    }

    // 避让基准 = 父盒 + 保持原位的子树 + **有效祖先盒**（O 有效 ⟺ 路径 (O, 本节点] 上无分叉
    // 节点，被同样平移刚性携带时才与基线一致）。分叉链上方是幽灵盒（实测 242px 级撑远）。
    const occ: BBox = toBBox(nb);
    for (const b of [...anchored.map(subtreeBBox), ...ancestors]) {
      occ.minX = Math.min(occ.minX, b.minX);
      occ.minY = Math.min(occ.minY, b.minY);
      occ.maxX = Math.max(occ.maxX, b.maxX);
      occ.maxY = Math.max(occ.maxY, b.maxY);
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
        const groupGap = groupGapOf(ln.node, dir, H_GAP);
        for (const e of extents) {
          const slotCenterY = cursor + e.span / 2;
          const subCenterY = (e.minY + e.maxY) / 2;
          const dy = slotCenterY - subCenterY;
          // 出线长度：left/right 组的水平距离按 note.len 逐子节点可调，
          // 组缺省回落父 lenses[dir]（缺省 H_GAP）
          const gap = linkLen(e.c.node, groupGap);
          const targetX =
            dir === 'right'
              ? Math.max(nb.x + nb.w, occ.maxX) + gap
              : Math.min(nb.x, occ.minX) - gap - e.c.box.w;
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
        // 出线长度：down/up 组的垂直距离 = 子节点自己的 note.len，
        // 缺省回落**父节点**的 note.len，再缺省 V_GAP——
        // up/down 的转折弯（子树竖段 → 共享梁 → 父中线段）距离是「父顶边到子树」
        // 的距离，语义归父：父上设一处，整组上下子树连同共享梁一起抬升/下移，
        // 子树内部（孙层）层距不受牵连。子节点自己的 len 仍优先覆盖自己的连线。
        const groupGap = groupGapOf(ln.node, dir, V_GAP);
        for (const e of extents) {
          const slotCenterX = cursor + e.span / 2;
          const subCenterX = (e.minX + e.maxX) / 2;
          const dx = slotCenterX - subCenterX;
          const gap = linkLen(e.c.node, groupGap);
          const targetY =
            dir === 'down'
              ? Math.max(nb.y + nb.h, occ.maxY) + gap
              : Math.min(nb.y, occ.minY) - gap - e.c.box.h;
          const dy = targetY - e.c.box.y;
          translateSubtree(e.c, dx, dy);
          cursor += e.span + SUB_GAP;
        }
      }
    });

    // 钳制阶段（v1.7.0 · 全部方向组落位之后统一执行）：
    // 横向窗口（down/up）与纵向窗口（hub 左右）互读对方的**最终**位置——
    // 在分支内钳会读到未平移的基线盒（基线全在父节点下方 → 窗口倒置 [298,0]，
    // 「居中尽力」把右组瞬移 +339px 的实测根因）。
    // 顺序：先上下（读已落位的左右组，与既有行为逐像素一致），后左右（读已落位且已钳制的上下组）。
    for (const dir of ['down', 'up'] as const) {
      const group = groups[dir];
      if (group.length === 0) continue;
      clampGroupToSideWindow(dir, nb, groupGapOf(ln.node, dir, V_GAP), group, groups.left, groups.right);
    }
    if (ln.node.note?.hub === true) {
      for (const dir of ['right', 'left'] as const) {
        const group = groups[dir];
        if (group.length === 0) continue;
        clampBeamGroupVertical(dir, nb, groupGapOf(ln.node, dir, H_GAP), group, groups.up, groups.down);
      }
    }
  };

  /**
   * 把 down/up 组水平钳制在左右组的内侧窗口里（仅与梁高程带相交的侧组参与）：左右组
   * 已在前落位，取其内侧边界；越界整组平移，窗口放不下则居中。「梁高程带」= 组盒朝父侧
   * 外扩半程最小层距（覆盖共享梁 y）；与该带纵向不相交的侧组不参与（保住「居中正下」）。
   */
  function clampGroupToSideWindow(
    dir: 'down' | 'up',
    nb: Box,
    groupGap: number,
    group: LayoutNode[],
    leftGroup: LayoutNode[],
    rightGroup: LayoutNode[],
  ): void {
    if (group.length === 0) return;
    // 梁线段（gate 的唯一判定对象）：横梁 y = 父边 ∓ 最小层距/2；
    // x 跨度 = 子中线 ∪ 父中线。侧组**压住这段线**（y 带含 railY 且 x 与线段相交）
    // 才需要让位——组盒更深处与侧组的盒相交由消解负责，不归钳制管
    // （此前用整组高度做带，宽出几十倍：右组在父旁、down 组挂在其下 14px 时
    // 也会判「相交」，把居中正下的 down 组整体挤偏 -287px 的实测根因）。
    let gMinX = Infinity;
    let gMaxX = -Infinity;
    let minGap = Infinity;
    const centers: number[] = [];
    for (const c of group) {
      const b = subtreeBBox(c);
      gMinX = Math.min(gMinX, b.minX);
      gMaxX = Math.max(gMaxX, b.maxX);
      minGap = Math.min(minGap, linkLen(c.node, groupGap));
      centers.push((b.minX + b.maxX) / 2);
    }
    centers.push(nb.x + nb.w / 2);
    const spanLo = Math.min(...centers);
    const spanHi = Math.max(...centers);
    const railY = dir === 'down' ? nb.y + nb.h + minGap / 2 : nb.y - minGap / 2;
    const pad = 6;
    const blocksRail = (b: BBox): boolean =>
      b.minY - pad <= railY &&
      railY <= b.maxY + pad &&
      b.minX - pad <= spanHi &&
      spanLo <= b.maxX + pad;

    let leftEdge = -Infinity; // 左组的右缘
    let rightEdge = Infinity; // 右组的左缘
    for (const c of leftGroup) {
      const b = subtreeBBox(c);
      if (!blocksRail(b)) continue; // 不压梁线 → 不收口
      leftEdge = Math.max(leftEdge, b.maxX);
    }
    for (const c of rightGroup) {
      const b = subtreeBBox(c);
      if (!blocksRail(b)) continue;
      rightEdge = Math.min(rightEdge, b.minX);
    }
    if (leftEdge === -Infinity && rightEdge === Infinity) return; // 无左右组在场 → 无需钳制

    const width = gMaxX - gMinX;
    const window = rightEdge - leftEdge;
    let shift = 0;
    if (gMaxX > rightEdge) shift = rightEdge - gMaxX;
    if (gMinX + shift < leftEdge) shift = leftEdge - gMinX;
    if (width > window && window > 0) {
      shift = leftEdge + window / 2 - (gMinX + gMaxX) / 2; // 窗口比组窄 → 居中尽力
    }
    if (shift !== 0) {
      for (const c of group) translateSubtree(c, shift, 0);
    }
  }

  place(rootLN, islandDir, []); // 根：无祖先可避

  // ④ 碰撞消解（自底向上刚体分离）：
  //    D2′ 原本的「邻侧防叠」只在同层相邻组之间做一次 bbox 推开、不迭代，三向以上
  //    复杂分叉或子树内部再分叉会残留重叠（ADR-0009 已知取舍）。这里统一交给
  //    separateTree：只要有**真实节点盒**相交，就把其中一棵子树整棵推开到分离为止。
  //    紧接其后的 ⑤ 会重新生成连线 → 连线端点/长度自动跟随，不会留下穿盒的旧 path。
  //    注：仅分支路径执行；无 dir 的旧文件已在上面逐像素回退，行为零变更。
  const sepOpts = opts.separate;
  if (sepOpts !== false) {
    const sep = { ...(sepOpts ?? {}), dirByNodeId: dirOf };
    const margin = sepOpts?.margin ?? SEPARATE_MARGIN;
    separateTree(rootLN, sep);

    // ④″ 子树不得回压父的出边：子树朝反方向长回去时（右向子节点的孙节点声明 left 等），
    //    它会压在「父 → 自己」的连线上——这类穿越换任何连线画法都躲不开，
    //    只能把整棵子树沿生长方向外推、拉长父线。外推后重跑消解清理新重叠。
    for (let r = 0; r < PARENT_EDGE_ROUNDS; r++) {
      if (clearParentEdges(rootLN, dirOf, margin) === 0) break;
      separateTree(rootLN, sep);
    }

    // ④⁗ 走廊排斥已退役（v1.6.0）：它按「折线包围盒」判走廊——共享梁的包围盒罩住
    //    梁线与父之间的整片空区，同组兄弟贴边即误判；四轮「排斥↔消解」博弈还会把
    //    右组当代价品挪位（实测 len 抬升后右组被掰成楼梯）。它防的「梁线被挡」由
    //    两道更精确的机制接管：落位期 clampGroupToSideWindow 的纵向闸门钳制（本文件）
    //    与 ⑤ 的换画法 beamVariants 抬梁/压梁（不动节点）。
    // ⑤′ 连线避障在 ⑤ 做：不动节点，只在同族几何里换一条（梁线换共享梁 y、贝塞尔换
    //    弓向/弓高）。默认几何干净时逐值返回默认，多数文档零视觉变化。
  }

  // 根节点居中于原点（与 layoutMindmap 约定一致，便于视觉对齐）
  const rootCenterX = rootLN.box.x + rootLN.box.w / 2;
  const rootCenterY = rootLN.box.y + rootLN.box.h / 2;
  translateSubtree(rootLN, -rootCenterX, -rootCenterY);

  // ⑤ 收集节点 + 连线（按子方向选线型；并做连线避障挑选）
  //    索引在消解之后建一次即可——本步**不移动任何节点**，零重叠不变量不受影响。
  const nodes: LayoutNode[] = [];
  const links: LayoutResult['links'] = [];
  const index = opts.linkClear === false ? null : new NodeIndex(collectNodes(rootLN));
  const walk = (ln: LayoutNode): void => {
    nodes.push(ln);
    for (const c of ln.children) {
      links.push(
        makeLinkByDir(ln, c, dirOf.get(c.node.id) ?? 'right', dirOf, index ?? undefined),
      );
      walk(c);
    }
  };
  walk(rootLN);

  return { nodes, links, bounds: layoutBounds(nodes) };
}

const toBBox = (b: Box): BBox => ({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h });

/**
 * 由基线落位反推子节点的有效生长方向：子盒在父盒的哪一侧，它就朝哪边长。
 * 四侧都不沾（与父盒重叠）时退回继承方向。
 */
function baselineDirOf(child: Box, parent: Box, fallback: GrowDir): GrowDir {
  if (child.x >= parent.x + parent.w) return 'right';
  if (child.x + child.w <= parent.x) return 'left';
  if (child.y >= parent.y + parent.h) return 'down';
  if (child.y + child.h <= parent.y) return 'up';
  return fallback;
}

/** 向下组共享梁的 y：父底边与「最靠上的 down 子节点顶边」的中点 */
function beamYDown(parent: LayoutNode, dirOfChild: (c: LayoutNode) => GrowDir): number {
  const tops = parent.children.filter((c) => dirOfChild(c) === 'down').map((c) => c.box.y);
  return (parent.box.y + parent.box.h + (tops.length ? Math.min(...tops) : parent.box.y)) / 2;
}

/** 向上组共享梁的 y：父顶边与「最靠下的 up 子节点底边」的中点 */
function beamYUp(parent: LayoutNode, dirOfChild: (c: LayoutNode) => GrowDir): number {
  const bottoms = parent.children
    .filter((c) => dirOfChild(c) === 'up')
    .map((c) => c.box.y + c.box.h);
  return (parent.box.y + (bottoms.length ? Math.max(...bottoms) : parent.box.y + parent.box.h)) / 2;
}

/**
 * 贝塞尔候选族：只改弓向 / 弓高（bow = 0 即默认曲线）。
 *
 * 换弓就能绕开挡在中间的盒，且**线型语义不变**（仍是水平切线的紧凑贝塞尔）。
 */
function bezierVariants(parent: LayoutNode, child: LayoutNode): LinkGeometry[] {
  const c = bezierControls(parent, child);
  const span = Math.max(Math.abs(c.ey - c.sy), Math.abs(c.ex - c.sx) * 0.35, 24);
  const of = (k: typeof c): LinkGeometry => ({ path: bezierPath(k), points: sampleBezier(k) });
  const out: LinkGeometry[] = [of(c)]; // 默认曲线
  // 拉直到端点 = 等价于直线，但仍保持 C 线型（不破坏「right/left 走贝塞尔」的语义）
  out.push(of({ ...c, c1x: c.sx, c1y: c.sy, c2x: c.ex, c2y: c.ey }));
  for (const k of [0.35, -0.35, 0.7, -0.7, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
    out.push(of({ ...c, c1y: c.c1y + span * k, c2y: c.c2y + span * k }));
  }
  return out;
}

/**
 * 梁线候选族：只改共享梁的 y（首个是默认梁位）。
 *
 * 梁位在「父出边 ↔ 子入边」的空隙里取样；空隙不足时只有默认梁位，
 * 退化为既有行为（不为了避障把梁甩到很远的地方）。
 */
function beamVariants(
  parent: LayoutNode,
  child: LayoutNode,
  dir: 'down' | 'up',
  baseBeamY: number,
  index?: NodeIndex,
): LinkGeometry[] {
  const pad = LINK_CLEAR_MARGIN + 2;
  const pEdge = dir === 'down' ? parent.box.y + parent.box.h : parent.box.y;
  const cEdge = dir === 'down' ? child.box.y : child.box.y + child.box.h;
  const lo = Math.min(pEdge, cEdge) + pad;
  const hi = Math.max(pEdge, cEdge) - pad;
  const ys: number[] = [baseBeamY];
  if (hi - lo > 1) {
    ys.push(lo, hi);
    for (let i = 1; i < 5; i++) ys.push(lo + ((hi - lo) * i) / 5);
  }
  // 避障采样：父↔子空隙里若有别的盒子，「空隙内」可能根本没有干净的一层
  // （实测：up 链的梁位缝被 anchored 兄弟占住 → 梁线横段直接穿盒）。
  // 此时把梁位抬到障碍物上缘之上 / 压到下缘之下，绕开它——是否真的干净
  // 由 pickClearGeometry 用节点索引复检，脏候选自然被淘汰。
  const pcx = parent.box.x + parent.box.w / 2;
  const ccx = child.box.x + child.box.w / 2;
  if (index !== undefined) {
    const corridor: Box = {
      x: Math.min(pcx, ccx),
      y: Math.min(pEdge, cEdge),
      w: Math.abs(ccx - pcx),
      h: Math.abs(cEdge - pEdge),
    };
    for (const o of index.query(corridor, pad)) {
      if (o === parent || o === child) continue;
      ys.push(o.box.y - pad, o.box.y + o.box.h + pad);
    }
    // 细分采样：相邻候选（>1px）补中点——8+6=14 的算术让推挤位踩着邻盒膨胀边界，粗候选全被
    // 复检淘汰；中点能命中「盒间正缝」（实测 -198 缝，此前贴边判穿 → 走廊用例红）
    const sorted = [...ys].sort((x, y) => y - x);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [a, b] = [sorted[i] ?? 0, sorted[i + 1] ?? 0];
      if (a - b > 1) ys.push((a + b) / 2);
    }
  }
  const at = (px: number, cx: number, y: number): LinkGeometry => {
    if (px === cx) {
      const pts = [
        { x: px, y: pEdge },
        { x: px, y: cEdge },
      ];
      return { path: orthogonalPath(pts), points: pts };
    }
    const pts = [
      { x: px, y: pEdge },
      { x: px, y },
      { x: cx, y },
      { x: cx, y: cEdge },
    ];
    return { path: orthogonalPath(pts), points: pts };
  };
  // ① 默认画法（竖干走父中线、落点走子中线）
  const out: LinkGeometry[] = ys.map((y) => at(pcx, ccx, y));
  // ② 竖干直接走子节点中线 → 无横段（父与子中线错开时反而更干净）
  for (const y of ys) out.push(at(ccx, ccx, y));
  return out;
}

/**
 * 父→子连线的**几何**：SVG path + 同源折线。
 *
 * 折线是避障判定的输入——必须与真正画出来的线是同一条，否则「避让算出的安全带」
 * 和「屏幕上的线」会各说各话（贝塞尔走采样、梁线走航点）。
 *
 * 传入 `index` 时启用避障：在同族几何里挑一条不压节点盒的；**默认几何干净则逐值
 * 返回默认**，因此绝大多数文档的连线与不启用避障时完全一致。
 *
 * 方向经参数显式注入（复审修复：原模块级可变桥接 _dirOf 从未被 bindDirOf 填充，
 * 会导致全部连线回退贝塞尔——且模块级可变状态在并发布局下不安全，已删除）。
 */
export function linkGeometry(
  parent: LayoutNode,
  child: LayoutNode,
  dir: GrowDir,
  dirOf: ReadonlyMap<string, GrowDir>,
  index?: NodeIndex,
): LinkGeometry {
  const dirOfChild = (c: LayoutNode): GrowDir => dirOf.get(c.node.id) ?? 'right';
  let variants: LinkGeometry[];
  if (dir === 'right' || dir === 'left') {
    // hub：左右组走共享竖梁 bus（与 up/down 共享梁对称）；未标记保持贝塞尔（老文档零变更）
    variants =
      parent.node.note?.hub === true
        ? beamXVariants(
            parent,
            child,
            dir,
            dir === 'right' ? beamXRight(parent, dirOfChild) : beamXLeft(parent, dirOfChild),
            index,
          )
        : bezierVariants(parent, child);
  } else if (dir === 'down') {
    variants = beamVariants(parent, child, 'down', beamYDown(parent, dirOfChild), index);
  } else {
    variants = beamVariants(parent, child, 'up', beamYUp(parent, dirOfChild), index);
  }
  const first = variants[0];
  if (first === undefined) throw new Error('连线候选几何为空');
  if (index === undefined) return first;
  return pickClearGeometry(variants, index, parent.node.id, child.node.id);
}

/** 父→子连线（LayoutResult.links 条目）：path 取 {@link linkGeometry} 的避障结果 */
function makeLinkByDir(
  parent: LayoutNode,
  child: LayoutNode,
  dir: GrowDir,
  dirOf: ReadonlyMap<string, GrowDir>,
  index?: NodeIndex,
): LayoutResult['links'][number] {
  return {
    path: linkGeometry(parent, child, dir, dirOf, index).path,
    depth: parent.depth,
    fromId: parent.node.id,
    toId: child.node.id,
  };
}
