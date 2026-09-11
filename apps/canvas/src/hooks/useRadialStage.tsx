/**
 * Phase 2：环形快捷操作接入主画布（v1.8.0）
 * ══════════════════════════════════════════════════════════════════════
 * 承载键盘状态机（Alt 按住 → 蓄力 → 出环 → 漫游/提交）与窗口级指针接线；
 * 渲染交给 `RadialStageOverlay`（复用 @mindcanvas/react 的渲染面，单一实现）。
 *
 * 与既有预方向键位共谋（marking 双通道）：
 *   快击 Alt+方向键（阈值内）→ pre-dir 效果 → 交回既有「预方向」写入（与 Tab 生长固化一致）；
 *   按住 ≥250ms → 环浮现，方向键改为漫游。
 * 宿主（MindmapStage）在 onKey 首位调用 `handleKey`：返回 true = 已消费。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChargeArc,
  floatLabelStyle,
  hitTest,
  itemAt,
  RADIAL_ACCENT,
  RADIAL_DANGER,
  RADIAL_GEOMETRY_DEFAULTS,
  RADIAL_HOLD_MS,
  RADIAL_IDLE,
  RADIAL_ITEMS_V1,
  RadialRing,
  RadialStyles,
  radialGeometryOf,
  radialReduce,
  slotCenterDeg,
  type RadialEffect,
  type RadialEvent,
  type RadialItem,
  type RadialOrigin,
  type RadialSlotKey,
  type RadialState,
} from '@mindcanvas/react';

/** 视口安全边距：外环 + 浮标/确认气泡的余量（环贴边时把锚点收进来） */
const VIEWPORT_PAD = RADIAL_GEOMETRY_DEFAULTS.outerR + 40;

/** 环锚点视口钳制：贴右/上等边缘时向内收（视口小于两边距时取尽力值） */
function clampToViewport(p: { x: number; y: number }): { x: number; y: number } {
  const lo = VIEWPORT_PAD;
  const hiX = Math.max(lo, window.innerWidth - VIEWPORT_PAD);
  const hiY = Math.max(lo, window.innerHeight - VIEWPORT_PAD);
  return { x: Math.min(Math.max(p.x, lo), hiX), y: Math.min(Math.max(p.y, lo), hiY) };
}

export interface RadialStageActions {
  addChild: (id: string) => void;
  editText: (id: string) => void;
  /** 环内已含二次确认气泡，实现不应再叠 window.confirm */
  removeNode: (id: string) => void;
  openMenu: (id: string, x: number, y: number) => void;
}

export interface RadialStageOptions {
  /** 当前选中节点（无 → null） */
  getSelectedId: () => string | null;
  /** 节点锚点（客户端坐标 = 节点盒右上角） */
  getAnchor: (id: string) => { x: number; y: number } | null;
  /** 快击通道：写既有预方向（与 MindmapStage 的 preDirsRef 同语义） */
  setPreDir: (id: string, dir: RadialSlotKey) => void;
  actions: RadialStageActions;
}

export interface RadialStage {
  state: RadialState;
  charge: number;
  inDead: boolean;
  /** 二次确认气泡；nodeId 在**升起时捕获**——确认删除的永远是「发起删除的节点」，不受期间选中变化影响 */
  confirm: { itemId: string; label: string; nodeId: string } | null;
  settleConfirm: (ok: boolean) => void;
  /** 键盘入口：宿主 onKey 首位调用；true = 已消费 */
  handleKey: (e: KeyboardEvent) => boolean;
}

