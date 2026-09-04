/**
 * FreeEdgeLayer —— 自由边叠加层渲染（E2）。树形连线之上的语义边：
 * 贝塞尔曲线 + dir 箭头 + label chip + note 原生提示 + ghost 锚点 + 点击选中。
 * 数据/几何来自 freeEdges.ts 纯函数；本组件只做 SVG 组装。
 * 已知边界：Canvas 模式（>50K 自动降级）不渲染自由边——L3 场景树未含边类型，等场景 diff 批次补。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { EditableNode } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import { edgeVisualOf, freeEdgeEndpoints, type EdgeManual, type FreeEdge } from './freeEdges.js';
import {
  bezierFromAnchors,
  findCrossings,
  pathWithJumps,
  routeAesthetic,
  type RouteObstacle,
  type RouteResult,
} from './edgeRouting.js';
import { EdgeLabel } from './EdgeLabel.js';

/**
 * 人工锁定边的手动路径（Issue #3）。
 *
 * 交互契约（与 XMind / MindManager / Miro 一致）：用户一旦手动调整某条连线，
 * 自动优化立即停用，需显式恢复。手动几何存于边的 `manual` 透传字段，
 * 重载后保持 —— 尊重人工干预，不让自动路由覆盖用户的明确意图。
 */
// v1.3.0：EdgeManual 迁至 freeEdges.ts（数据契约层）以消除循环依赖 ——
// 本文件依赖 freeEdges，反向 import 会成环。此处 re-export 保持既有导入路径可用。
export type { EdgeManual } from './freeEdges.js';

/** 由手动字段还原路径；字段不全时退回直连 */
function manualPathOf(edge: FreeEdge, from?: Box, to?: Box): RouteResult {
  const c = edge.manual?.curvature ?? 0;
  if (from && to) {
    const p0 = {
      x: from.x + from.w * (edge.manual?.from?.x ?? 0.5),
      y: from.y + from.h * (edge.manual?.from?.y ?? 0.5),
    };
    const p3 = {
      x: to.x + to.w * (edge.manual?.to?.x ?? 0.5),
      y: to.y + to.h * (edge.manual?.to?.y ?? 0.5),
    };
    const bez = bezierFromAnchors(p0, p3, c);
    return {
      d: bez.d,
      points: [p0, bez.mid, p3],
      routed: false,
      mid: bez.mid,
      nx: bez.nx,
      ny: bez.ny,
    };
  }
  return { d: '', points: [], routed: false, mid: { x: 0, y: 0 }, nx: 0, ny: 0 };
}

export interface FreeEdgeLayerProps {
  edges: readonly FreeEdge[];
  /** 端点盒取值（含动画帧插值盒）；端点无盒须返回 undefined（不可退化成零盒——否则边会飞向原点） */
  boxOf: (id: string) => Box | undefined;
  root: EditableNode;
  collapsed: ReadonlySet<string>;
  token: TokenSet;
  selectedKey?: string | null;
  onSelect?: (edge: FreeEdge, sx: number, sy: number) => void;
  /** E8：连线只在关系模式下可点选编辑 */
  interactive?: boolean;
  /**
   * 避障障碍物（画布上其它节点卡片的世界坐标盒 + 节点 id）。
   * 缺省空数组 → 退化为原「恒定弓高贝塞尔」行为（调用方在低 LOD / 大图时据此关闭避障）。
   *
   * 带 id 的原因：节点过渡动画期间端点走的是**插值盒**，与障碍集里的最终盒坐标不同，
   * 按坐标值无法判定"这是端点自己的卡片"；按 id 排除才可靠，否则连线会被自己的卡片
   * 判定为障碍而绕行。
   */
  obstacles?: readonly { id: string; box: RouteObstacle }[];
  /**
   * 屏幕坐标 → 世界坐标（Issue #3 拖拽 handle 定位用，由上层视口提供）。
   * 拖拽事件给的是屏幕坐标，而本组件渲染在世界坐标系（外层有 translate/scale），
   * 故需上层注入换算；缺省时拖拽 handle 不渲染（降级为不可拖拽）。
   */
  toWorld?: (sx: number, sy: number) => { x: number; y: number };
  /**
   * 手动调整回调（Issue #3）：拖拽端点 / bend 控制点后给出新的 manual 几何。
   * manual = null 表示「恢复自动优化」（清空人工锁定）。
   */
  onManualChange?: (edge: FreeEdge, manual: EdgeManual | null) => void;
  /**
   * 路由结果回调（Opp 精确翻转用）：把「边 key → 实际渲染的 RouteResult」抛给上层。
   *
   * 上层需要它来回答「这条边现在到底鼓向哪一侧」—— 只在 routingSide 未设（auto）时才需要，
   * 因为 auto 模式下鼓向由评分决定、光看数据无从得知。
   * 用回调而非让上层复刻计算：复刻会漏掉跨边交叉协调与 Line jumps 的影响，结论可能与实际渲染不符。
   */
  onRoutesChange?: (routes: ReadonlyMap<string, EdgeRouteEntry>) => void;
}

