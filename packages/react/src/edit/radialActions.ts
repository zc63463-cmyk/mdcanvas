/**
 * 环形快捷操作（Radial Menu）· 纯逻辑层 —— v1.8.0 Phase 1
 * ══════════════════════════════════════════════════════════════════════
 * 与 beamDrag.ts 同先例：本模块只做「几何 / 命中 / 键盘漫游 / 时序状态机」，
 * 零 React、零 DOM、零依赖——可在 node 里直接跑，渲染与事件接线在组件层（Phase 2）。
 *
 * 设计要点（设计评审结论）：
 *
 * 1. **marking menu 双通道**：Alt 按住 ≥ RADIAL_HOLD_MS → 环浮现（可见菜单通道）；
 *    Alt+方向键「快击」（阈值内）→ 产出 pre-dir 效果，交还既有「预方向」语义
 *    （专家肌肉记忆零破坏）。慢按=菜单、快击=手势——同一按键的两种熟练度。
 *
 * 2. **方向键直映射扇区**（ArrowUp→上、ArrowRight→右…），不做环形轮转：
 *    直映射可盲操（marking 语义）；轮转依赖当前位置、需要计数，是反模式。
 *
 * 3. **命中区宽容**：距锚点 [deadR, outerR+hitSlack] 的整个环带都算命中（innerR 只影响
 *    观感，内孔仍按角度归属扇区）；缺口（gap）朝**所依附的节点角**（环挂在节点盒右上角，
 *    节点在锚点左下 → 缺口中心 135°）——既是视觉上的「依附开口」，也是取消带。
 *
 * 4. **动作源单一**：环上动作与右键菜单同源（Phase 2 由 contextMenuItemsFor 过滤生成）；
 *    本文件内置 V1 一等动作表 RADIAL_ITEMS_V1 作为默认。
 *
 * 角度约定：度数制；0° = 屏幕正右（+x），顺时针为正（屏幕 y 向下）。
 * 于是：上 = 270°（≡ -90°）、右 = 0°、下 = 90°、左 = 180°；缺口中心 = 135°（左下）。
 */

// ─────────────────────────── 类型 ───────────────────────────

/** 槽位（四向；与 kernel GrowDir 的前四值同构——本模块保持零依赖故本地定义） */
export type RadialSlotKey = 'up' | 'right' | 'down' | 'left';

export interface RadialItem {
  /** 稳定 id（Phase 2：与右键菜单项 id 对齐，保证「同一动作源、两个渲染器」） */
  id: string;
  slot: RadialSlotKey;
  /** 浮动说明主文案 */
  label: string;
  /** 键提示（如 Tab / Del），可选 */
  hint?: string;
  /** 危险操作（渲染红色语义；提交前可加二次确认） */
  danger?: boolean;
  /** 置灰：不可高亮、不可提交 */
  disabled?: boolean;
  /** 16×16 stroke 图标：path `d` 数组（渲染层直接铺 <path>，linecap=round） */
  icon: readonly string[];
}

/** 环形几何配置（预览页以滑杆暴露，方便调手感） */
export interface RadialGeometryConfig {
  /** 内孔半径（仅观感；命中不设限） */
  innerR: number;
  /** 外缘半径 */
  outerR: number;
  /** 死区半径：距锚点 < deadR 视为「未瞄准」→ 取消 */
  deadR: number;
  /** 缺口中心角（默认 135° = 朝向所依附的节点角：环挂节点右上角、节点在锚点左下） */
  gapCenterDeg: number;
  /** 缺口宽度（度）——视觉断口 + 取消带 */
  gapWidthDeg: number;
  /** 外缘命中宽容（px）——Fitts：外圈多留余量 */
  hitSlack: number;
}

export interface RadialGeometry {
  cx: number;
  cy: number;
  cfg: RadialGeometryConfig;
}

