/**
 * 共享梁拖拽（v1.7.0 · Phase 3）：hub 出线的共享梁 = 该方向组层距的直接操纵把手。
 *
 * 纯逻辑模块（可测）：把手构建（hub 连线按「父 + 方向」分组 → 梁线段范围与当前组层距）、
 * 命中测试（梁线 ±8px 带）、拖拽映射（沿行程轴位移 → 新层距，下限 14）。
 *
 * 交互契约（与 center 拖拽同款）：拖拽中只更新状态与预览叠层（梁线随指针移动 +
 * 像素徽标），**节点不动**；松手一次性提交（`onBeamLensChange` → controller.updateNote
 * 写 `lens[dir]`，单条 undo）→ 布局权威重排（消解可能微调，属预期）。
 */
import type { GrowDir } from '@mindcanvas/kernel';
import type { LinkGeom } from './geometry.js';

export type BeamDir = 'up' | 'down' | 'left' | 'right';

/** 最小层距（与内核 SEPARATE_MARGIN 同值；react 不引内核私有常量，注释锚定） */
export const BEAM_MIN_LEN = 14;
/** 最大层距（与内核 BEAM_MAX_LEN 同值）：出线是相邻层距，超过即无意义且会把布局撑炸 */
export const BEAM_MAX_LEN = 600;
/** 梁命中容差（世界坐标 px）：梁是线段，命中区须是带状 */
export const BEAM_HIT_TOLERANCE = 8;

/** 可拖拽的共享梁把手（一个 hub 节点的一个方向组 = 一根梁） */
export interface BeamHandle {
  fromId: string;
  dir: BeamDir;
  /** 梁坐标：up/down 为 y（横梁），left/right 为 x（竖梁） */
  rail: number;
  /** 梁线段在组轴上的范围（成员子节点中线 ∪ 父中线的最小/最大值） */
  lo: number;
  hi: number;
  /** 起始组层距 = 梁到父出边距离 ×2（rail 是该距离的中点）——拖拽映射起点 */
  startLen: number;
}

/** 拖拽中的状态（MapView useState；结构供渲染叠层与提交） */
export interface BeamDragState {
  handle: BeamHandle;
  pointerId: number;
  /** 按下时的世界坐标 */
  startW: { x: number; y: number };
  /** 当前预览层距（随移动更新） */
  len: number;
  /** 是否已越过拖拽阈值（未越过 = 点击，不提交） */
  moved: boolean;
  /** 最近世界坐标（徽标定位） */
  curW: { x: number; y: number };
}

/**
 * 把 hub 连线按「父 + 方向」分组成梁把手。
 *
 * `railOf` 返回该连线的共享梁坐标（MapView 的 linkBeamYs/linkBeamXs 产出；
 * 组内成员同值，取首个命中即可）。层距起点 = |rail − 父出边| × 2
 * （rail 是「父出边 ↔ 最近子边」的中点，与内核 beamY/beamX 公式一致）。
 */
export function buildBeamHandles<L extends LinkGeom & { dir?: GrowDir }>(
  links: readonly L[],
  railOf: (l: L) => number | undefined,
): BeamHandle[] {
  const groups = new Map<
    string,
    { dir: BeamDir; rail: number; from: L['from']; tos: L['to'][]; fromId: string }
  >();
  for (const l of links) {
    const dir = l.dir;
    const rail = railOf(l);
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') continue;
    if (rail === undefined) continue;
    const key = `${l.fromId}|${dir}`;
    let g = groups.get(key);
    if (!g) {
      g = { dir, rail, from: l.from, tos: [], fromId: l.fromId };
      groups.set(key, g);
    }
    g.tos.push(l.to);
  }
  const out: BeamHandle[] = [];
  for (const g of groups.values()) {
    const vertical = g.dir === 'up' || g.dir === 'down';
    const parentEdge =
      g.dir === 'up'
        ? g.from.y
        : g.dir === 'down'
          ? g.from.y + g.from.h
          : g.dir === 'right'
            ? g.from.x + g.from.w
            : g.from.x;
    // 梁线段范围：成员子节点中线 ∪ 父中线（沿组轴）
    const centers = g.tos.map((b) => (vertical ? b.x + b.w / 2 : b.y + b.h / 2));
    centers.push(vertical ? g.from.x + g.from.w / 2 : g.from.y + g.from.h / 2);
    const startLen = Math.max(BEAM_MIN_LEN, Math.round(Math.abs(g.rail - parentEdge) * 2));
    const lo = Math.min(...centers);
    const hi = Math.max(...centers);
    // 有限性护栏：动画插值帧的盒可能短暂含 NaN——NaN 把手不可拖（拖了会把 NaN 写进 lens）
    if (
      !Number.isFinite(g.rail) ||
      !Number.isFinite(startLen) ||
      !Number.isFinite(lo) ||
      !Number.isFinite(hi)
    ) {
      continue;
    }
    out.push({ fromId: g.fromId, dir: g.dir, rail: g.rail, lo, hi, startLen });
  }
  return out;
}

/** 命中测试：跨梁轴 |距| ≤ 容差，且沿梁轴落在段范围（± 容差）内 */
export function hitBeamAt(
  handles: readonly BeamHandle[],
  w: { x: number; y: number },
): BeamHandle | null {
  for (const h of handles) {
    const along = h.dir === 'up' || h.dir === 'down' ? w.x : w.y;
    const across = h.dir === 'up' || h.dir === 'down' ? w.y : w.x;
    if (
      Math.abs(across - h.rail) <= BEAM_HIT_TOLERANCE &&
      along >= h.lo - BEAM_HIT_TOLERANCE &&
      along <= h.hi + BEAM_HIT_TOLERANCE
    ) {
      return h;
    }
  }
  return null;
}

/** 拖拽映射：沿行程轴的世界位移 → 新层距（up/left 拖负向 = 拉长；下限钳 14） */
export function beamLenAfterDrag(
  h: BeamHandle,
  start: { x: number; y: number },
  cur: { x: number; y: number },
): number {
  const delta =
    h.dir === 'up'
      ? start.y - cur.y
      : h.dir === 'down'
        ? cur.y - start.y
        : h.dir === 'right'
          ? cur.x - start.x
          : start.x - cur.x;
  const next = Math.min(
    BEAM_MAX_LEN,
    Math.max(BEAM_MIN_LEN, Math.round(h.startLen + delta)),
  );
  return Number.isFinite(next) ? next : h.startLen;
}

/** 拖拽预览时梁的瞬时坐标（随 len 相对起始值的差移动） */
export function beamRailDuringDrag(h: BeamHandle, len: number): number {
  if (!Number.isFinite(len)) return h.rail;
  const d = len - h.startLen;
  const rail =
    h.dir === 'up'
      ? h.rail - d
      : h.dir === 'down'
        ? h.rail + d
        : h.dir === 'right'
          ? h.rail + d
          : h.rail - d;
  return Number.isFinite(rail) ? rail : h.rail;
}
