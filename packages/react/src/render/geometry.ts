/**
 * 几何与视觉决策层（ShapeUtil 精神：组件/几何分离）。
 * 全部纯函数、零 React 零 DOM 依赖：命中检测、节点卡片样式、连线路径、LOD。
 * 视觉值一律来自 TokenSet —— 本文件不出现任何 #hex / rgba 字面量。
 */
import {
  KIND_META,
  KIND_FALLBACK_COLOR,
  compactBezier,
  orthogonalPath,
} from '@mindcanvas/kernel';
import type { Box, GrowDir, LayoutNode } from '@mindcanvas/kernel';
import type { BranchColor, TokenSet } from '../theme/types.js';

/** 卡片层级（决定圆角/描边/配色变体） */
export type CardLevel = 'branch' | 'leaf';

/** 节点卡片视觉结论（渲染器只读消费） */
export interface NodeCardStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  radius: number;
  /** 滤镜（sticker drop-shadow；'none' 表示无） */
  filter: string;
}

/** 连线路径结论 */
export interface LinkPathResult {
  d: string;
  stroke: string;
  width: number;
}

/**
 * 分支索引：每个节点归属哪条顶级分支（根 = 0；一级 = 自身序；深层 = 继承）。
 * 返回 Map<nodeId, index>。
 */
export function computeBranchIndex(layoutNodes: readonly LayoutNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const root = layoutNodes.find((n) => n.depth === 0);
  if (!root) return out;
  out.set(root.node.id, 0);
  for (const n of layoutNodes) {
    if (n.depth === 1)
      out.set(
        n.node.id,
        root.children.findIndex((c) => c.node.id === n.node.id),
      );
    else if (n.depth > 1 && n.parentId) out.set(n.node.id, out.get(n.parentId) ?? 0);
  }
  return out;
}

/**
 * 节点卡片样式（全令牌驱动）：
 * - 实体节点 → entityFill / KIND_META 语义色描边（跨主题一致，仅令牌基座）
 * - 叶节点 → 分支 leaf 变体（classic）或主题 leafDefault（sticker/glass）
 * - 其余 → 分支色板对应色
 */
export function nodeCardStyle(
  token: TokenSet,
  palette: BranchColor | undefined,
  level: CardLevel,
  entityKind?: string | null,
): NodeCardStyle {
  const isLeaf = level === 'leaf';
  if (entityKind) {
    const kindColor = KIND_META[entityKind]?.color ?? KIND_FALLBACK_COLOR;
    return {
      fill: token.color.entityFill,
      stroke: kindColor,
      strokeWidth: token.nodeStyle.strokeWidth,
      text: token.color.entityText,
      radius: token.radius.node,
      filter: token.nodeStyle.shadow === 'none' ? 'none' : token.nodeStyle.shadow,
    };
  }
  const leafStyle = palette?.leaf ?? token.color.leafDefault;
  const s = isLeaf ? leafStyle : (palette ?? token.color.branches[0]!);
  return {
    fill: s.fill,
    stroke: s.stroke,
    strokeWidth: isLeaf ? token.nodeStyle.strokeWidthLeaf : token.nodeStyle.strokeWidth,
    text: s.text,
    radius: isLeaf ? token.radius.leaf : token.radius.node,
    filter: token.nodeStyle.shadow,
  };
}

/** 命中检测（节点盒 + 外扩 pad） */
export function nodeHitTest(box: Box, x: number, y: number, pad = 0): boolean {
  return (
    x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad
  );
}

/** 连线朝向（四向生长感知）：声明方向优先，缺省回退几何判据。
 *  - dir 声明 up/down → 垂直；left/right → 水平（声明优先于盒子位置——
 *    用户回归：铺宽的上分支组外侧子节点与父盒无 x 重叠，纯几何会误判水平）
 *  - 无声明 → 几何判据：子盒与父盒 x 区间重叠且完全在上/下方 → 垂直，否则水平。
 *    判据说明：经典布局的 right/left 子节点恒在父盒 x 区间之外（targetX = 父缘 ± H_GAP），
 *    而 up/down 组相对父水平居中 —— x 重叠 + 纵向完全分离因此是可靠的垂直信号，
 *    对动画插值盒与 Canvas/SVG 双后端同样成立。 */
export type LinkOrientation =
  | { kind: 'horizontal'; toRight: boolean }
  | { kind: 'vertical'; toDown: boolean };