/** 环的锚点：所选节点盒的右上角（屏幕坐标） */
export interface RadialOrigin {
  /** 所属节点（Phase 2 用于定位与提交上下文） */
  nodeId: string;
  cx: number;
  cy: number;
}

export type RadialPhase = 'idle' | 'arming' | 'ring' | 'pre-dir';

export interface RadialState {
  phase: RadialPhase;
  origin: RadialOrigin | null;
  altDownAt: number;
  highlight: RadialSlotKey | null;
}

export type RadialEvent =
  | { t: 'alt-down'; now: number; origin: RadialOrigin }
  | { t: 'alt-up' }
  | { t: 'tick'; now: number }
  | { t: 'arrow'; key: string }
  | { t: 'hover'; x: number; y: number }
  | { t: 'click'; x: number; y: number }
  | { t: 'confirm' }
  | { t: 'cancel' };

export type RadialEffect =
  | { kind: 'none' }
  /** 快击通道：交还既有预方向（Phase 2 接入 keys.ts / 控制器） */
  | { kind: 'pre-dir'; dir: RadialSlotKey }
  | { kind: 'open' }
  | { kind: 'commit'; itemId: string; slot: RadialSlotKey }
  | { kind: 'close' };

export interface RadialReduceCtx {
  /** 几何配置（缺省 RADIAL_GEOMETRY_DEFAULTS） */
  cfg?: Partial<RadialGeometryConfig>;
  /** 按住阈值覆盖（预览调参用）；缺省 RADIAL_HOLD_MS */
  holdMs?: number;
}

// ─────────────────────────── 常量 ───────────────────────────

/** 按住多久算「菜单通道」（毫秒）；快于此阈值内的 Alt+方向键 = 预方向（手势通道） */
export const RADIAL_HOLD_MS = 250;

/** 四向槽位（顺时针自上方起）：命中顺序稳定，渲染同此顺序 */
export const RADIAL_SLOTS: ReadonlyArray<{ key: RadialSlotKey; centerDeg: number }> = [
  { key: 'up', centerDeg: 270 },
  { key: 'right', centerDeg: 0 },
  { key: 'down', centerDeg: 90 },
  { key: 'left', centerDeg: 180 },
];

/** 槽位半宽（度）：4 槽均分 360°，中心 ±45° 为归属范围（半开区间） */
const SLOT_HALF_DEG = 45;

export const RADIAL_GEOMETRY_DEFAULTS: RadialGeometryConfig = {
  innerR: 26,
  outerR: 52,
  deadR: 16,
  gapCenterDeg: 135, // 缺口朝节点（锚点=节点右上角，节点在锚点左下）
  gapWidthDeg: 64,
  hitSlack: 10,
};

export const RADIAL_IDLE: RadialState = { phase: 'idle', origin: null, altDownAt: 0, highlight: null };

/** V1 一等动作：新建（上）/ 编辑（右）/ 删除（下，danger）/ 更多（左，渐进披露） */
export const RADIAL_ITEMS_V1: readonly RadialItem[] = [
  { id: 'add-child', slot: 'up', label: '新建子节点', hint: 'Tab', icon: ['M8 3.5v9', 'M3.5 8h9'] },
  {
    id: 'edit-text',
    slot: 'right',
    label: '编辑文本',
    hint: 'F2',
    icon: ['M4.2 11.8 5 9.2l5.6-5.6a1.35 1.35 0 0 1 1.9 1.9L6.9 11.1l-2.7.7Z'],
  },
  {
    id: 'delete',
    slot: 'down',
    label: '删除节点',
    hint: 'Del',
    danger: true,
    icon: ['M4 5.2h8', 'M6.6 5.2V3.6h2.8v1.6', 'M5.2 5.2l.6 7.2h4.4l.6-7.2'],
  },
  {
    id: 'more',
    slot: 'left',
    label: '更多操作…',
    hint: '右键',
    icon: ['M4.4 8h.01', 'M8 8h.01', 'M11.6 8h.01'],
  },
];

