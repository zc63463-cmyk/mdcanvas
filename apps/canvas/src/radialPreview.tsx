/**
 * 环形快捷操作 · 静态预览页（v1.8.0 Phase 1）
 * ══════════════════════════════════════════════════════════════════════
 * 运行：pnpm --filter canvas dev → 打开 /radial.html
 *
 * 体验脚本：
 *   1. 按住 Alt ≥250ms → 环从节点右上角浮现（慢按=菜单通道）；
 *   2. Alt 按下后 250ms 内快击方向键 → 预方向（快击=手势通道，环不浮现，看日志）；
 *   3. 环内：方向键直映射漫游 / 鼠标悬停高亮 / 点击或 Enter 提交 / Esc 或松开 Alt 取消；
 *   4. 右上角滑杆调按住阈值、缺口宽度、外环半径——调手感用；
 *   5. 节点卡可拖动——试环贴屏幕边缘的形态。
 *
 * 全部逻辑来自纯模块 `@mindcanvas/react` 的 radialActions（几何/命中/状态机），
 * 本文件只做渲染与事件接线——Phase 2 接主画布时替换的就是这层。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
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
  type RadialState,
} from '@mindcanvas/react';
import { RADIAL_PREVIEW_CSS } from './radialPreviewCss.js';

// ─────────────────────────── 演示组件 ───────────────────────────

function RadialPreview() {
  const [state, setState] = useState<RadialState>(RADIAL_IDLE);
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);
  const [holdMs, setHoldMs] = useState(RADIAL_HOLD_MS);
  const [gapWidth, setGapWidth] = useState(RADIAL_GEOMETRY_DEFAULTS.gapWidthDeg);
  const [outerR, setOuterR] = useState(RADIAL_GEOMETRY_DEFAULTS.outerR);
  const [pos, setPos] = useState(() => ({
    x: Math.round(window.innerWidth * 0.4),
    y: Math.round(window.innerHeight * 0.5),
  }));
  const [anchor, setAnchor] = useState<RadialOrigin | null>(null);
  const [lastKey, setLastKey] = useState('—');
  const [cardRect, setCardRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [charge, setCharge] = useState(0); // 蓄力进度 0..1（arming 期间 rAF 逐帧）
  const [inDead, setInDead] = useState(false); // 指针在死区（显示「松开取消」）
  const [confirm, setConfirm] = useState<{ itemId: string; label: string } | null>(null); // 危险动作二次确认
  const [rootSim, setRootSim] = useState(false); // 模拟根节点：禁用「删除」（演示禁用态）

  const cardRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const anchorRef = useRef<RadialOrigin | null>(null);
  const itemsRef = useRef<readonly RadialItem[]>(RADIAL_ITEMS_V1);
  const confirmRef = useRef(confirm);
  const ctxRef = useRef({ cfg: { gapWidthDeg: gapWidth, outerR }, holdMs });
  const timerRef = useRef(0);
  const confirmTimerRef = useRef(0);
  const pendingNullRef = useRef(0);
  const logIdRef = useRef(0);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // 动作清单：可被「模拟根节点」注入 disabled（演示禁用态渲染）
  const items = useMemo<readonly RadialItem[]>(
    () =>
      rootSim ? RADIAL_ITEMS_V1.map((it) => (it.slot === 'down' ? { ...it, disabled: true } : it)) : RADIAL_ITEMS_V1,
    [rootSim],
  );

  // 监听器里要读最新值：渲染期同步进 ref（事件回调用稳定引用）
  stateRef.current = state;
  anchorRef.current = anchor;
  itemsRef.current = items;
  confirmRef.current = confirm;
  ctxRef.current = { cfg: { gapWidthDeg: gapWidth, outerR }, holdMs };

  const pushLog = useCallback((text: string) => {
    logIdRef.current += 1;
    const entry = { id: logIdRef.current, text };
    setLog((prev) => [entry, ...prev].slice(0, 9));
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  // 危险动作二次确认（预览层演示：1.6s 窗口内 Enter / 点「确认」才真正执行）
  const armConfirm = useCallback(
    (itemId: string, label: string) => {
      setConfirm({ itemId, label });
      if (confirmTimerRef.current !== 0) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => {
        confirmTimerRef.current = 0;
        setConfirm(null);
        pushLog('确认超时，已取消');
      }, 1600);
    },
    [pushLog],
  );

  const settleConfirm = useCallback(
    (ok: boolean) => {
      const c = confirmRef.current;
      if (!c) return;
      if (confirmTimerRef.current !== 0) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = 0;
      }
      setConfirm(null);
      pushLog(ok ? `已执行：${c.label}（二次确认）` : `已取消：${c.label}`);
    },
    [pushLog],
  );

  const handleEffect = useCallback(
    (effect: RadialEffect) => {
      switch (effect.kind) {
        case 'open':
          pushLog('环浮现（慢按通道）');
          break;
        case 'close':
          pushLog('取消');
          break;
        case 'commit': {
          const item = itemsRef.current.find((it) => it.id === effect.itemId);
          if (item?.danger) {
            // 危险动作不直接执行：转入二次确认（防误触）
            pushLog(`⚠ ${item.label}：需二次确认`);
            armConfirm(item.id, item.label);
          } else {
            pushLog(`提交：${item?.label ?? effect.itemId}（${effect.slot}）`);
          }
          break;
        }
        case 'pre-dir':
          pushLog(`预方向 → ${effect.dir}（快击通道，环不浮现）`);
          break;
        default:
          break;
      }
    },
    [pushLog, armConfirm],
  );

  const dispatch = useCallback(
    (ev: RadialEvent) => {
      const step = radialReduce(stateRef.current, ev, itemsRef.current, ctxRef.current);
      stateRef.current = step.state;
      setState(step.state);
      if (step.effect.kind !== 'none') handleEffect(step.effect);
    },
    [handleEffect],
  );

  // 锚点 = 节点卡右上角（每次渲染后校准：拖动 / 窗口缩放 / 布局变化全覆盖）。
  // 不用依赖数组——值不变则保持原引用，不触发额外渲染（规避 useExhaustiveDependencies 误报）。
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.right);
    const cy = Math.round(r.top);
    setAnchor((prev) => (prev && prev.cx === cx && prev.cy === cy ? prev : { nodeId: 'demo-node', cx, cy }));
    const next = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    setCardRect((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next,
    );
  });

  // 蓄力进度：arming 期间 rAF 逐帧推进 0→1——把「快击 vs 慢按」的窗口画出来
  useEffect(() => {
    if (state.phase !== 'arming') {
      setCharge(0);
      return;
    }
    let raf = 0;
    const loop = (): void => {
      const cur = stateRef.current;
      if (cur.phase !== 'arming') return;
      const p = Math.min(1, (performance.now() - cur.altDownAt) / Math.max(1, ctxRef.current.holdMs));
      setCharge(p);
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state.phase]);

  // 死区提示只在环开着时有效
  useEffect(() => {
    if (state.phase !== 'ring') setInDead(false);
  }, [state.phase]);

  // 卸载清理定时器
  useEffect(
    () => () => {
      if (confirmTimerRef.current !== 0) window.clearTimeout(confirmTimerRef.current);
      if (pendingNullRef.current !== 0) window.clearTimeout(pendingNullRef.current);
    },
    [],
  );

  // 按住触发键（Alt=设计键位 / Shift=webview 兜底：宿主可能吞掉裸 Alt）与松手复位。
  // 快击 vs 慢按由相位承载：这套 pressDown/pressUp 同时被键盘、模拟按钮复用。
  const pressDown = useCallback(() => {
    const origin = anchorRef.current;
    if (!origin) return;
    dispatch({ t: 'alt-down', now: performance.now(), origin });
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      dispatch({ t: 'tick', now: performance.now() });
    }, ctxRef.current.holdMs);
  }, [dispatch, clearTimer]);

  const pressUp = useCallback(() => {
    clearTimer();
    dispatch({ t: 'alt-up' });
  }, [clearTimer, dispatch]);

  // 全局键鼠接线（Phase 2 里这层会搬进画布手势层）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      setLastKey(
        `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey && e.key !== 'Alt' ? 'Alt+' : ''}${e.shiftKey && e.key !== 'Shift' ? 'Shift+' : ''}${e.key}`,
      );
      // 二次确认窗口优先：Enter 确认 / Esc 取消
      if (confirmRef.current) {
        if (e.key === 'Enter') {
          e.preventDefault();
          settleConfirm(true);
          return;
        }
        if (e.key === 'Escape') {
          settleConfirm(false);
          return;
        }
      }
      if (e.key === 'Alt' || e.key === 'Shift') {
        if (e.repeat) return;
        e.preventDefault(); // 避免浏览器把 Alt 焦点切到菜单栏
        pressDown();
        return;
      }
      const phase = stateRef.current.phase;
      if (phase === 'idle') return;
      if (e.key === 'Escape') {
        dispatch({ t: 'cancel' });
        clearTimer();
        return;
      }
      if (e.key === 'Enter' && phase === 'ring') {
        e.preventDefault();
        dispatch({ t: 'confirm' });
        return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        dispatch({ t: 'arrow', key: e.key });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' && e.key !== 'Shift') return;
      pressUp();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (stateRef.current.phase !== 'ring') return;
      const geoNow = radialGeometryOf(stateRef.current, ctxRef.current.cfg);
      if (geoNow) {
        const r = Math.hypot(e.clientX - geoNow.cx, e.clientY - geoNow.cy);
        setInDead(r < geoNow.cfg.deadR);
      }
      // 悬停防抖：命中可用扇区立即生效；离开（呼吸缝/缺口/死区/界外）延迟 60ms 生效——
      // 快速划过扇区之间时高亮不再抖灭
      const slot = geoNow ? hitTest(geoNow, e.clientX, e.clientY) : null;
      const usable = slot !== null && itemAt(itemsRef.current, slot) !== null;
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
    const onMouseDown = (e: MouseEvent) => {
      if (stateRef.current.phase !== 'ring') return;
      // 面板上的点击不当作「对环提交」（调滑杆/按钮时环不该被误触发）
      if (e.target instanceof Element && e.target.closest('.hud-right')) return;
      dispatch({ t: 'click', x: e.clientX, y: e.clientY });
    };
    const onBlur = () => {
      clearTimer();
      dispatch({ t: 'cancel' });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('blur', onBlur);
      clearTimer();
    };
  }, [dispatch, clearTimer, pressDown, pressUp, settleConfirm]);

  // 节点卡拖动
  const onCardPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (stateRef.current.phase !== 'idle') return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCardPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  };
  const onCardPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const geo = state.phase === 'ring' ? radialGeometryOf(state, { gapWidthDeg: gapWidth, outerR }) : null;
  const chargeGeo = state.phase === 'arming' ? radialGeometryOf(state, { gapWidthDeg: gapWidth, outerR }) : null;
  const highlightItem: RadialItem | null = state.highlight ? itemAt(items, state.highlight) : null;

  return (
    <div className="page">
      <style>{RADIAL_PREVIEW_CSS}</style>
      <RadialStyles />

      <header className="hud-top">
        <b>环形快捷操作 · 静态预览</b>
        <span>
          按住 Alt（或 Shift）≥{Math.round(holdMs)}ms 出环（蓄力弧充满即浮现） · 快击 Alt+方向键 = 预方向 ·
          方向键漫游 / 悬停高亮 · 点击/Enter 提交 · 「删除」需二次确认 · Esc 取消 · 节点卡可拖动
        </span>
      </header>

      <div
        ref={cardRef}
        className={`node-card${highlightItem?.id === 'delete' ? ' preview-delete' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onCardPointerDown}
        onPointerMove={onCardPointerMove}
        onPointerUp={onCardPointerUp}
      >
        <span className="node-text">新节点</span>
        <span className="node-dot" />
      </div>

      {/* 幽灵预览：高亮「新建」时在出线方向显示即将创建的节点 */}
      {cardRect && highlightItem?.id === 'add-child' && (
        <div
          className="ghost-node"
          style={{ left: cardRect.x + cardRect.w + 26, top: cardRect.y, width: cardRect.w, height: cardRect.h }}
        >
          <span className="node-text">新节点</span>
        </div>
      )}

      {anchor && state.phase === 'idle' && (
        <div className="anchor-dot" style={{ left: anchor.cx, top: anchor.cy }} />
      )}
      {anchor && state.phase === 'arming' && (
        <div className="anchor-pulse" style={{ left: anchor.cx, top: anchor.cy }} />
      )}

      {/* 蓄力进度弧：按住后 0→阈值 逐帧推进，环浮现前把它「充满」 */}
      {chargeGeo && <ChargeArc geo={chargeGeo} progress={charge} />}

      {geo && <RadialRing geo={geo} highlight={state.highlight} items={items} />}

      {geo && highlightItem && state.highlight && (
        <div className="float-label" style={floatLabelStyle(geo, slotCenterDeg(state.highlight))}>
          <svg
            className="fl-ico"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            style={{ color: highlightItem.danger ? RADIAL_DANGER : RADIAL_ACCENT }}
          >
            {highlightItem.icon.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          <b style={{ color: highlightItem.danger ? RADIAL_DANGER : RADIAL_ACCENT }}>{highlightItem.label}</b>
          {highlightItem.hint ? <kbd>{highlightItem.hint}</kbd> : null}
        </div>
      )}

      {/* 死区提示：指针停在环中心 → 松开即取消 */}
      {state.phase === 'ring' && inDead && anchor && (
        <div className="dead-hint" style={{ left: anchor.cx, top: anchor.cy }}>
          松开取消
        </div>
      )}

      {/* 危险动作二次确认（1.6s 窗口，Enter 确认 / Esc 取消） */}
      {confirm && anchor && (
        <div className="confirm-chip" style={{ left: anchor.cx, top: anchor.cy + 24 }}>
          <span>「{confirm.label}」需二次确认</span>
          <button type="button" onClick={() => settleConfirm(true)}>
            确认
          </button>
          <button type="button" className="ghost" onClick={() => settleConfirm(false)}>
            取消
          </button>
        </div>
      )}

      <aside className="hud-right">
        <div className="panel-title">状态</div>
        <div className="stat-row">
          <span className="stat">
            <i>相位</i>
            <b>{state.phase}</b>
          </span>
          <span className="stat">
            <i>高亮</i>
            <b>{state.highlight ?? '—'}</b>
          </span>
          <span className="stat">
            <i>按键</i>
            <b>{lastKey}</b>
          </span>
        </div>
        <div className="panel-title">参数</div>
        <label className="slider">
          <span>按住阈值</span>
          <b>{holdMs}ms</b>
          <input type="range" min={80} max={500} step={10} value={holdMs} onChange={(e) => setHoldMs(Number(e.target.value))} />
        </label>
        <label className="slider">
          <span>缺口宽度</span>
          <b>{gapWidth}°</b>
          <input type="range" min={0} max={120} step={2} value={gapWidth} onChange={(e) => setGapWidth(Number(e.target.value))} />
        </label>
        <label className="slider">
          <span>外环半径</span>
          <b>{outerR}px</b>
          <input type="range" min={40} max={84} step={2} value={outerR} onChange={(e) => setOuterR(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={rootSim} onChange={(e) => setRootSim(e.target.checked)} />
          <span>模拟根节点（禁用「删除」）</span>
        </label>
        <button
          className="hold-btn"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            pressDown();
          }}
          onPointerUp={pressUp}
          onPointerCancel={pressUp}
        >
          按住我 = 按住 Alt / Shift
        </button>
        {lastKey === '—' && <div className="tip">按键没反应？先点击页面空白处，让预览页获得键盘焦点</div>}
        <div className="panel-title">日志</div>
        <ol className="log">
          {log.map((l) => (
            <li key={l.id}>{l.text}</li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<RadialPreview />);
