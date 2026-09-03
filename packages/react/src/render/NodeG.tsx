/**
 * 节点渲染组件（按 token.nodeStyle.shape 参数化——矩形/贴纸/玻璃差异全部收敛在令牌）。
 * 纯展示：几何与样式结论来自 geometry.nodeCardStyle，文本来自内核 displayMetrics。
 * 组件内零视觉值（无 #hex / rgba 字面量）。
 */
import { useEffect, useState } from 'react';
import type { DisplayMetrics, LayoutNode } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import type { NodeCardStyle } from './geometry.js';
import type { AnimatedBox } from './transition.js';

export interface NodeGProps {
  node: LayoutNode;
  style: NodeCardStyle;
  metrics: DisplayMetrics;
  token: TokenSet;
  depth: number;
  /** 是否根节点 */
  root: boolean;
  /** 实体节点 kind chip 起点 x（MapView 预计算；非实体为 null） */
  chipX: number | null;
  /** 文本被 LOD 省略（只画卡片） */
  noText: boolean;
  /** 选中态：描边换令牌 selection 色 */
  selected?: boolean;
  /** 有子节点时显示折叠指示三角（供折叠/展开） */
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 展开态（快速注释生长）：本体 rect 只画 bodyHeight 高，下方注释区背景由 SVG 画 */
  expanded?: boolean;
  /** 展开态本体高（不含注释区）；缺省 = 布局盒高 */
  bodyHeight?: number;
  /** 资产基础 URL（@img/@draw 实体渲染 <image> 预览时拼接；缺省不渲染） */
  assetBaseUrl?: string;
  /**
   * 动画覆盖（M5-T2）：提供则整体平移/缩放/透明度取代布局坐标（淡入淡出/位置插值）；
   * 缺省 = 布局盒原位渲染。内容排版仍按 node.box 尺寸——插值只动 x/y 与整组变换。
   */
  anim?: AnimatedBox;
  /** 拖拽落点高亮（M5-T5）：valid → 令牌 selection 描边；invalid → 令牌 warn 描边（拒绝态） */
  dragTarget?: 'valid' | 'invalid';
}

const LINE_H = 16;
const COLLAPSE_R = 6;
/** 资产区与文本区的垂直间隙（与内核 nodeLayout 的 ASSET_GAP 对齐） */
const ASSET_GAP = 8;

