/**
 * 画布 overlay 组件集合（从 `MapView.tsx` 拆出，属代码结构规范化 T2）
 *
 * 这三者共同点：都是**屏幕坐标定位**的浮层，锚定节点在世界坐标中的位置，
 * 经 viewport 变换换算到屏幕。与 SVG 画布内的内容（节点/连线）职责不同——
 * 画布内的是可缩放矢量内容，overlay 是常驻尺寸的 HTML 交互层（输入框、滚动区）。
 *
 * 不是什么：不含画布本体（节点渲染、连线路由、指针手势），那些仍在 `MapView`。
 *
 * 拆分性质：纯搬迁，逻辑未改写。
 */
import type { ReactElement } from 'react';
import type { LayoutResult } from '@mindcanvas/kernel';
import {
  DescBlock,
  DESC_EXPAND_MAX_LINES,
  DESC_MAX_LINES,
  estimateDescHeight,
} from '../chrome/DescBlock.js';
import { estimateCommentAreaHeight, GrowthCommentPanel } from '../chrome/GrowthCommentPanel.js';
import { OverlayEditor } from '../edit/OverlayEditor.js';
import type { TokenSet } from '../theme/types.js';
import type { ViewportController } from './viewport.js';

/** DescOverlays 所需的最小布局节点形态（避免与 LayoutResult 具体类型耦合） */
interface LayoutNodeLike {
  node: { id: string; note?: { desc?: unknown } };
  box: { x: number; y: number; w: number; h: number };
  /** 层级（描述区字号 / 行高按它差分） */
  depth: number;
}

/**
 * 幕布描述 overlay 集合（v1.3.0）：遍历**视口内**布局节点，凡 note.desc 非空（或正在编辑）
 * 都在其本体下方渲染引用块。与 ExpandCommentOverlay 同构（屏幕坐标 + scale），
 * 但区别是——描述是**常驻可见**的（默认收缩一行），不依赖 expandedId 点击展开。
 *
 * 性能（v1.3.0 编辑深度优化）：只遍历 visibleNodes（视口裁剪结果），
 * 原实现遍历全量 layout.nodes —— 10K 节点图会为不可见节点创建上万个 div。
 */
export function DescOverlays({
  visible,
  viewport,
  token,
  descEditingId,
  descExpandedIds,
  expandedNodeIds,
  onToggle,
  onCommit,
  onCancel,
}: {
  /** 视口裁剪后的节点（性能：不遍历全量 layout.nodes —— 10K 图会渲染上万个 div） */
  visible: readonly LayoutNodeLike[];
  viewport: ViewportController;
  token: TokenSet;
  descEditingId: string | null;
  descExpandedIds?: ReadonlySet<string>;
  /**
   * 节点级「放大展开」：这些节点的描述区行数上限更高（DESC_EXPAND_MAX_LINES）。
   * 与 descExpandedIds 一样画在节点盒内、**占布局** → 节点盒加高、挤压相邻节点。
   * 高度口径必须与 createDescMeasure 一致，否则节点盒与描述区错位。
   */
  expandedNodeIds?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  onCommit?: (id: string, text: string) => void;
  onCancel?: () => void;
}) {
  const { k, x, y } = viewport.transform;
  const out: ReactElement[] = [];
  for (const ln of visible) {
    const raw = ln.node.note?.desc;
    const desc = typeof raw === 'string' ? raw : '';
    const isEditing = descEditingId === ln.node.id;
    // 编辑态即使文本为空也要渲染（新建描述的占位）
    if (desc === '' && !isEditing) continue;
    const expanded = descExpandedIds?.has(ln.node.id) ?? false;
    // editing **不传**：布局 measure（createDescMeasure）刻意不含 editing ——
    // 纳入会让 measureKey 变化 → LayoutCache.reset() → 全树重排（10K 卡死）。
    // 编辑态沿用内容高度，由 DescBlock 的 floating 机制处理"无预留时浮出"。
    // depth 同理不参与高度：EditableNode 没有 depth 字段，measure 拿不到，
    // 若 overlay 按 depth 算行高就会与 measure 预留的高度错位。
    // → 高度只由 expanded + desc 决定（与 measure 严格同口径）；
    //   depth 只影响描述区**字号**（传给 DescBlock，不参与布局高度）。
    // 节点级「放大展开」：与"点击描述区展开"一样画在节点盒内（占布局 → 挤压相邻节点），
    // 只是行数上限更高。高度必须与 createDescMeasure 的口径完全一致，否则错位。
    const isNodeExpanded = expandedNodeIds?.has(ln.node.id) ?? false;
    const cap = isNodeExpanded ? DESC_EXPAND_MAX_LINES : DESC_MAX_LINES;
    const dh = estimateDescHeight(expanded || isNodeExpanded, desc, false, cap);
    // 有 desc 的节点：布局已预留描述区高度（createDescMeasure），描述区画在节点盒内的下半部。
    // 无 desc 的新建编辑：节点盒**没有**预留（measure 不含 editing，否则会全树重排）→
    //   描述区浮出在节点盒下方（绝对定位覆盖，不占布局 → 进入/退出编辑零重排）。
    const hasSlot = desc !== '';
    const bodyH = hasSlot ? Math.max(0, ln.box.h - dh) : ln.box.h;
    out.push(
      <DescBlock
        key={ln.node.id}
        text={desc}
        editing={isEditing}
        expanded={expanded}
        // 浮出**视觉**（卡片底色 + 圆角 + 阴影 + 高层级）用于两种场景：
        //   ① !hasSlot：无预留高度的新建编辑 —— 真浮出，不占布局，会遮挡邻居
        //   ② isNodeExpanded：节点放大展开 —— **有**预留高度（measure 已加高，
        //      会挤压相邻节点），只是沿用浮出卡片的外观，让它看起来是"浮"起来的。
        // 即 floating 是**视觉开关**，不等于"不占布局"。
        floating={!hasSlot || isNodeExpanded}
        token={token}
        x={ln.box.x * k + x}
        y={(ln.box.y + bodyH) * k + y}
        width={ln.box.w * k}
        height={dh * k}
        scale={k}
        depth={ln.depth}
        onToggle={() => onToggle?.(ln.node.id)}
        onCommit={(t) => onCommit?.(ln.node.id, t)}
        onCancel={() => onCancel?.()}
      />,
    );
  }
  return <>{out}</>;
}

