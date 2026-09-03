/**
 * 画布手势（pan 平移 / pinch 多指缩放 / 节点拖拽结束）的状态与处理器。
 *
 * 从 `MapView` 拆出，属代码结构规范化 T2。承载画布手势的**全部四个**处理器
 * （onPointerDown / Move / Up / Cancel）与两个 ref 状态（pinch / dragRef）。
 *
 * 分三小步渐进迁移完成（每步独立验证、独立提交）：
 *   ① 抽出 worldPointOf / hitNodeAt 消除 5 处重复
 *   ② 搬入结束类处理器（Up / Cancel）
 *   ③ 搬入起始类处理器（Down / Move）
 * 全程保持 Hook 数量与调用位置恒定，故未触碰 Hook 顺序敏感性问题。
 *
 * 同时承载 `worldPointOf` / `hitNodeAt` 两个交互辅助函数：
 * 它们被 MapView 的多个处理器共用，放在这里以保持单向依赖（MapView → 本模块）。
 *
 * 不是什么：不含节点渲染、连线路由、自由边、连接手柄（仍在 MapView）；
 * 本模块只负责「指针事件 → 手势状态 / 节点拖拽状态」这一层。
 */

import type { LayoutResult } from '@mindcanvas/kernel';
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { useRef } from 'react';
import { PAN_INERTIA_TRIGGER, PAN_SAMPLE_WINDOW } from './motion.js';
import { type DropMode, dropModeFor, planDrop } from './nodeDrag.js';
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
  /** 拖拽中需排除的节点（被拖节点及其子树），避免命中自身 */
  dragExcluded?: ReadonlySet<string> | null;
  /** 合法落点 → 执行移动 op；非法（成环/自拖/根目标）→ 不回调 */
  onNodeMove?: (op: NonNullable<ReturnType<typeof planDrop>['op']>) => void;
  onNodeClick?: (ln: VisibleNode, info: { shift: boolean; sx: number; sy: number }) => void;
  /** 点击空白处（未命中任何节点）：用于取消选中 / 收起放大展开 */
  onBlankClick?: () => void;
}

export function useMapGestures({
  viewport,
  layout,
  visibleNodes,
  nodeDrag,
  setNodeDrag,
  dragExcluded,
  onNodeMove,
  onNodeClick,
  onBlankClick,
}: UseMapGesturesParams) {
  /** R2：多指 pinch 跟踪（≥2 指 → 缩放模式，抑制 pan / 节点拖拽） */
  const pinch = useRef(new PinchTracker());
  /** 画布平移拖拽（含 M5-T4 速度采样，用于松手惯性） */
  const dragRef = useRef<PanDrag | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // 用户接管视口：打断进行中的视口动画（M5-T3）
    viewport.cancelAnim();
    // R2：多指登记——第二指落下进入 pinch（取消单指 pan / 节点拖拽）
    if (pinch.current.down(e.pointerId, e.clientX, e.clientY)?.type === 'start') {
      dragRef.current = null;
      setNodeDrag(null);
      return;
    }
    const w = worldPointOf(e, e.currentTarget, viewport);
    // 命中节点（根不可拖拽）→ 节点拖拽重排；空白 → 画布平移
    const hitId = hitNodeAt(visibleNodes, w, (ln) => ln.depth === 0)?.node.id ?? null;
    if (hitId !== null) {
      setNodeDrag({
        nodeId: hitId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        dy: 0,
        moved: false,
        targetId: null,
        mode: 'child',
        valid: false,
      });
    } else {
      dragRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        samples: [],
      };
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    // R2：pinch 路径——距离比 → zoomAt(指间中点)；中点位移自然转化为平移
    if (pinch.current.active) {
      const ev = pinch.current.move(e.pointerId, e.clientX, e.clientY);
      if (ev?.type === 'zoom') {
        const rect = e.currentTarget.getBoundingClientRect();
        viewport.zoomAt(ev.midX - rect.left, ev.midY - rect.top, ev.factor);
      }
      return;
    }
    // 节点拖拽路径（M5-T5）
    const nd = nodeDrag;
    if (nd) {
      if (nd.pointerId !== e.pointerId) return;
      const dx = e.clientX - nd.startX;
      const dy = e.clientY - nd.startY;
      if (!nd.moved && Math.hypot(dx, dy) <= 4) return; // 未过拖拽阈值
      // 悬停目标：命中可见节点（排除自身子树）→ 按悬停带判定插入模式
      const w = worldPointOf(e, e.currentTarget, viewport);
      let targetId: string | null = null;
      let mode: DropMode = 'child';
      const target = hitNodeAt(visibleNodes, w, (ln) => dragExcluded?.has(ln.node.id) ?? false);
      if (target) {
        targetId = target.node.id;
        mode = dropModeFor(target.box, w);
      }
      const plan = targetId ? planDrop(layout, nd.nodeId, targetId, mode) : null;
      setNodeDrag({
        ...nd,
        dx,
        dy,
        moved: true,
        targetId,
        mode,
        valid: plan?.valid ?? false,
      });
      return;
    }
    // 画布平移路径（含 M5-T4 速度采样）
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.moved) {
      // 速度采样（M5-T4 惯性：最近窗口位移/时长）
      d.samples.push({ t: performance.now(), dx, dy });
      if (d.samples.length > PAN_SAMPLE_WINDOW) d.samples.shift();
      viewport.panBy(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  };

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
    else onBlankClick?.();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): void => {
    pinch.current.up(e.pointerId);
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    setNodeDrag((d) => (d?.pointerId === e.pointerId ? null : d));
  };

  return { pinch, dragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
