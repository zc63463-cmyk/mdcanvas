/**
 * 画布手势（pan 平移 / pinch 多指缩放 / 节点拖拽结束）的状态与处理器。
 *
 * 从 `MapView` 拆出，属代码结构规范化 T2。目前承载**结束类**处理器
 * （onPointerUp / onPointerCancel）与手势所需的两个 ref；
 * 起始类处理器（onPointerDown / onPointerMove）仍在 MapView 内，
 * 通过本 hook 返回的 `pinch` / `dragRef` 共享同一份状态——渐进迁移，避免一次大改。
 *
 * 同时承载 `worldPointOf` / `hitNodeAt` 两个交互辅助函数：
 * 它们被 MapView 的多个处理器共用，放在这里以保持单向依赖（MapView → 本模块）。
 *
 * 不是什么：不含节点拖拽的起始逻辑（命中 → setNodeDrag），那仍在 MapView。
 */

import type { LayoutResult } from '@mindcanvas/kernel';
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { useRef } from 'react';
import { PAN_INERTIA_TRIGGER } from './motion.js';
import { type DropMode, planDrop } from './nodeDrag.js';
import { PinchTracker } from './pinch.js';
import { estimatePanVelocity, type PanSample, type ViewportController } from './viewport.js';

/** 可见节点（= layout.nodes 的元素） */
export type VisibleNode = LayoutResult['nodes'][number];

/** 节点拖拽状态（与 MapView 内 useState 的结构一致） */
export interface NodeDragState {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  targetId: string | null;
  mode: DropMode;
  valid: boolean;
}

/** 画布平移拖拽的运行时状态 */
interface PanDrag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  samples: PanSample[];
}

/**
 * 指针事件 → 世界坐标（扣掉容器偏移）。
 *
 * 这是所有命中测试 / 拖拽定位的公共第一步。原先在 onPointerDown / onPointerUp /
 * onContextMenu / onDoubleClick 里各写一遍（4 处重复），收敛到此处。
 */
export function worldPointOf(
  e: { clientX: number; clientY: number },
  el: { getBoundingClientRect(): { left: number; top: number } },
  viewport: ViewportController,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
}

/**
 * 自后向前命中可见节点（后绘制的在上，故倒序遍历），返回最顶层的命中项。
 *
 * `skip` 用于排除：拖拽时跳过根节点（depth===0 不可拖）、
 * 以及拖拽中被排除的节点自身（dragExcluded）。
 */
export function hitNodeAt(
  visible: readonly VisibleNode[],
  w: { x: number; y: number },
  skip?: (ln: VisibleNode) => boolean,
): VisibleNode | null {
  for (let i = visible.length - 1; i >= 0; i--) {
    const ln = visible[i]!;
    if (skip?.(ln)) continue;
    if (worldHitPad(ln.box, w)) return ln;
  }
  return null;
}

/** 命中判定（含 6px 容差）——抽出来只为让 hitNodeAt 保持单一职责 */
function worldHitPad(box: VisibleNode['box'], w: { x: number; y: number }): boolean {
  const pad = 6;
  return (
    w.x >= box.x - pad &&
    w.x <= box.x + box.w + pad &&
    w.y >= box.y - pad &&
    w.y <= box.y + box.h + pad
  );
}

export interface UseMapGesturesParams {
  viewport: ViewportController;
  layout: LayoutResult;
  /** 视口裁剪后的可见节点（命中测试只遍历它，不遍历全量） */
  visibleNodes: readonly VisibleNode[];
  nodeDrag: NodeDragState | null;
  setNodeDrag: Dispatch<SetStateAction<NodeDragState | null>>;
  /** 合法落点 → 执行移动 op；非法（成环/自拖/根目标）→ 不回调 */
  onNodeMove?: (op: NonNullable<ReturnType<typeof planDrop>['op']>) => void;
  onNodeClick?: (ln: VisibleNode, info: { shift: boolean; sx: number; sy: number }) => void;
}

export function useMapGestures({
  viewport,
  layout,
  visibleNodes,
  nodeDrag,
  setNodeDrag,
  onNodeMove,
  onNodeClick,
}: UseMapGesturesParams) {
  /** R2：多指 pinch 跟踪（≥2 指 → 缩放模式，抑制 pan / 节点拖拽） */
  const pinch = useRef(new PinchTracker());
  /** 画布平移拖拽（含 M5-T4 速度采样，用于松手惯性） */
  const dragRef = useRef<PanDrag | null>(null);

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    // R2：指头抬起——退出登记（剩一指重新按下即可恢复 pan）
    pinch.current.up(e.pointerId);
    // 节点拖拽结束（M5-T5）：合法落点 → move-node op；非法/无目标 → 拒绝；未移动 → 点击选中
    const nd = nodeDrag;
    if (nd && nd.pointerId === e.pointerId) {
      if (nd.moved) {
        const plan = nd.targetId ? planDrop(layout, nd.nodeId, nd.targetId, nd.mode) : null;
        if (plan?.valid && plan.op) onNodeMove?.(plan.op);
        // 非法（成环/自拖/根目标）→ 不执行任何 op
      } else {
        const ln = layout.nodes.find((n) => n.node.id === nd.nodeId);
        if (ln) onNodeClick?.(ln, { shift: e.shiftKey, sx: e.clientX, sy: e.clientY });
      }
      setNodeDrag(null);
      return;
    }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) {
      // M5-T4：松手速度高于阈值 → 惯性滑行（指数衰减缓停）
      const { vx, vy } = estimatePanVelocity(d.samples);
      if (Math.hypot(vx, vy) >= PAN_INERTIA_TRIGGER) viewport.animateInertia(vx, vy);
      return;
    }
    // 点击：世界坐标命中检测（可见节点自后向前取顶）
    const w = worldPointOf(e, e.currentTarget, viewport);
    const ln = hitNodeAt(visibleNodes, w);
    if (ln) onNodeClick?.(ln, { shift: e.shiftKey, sx: e.clientX, sy: e.clientY });
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): void => {
    pinch.current.up(e.pointerId);
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    setNodeDrag((d) => (d?.pointerId === e.pointerId ? null : d));
  };

  return { pinch, dragRef, onPointerUp, onPointerCancel };
}