export function linkOrientation(parent: Box, child: Box, dir?: GrowDir): LinkOrientation {
  if (dir === 'up') return { kind: 'vertical', toDown: false };
  if (dir === 'down') return { kind: 'vertical', toDown: true };
  if (dir === 'left') return { kind: 'horizontal', toRight: false };
  if (dir === 'right') return { kind: 'horizontal', toRight: true };
  const xOverlap = child.x < parent.x + parent.w && parent.x < child.x + child.w;
  if (xOverlap) {
    if (child.y >= parent.y + parent.h) return { kind: 'vertical', toDown: true };
    if (child.y + child.h <= parent.y) return { kind: 'vertical', toDown: false };
  }
  return { kind: 'horizontal', toRight: child.x >= parent.x };
}

/** 连线端点（贴边中点，方向感知）：
 *  - 垂直（up/down 生长）：父底/顶边中点 ↔ 子顶/底边中点
 *  - 水平（经典 right/left）：父左/右缘中点 ↔ 子左/右缘中点（行为与旧版逐像素一致） */
export function linkEndpoints(
  parent: Box,
  child: Box,
  dir?: GrowDir,
): { sx: number; sy: number; ex: number; ey: number } {
  const o = linkOrientation(parent, child, dir);
  if (o.kind === 'vertical') {
    return o.toDown
      ? {
          sx: parent.x + parent.w / 2,
          sy: parent.y + parent.h,
          ex: child.x + child.w / 2,
          ey: child.y,
        }
      : {
          sx: parent.x + parent.w / 2,
          sy: parent.y,
          ex: child.x + child.w / 2,
          ey: child.y + child.h,
        };
  }
  const toRight = o.toRight;
  const sx = toRight ? parent.x + parent.w : parent.x;
  const ex = toRight ? child.x : child.x + child.w;
  return { sx, sy: parent.y + parent.h / 2, ex, ey: child.y + child.h / 2 };
}

/** 垂直方向组共享梁高（与内核 makeLinkByDir 公式逐像素一致）：
 *  down：父底缘与最高子顶缘（min tops）的中点；up：父顶缘与最低子底缘（max bottoms）的中点。
 *  空组回退父对侧缘 → 梁落在父盒中线（与内核空数组回退分支一致）。 */
export function beamYForGroup(parent: Box, childBoxes: readonly Box[], dir: 'up' | 'down'): number {
  if (dir === 'down') {
    const tops = childBoxes.map((b) => b.y);
    return (parent.y + parent.h + (tops.length ? Math.min(...tops) : parent.y)) / 2;
  }
  const bottoms = childBoxes.map((b) => b.y + b.h);
  return (parent.y + (bottoms.length ? Math.max(...bottoms) : parent.y + parent.h)) / 2;
}

/** 连线几何中间形态（供 verticalBeamMap 分组） */
export interface LinkGeom {
  fromId: string;
  from: Box;
  to: Box;
}

/** 垂直连线 → 共享梁高映射：按 fromId + 方向分组，组内共用一条水平梁。
 *  dirOf：每条连线的声明方向（collectDeclaredGrowDir 产出；缺省 → 纯几何判据）。
 *  渲染层每帧以当前（动画插值）盒调用一次 → 梁随动画同步；水平连线不入表。 */
export function verticalBeamMap<L extends LinkGeom>(
  links: readonly L[],
  dirOf?: (l: L) => GrowDir | undefined,
): Map<L, number> {
  const out = new Map<L, number>();
  const groups = new Map<string, { dir: 'up' | 'down'; parent: Box; children: Box[]; members: L[] }>();
  for (const l of links) {
    const o = linkOrientation(l.from, l.to, dirOf?.(l));
    if (o.kind !== 'vertical') continue;
    const key = `${l.fromId}|${o.toDown ? 'down' : 'up'}`;
    let g = groups.get(key);
    if (!g) {
      g = { dir: o.toDown ? 'down' : 'up', parent: l.from, children: [], members: [] };
      groups.set(key, g);
    }
    g.children.push(l.to);
    g.members.push(l);
  }
  for (const g of groups.values()) {
    const beamY = beamYForGroup(g.parent, g.children, g.dir);
    for (const m of g.members) out.set(m, beamY);
  }
  return out;
}

/** 水平方向组共享竖梁 x（与内核 beamXRight/beamXLeft 公式逐像素一致）：
 *  right：父右缘与最靠左子左缘（min lefts）的中点；left：父左缘与最靠右子右缘（max rights）的中点。 */
