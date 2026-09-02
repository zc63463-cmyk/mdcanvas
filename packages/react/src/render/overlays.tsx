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
import { DescBlock, estimateDescHeight } from '../chrome/DescBlock.js';
import { estimateCommentAreaHeight, GrowthCommentPanel } from '../chrome/GrowthCommentPanel.js';
import { OverlayEditor } from '../edit/OverlayEditor.js';
import type { TokenSet } from '../theme/types.js';
import type { ViewportController } from './viewport.js';

/** DescOverlays 所需的最小布局节点形态（避免与 LayoutResult 具体类型耦合） */
interface LayoutNodeLike {
  node: { id: string; note?: { desc?: unknown } };
  box: { x: number; y: number; w: number; h: number };
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
    const dh = estimateDescHeight(expanded, desc);
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
        floating={!hasSlot}
        token={token}
        x={ln.box.x * k + x}
        y={(ln.box.y + bodyH) * k + y}
        width={ln.box.w * k}
        height={dh * k}
        scale={k}
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
  onChange,
  onClose,
}: {
  expandedId: string;
  layout: LayoutResult;
  viewport: ViewportController;
  token: TokenSet;
  onChange: (qa: string[]) => void;
  onClose: () => void;
}) {
  const ln = layout.nodes.find((n) => n.node.id === expandedId);
  if (!ln) return null;
  const qa = ln.node.note?.qa;
  const items = Array.isArray(qa) ? (qa as string[]) : [];
  if (items.length === 0) return null;
  const { k, x, y } = viewport.transform;
  // 布局盒 = 本体高 + 注释区高；注释区从本体之下开始
  const bodyH = Math.max(0, ln.box.h - commentAreaH);
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