// ─────────────────────────── 角度工具 ───────────────────────────

/** 归一化到 [0, 360) */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 角度 a 是否在 [start, start+span)（度，环绕安全） */
function inArc(a: number, start: number, span: number): boolean {
  return norm360(a - start) < norm360(span);
}

/** 槽位角度区间（半开：对角线归起始侧，消除边界歧义） */
function slotRange(slot: { centerDeg: number }): { start: number; span: number } {
  return { start: slot.centerDeg - SLOT_HALF_DEG, span: SLOT_HALF_DEG * 2 };
}

// ─────────────────────────── 几何 / 命中 / 渲染弧 ───────────────────────────

export function radialGeometryFor(
  cx: number,
  cy: number,
  cfg?: Partial<RadialGeometryConfig>,
): RadialGeometry {
  return { cx, cy, cfg: { ...RADIAL_GEOMETRY_DEFAULTS, ...cfg } };
}

/** 由状态取锚点构建几何（idle / 无锚点 → null） */
export function radialGeometryOf(
  state: RadialState,
  cfg?: Partial<RadialGeometryConfig>,
): RadialGeometry | null {
  if (!state.origin) return null;
  return radialGeometryFor(state.origin.cx, state.origin.cy, cfg);
}

/**
 * 屏幕坐标 → 槽位（null = 未命中：死区 / 超出外缘+宽容 / 落在缺口取消带）。
 */
export function hitTest(geo: RadialGeometry, x: number, y: number): RadialSlotKey | null {
  const { cfg } = geo;
  const r = Math.hypot(x - geo.cx, y - geo.cy);
  if (r < cfg.deadR || r > cfg.outerR + cfg.hitSlack) return null;
  const a = norm360((Math.atan2(y - geo.cy, x - geo.cx) * 180) / Math.PI);
  if (inArc(a, cfg.gapCenterDeg - cfg.gapWidthDeg / 2, cfg.gapWidthDeg)) return null;
  for (const s of RADIAL_SLOTS) {
    const { start, span } = slotRange(s);
    if (inArc(a, start, span)) return s.key;
  }
  return null;
}

/** 方向键 → 槽位（直映射；无匹配 → null） */
export function slotForArrowKey(key: string): RadialSlotKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowRight':
      return 'right';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    default:
      return null;
  }
}

/**
 * 可见弧段（供渲染层画环）：槽位区间扣掉缺口后的片段（度）。
 * 4 槽 + 单缺口（< 90°）⇒ 每槽至多剩一段，缺口只可能切到缺口相邻的两槽。
 */
export function visibleArcs(
  geo: RadialGeometry,
): Array<{ key: RadialSlotKey; startDeg: number; spanDeg: number }> {
  const gapStart = geo.cfg.gapCenterDeg - geo.cfg.gapWidthDeg / 2;
  const gapEnd = gapStart + geo.cfg.gapWidthDeg;
  const out: Array<{ key: RadialSlotKey; startDeg: number; spanDeg: number }> = [];
  for (const s of RADIAL_SLOTS) {
    const { start, span } = slotRange(s);
    if (inArc(gapStart, start, span)) {
      const left = norm360(gapStart - start); // 缺口切走区间末尾
      if (left > 1) out.push({ key: s.key, startDeg: start, spanDeg: left });
    } else if (inArc(gapEnd, start, span)) {
      const left = norm360(start + span - gapEnd); // 缺口切走区间开头
      if (left > 1) out.push({ key: s.key, startDeg: gapEnd, spanDeg: left });
    } else {
      out.push({ key: s.key, startDeg: start, spanDeg: span });
    }
  }
  return out;
}

/** 槽位 → 可用动作（disabled 视同无） */
export function itemAt(items: readonly RadialItem[], slot: RadialSlotKey): RadialItem | null {
  return items.find((it) => it.slot === slot && !it.disabled) ?? null;
}