/**
 * 展开态注释区高度（定值，与布局 measure 注入共用）。
 * 导出：MapView 侧的布局计算同样需要它，两边必须同一个值。
 */
export const commentAreaH = estimateCommentAreaHeight();

/** 展开节点注释区 overlay：锚定节点本体下方（屏幕坐标），与 SVG 连体 + 内置滚动 */
export function ExpandCommentOverlay({
  expandedId,
  layout,
  viewport,
  token,
  expandedNodeIds,
  onChange,
  onClose,
}: {
  expandedId: string;
  layout: LayoutResult;
  viewport: ViewportController;
  token: TokenSet;
  /** 放大展开的节点集合（决定描述区高度，注释区要给它让位） */
  expandedNodeIds?: ReadonlySet<string>;
  onChange: (qa: string[]) => void;
  onClose: () => void;
}) {
  const ln = layout.nodes.find((n) => n.node.id === expandedId);
  if (!ln) return null;
  const qa = ln.node.note?.qa;
  const items = Array.isArray(qa) ? (qa as string[]) : [];
  if (items.length === 0) return null;
  const { k, x, y } = viewport.transform;
  // 布局盒 = 本体高 + 描述区高 + 注释区高（createDescMeasure 已把描述区算进 box.h）。
  // ⚠️ 注释区必须从**描述区之上**开始：若这里只扣 commentAreaH，注释区就会落在
  // 描述块身上（两者都从盒底往上锚）→ 视觉重叠。修正前 ea969d4 引入了这个回归。
  const descText = typeof ln.node.note?.desc === 'string' ? (ln.node.note.desc as string) : '';
  const descH =
    descText === ''
      ? 0
      : estimateDescHeight(
          expandedNodeIds?.has(ln.node.id) ?? false,
          descText,
          false,
          expandedNodeIds?.has(ln.node.id) ? DESC_EXPAND_MAX_LINES : DESC_MAX_LINES,
        );
  const bodyH = Math.max(0, ln.box.h - commentAreaH - descH);
  const sx = ln.box.x * k + x;
  const sy = (ln.box.y + bodyH) * k + y;
  const sw = ln.box.w * k;
  const sh = commentAreaH * k;
  return (
    <GrowthCommentPanel
      items={items}
      onChange={onChange}
      onClose={onClose}
      token={token}
      x={sx}
      y={sy}
      width={sw}
      height={sh}
      scale={k}
    />
  );
}

/** 节点文本内联编辑 overlay（绝对定位 input；Enter 提交 / Esc 取消 / blur 提交
 *  v1.3.0：Shift+Enter 切到描述编辑，经 onDescEditRequest 上报） */
export function NodeTextOverlay({
  editingId,
  layout,
  viewport,
  token,
  onCommit,
  onCancel,
  onDescEditRequest,
}: {
  editingId: string;
  layout: LayoutResult;
  viewport: ViewportController;
  token: TokenSet;
  onCommit?: (id: string, text: string) => void;
  onCancel?: () => void;
  onDescEditRequest?: (id: string) => void;
}) {
  const ln = layout.nodes.find((n) => n.node.id === editingId);
  if (!ln || !onCommit) return null;
  const { k, x, y } = viewport.transform;
  const sx = ln.box.x * k + x;
  const sy = ln.box.y * k + y;
  const sw = ln.box.w * k;
  const sh = ln.box.h * k;
  const initial = ln.node.type === 'text' ? (ln.node.text ?? '') : '';
  return (
    <OverlayEditor
      x={sx}
      y={sy}
      w={sw}
      h={sh}
      initial={initial}
      token={token}
      depth={ln.depth}
      root={ln.depth === 0}
      scale={k}
      onCommit={(t) => onCommit(editingId, t)}
      onCancel={() => onCancel?.()}
      // v1.3.0：主题编辑态 Shift+Enter → 切换到该节点的描述编辑（幕布语义）
      onRequestDesc={onDescEditRequest ? () => onDescEditRequest(editingId) : undefined}
    />
  );
}