export function NodeG({
  node,
  style,
  metrics,
  token,
  depth,
  root,
  chipX,
  noText,
  selected,
  hasChildren,
  collapsed,
  onToggleCollapse,
  expanded,
  bodyHeight,
  assetBaseUrl,
  anim,
  dragTarget,
}: NodeGProps) {
  const b = node.box;
  const leaf = depth >= 2;
  const fontSize = leaf ? token.font.sizeLeaf : token.font.size;
  const fontWeight = root ? token.font.weightRoot : token.font.weight;
  const lines = metrics.lines;
  // 展开态：文本/本体居顶（bodyHeight 内），注释区从 bodyHeight 到 b.h
  const bodyH = expanded && bodyHeight != null ? bodyHeight : b.h;
  // 滤镜：sticker 主题的 drop-shadow 直接以 CSS filter 应用（令牌即滤镜语法）；其余 none
  const shadow = style.filter === 'none' ? undefined : { filter: style.filter };
  // 选中：描边换 selection 令牌色 + 描边加粗（交互态，非主题差异 → 走令牌）
  const stroke = dragTarget
    ? dragTarget === 'valid'
      ? token.color.selection
      : token.color.warn
    : selected
      ? token.color.selection
      : style.stroke;
  const strokeWidth = dragTarget || selected ? style.strokeWidth + 1 : style.strokeWidth;
  // 资产预览：@img/@draw 实体 → 拼接 assetBaseUrl 渲染 <image>（非资产实体 / 无 baseUrl 不渲染）
  const assetKind =
    node.node.type === 'entity' &&
    node.node.ref?.kind &&
    (node.node.ref.kind === 'img' || node.node.ref.kind === 'draw')
      ? node.node.ref.kind
      : null;
  const assetHref = assetKind && assetBaseUrl ? assetBaseUrl + (node.node.ref?.id ?? '') : null;
  // 资产区高度仅当确实要渲染图片时才占位（无 baseUrl 时降级为纯文本节点，不留空白）
  const assetH = assetHref !== null ? (metrics.assetH ?? 0) : 0;
  // 文本区起点：有资产时下移至资产区之下，二者垂直分离不再重叠（布局侧已同步预留高度）
  const textAreaTop = assetH > 0 ? assetH + ASSET_GAP : 0;
  const textTop = textAreaTop + (bodyH - textAreaTop - lines.length * LINE_H) / 2;
  // 资产加载失败 → warn 占位（虚线框 + ✕ 提示，非无感隐藏）；href 变化重置失败态
  const [assetFailed, setAssetFailed] = useState(false);
  useEffect(() => setAssetFailed(false), [assetHref]);
  const showAsset = assetH > 0 && !assetFailed;
  // 注释区底部圆角半径：不超过连体段高度的一半（防止矮注释区圆角过冲成畸形）
  const noteR = Math.min(style.radius, Math.max(0, (b.h - bodyH) / 2));
  return (
    <g
      transform={
        anim ? `translate(${anim.x} ${anim.y}) scale(${anim.scale})` : `translate(${b.x} ${b.y})`
      }
      data-node-id={node.node.id}
      opacity={anim ? anim.opacity : 1}
      // 淡入/淡出中的节点不可交互（命中检测只走布局节点——双保险防误点）
      style={anim && anim.opacity < 1 ? { pointerEvents: 'none' } : undefined}
    >
      <rect
        x={0}
        y={0}
        width={b.w}
        height={bodyH}
        rx={style.radius}
        fill={style.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        style={shadow}
      />
      {/* 资产失效占位（P2）：加载失败 → warn 虚线框 + ✕ 提示（诊断标识，不再静默隐藏） */}
      {assetH > 0 && assetFailed && (
        <g data-asset-broken>
          <rect
            x={4}
            y={4}
            width={Math.max(0, b.w - 8)}
            height={Math.max(0, assetH - 8)}
            rx={6}
            fill="none"
            stroke={token.color.warn}
            strokeWidth={1.2}
            strokeDasharray="4 3"
          />
          {/* 文字也受 noText 约束：编辑态由浮层 <input> 独占文字层，
              否则这段 SVG 文字会和输入框内容叠在一起（与主题文字同样的双层问题）。
              虚线框保留 —— 它是诊断标识，不是文字，被输入框半透明底色盖住也无妨。 */}
          {assetH >= 22 && !noText && (
            <text
              x={b.w / 2}
              y={assetH / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fill={token.color.warn}
            >
              ✕ 资产缺失
            </text>
          )}
        </g>
      )}
      {/* 资产预览：卡片式布局——图片占顶部独立区（高度由内核 displayMetrics.assetH 预留），文本区在其下方 */}
      {showAsset && (
        <image
          href={assetHref ?? undefined}
          x={4}
          y={4}
          width={Math.max(0, b.w - 8)}
          height={Math.max(0, assetH - 8)}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.92}
          onError={() => setAssetFailed(true)}
        />
      )}
      {/* 展开态：注释区背景（连体：上半直角与本体相接、下半圆角；顶边 stroke 即分隔线，不再额外叠加 line） */}
      {expanded && bodyH < b.h && (
        <path
          d={`M 0 ${bodyH} H ${b.w} V ${b.h - noteR} Q ${b.w} ${b.h} ${b.w - noteR} ${b.h} H ${noteR} Q 0 ${b.h} 0 ${
            b.h - noteR
          } Z`}
          fill={token.color.annotationBadge}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {hasChildren && !root && onToggleCollapse && (
        <g
          onPointerDown={(e) => e.stopPropagation() /* 阻止触发画布拖拽/选择 */}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          style={{ cursor: 'pointer' }}
          transform={`translate(${b.w - COLLAPSE_R * 2} ${bodyH / 2})`}
        >
          <circle r={COLLAPSE_R + 2} fill="transparent" />
          <path
            d={
              collapsed
                ? `M ${-2.5} ${-4} L ${-2.5} ${4} L ${3} 0 Z`
                : `M ${-4} ${-2.5} L ${4} ${-2.5} L 0 ${3} Z`
            }
            fill={token.color.textMuted}
            opacity={0.85}
          />
        </g>
      )}
      {!noText && (
        <g>
          {metrics.kindLabel !== null && (
            <text
              x={chipX ?? 12}
              y={textTop + LINE_H / 2}
              fontSize={fontSize}
              fontWeight={token.font.weightRoot}
              fill={metrics.kindColor}
              dominantBaseline="central"
            >
              {metrics.kindLabel}
            </text>
          )}
          {lines.map((line, i) => (
            <text
              key={i}
              x={metrics.contentX}
              y={textTop + i * LINE_H + LINE_H / 2}
              fontSize={fontSize}
              fontWeight={fontWeight}
              fill={style.text}
              dominantBaseline="central"
            >
              {line}
            </text>
          ))}
          {metrics.hasNote && <NoteDot token={token} x={b.w - 12} y={bodyH - 12} />}
          {metrics.warn && <WarnDot token={token} x={b.w - 12} y={12} />}
        </g>
      )}
    </g>
  );
}

/** 有笔记的节点角标（token 驱动色） */
function NoteDot({ token, x, y }: { token: TokenSet; x: number; y: number }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={2.5}
      fill={token.color.accent ?? token.color.textMuted}
      opacity={0.85}
    />
  );
}

/** 未解析实体警示（token.color.warn） */
function WarnDot({ token, x, y }: { token: TokenSet; x: number; y: number }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={3.5}
      fill="none"
      stroke={token.color.warn}
      strokeWidth={1.4}
      opacity={0.9}
    />
  );
}
