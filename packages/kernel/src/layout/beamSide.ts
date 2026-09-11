/**
 * 出线长度与横向共享梁（hub 的 left/right 组，v1.7.0）。
 *
 * 从 branching.ts 拆出：hub 横向梁线家族（len/lens 语义 + 竖梁几何 + 候选族 +
 * 纵向钳制）独立成章——branching 的分组调度只消费，不再兼任四种梁的实现者，
 * 同时保住 600 行预算线。依赖方向单向：本模块 ← branching；本模块 → mindmap /
 * layouts / linkClear，无回流。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { GrowDir } from './mindmap.js';
import { orthogonalPath, type Box, type LayoutNode } from './mindmap.js';
import { LINK_CLEAR_MARGIN, type LinkGeometry } from './linkClear.js';
import { subtreeBBox, translateSubtree, type BBox } from './layouts.js';
import { SEPARATE_MARGIN } from './separate.js';

export type BeamDir = 'up' | 'down' | 'left' | 'right';
// ---------- 容错读取器（v1.7.0 深度审查补） ----------
//
// 手写 .mm.md 的标量全是字符串（迷你 YAML 的 scalarValue 不做类型收敛）：
// `hub: true` 读回 'true'、`len: 60` 读回 '60'——此前布局消费用严格 typeof 判定，
// 文件层全线失效（仅编辑器往返侥幸可用：serializer 写严格 JSON）。读取一律走
// 这里做**容错收敛**（数字/数字字符串/布尔/'true'），单一事实源，react 同源消费。

/** 数字或数字字符串 → number；否则 null */
function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** 层距上限：出线是「相邻层距」，几百 px 已无意义——坏窗口期拖出的巨型值在读取侧钳回，
 * 旧文档无需手动清理（上限同时挡住「布局炸裂」的复发路径） */
export const BEAM_MAX_LEN = 600;

const clampLen = (n: number): number =>
  Math.min(BEAM_MAX_LEN, Math.max(SEPARATE_MARGIN, Math.round(n)));

/** 读取出线长度（note.len）：数字/数字字符串容错，钳到 [14, 600]；缺省/非法 → null */
export function readLinkLen(note: unknown): number | null {
  const n = asNum((note as { len?: unknown } | null)?.len);
  return n === null ? null : clampLen(n);
}

/** 读取出线枢纽标记（note.hub）：布尔 true 或字符串 'true' */
export function readHubFlag(note: unknown): boolean {
  const v = (note as { hub?: unknown } | null)?.hub;
  return v === true || v === 'true';
}

/** 宽松流式映射：`{ up: 60, down: 32 }`（无引号键/值亦可）→ Record；值保留原样（消费端收敛） */
function parseLenientFlow(s: string): Record<string, unknown> | null {
  const inner = s.trim().slice(1, -1);
  if (inner.trim() === '') return {};
  const out: Record<string, unknown> = {};
  for (const part of inner.split(',')) {
    const m = part.match(/^\s*([^:\s]+)\s*:\s*(.*?)\s*$/);
    const key = m?.[1];
    if (!m || key === undefined) return null;
    out[key] = m[2] ?? '';
  }
  return out;
}

/** 读取逐方向组缺省（note.lens）：对象 / 内联 JSON / 宽松流式字符串皆可；非法 → null */
export function readLensMap(note: unknown): Partial<Record<BeamDir, number>> | null {
  const raw = (note as { lens?: unknown } | null)?.lens;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      obj = parseLenientFlow(s);
    }
  }
  if (obj === null || typeof obj !== 'object') return null;
  const out: Partial<Record<BeamDir, number>> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== 'up' && k !== 'down' && k !== 'left' && k !== 'right') continue;
    const n = asNum(v);
    if (n !== null) out[k] = clampLen(n);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 出线长度（note.len）：本节点与父节点连线的直线段距离（盒边到盒边）。
 *
 * 缺省/非法回落布局常量；下限钳到 SEPARATE_MARGIN——用户设得过小时消解会推回，
 * 预钳制避免「落位 → 消解推回」的往返抖动。**容错读取走 readLinkLen**（手写文件的
 * 数字标量是字符串，严格 typeof 会全线失效——深度审查实测）。
 */
