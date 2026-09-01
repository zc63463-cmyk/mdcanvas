/**
 * 场景构建器（C1：Canvas 主循环接入的第一块）。
 * 从「可见节点/连线 + 令牌」构建后端无关的 ScenePrimitive 树（世界坐标；
 * 视口变换由 CanvasSurface 的 setTransform 处理）。
 * 视觉决策取 NodeG 的简化等价：节点卡（分支色/叶样式）+ 单行文本 + 折叠计数 + 选中描边。
 * 交互态（hover/编辑浮层/拖拽 ghost）不在场景内——超大图降级场景可接受。
 */
import { buildLinkPath, nodeCardStyle, type CardLevel } from './geometry.js';
import type { BranchColor, TokenSet } from '../theme/types.js';
import type { ScenePrimitive } from './backend.js';
import type { Box, LayoutNode } from '@mindcanvas/kernel';

/** 自动切 Canvas 的节点数阈值（T8 降级策略 L3：>50K） */
export const CANVAS_AUTO_NODES = 50000;

/** 场景构建输入（调用方从 MapView 渲染循环的既有量装配） */
export interface SceneInput {
  nodes: Array<{
    id: string;
    box: Box;
    depth: number;
    text: string | null;
    isEntity: boolean;
    entityKind: string | null;
    childCount: number;
    collapsed: boolean;
    selected: boolean;
  }>;
  /** 连线（端点盒由调用方解析后传入） */
  links: Array<{ from: Box; to: Box; toId: string }>;
  /** 节点 id → 分支色（MapView 的 branchIndex 已算好） */
  branchColorOf: (id: string) => BranchColor | undefined;
  token: TokenSet;
}

/** 单节点 → 场景组（卡 + 文本 + 折叠计数） */
function nodeScene(
  n: SceneInput['nodes'][number],
  token: TokenSet,
  colorOf: (id: string) => BranchColor | undefined,
): ScenePrimitive {
  const palette = colorOf(n.id);
  const level: CardLevel = n.depth >= 2 ? 'leaf' : 'branch';
  const style = nodeCardStyle(token, palette, level, n.isEntity ? (n.entityKind ?? null) : null);
  const selectedStroke = n.selected ? token.color.selection : style.stroke;
  const selectedWidth = n.selected ? style.strokeWidth + 1 : style.strokeWidth;
  const children: ScenePrimitive[] = [
    {
      type: 'rect',
      x: 0,
      y: 0,
      w: n.box.w,
      h: n.box.h,
      rx: style.radius,
      fill: style.fill,
      stroke: selectedStroke,
      strokeWidth: selectedWidth,
    },
  ];
  // 单行文本（骨架保真：省略多行换行；文本缺省占位）
  const fontSize = n.depth >= 2 ? token.font.sizeLeaf : token.font.size;
  children.push({
    type: 'text',
    x: token.spacing.padX + 2,
    y: n.box.h / 2,
    value: n.text ?? '（实体）',
    fontSize,
    fontWeight: n.depth === 0 ? token.font.weightRoot : token.font.weight,
    fill: style.text,
    dominantBaseline: 'central',
  });
  // 折叠计数（一眼可知隐藏子树规模）
  if (n.collapsed && n.childCount > 0) {
    children.push({
      type: 'text',
      x: n.box.w - 8,
      y: n.box.h / 2,
      value: `+${n.childCount}`,
      fontSize: token.font.sizeLeaf,
      fontWeight: 600,
      fill: token.color.textMuted,
      dominantBaseline: 'central',
    });
  }
  return { type: 'group', transform: `translate(${n.box.x} ${n.box.y})`, children, dataId: n.id };
}

/** 可见节点/连线 → 场景树（世界坐标） */
export function buildSceneFromLayout(input: SceneInput): ScenePrimitive {
  const linkPrims = input.links.map((l) => {
    const p = buildLinkPath(input.token, l.from, l.to);
    return { type: 'path', d: p.d, stroke: p.stroke, strokeWidth: p.width } as ScenePrimitive;
  });
  const nodePrims = input.nodes.map((n) => nodeScene(n, input.token, input.branchColorOf));
  return { type: 'group', transform: '', children: [...linkPrims, ...nodePrims] };
}
