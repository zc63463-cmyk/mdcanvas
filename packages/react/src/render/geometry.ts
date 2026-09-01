/**
 * 几何与视觉决策层（ShapeUtil 精神：组件/几何分离）。
 * 全部纯函数、零 React 零 DOM 依赖：命中检测、节点卡片样式、连线路径、LOD。
 * 视觉值一律来自 TokenSet —— 本文件不出现任何 #hex / rgba 字面量。
 */
import { KIND_META, KIND_FALLBACK_COLOR, compactBezier } from '@mindcanvas/kernel';
import type { Box, LayoutNode } from '@mindcanvas/kernel';
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

/** 连线端点（父/子边缘中点，贴边） */
export function linkEndpoints(
  parent: Box,
  child: Box,
): { sx: number; sy: number; ex: number; ey: number } {
  const toRight = child.x >= parent.x;
  const sx = toRight ? parent.x + parent.w : parent.x;
  const ex = toRight ? child.x : child.x + child.w;
  return { sx, sy: parent.y + parent.h / 2, ex, ey: child.y + child.h / 2 };
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
 * 连线路径（按 token.lineStyle.language 分支）：
 * - color-curve：彩色曲线（水平切线单弧，复用 kernel compactBezier，curvature=0.4）
 * - soft：柔和贝塞尔（更缓 curvature=0.3）
 * - wavy：任意曲线（双弧 S 形、轻微纵向摆幅——手绘松弛感）
 * V1/V7/V8 设计报告内联 SVG 均为水平切线三次贝塞尔，此处以曲率区分连线语言。
 */
export function buildLinkPath(
  token: TokenSet,
  parent: Box,
  child: Box,
  branchColor?: BranchColor,
): LinkPathResult {
  const { sx, sy, ex, ey } = linkEndpoints(parent, child);
  const lang = token.lineStyle.language;
  const d =
    lang === 'wavy'
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