export function linkLen(node: EditableNode, fallback: number): number {
  return readLinkLen(node.note) ?? fallback;
}

/**
 * 方向组的**组缺省层距**：父 `lens[dir]` > 父 `len`（仅 up/down，向后兼容）> 布局常量。
 *
 * 逐方向是刻意设计——四个方向共用一个尺度必然顾此失彼（down 要留白、right 要紧凑
 * 是常态），拖哪根共享梁就写哪个方向的键。非法值与 {@link linkLen} 同口径静默回落。
 */
export function groupGapOf(parent: EditableNode, dir: GrowDir, fallback: number): number {
  const v = readLensMap(parent.note)?.[dir];
  if (v !== undefined) return v;
  if (dir === 'up' || dir === 'down') return linkLen(parent, fallback);
  return fallback;
}

/** 向右组共享竖梁的 x：父右边与「最靠左的 right 子节点左缘」的中点（beamYUp 的换轴镜像） */
export function beamXRight(parent: LayoutNode, dirOfChild: (c: LayoutNode) => GrowDir): number {
  const lefts = parent.children
    .filter((c) => dirOfChild(c) === 'right')
    .map((c) => c.box.x);
  return (
    (parent.box.x + parent.box.w + (lefts.length ? Math.min(...lefts) : parent.box.x + parent.box.w)) / 2
  );
}

/** 向左组共享竖梁的 x：父左边与「最靠右的 left 子节点右缘」的中点 */
export function beamXLeft(parent: LayoutNode, dirOfChild: (c: LayoutNode) => GrowDir): number {
  const rights = parent.children
    .filter((c) => dirOfChild(c) === 'left')
    .map((c) => c.box.x + c.box.w);
  return (parent.box.x + (rights.length ? Math.max(...rights) : parent.box.x)) / 2;
}

/**
 * 横向梁线候选族（hub 的 left/right 共享竖梁）：只改竖梁的 x（首个是默认梁位）。
 *
 * beamVariants 的换轴镜像：梁位在「父出边 ↔ 子入边」的空隙里取样；
 * 避障采样把梁位推到障碍物左缘之左 / 右缘之右，是否干净由 pickClearGeometry 复检。
 */
export function beamXVariants(
  parent: LayoutNode,
  child: LayoutNode,
  dir: 'right' | 'left',
  baseBeamX: number,
  index?: import('./linkClear.js').NodeIndex,
): LinkGeometry[] {
  const pad = LINK_CLEAR_MARGIN + 2;
  const pEdge = dir === 'right' ? parent.box.x + parent.box.w : parent.box.x;
  const cEdge = dir === 'right' ? child.box.x : child.box.x + child.box.w;
  const lo = Math.min(pEdge, cEdge) + pad;
  const hi = Math.max(pEdge, cEdge) - pad;
  const xs: number[] = [baseBeamX];
  if (hi - lo > 1) {
    xs.push(lo, hi);
    for (let i = 1; i < 5; i++) xs.push(lo + ((hi - lo) * i) / 5);
  }
  const pcy = parent.box.y + parent.box.h / 2;
  const ccy = child.box.y + child.box.h / 2;
  if (index !== undefined) {
    const corridor: Box = {
      x: Math.min(pEdge, cEdge),
      y: Math.min(pcy, ccy),
      w: Math.abs(cEdge - pEdge),
      h: Math.abs(ccy - pcy),
    };
    for (const o of index.query(corridor, pad)) {
      if (o === parent || o === child) continue;
      xs.push(o.box.x - pad, o.box.x + o.box.w + pad);
    }
  }
  const at = (py: number, cy: number, x: number): LinkGeometry => {
    if (py === cy) {
      const pts = [
        { x: pEdge, y: py },
        { x: cEdge, y: cy },
      ];
      return { path: orthogonalPath(pts), points: pts };
    }
    const pts = [
      { x: pEdge, y: py },
      { x, y: py },
      { x, y: cy },
      { x: cEdge, y: cy },
    ];
    return { path: orthogonalPath(pts), points: pts };
  };
  // ① 默认画法（横干走父中线、落点走子中线）
  const out: LinkGeometry[] = xs.map((x) => at(pcy, ccy, x));
  // ② 干线直接走子节点中线 → 无竖段（父与子中线错开时反而更干净）
  for (const x of xs) out.push(at(ccy, ccy, x));
  return out;
}