// ─────────────────────────── 时序状态机 ───────────────────────────

const NONE: RadialEffect = { kind: 'none' };

/**
 * 环状态机（纯函数）。
 *
 * 相位流转：
 *   idle --alt-down--> arming --tick(≥hold)--> ring --alt-up(有高亮)--> commit
 *                        |                      |--alt-up(无高亮)/cancel--> close
 *                        |--arrow(快击)--> pre-dir --alt-up--> idle（环不浮现）
 *   ring 内：arrow/悬停 → 高亮；click/confirm → 立即提交或取消。
 *
 * 「快击 vs 慢按」由相位承载——alt-down 后的定时器驱动 tick；箭头先于 tick 到达即快击。
 */
export function radialReduce(
  state: RadialState,
  event: RadialEvent,
  items: readonly RadialItem[],
  ctx: RadialReduceCtx = {},
): { state: RadialState; effect: RadialEffect } {
  const hold = ctx.holdMs ?? RADIAL_HOLD_MS;
  switch (event.t) {
    case 'alt-down': {
      if (state.phase !== 'idle') return { state, effect: NONE };
      return {
        state: { phase: 'arming', origin: event.origin, altDownAt: event.now, highlight: null },
        effect: NONE,
      };
    }
    case 'tick': {
      if (state.phase === 'arming' && event.now - state.altDownAt >= hold) {
        return { state: { ...state, phase: 'ring' }, effect: { kind: 'open' } };
      }
      return { state, effect: NONE };
    }
    case 'arrow': {
      const dir = slotForArrowKey(event.key);
      if (dir === null) return { state, effect: NONE };
      if (state.phase === 'arming' || state.phase === 'pre-dir') {
        // 快击通道：不浮现环，交还预方向（连续按可改方向，与既有语义一致）
        return { state: { ...state, phase: 'pre-dir' }, effect: { kind: 'pre-dir', dir } };
      }
      if (state.phase === 'ring') {
        const next = itemAt(items, dir) ? dir : null;
        return { state: { ...state, highlight: next }, effect: NONE };
      }
      return { state, effect: NONE };
    }
    case 'hover': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      const geo = radialGeometryOf(state, ctx.cfg);
      const slot = geo ? hitTest(geo, event.x, event.y) : null;
      const next = slot !== null && itemAt(items, slot) ? slot : null;
      return { state: { ...state, highlight: next }, effect: NONE };
    }
    case 'click': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      const geo = radialGeometryOf(state, ctx.cfg);
      const slot = geo ? hitTest(geo, event.x, event.y) : null;
      const item = slot !== null ? itemAt(items, slot) : null;
      if (item) return { state: RADIAL_IDLE, effect: { kind: 'commit', itemId: item.id, slot: item.slot } };
      return { state: RADIAL_IDLE, effect: { kind: 'close' } };
    }
    case 'confirm': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      const item = state.highlight !== null ? itemAt(items, state.highlight) : null;
      if (item) return { state: RADIAL_IDLE, effect: { kind: 'commit', itemId: item.id, slot: item.slot } };
      return { state: RADIAL_IDLE, effect: { kind: 'close' } };
    }
    case 'alt-up': {
      if (state.phase === 'ring') {
        const item = state.highlight !== null ? itemAt(items, state.highlight) : null;
        if (item) {
          return { state: RADIAL_IDLE, effect: { kind: 'commit', itemId: item.id, slot: item.slot } };
        }
        return { state: RADIAL_IDLE, effect: { kind: 'close' } };
      }
      // arming（轻按 Alt 没等到悬浮）/ pre-dir（已走手势通道）→ 静默复位
      return { state: RADIAL_IDLE, effect: NONE };
    }
    case 'cancel': {
      if (state.phase === 'ring') return { state: RADIAL_IDLE, effect: { kind: 'close' } };
      return { state: RADIAL_IDLE, effect: NONE };
    }
    default:
      return { state, effect: NONE };
  }
}