export function useRadialStage(opts: RadialStageOptions): RadialStage {
  const [state, setState] = useState<RadialState>(RADIAL_IDLE);
  const [charge, setCharge] = useState(0);
  const [inDead, setInDead] = useState(false);
  const [confirm, setConfirm] = useState<{ itemId: string; label: string; nodeId: string } | null>(null);

  const stateRef = useRef(state);
  const optsRef = useRef(opts);
  const selRef = useRef<string | null>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const confirmRef = useRef(confirm);
  const holdTimerRef = useRef(0);
  const confirmTimerRef = useRef(0);
  const pendingNullRef = useRef(0);

  // 事件回调读最新值：渲染期同步进 ref（回调用稳定引用）
  stateRef.current = state;
  optsRef.current = opts;
  confirmRef.current = confirm;

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== 0) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = 0;
    }
  }, []);

  /** 非危险动作直接执行（delete 走二次确认气泡） */
  const runAction = useCallback((itemId: string) => {
    const id = selRef.current;
    const anchor = anchorRef.current;
    if (!id) return;
    const a = optsRef.current.actions;
    switch (itemId) {
      case 'add-child':
        a.addChild(id);
        break;
      case 'edit-text':
        a.editText(id);
        break;
      case 'more':
        if (anchor) a.openMenu(id, anchor.x, anchor.y);
        break;
      default:
        break;
    }
  }, []);

  const armConfirm = useCallback((itemId: string, label: string, nodeId: string) => {
    setConfirm({ itemId, label, nodeId });
    if (confirmTimerRef.current !== 0) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => {
      confirmTimerRef.current = 0;
      setConfirm(null);
    }, 1600);
  }, []);

  const settleConfirm = useCallback((ok: boolean) => {
    const c = confirmRef.current;
    if (!c) return;
    if (confirmTimerRef.current !== 0) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = 0;
    }
    setConfirm(null);
    if (ok && c.itemId === 'delete') optsRef.current.actions.removeNode(c.nodeId); // 用捕获的节点，不读实时选中
  }, []);

  const handleEffect = useCallback(
    (effect: RadialEffect) => {
      switch (effect.kind) {
        case 'pre-dir': {
          const id = selRef.current;
          if (id) optsRef.current.setPreDir(id, effect.dir);
          break;
        }
        case 'commit': {
          const item = RADIAL_ITEMS_V1.find((it) => it.id === effect.itemId);
          const id = selRef.current;
          if (item?.danger) {
            if (id) armConfirm(item.id, item.label, id); // 捕获发起节点（确认时可能已换选中）
          } else runAction(effect.itemId);
          break;
        }
        default:
          break;
      }
    },
    [armConfirm, runAction],
  );

  const dispatch = useCallback(
    (ev: RadialEvent) => {
      const step = radialReduce(stateRef.current, ev, RADIAL_ITEMS_V1, {});
      stateRef.current = step.state;
      setState(step.state);
      if (step.effect.kind !== 'none') handleEffect(step.effect);
    },
    [handleEffect],
  );

  const pressDown = useCallback(
    (origin: RadialOrigin) => {
      dispatch({ t: 'alt-down', now: performance.now(), origin });
      clearHold();
      holdTimerRef.current = window.setTimeout(() => {
        dispatch({ t: 'tick', now: performance.now() });
      }, RADIAL_HOLD_MS);
    },
    [dispatch, clearHold],
  );

  const pressUp = useCallback(() => {
    clearHold();
    dispatch({ t: 'alt-up' });
  }, [clearHold, dispatch]);

  /** 键盘入口（宿主 onKey 首位）：二次确认 → Alt 蓄力 → 环内漫游/提交/取消 */
  const handleKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (confirmRef.current) {
        if (e.key === 'Enter') {
          e.preventDefault();
          settleConfirm(true);
          return true;
        }
        if (e.key === 'Escape') {
          settleConfirm(false);
          return true;
        }
      }
      const phase = stateRef.current.phase;
      if (e.key === 'Alt') {
        if (e.repeat) return true;
        if (confirmRef.current) settleConfirm(false); // 新会话开始：旧确认气泡收起（用户已转移意图）
        const sel = optsRef.current.getSelectedId();
        if (!sel) return false;
        const anchor = optsRef.current.getAnchor(sel);
        if (!anchor) return false;
        e.preventDefault(); // 避免浏览器把 Alt 焦点切到菜单栏
        const clamped = clampToViewport(anchor); // 贴视口边缘 → 锚点收进来（环不出屏）
        selRef.current = sel;
        anchorRef.current = clamped;
        pressDown({ nodeId: sel, cx: clamped.x, cy: clamped.y });
        return true;
      }
      if (phase === 'arming' || phase === 'pre-dir' || phase === 'ring') {
        if (e.key.startsWith('Arrow')) {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return true; // 组合键不参与（吞掉，不落导航）
          e.preventDefault();
          dispatch({ t: 'arrow', key: e.key });
          return true;
        }
        if (e.key === 'Enter' && phase === 'ring') {
          e.preventDefault();
          dispatch({ t: 'confirm' });
          return true;
        }
        if (e.key === 'Escape') {
          clearHold();
          dispatch({ t: 'cancel' });
          return true;
        }
        // 纯修饰键：会话内静默吞掉（不改变相位）
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'AltGraph') return true;
        // —— 意图分流（防「环外快捷键 + 环内提交」双触发）——
        if (phase === 'pre-dir') return false; // 手势通道：其余键照常落画布（Tab 消费预方向）
        if (phase === 'arming') {
          // 蓄力中改变意图（如直接按 Tab）：撤会话、按键照常落画布——防「操作后环弹在旧锚点」
          clearHold();
          dispatch({ t: 'cancel' });
          return false;
        }
        // 撤销/重做白名单：先撤环（会话引用的节点可能被改动），按键照常落画布
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
          clearHold();
          dispatch({ t: 'cancel' });
          return false;
        }
        e.preventDefault(); // ring：模态——其余键全部吞掉（Tab 防焦点游走；环仍在，Esc/松键退出）
        return true;
      }
      return false;
    },
    [dispatch, clearHold, settleConfirm, pressDown],
  );

  // 窗口级接线：Alt 松手 / 失焦取消 / 悬停（防抖 + 死区）/ 点击（capture 吞掉，不透传画布）
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') pressUp();
    };
    const onBlur = (): void => {
      clearHold();
      dispatch({ t: 'cancel' });
      if (confirmRef.current) settleConfirm(false); // 离开窗口：确认气泡一并收起
    };
    const onMove = (e: PointerEvent): void => {
      if (stateRef.current.phase !== 'ring') return;
      const geo = radialGeometryOf(stateRef.current);
      if (geo) {
        const r = Math.hypot(e.clientX - geo.cx, e.clientY - geo.cy);
        setInDead(r < geo.cfg.deadR);
      }
      const slot = geo ? hitTest(geo, e.clientX, e.clientY) : null;
      const usable = slot !== null && itemAt(RADIAL_ITEMS_V1, slot) !== null;
      if (pendingNullRef.current !== 0) {
        window.clearTimeout(pendingNullRef.current);
        pendingNullRef.current = 0;
      }
      if (usable) {
        dispatch({ t: 'hover', x: e.clientX, y: e.clientY });
      } else {
        const { clientX: x, clientY: y } = e;
        pendingNullRef.current = window.setTimeout(() => {
          pendingNullRef.current = 0;
          dispatch({ t: 'hover', x, y });
        }, 60);
      }
    };
    const onDown = (e: PointerEvent): void => {
      const phase = stateRef.current.phase;
      const onChip = e.target instanceof Element && e.target.closest('[data-radial-ignore]') !== null;
      // 二次确认气泡：点别处即收起（气泡自身除外）
      if (confirmRef.current && !onChip) settleConfirm(false);
      if (phase === 'ring') {
        if (e.button !== 0) {
          // 右/中键：撤环让路（右键菜单照常打开），不吞事件
          clearHold();
          dispatch({ t: 'cancel' });
          return;
        }
        if (onChip) return;
        e.stopPropagation(); // capture：环开的这次点击不落画布（避免连带改选中）
        e.preventDefault();
        dispatch({ t: 'click', x: e.clientX, y: e.clientY });
        return;
      }
      if (phase === 'arming') {
        // 点击 = 意图改变：撤掉蓄力中的会话（不吞事件，点击照常落画布）
        clearHold();
        dispatch({ t: 'cancel' });
      }
    };
    const onWheel = (): void => {
      const phase = stateRef.current.phase;
      if (phase === 'ring' || phase === 'arming') {
        clearHold();
        dispatch({ t: 'cancel' }); // 滚轮=视口变化：环锚点立刻失准，撤掉
      }
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel);
      clearHold();
    };
  }, [dispatch, clearHold, pressUp, settleConfirm]);

  // 蓄力进度：arming 期间 rAF 逐帧推进 0→1
  useEffect(() => {
    if (state.phase !== 'arming') {
      setCharge(0);
      return;
    }
    let raf = 0;
    const loop = (): void => {
      const cur = stateRef.current;
      if (cur.phase !== 'arming') return;
      const p = Math.min(1, (performance.now() - cur.altDownAt) / RADIAL_HOLD_MS);
      setCharge(p);
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== 'ring') setInDead(false);
  }, [state.phase]);

  // 卸载清理
  useEffect(
    () => () => {
      if (holdTimerRef.current !== 0) window.clearTimeout(holdTimerRef.current);
      if (confirmTimerRef.current !== 0) window.clearTimeout(confirmTimerRef.current);
      if (pendingNullRef.current !== 0) window.clearTimeout(pendingNullRef.current);
    },
    [],
  );

  return { state, charge, inDead, confirm, settleConfirm, handleKey };
}