const GHOST_R = 4;
const CURVATURE = 0.16;

/**
 * 一条边的路由结果条目（Opp 精确翻转用）。
 * eps = 解析后的端点（含折叠上溯与幽灵锚点）；route = 实际渲染的几何（含跨边协调与 Line jumps 后的最终 d）。
 */
export type EdgeRouteEntry = {
  eps: ReturnType<typeof freeEdgeEndpoints>;
  route: RouteResult;
};

export function FreeEdgeLayer({
  edges,
  boxOf,
  root,
  collapsed,
  token,
  selectedKey,
  onSelect,
  interactive = true,
  obstacles = [],
  toWorld,
  onManualChange,
  onRoutesChange,
}: FreeEdgeLayerProps) {
  // Issue #3：正在拖拽的 handle（端点 / bend 控制点）。仅选中的边渲染 handle，
  // 与 XMind 交互一致——选中关系线后才出现可拖拽的端点与控制点。
  const [drag, setDrag] = useState<{ key: string; handle: 'from' | 'to' | 'bend' } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // 路由缓存（E8 性能 P4）：仅在「边集 / 端点盒 / 树结构 / 障碍集」变化时重算。
  // pan/zoom 不触发——路由在世界坐标系，且 boxOf 与 obstacles 已在 MapView 侧稳定化。
  // 仅节点过渡动画期间（animBoxes 逐帧变化）才会逐帧重算，动画结束即回到缓存态。
  const routes = useMemo(() => {
    const m = new Map<string, { eps: ReturnType<typeof freeEdgeEndpoints>; route: RouteResult }>();
    // 跨边协调：按边顺序累积已路由路径，供后续边做「交叉罚分」。
    // 对应 Issue #2 —— 让多条关系线彼此错开，而不是各自为政地抢同一条通道。
    // 用「起点—中点—终点」三点折线近似曲线（交叉检测精度足够，成本远低于全曲线采样）。
    const routedPolylines: { x: number; y: number }[][] = [];
    // P0 · 平行入边错位：同一目标节点的第 N 条入边沿外侧轴反向错位（anchorStagger），
    // 避免多条边从同一个点扇形炸开（semanticAnchorPair 的 stagger 语义）。
    const staggerSeen = new Map<string, number>();
    for (const edge of edges) {
      const eps = freeEdgeEndpoints(edge, boxOf, root, collapsed);
      // 源锚未解析/端点盒缺失 → 不绘制（此前退化成指向世界原点的误导性直线）
      if (!eps.renderable) continue;
      const seq = eps.toId === '' ? 0 : (staggerSeen.get(eps.toId) ?? 0);
      if (eps.toId !== '') staggerSeen.set(eps.toId, seq + 1);
      // 按 id 排除两端自身卡片（动画期间坐标不可靠，见 obstacles 注释）
      const obs = obstacles
        .filter((o) => o.id !== eps.fromId && o.id !== eps.toId)
        .map((o) => o.box);
      // 新主路由：曲率自适应贝塞尔（外围绕行优先，见 edgeRouting.ts 顶部说明）。
      // 人工锁定的边跳过自动路由 —— 见 Issue #3 的 manual 字段约定。
      const route = edge.manual
        ? manualPathOf(edge, eps.from, eps.to)
        : routeAesthetic(eps.from, eps.to, obs, routedPolylines, {
            // 用户指定的绕行侧优先于评分自动选择（对标 markvault forceSide）
            ...(edge.routingSide ? { forceSide: edge.routingSide } : {}),
            // P0 · 平行入边错位（步长 = 盒边长 × 0.0625，最多 4 档防出盒内缩）
            anchorStagger: Math.min(seq, 4),
          });
      m.set(edge.key, { eps, route });
      if (route.points.length >= 2) routedPolylines.push([...route.points]);
    }

    // ── Line jumps（Issue #4）：交叉处让「下方」那条线画跨越小弧，使交叉可读 ──
    // 不强求消除交叉（几何上未必可行），而是明确上下关系 —— 参照 Miro Line jumps，
    // 但 Miro 仅支持直线/正交线型，曲线用此处自绘实现（pathWithJumps）。
    if (m.size >= 2) {
      const orderedKeys = [...m.keys()];
      const polys = orderedKeys.map((k) => m.get(k)!.route.points);
      const crossings = findCrossings(polys);
      // 按「被跨越的边」归组跳线点
      const jumpsByKey = new Map<string, { x: number; y: number }[]>();
      for (const c of crossings) {
        const key = orderedKeys[c.under];
        if (!key) continue;
        const arr = jumpsByKey.get(key) ?? [];
        arr.push({ x: c.x, y: c.y });
        jumpsByKey.set(key, arr);
      }
      for (const [key, jps] of jumpsByKey) {
        const entry = m.get(key)!;
        entry.route = { ...entry.route, d: pathWithJumps(entry.route.points, jps) };
      }
    }
    return m;
  }, [edges, boxOf, root, collapsed, obstacles]);

  // Opp 精确翻转：把实际渲染结果抛给上层（含跨边交叉协调与 Line jumps 的最终 d）。
  // 上层据此用 inferBowSide 判断当前鼓向，避免"复刻计算"与真实渲染不一致。
  useEffect(() => {
    onRoutesChange?.(routes);
  }, [routes, onRoutesChange]);

  // Issue #3：拖拽期间在 window 上跟踪指针 —— 指针可能移出 SVG 区域，
  // 只在元素上监听会导致拖拽中断。
  useEffect(() => {
    if (!drag || !toWorld || !onManualChange) return;
    const target = edges.find((e) => e.key === drag.key);
    if (!target) return;
    const entry = routes.get(drag.key);
    if (!entry) return;
    const { eps } = entry;
    const a = eps.from;
    const b = eps.to;
    const cur = target.manual ?? {};

    const onMove = (ev: PointerEvent): void => {
      const w = toWorld(ev.clientX, ev.clientY);
      if (drag.handle === 'bend') {
        // bend：以「相对弦的垂距 / 弦长」作为曲率（与 bezierFromAnchors 的 bow 定义一致）
        const p0 = { x: a.x + a.w * (cur.from?.x ?? 0.5), y: a.y + a.h * (cur.from?.y ?? 0.5) };
        const p3 = { x: b.x + b.w * (cur.to?.x ?? 0.5), y: b.y + b.h * (cur.to?.y ?? 0.5) };
        const dx = p3.x - p0.x;
        const dy = p3.y - p0.y;
        const chord = Math.hypot(dx, dy) || 1;
        // 有符号垂距（叉积 / 弦长）
        const cross = ((w.x - p0.x) * dy - (w.y - p0.y) * dx) / chord;
        // bezierFromAnchors 中 mid 偏移 = 0.75 * chord * c，故 c = cross / (0.75 * chord)
        const c = cross / (0.75 * chord);
        onManualChange(target, { ...cur, curvature: Math.max(-2.5, Math.min(2.5, c)) });
        return;
      }
      // 端点：投影到对应盒，换算为归一化坐标（夹紧到 [0,1]）
      const box = drag.handle === 'from' ? a : b;
      const nx = box.w > 0 ? (w.x - box.x) / box.w : 0.5;
      const ny = box.h > 0 ? (w.y - box.y) / box.h : 0.5;
      const norm = { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
      onManualChange(
        target,
        drag.handle === 'from' ? { ...cur, from: norm } : { ...cur, to: norm },
      );
    };
    const onUp = (): void => setDrag(null);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, toWorld, onManualChange, edges, routes]);

  if (edges.length === 0) return null;
  // marker 按颜色去重（同色边共享箭头 def）
  const colors: string[] = [];
  const markerIdOf = (stroke: string): string => {
    let i = colors.indexOf(stroke);
    if (i < 0) {
      colors.push(stroke);
      i = colors.length - 1;
    }
    return `free-arrow-${i}`;
  };
  const onSelectRef = onSelect;
  return (
    <g data-free-edge-layer>
      <defs>
        {colors.map((c, i) => (
          <marker
            key={c}
            id={`free-arrow-${i}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path
              d="M1 1L9 5L1 9"
              fill="none"
              stroke={c}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => {
        const cached = routes.get(edge.key);
        if (!cached) return null;
        const { eps, route } = cached;
        const { d, mid, nx, ny } = route;
        const visual = edgeVisualOf(edge, token);
        const stale = edge.state === 'stale';
        const invalidated = edge.invalidAt !== undefined;
        const stroke = invalidated
          ? token.color.textMuted
          : stale
            ? token.color.warn
            : visual.stroke;
        const dashed = invalidated || stale || visual.dashed;
        const width = visual.width;
        const selected = selectedKey === edge.key;
        const mId = markerIdOf(stroke);
        const both = edge.dir === 'both' && !eps.ghost;
        const labelText = edge.label ?? edge.rel;
        const tip = [
          invalidated ? `已失效 ${edge.invalidAt!.slice(0, 10)}` : '',
          `${edge.rel}${edge.label ? ` · ${edge.label}` : ''}`,
          edge.source ? `来源: ${edge.source}` : '',
          edge.note ?? '',
          eps.ghost ? '锚点未命中（悬空）' : '',
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <g key={edge.key} data-free-edge={edge.key} data-free-edge-state={edge.state}>
            <title>{tip}</title>
            {/* 命中区：宽透明描边，拦截点击（阻断下层 pan 启动）；浏览态不挂载（边只读） */}
            {interactive && (
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onSelectRef?.(edge, e.clientX, e.clientY)}
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={selected ? width + 0.8 : width}
              strokeDasharray={dashed ? '5 4' : undefined}
              markerEnd={eps.ghost ? undefined : `url(#${mId})`}
              markerStart={both ? `url(#${mId})` : undefined}
              opacity={selected ? 1 : 0.9}
              style={{ pointerEvents: 'none' }}
            />
            {eps.ghost && (
              <circle
                cx={eps.to.x + eps.to.w / 2}
                cy={eps.to.y + eps.to.h / 2}
                r={GHOST_R}
                fill="none"
                stroke={stroke}
                strokeWidth={1.2}
                strokeDasharray="2 2"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {/* E8：关系标签「线中生长」——触点 + 短茎 + 小胶囊（字号 10 / 高 14）
                ghost 边：标签挂在幽灵锚点上方（不压源节点折叠钮） */}
            <EdgeLabel
              ax={eps.ghost ? eps.to.x + eps.to.w / 2 : mid.x}
              ay={eps.ghost ? eps.to.y + eps.to.h / 2 - GHOST_R : mid.y}
              nx={eps.ghost ? 0 : nx}
              ny={eps.ghost ? -1 : ny}
              text={labelText}
              stroke={stroke}
              token={token}
              muted={invalidated}
            />
            {/* Issue #3：手动覆盖 handle —— 选中边才显示（与 XMind 一致）：
                两个端点圆点（from/to）+ 一个 bend 方点（曲率）。拖动任一即写入
                edge.manual 并停用自动优化；Shift+点击 bend 或点击「恢复自动」清空。 */}
            {interactive && selected && toWorld && onManualChange && (
              <EdgeHandles
                edge={edge}
                entry={cached}
                token={token}
                onDragStart={(handle) => setDrag({ key: edge.key, handle })}
                onReset={() => onManualChange(edge, null)}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Issue #3：端点 / bend 控制点渲染 */
function EdgeHandles({
  edge,
  entry,
  token,
  onDragStart,
  onReset,
}: {
  edge: FreeEdge;
  entry: { eps: ReturnType<typeof freeEdgeEndpoints>; route: RouteResult };
  token: TokenSet;
  onDragStart: (handle: 'from' | 'to' | 'bend') => void;
  onReset: () => void;
}) {
  const { eps, route } = entry;
  const cur = edge.manual ?? {};
  const p0 = {
    x: eps.from.x + eps.from.w * (cur.from?.x ?? 0.5),
    y: eps.from.y + eps.from.h * (cur.from?.y ?? 0.5),
  };
  const p3 = {
    x: eps.to.x + eps.to.w * (cur.to?.x ?? 0.5),
    y: eps.to.y + eps.to.h * (cur.to?.y ?? 0.5),
  };
  // bend 控制点：自中点沿法向外推（偏移量随曲率），让控制点落在曲线"弓起"的一侧
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const chord = Math.hypot(dx, dy) || 1;
  const nxv = -dy / chord;
  const nyv = dx / chord;
  const c = cur.curvature ?? 0;
  const bowPx = 0.75 * chord * c;
  const bend = { x: route.mid.x + nxv * bowPx, y: route.mid.y + nyv * bowPx };

  const dot = (p: { x: number; y: number }, handle: 'from' | 'to', fill: string): ReactElement => (
    <circle
      key={handle}
      data-edge-handle={handle}
      cx={p.x}
      cy={p.y}
      r={5}
      fill={fill}
      stroke={token.color.canvas}
      strokeWidth={1.5}
      style={{ cursor: 'grab', pointerEvents: 'all' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDragStart(handle);
      }}
    />
  );

  return (
    <g data-edge-handles>
      {/* bend 引导线（中点 → bend 点），让"曲率"可感知 */}
      <line
        x1={route.mid.x}
        y1={route.mid.y}
        x2={bend.x}
        y2={bend.y}
        stroke={token.color.textMuted}
        strokeWidth={0.8}
        strokeDasharray="3 2"
        style={{ pointerEvents: 'none' }}
      />
      {dot(p0, 'from', token.color.selection)}
      {dot(p3, 'to', token.color.selection)}
      <rect
        data-edge-handle="bend"
        x={bend.x - 4.5}
        y={bend.y - 4.5}
        width={9}
        height={9}
        rx={2}
        fill={token.color.selection}
        stroke={token.color.canvas}
        strokeWidth={1.5}
        style={{ cursor: 'grab', pointerEvents: 'all' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart('bend');
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
      >
        <title>拖动调整曲率；双击恢复自动优化</title>
      </rect>
    </g>
  );
}