/**
 * hub 左右组的纵向钳制：竖梁若在纵向上压过 up/down 组，整组沿 y 平移错开。
 *
 * clampGroupToSideWindow 的换轴镜像：窗口取上下组的内缘（仅取与「梁高程带」
 * ——组盒 x 范围朝父侧外扩半程最小层距，覆盖共享竖梁——横向相交者）；
 * 纵向不相交的上下组碰不到梁，不参与收口，保住「上下子树居中正上/正下」的形态。
 */
export function clampBeamGroupVertical(
  dir: 'right' | 'left',
  nb: Box,
  groupGap: number,
  group: LayoutNode[],
  upGroup: LayoutNode[],
  downGroup: LayoutNode[],
): void {
  if (group.length === 0) return;
  let gMinX = Infinity;
  let gMaxX = -Infinity;
  let gMinY = Infinity;
  let gMaxY = -Infinity;
  let minGap = Infinity;
  for (const c of group) {
    const b = subtreeBBox(c);
    gMinX = Math.min(gMinX, b.minX);
    gMaxX = Math.max(gMaxX, b.maxX);
    gMinY = Math.min(gMinY, b.minY);
    gMaxY = Math.max(gMaxY, b.maxY);
    minGap = Math.min(minGap, linkLen(c.node, groupGap));
  }
  const railX = dir === 'right' ? nb.x + nb.w + minGap / 2 : nb.x - minGap / 2;
  // 竖梁线段的 y 范围（子中线 ∪ 父中线）——只有 x 带含 railX 且 y 与线段相交的
  // 上下组才参与收口（组盒深处的相交归消解，不归钳制）
  const centersY: number[] = [];
  for (const c of group) {
    const b = subtreeBBox(c);
    centersY.push((b.minY + b.maxY) / 2);
  }
  centersY.push(nb.y + nb.h / 2);
  const spanLo = Math.min(...centersY);
  const spanHi = Math.max(...centersY);
  const pad = 6;
  const blocksRail = (b: BBox): boolean =>
    b.minX - pad <= railX &&
    railX <= b.maxX + pad &&
    b.minY - pad <= spanHi &&
    spanLo <= b.maxY + pad;
  let topEdge = -Infinity; // up 组的最下缘（窗口上界）
  let bottomEdge = Infinity; // down 组的最上缘（窗口下界）
  for (const c of upGroup) {
    const b = subtreeBBox(c);
    if (!blocksRail(b)) continue; // 不压竖梁 → 不收口
    topEdge = Math.max(topEdge, b.maxY);
  }
  for (const c of downGroup) {
    const b = subtreeBBox(c);
    if (!blocksRail(b)) continue;
    bottomEdge = Math.min(bottomEdge, b.minY);
  }
  if (topEdge === -Infinity && bottomEdge === Infinity) return;
  const height = gMaxY - gMinY;
  const window = bottomEdge - topEdge;
  if (window <= 0) return; // 上下组纵向倒置/重叠 → 无有效窗口，不钳（交由消解/换画法）
  let shift = 0;
  if (gMaxY > bottomEdge) shift = bottomEdge - gMaxY;
  if (gMinY + shift < topEdge) shift = topEdge - gMinY;
  if (height > window) {
    shift = topEdge + window / 2 - (gMinY + gMaxY) / 2; // 窗口比组矮 → 居中尽力
  }
  if (shift !== 0) {
    for (const c of group) translateSubtree(c, 0, shift);
  }
  }