export function beamXForGroup(parent: Box, childBoxes: readonly Box[], dir: 'right' | 'left'): number {
  if (dir === 'right') {
    const lefts = childBoxes.map((b) => b.x);
    return (parent.x + parent.w + (lefts.length ? Math.min(...lefts) : parent.x + parent.w)) / 2;
  }
  const rights = childBoxes.map((b) => b.x + b.w);
  return (parent.x + (rights.length ? Math.max(...rights) : parent.x)) / 2;
}

/** 水平连线 → 共享竖梁 x 映射（verticalBeamMap 的换轴镜像，仅 hub 节点的左右组入表）：
 *  hubOf 判定该连线的**父端**是否为出线枢纽（note.hub）；渲染层每帧以当前盒调用一次。 */
export function horizontalBeamMap<L extends LinkGeom>(
  links: readonly L[],
  hubOf?: (l: L) => boolean,
  dirOf?: (l: L) => GrowDir | undefined,
): Map<L, number> {
  const out = new Map<L, number>();
  const groups = new Map<
    string,
    { dir: 'right' | 'left'; parent: Box; children: Box[]; members: L[] }
  >();
  for (const l of links) {
    if (!hubOf?.(l)) continue;
    const o = linkOrientation(l.from, l.to, dirOf?.(l));
    if (o.kind === 'vertical') continue;
    const key = `${l.fromId}|${o.toRight ? 'right' : 'left'}`;
    let g = groups.get(key);
    if (!g) {
      g = { dir: o.toRight ? 'right' : 'left', parent: l.from, children: [], members: [] };
      groups.set(key, g);
    }
    g.children.push(l.to);
    g.members.push(l);
  }
  for (const g of groups.values()) {
    const beamX = beamXForGroup(g.parent, g.children, g.dir);
    for (const m of g.members) out.set(m, beamX);
  }
  return out;
}

/**
 * hub 出线箭头三角（实心 path，画布/导出通用——无需 marker defs）。
 *
 * 朝向取连线末段：左右 bus 为横段（beamX），up/down 梁为竖段（beamY）；
 * 两者都缺时按主轴判向（单线调用方）。非 hub 返回 null。
 */
export function hubArrowTip(
  parent: Box,
  child: Box,
  dir: GrowDir | undefined,
  opts?: { hub?: boolean; beamX?: number; beamY?: number },
): string | null {
  if (opts?.hub !== true) return null;
  const { sx, sy, ex, ey } = linkEndpoints(parent, child, dir);
  // 流向语义（v1.7.1）：左入/上入 = 支流汇入枢纽 → 箭头落在**父出边**上、指向枢纽内部
  // （left：+x；up：+y）；右出/下出 = 枢纽流出 → 箭头落在**子入边**上、指向外侧。
  // 入/出分形正是四向箭头的语义差分，缺了它左右上下无差别。
  const inbound = dir === 'up' || dir === 'left';
  if (inbound) {
    if (opts.beamX !== undefined) {
      // 左 bus：竖梁在父左侧，入流沿 +x 汇入父左缘
      return `M ${sx} ${sy} L ${sx - 8} ${sy - 4} L ${sx - 8} ${sy + 4} Z`;
    }
    if (opts.beamY !== undefined) {
      // 上梁：横梁在父上方，入流沿 +y 汇入父顶缘
      return `M ${sx} ${sy} L ${sx - 4} ${sy - 8} L ${sx + 4} ${sy - 8} Z`;
    }
  }
  if (opts.beamX !== undefined) {
    const d = ex >= opts.beamX ? 1 : -1;
    return `M ${ex} ${ey} L ${ex - d * 8} ${ey - 4} L ${ex - d * 8} ${ey + 4} Z`;
  }
  if (opts.beamY !== undefined) {
    const d = ey >= opts.beamY ? 1 : -1;
    return `M ${ex} ${ey} L ${ex - 4} ${ey - d * 8} L ${ex + 4} ${ey - d * 8} Z`;
  }
  const horiz = Math.abs(ex - sx) >= Math.abs(ey - sy);
  if (horiz) {
    const d = ex >= sx ? 1 : -1;
    return `M ${ex} ${ey} L ${ex - d * 8} ${ey - 4} L ${ex - d * 8} ${ey + 4} Z`;
  }
  const d = ey >= sy ? 1 : -1;
  return `M ${ex} ${ey} L ${ex - 4} ${ey - d * 8} L ${ex + 4} ${ey - d * 8} Z`;
}