/** 覆盖层：环 + 浮动说明 + 死区提示 + 二次确认气泡（挂画布上层；样式随 RadialStyles） */
export function RadialStageOverlay({ radial }: { radial: RadialStage }) {
  const { state, charge, inDead, confirm, settleConfirm } = radial;
  const geo = state.phase === 'ring' ? radialGeometryOf(state) : null;
  const chargeGeo = state.phase === 'arming' ? radialGeometryOf(state) : null;
  const highlightItem: RadialItem | null = state.highlight ? itemAt(RADIAL_ITEMS_V1, state.highlight) : null;
  const anchor: RadialOrigin | null = state.origin;
  return (
    <>
      <RadialStyles />
      {chargeGeo && <ChargeArc geo={chargeGeo} progress={charge} />}
      {geo && <RadialRing geo={geo} highlight={state.highlight} items={RADIAL_ITEMS_V1} />}
      {geo && highlightItem && state.highlight && (
        <div className="float-label" style={floatLabelStyle(geo, slotCenterDeg(state.highlight))}>
          <b style={{ color: highlightItem.danger ? RADIAL_DANGER : RADIAL_ACCENT }}>{highlightItem.label}</b>
          {highlightItem.hint ? <kbd>{highlightItem.hint}</kbd> : null}
        </div>
      )}
      {state.phase === 'ring' && inDead && anchor && (
        <div className="dead-hint" style={{ left: anchor.cx, top: anchor.cy }}>
          松开取消
        </div>
      )}
      {confirm && anchor && (
        <div
          className="confirm-chip"
          data-radial-ignore
          style={{ left: anchor.cx, top: anchor.cy + 24, pointerEvents: 'auto' }}
        >
          <span>「{confirm.label}」需二次确认</span>
          <button type="button" onClick={() => settleConfirm(true)}>
            确认
          </button>
          <button type="button" className="ghost" onClick={() => settleConfirm(false)}>
            取消
          </button>
        </div>
      )}
    </>
  );
}