/** LOD 等级（性能常量，非视觉值）：full 全量 / detail 叶省略文本 / skeleton 只画卡 */
export type LodLevel = 'full' | 'detail' | 'skeleton';

/** LOD 自动降级阈值（T8 降级策略 L1）：节点数超过 → detail/skeleton 阈值提前（激进 LOD） */
export const LOD_AUTO_NODES = 5000;

export function lodFor(k: number, nodeCount?: number): LodLevel {
  // 近距离（k>=0.5）始终全量细节——大图降级只影响远距档位，不牺牲眼前阅读
  if (k >= 0.5) return 'full';
  // 大图自动降级（A2/L1）：detail 阈值从 0.26 提高到 0.4 → skeleton 覆盖 [0,0.4)，更早省文本
  if (nodeCount !== undefined && nodeCount > LOD_AUTO_NODES) {
    return k >= 0.4 ? 'detail' : 'skeleton';
  }
  if (k >= 0.26) return 'detail';
  return 'skeleton';
}

/** 文本是否被 LOD 省略 */
export function lodSkipText(lod: LodLevel, depth: number): boolean {
  return lod === 'skeleton' || (lod === 'detail' && depth >= 2);
}

/**
 * 连线路径（按 token.lineStyle.language 分支，方向感知）：
 * - 水平连线（经典 right/left）：水平切线曲线（与旧版逐像素一致）
 * - 垂直连线（up/down 生长）：组织架构正交梁线（垂直-水平-垂直、圆角拐角），
 *   与内核 orgBeamLink/orgBeamLinkUp 同形状——opts.beamY 传入方向组共享梁高
 *   （verticalBeamMap 产出）；缺省回退两端中点（无分组信息的单线调用方）
 * - color-curve：彩色曲线（compactBezier 系，curvature=0.4）
 * - soft：柔和贝塞尔（更缓 curvature=0.3）
 * - wavy：任意曲线（双弧 S 形、轻微摆幅——手绘松弛感）；仅水平语言，垂直恒为梁线
 */
export function buildLinkPath(
  token: TokenSet,
  parent: Box,
  child: Box,
  branchColor?: BranchColor,
  opts?: { beamY?: number; dir?: GrowDir; hub?: boolean; beamX?: number },
): LinkPathResult {
  const { sx, sy, ex, ey } = linkEndpoints(parent, child, opts?.dir);
  const lang = token.lineStyle.language;
  const vertical = linkOrientation(parent, child, opts?.dir).kind === 'vertical';
  // hub 的左右组：共享竖梁 bus（父中线段 → 横段 → 竖梁 → 横段 → 子中线段），
  // 与垂直梁线同族正交形——与内核 linkGeometry 的 beamXVariants 首选候选同形状
  const hubBeamX = opts?.hub === true && !vertical ? opts?.beamX : undefined;
  const d = vertical
    ? orthogonalPath([
        { x: sx, y: sy },
        { x: sx, y: opts?.beamY ?? (sy + ey) / 2 },
        { x: ex, y: opts?.beamY ?? (sy + ey) / 2 },
        { x: ex, y: ey },
      ])
    : hubBeamX !== undefined
      ? orthogonalPath([
          { x: sx, y: sy },
          { x: hubBeamX, y: sy },
          { x: hubBeamX, y: ey },
          { x: ex, y: ey },
        ])
      : lang === 'wavy'
        ? wavyPath(sx, sy, ex, ey)
        : compactBezier(sx, sy, ex, ey, token.lineStyle.curvature);
  const stroke =
    lang === 'color-curve' && branchColor ? branchColor.stroke : token.color.linkStroke;
  return { d, stroke, width: token.lineStyle.width };
}

/** 双弧 S 形「任意曲线」（摆幅随跨度自适应，镜像支持左右双向） */
export function wavyPath(sx: number, sy: number, ex: number, ey: number): string {
  const dx = Math.abs(ex - sx);
  const dy = Math.abs(ey - sy);
  const dir = ex >= sx ? 1 : -1;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const amp = clamp(dx * 0.05 + dy * 0.03, 2, 9);
  return (
    `M ${sx} ${sy} ` +
    `C ${sx + dir * dx * 0.4} ${sy}, ${mx - dir * dx * 0.12} ${my - amp}, ${mx} ${my} ` +
    `C ${mx + dir * dx * 0.12} ${my + amp}, ${ex - dir * dx * 0.4} ${ey}, ${ex} ${ey}`
  );
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
