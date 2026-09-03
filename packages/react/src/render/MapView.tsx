/**
 * MapView：渲染核心主体（dirty-flag 按需渲染 + 视口裁剪 + LOD）。
 * 调度纪律（硬验收：空闲 CPU ≈ 0，禁永续 rAF）：
 * - 视口变换（pan/zoom/fit）→ notify() → 脏标记 ∈ FrameScheduler（单帧 rAF，帧内合批；同帧多次变更只渲染一次）
 * - 无交互时零 rAF / 零 timer 挂起——空闲零活动
 * - 数据更改（新 layout）→ 派生 memo 重算 + epoch 触发一帧
 * 组件/几何分离：几何与命中检测在 geometry.ts（纯函数），本组件只做组装。
 */

import type { CharMeasure, EditableNode, Entity } from '@mindcanvas/kernel';
import {
  type Box,
  filterVisibleLinks,
  isBoxInView,
  type LayoutNode,
  type LayoutResult,
  type TreeOp,
} from '@mindcanvas/kernel';
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DescBlock, estimateDescHeight } from '../chrome/DescBlock.js';
import { estimateCommentAreaHeight, GrowthCommentPanel } from '../chrome/GrowthCommentPanel.js';
import { OverlayEditor } from '../edit/OverlayEditor.js';
import { useTheme } from '../theme/ThemeContext.js';
import type { TokenSet } from '../theme/types.js';
import { createSvgBackend, type RenderBackend } from './backend.js';
import { CanvasSurface } from './canvasBackend.js';
import { createDisplayMetricsFn } from './domMeasure.js';
import { cubicMidNormal, EdgeLabel } from './EdgeLabel.js';
import type { EdgeRouteEntry } from './FreeEdgeLayer.js';
import { type EdgeManual, FreeEdgeLayer } from './FreeEdgeLayer.js';
import { collectFreeEdges, type FreeEdge } from './freeEdges.js';
import type { LodLevel } from './geometry.js';
import {
  buildLinkPath,
  computeBranchIndex,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
} from './geometry.js';
import {
  NODE_ANIM_MAX_NODES,
  NODE_ANIM_MS,
  PAN_INERTIA_TRIGGER,
  PAN_SAMPLE_WINDOW,
  prefersReducedMotion,
  VIEWPORT_ANIM_MS,
} from './motion.js';
import { NodeG } from './NodeG.js';
import { type DropMode, dropModeFor, planDrop } from './nodeDrag.js';
import { commentAreaH, DescOverlays, ExpandCommentOverlay, NodeTextOverlay } from './overlays.js';
import { PinchTracker } from './pinch.js';
import { buildSceneFromLayout, CANVAS_AUTO_NODES } from './sceneBuilder.js';
import { FrameScheduler } from './scheduler.js';
import { lerpNodeFrame, type NodeFrame, toNodeFrame } from './transition.js';
import { hitNodeAt, useMapGestures, worldPointOf } from './useMapGestures.js';
import { estimatePanVelocity, type PanSample, ViewportController } from './viewport.js';

export interface MapViewProps {
  layout: LayoutResult;
  entities: Map<string, Entity>;
  /** DOM 精确字符度量（T3 注入；随主题字体切换） */
  char: CharMeasure;
  /** 外部控制柄（fit / zoomBy） */
  apiRef?: RefObject<MapViewApi | null>;
  /** 渲染后端强制（C2）：'canvas' → 大图模式（场景树 → 2D 画布，交互走坐标命中）；缺省 'svg' */
  forceBackend?: 'svg' | 'canvas';
  /** 每帧渲染统计（T5 性能验证 / 性能面板） */
  onStats?: (s: MapStats) => void;
  /** 节点点击（hit-test：点击非拖拽时命中可见节点；mods.shift 供「Shift+点击两节点连线」） */
  onNodeClick?: (node: LayoutNode, mods?: { shift: boolean; sx: number; sy: number }) => void;
  /** 节点右键（hit-test；空白处命中 null；带屏幕坐标） */
  onNodeContext?: (node: LayoutNode | null, sx: number, sy: number) => void;
  /** 选中节点 id（高亮；null = 无） */
  selectedId?: string | null;
  /** 正在编辑的节点 id（渲染文本内联输入框） */
  editingId?: string | null;
  onEditCommit?: (id: string, text: string) => void;
  onEditCancel?: () => void;
  /** 双击节点请求进入编辑（仅 text 类型命中回调；由上层决定 select+startEdit） */
  onEditStart?: (id: string) => void;
  /** 折叠集合（缺省无折叠） */
  collapsedIds?: ReadonlySet<string>;
  onToggleCollapse?: (id: string) => void;
  /** 展开态节点 id（快速注释"生长"：节点向下变宽变高参与布局；null = 无展开） */
  expandedId?: string | null;
  /** 点击节点展开/收起（由上层决定 expandedId） */
  onToggleExpand?: (id: string) => void;
  /** 写回展开节点（或选中节点）的 note.qa 数组 */
  onQaChange?: (id: string, qa: string[]) => void;
  /** 资产基础 URL（透传给 NodeG：@img/@draw 实体渲染 <image> 预览时拼接；缺省不渲染） */
  assetBaseUrl?: string;
  /**
   * 节点拖拽重排落点（M5-T5）：拖拽松手时给出 move-node op（由上层经 controller.apply 执行，
   * 保证 undo/redo 正确）；非法落点（成环/自拖/根目标）不会触发本回调。
   */
  onNodeMove?: (op: Extract<TreeOp, { type: 'move-node' }>) => void;
  /**
   * 文件拖入/粘贴到画布（P1 上传管线）：由上层经资产宿主上传后插入 @img 引用。
   * 缺省 = 忽略（拖放/粘贴文件不响应）。
   */
  onAssetFiles?: (files: File[]) => void;
  /** 选中自由边 key（E3 边编辑高亮；null = 无） */
  selectedEdgeKey?: string | null;
  /** 点击自由边（E2 选中回调；带屏幕坐标供浮窗锚定） */
  onEdgeClick?: (edge: FreeEdge, sx: number, sy: number) => void;
  /**
   * Issue #3：手动调整连线（拖端点 / bend 控制点）→ 回写 manual。
   * manual = null 表示「恢复自动优化」（清空人工锁定）。
   */
  onEdgeManualChange?: (edge: FreeEdge, manual: EdgeManual | null) => void;
  /**
   * 路由结果回调（Opp 精确翻转用）：给出「边 key → 实际渲染的 RouteResult」。
   * 上层据此用 inferBowSide 判断某条边当前鼓向哪一侧（auto 模式下光看数据无从得知）。
   */
  onEdgeRoutes?: (routes: ReadonlyMap<string, EdgeRouteEntry>) => void;
  /** 左键/右键树自然线（父→子连线）→ 编辑关系内容（存子节点 note.via；E6） */
  onTreeEdgeEdit?: (childId: string, sx: number, sy: number) => void;
  /** 连接手柄拖拽松手（E6 图操作）：目标命中 → 建边；未命中 → null（上层开创建器） */
  onEdgeConnect?: (fromId: string, toId: string | null, sx: number, sy: number) => void;
  /**
   * E8：关系模式（模式隔离）。关闭 = 浏览态——画布只呈现已有关系，不暴露任何连线入口：
   * 无连接手柄、树边不可右键编辑、自由边只读（点击穿透，不弹编辑器）。
   * 开启 = 关系编辑态——手柄 / 树边右键 / 边的点击编辑全部激活。
   */
  relationMode?: boolean;
  // ---------- v1.3.0 幕布描述（note.desc）----------
  /** 正在编辑描述的节点 id（Shift+Enter 进入；null = 无） */
  descEditingId?: string | null;
  /** 已展开全文描述的节点 id 集合（默认收缩为一行；点击展开） */
  descExpandedIds?: ReadonlySet<string>;
  /** 点击描述区：切换展开/收缩 */
  onDescToggle?: (id: string) => void;
  /** 提交描述文本（空串 = 删除描述） */
  onDescCommit?: (id: string, text: string) => void;
  /** 取消描述编辑 */
  onDescCancel?: () => void;
  /** v1.3.0：主题文本编辑态按 Shift+Enter → 请求切到该节点描述编辑 */
  onDescEditRequest?: (id: string) => void;
}

export interface MapViewApi {
  fit(): void;
  zoomBy(factor: number): void;
  /** 重置缩放（k=1 居中于原点） */
  resetZoom(): void;
  /** 定位节点：保持当前 k，将节点中心平移到视口中心 */
  focusNode(id: string): void;
}

export interface MapStats {
  epoch: number;
  totalNodes: number;
  visibleNodes: number;
  visibleLinks: number;
  lod: LodLevel;
  viewMs: number;
}

/** 裁剪外扩（世界 px；缓冲防边缘闪烁） */
const CULL_MARGIN = 128;
/**
 * 空折叠集常量。
 * 原先写 `collapsedIds ?? new Set()` —— 每次渲染都造一个新 Set，
 * 会让 `FreeEdgeLayer` 的路由 useMemo 依赖失效，**每次重渲染都把全部边重算一遍路由**
 * （100 条边 ≈ 0.5s），并且路由回调会自我触发形成死循环。此处固定为空集单例。
 */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

export function MapView({
  layout,
  entities,
  char,
  apiRef,
  forceBackend,
  onStats,
  onNodeClick,
  selectedId,
  editingId,
  onEditCommit,
  onEditCancel,
  collapsedIds,
  onToggleCollapse,
  expandedId,
  onToggleExpand,
  onQaChange,
  onNodeContext,
  onEditStart,
  assetBaseUrl,
  onNodeMove,
  onAssetFiles,
  selectedEdgeKey,
  onEdgeClick,
  onEdgeManualChange,
  onEdgeRoutes,
  onTreeEdgeEdit,
  onEdgeConnect,
  relationMode = false,
  descEditingId = null,
  descExpandedIds,
  onDescToggle,
  onDescCommit,
  onDescCancel,
  onDescEditRequest,
}: MapViewProps) {
  const { token } = useTheme();
  // E8 模式隔离：连线入口总闸（回调以 ref 形式参与渲染分支——避免闭包陈旧）
  const relationModeRef = useRef(relationMode);
  relationModeRef.current = relationMode;

  // 渲染基础设施：单帧调度器 + 视口（挂载一次，卸载即清）
  const frameRef = useRef<FrameScheduler | null>(null);
  if (frameRef.current === null) frameRef.current = new FrameScheduler();
  const frame = frameRef.current;
  const viewportRef = useRef<ViewportController | null>(null);
  if (viewportRef.current === null) viewportRef.current = new ViewportController(frame);
  const viewport = viewportRef.current;

  // 节点位置过渡（M5-T2）：布局变化时旧→新坐标插值；anim 非空 = 过渡进行中
  const [anim, setAnim] = useState<NodeFrame | null>(null);
  const prevLayoutRef = useRef<LayoutResult | null>(null);

  // 节点拖拽重排（M5-T5）：pointerdown 命中节点启动；moved 后跟随光标 + 悬停目标提示
  const [nodeDrag, setNodeDrag] = useState<{
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
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const didInitialFit = useRef(false);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeContextRef = useRef(onNodeContext);
  onNodeContextRef.current = onNodeContext;
  const onEditCommitRef = useRef(onEditCommit);
  onEditCommitRef.current = onEditCommit;
  const onEditCancelRef = useRef(onEditCancel);
  onEditCancelRef.current = onEditCancel;
  const onToggleCollapseRef = useRef(onToggleCollapse);
  onToggleCollapseRef.current = onToggleCollapse;
  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;
  const onQaChangeRef = useRef(onQaChange);
  onQaChangeRef.current = onQaChange;
  const onEditStartRef = useRef(onEditStart);
  onEditStartRef.current = onEditStart;
  const onNodeMoveRef = useRef(onNodeMove);
  onNodeMoveRef.current = onNodeMove;
  const onAssetFilesRef = useRef(onAssetFiles);
  onAssetFilesRef.current = onAssetFiles;
  const onEdgeClickRef = useRef(onEdgeClick);
  onEdgeClickRef.current = onEdgeClick;
  const onEdgeManualChangeRef = useRef(onEdgeManualChange);
  onEdgeManualChangeRef.current = onEdgeManualChange;
  // Opp 精确翻转：用 ref 承接，避免上层传内联函数导致路由结果回调每次渲染都变
  const onEdgeRoutesRef = useRef(onEdgeRoutes);
  onEdgeRoutesRef.current = onEdgeRoutes;
  // 必须是稳定引用 —— FreeEdgeLayer 的 useEffect 依赖它；
  // 若每渲染都换新函数，会「回调 → 上层 setState → 重渲染 → 再回调」形成死循环。
  const handleRoutesChange = useCallback((routes: ReadonlyMap<string, EdgeRouteEntry>) => {
    onEdgeRoutesRef.current?.(routes);
  }, []);
  // Issue #3：屏幕坐标 → 世界坐标（拖 handle 定位；需扣掉容器偏移）
  const toWorld = useCallback(
    (sx: number, sy: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return viewport.toWorld(sx - (rect?.left ?? 0), sy - (rect?.top ?? 0));
    },
    [viewport],
  );
  const onTreeEdgeEditRef = useRef(onTreeEdgeEdit);
  onTreeEdgeEditRef.current = onTreeEdgeEdit;
  const onEdgeConnectRef = useRef(onEdgeConnect);
  onEdgeConnectRef.current = onEdgeConnect;
  // v1.3.0 幕布描述回调 ref（避免闭包陈旧）
  const onDescToggleRef = useRef(onDescToggle);
  onDescToggleRef.current = onDescToggle;
  const onDescCommitRef = useRef(onDescCommit);
  onDescCommitRef.current = onDescCommit;
  const onDescCancelRef = useRef(onDescCancel);
  onDescCancelRef.current = onDescCancel;
  const onDescEditRequestRef = useRef(onDescEditRequest);
  onDescEditRequestRef.current = onDescEditRequest;

  // E6：连接手柄拖拽（图操作）——选中节点手柄按下 → 引导线跟随 + 悬停目标高亮 → 松手建边
  const [connectDrag, setConnectDrag] = useState<{
    sourceId: string;
    x: number;
    y: number;
    hoverId: string | null;
  } | null>(null);

  // 自由边数据（E5：文档级标注边——root note.edges；锚存路径，会话内解析）
  // E8：根以 depth===0 定位并复用给 FreeEdgeLayer（原用 layout.nodes[0] 假定有序——折叠路由会算错祖先）
  const rootNode = useMemo(() => layout.nodes.find((n) => n.depth === 0)?.node, [layout]);
  const freeEdges = useMemo(() => (rootNode ? collectFreeEdges(rootNode) : []), [rootNode]);

  // 文件拖入画布高亮（P1）
  const [fileDragActive, setFileDragActive] = useState(false);

  // 渲染后端（M5-T7）：SVG 适配器——连线等原语经后端绘制，为未来 Canvas 切换预留
  const backendRef = useRef<RenderBackend | null>(null);
  if (backendRef.current === null) backendRef.current = createSvgBackend();
  const backend = backendRef.current;

  const epoch = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot);

  // 尺寸观测（ResizeObserver → 视口脏标记 → 单帧渲染；jsdom/SSR 无 RO 时跳过）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) viewport.setSize(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  // 派生数据：分支索引 / 盒表 / 渲染度量（layout 或字符度量变化时重建）
  const derived = useMemo(() => {
    const metric = createDisplayMetricsFn(char, entities);
    const branchIndex = computeBranchIndex(layout.nodes);
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    const metrics = new Map<string, ReturnType<typeof metric>>();
    for (const ln of layout.nodes) {
      boxes.set(ln.node.id, ln.box);
      metrics.set(ln.node.id, metric(ln.node));
    }
    return { boxes, metrics, branchIndex, metricFn: metric };
  }, [layout, char, entities]);

  // E7 审查：节点 id → node 索引（树边 overlay 每帧查 child 标注，避免 O(links×nodes) 扫描）
  const nodeByIdx = useMemo(() => {
    const m = new Map<string, EditableNode>();
    for (const ln of layout.nodes) m.set(ln.node.id, ln.node);
    return m;
  }, [layout]);

  // 视口变换渲染（render body 内：每次 epoch 变化重算可见集合——单帧触发）
  // A2：大图（>LOD_AUTO_NODES）自动激进 LOD（T8 降级策略 L1 接线）
  const lod = lodFor(viewport.transform.k, layout.nodes.length);

  // E8：连线避障的障碍集（全量节点盒 + id）。
  // 低 LOD（缩小视图）传空数组关闭寻路——与树边命中区/chip 的 `lod === 'full'` 门控同一策略：
  // 缩小时单条边只占几个像素，寻路无视觉收益，而成本随节点数增长。
  const edgeObstacles = useMemo(
    () => (lod === 'full' ? layout.nodes.map((ln) => ({ id: ln.node.id, box: ln.box })) : []),
    [layout, lod],
  );
  const view = viewport.worldRect(CULL_MARGIN);
  const start = performance.now();
  // 渲染盒 = 动画帧优先（M5-T2 过渡中）/ 布局盒（静止）
  const animBoxes = anim?.boxes;
  const renderBoxOf = (id: string, fallback: Box): Box => animBoxes?.get(id) ?? fallback;

  // E8：自由边端点取盒（稳定引用）。
  // 关键：非动画期间 identity 不变 → FreeEdgeLayer 内的路由结果可缓存，
  // pan/zoom 不触发重算（路由在世界坐标系，与视口无关）；仅动画逐帧变化时重算。
  const edgeBoxOf = useCallback(
    (id: string): Box | undefined => {
      const b = derived.boxes.get(id);
      return b ? renderBoxOf(id, b) : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, animBoxes],
  );
  const visibleNodes = layout.nodes.filter((n) =>
    isBoxInView(renderBoxOf(n.node.id, n.box), view, CULL_MARGIN),
  );
  // 淡出中的被删节点（ghost）：仅动画期间存在，参与裁剪但不计入 stats
  const visibleGhosts =
    anim?.ghosts.filter((g) =>
      isBoxInView(animBoxes?.get(g.node.id) ?? g.box, view, CULL_MARGIN),
    ) ?? [];
  const visibleLinks = filterVisibleLinks(layout.links, derived.boxes, view, CULL_MARGIN);

  // 性能（E7 审查）：自由边视口裁剪。
  // E8 修复（用户反馈②「连线丢失」）：原按【端点】裁剪——长边两端都在视口外、但曲线中段
  //   穿过视口时，两端判定皆 false → 整条边被误删（视觉上「连线凭空消失」）。
  //   改为按【两端点包围盒】裁剪：边跨越视口即渲染，与曲线实际覆盖范围一致。
  // 必须 memo 化：这是 FreeEdgeLayer 路由 useMemo 的依赖项之一。
  // 若不 memo，任何重渲染（hover / 选中 / 面板开关）都会产出新数组，
  // 导致**全部边重算路由**（100 条边 ≈ 0.5s），并使路由回调自我触发成死循环。
  // 依赖取 view 的原始数值而非 view 对象 —— view 由 viewport.worldRect() 每次新建。
  const visibleFreeEdges = useMemo(() => {
    if (freeEdges.length === 0) return freeEdges;
    return freeEdges.filter((e) => {
      const sb = e.sourceId !== null ? derived.boxes.get(e.sourceId) : undefined;
      const tb = e.targetId !== null ? derived.boxes.get(e.targetId) : undefined;
      if (!sb && !tb) return true; // ghost / 端点未解析：数量少，恒渲染
      const inView = (b: Box): boolean =>
        b.x + b.w >= view.x - CULL_MARGIN &&
        b.x <= view.x + view.w + CULL_MARGIN &&
        b.y + b.h >= view.y - CULL_MARGIN &&
        b.y <= view.y + view.h + CULL_MARGIN;
      if (sb && tb) return inView(spanBoxOf(sb, tb));
      // 仅一端有盒（ghost 靶点）：按该端点判定
      return inView(sb ?? tb!);
    });
  }, [freeEdges, derived, view.x, view.y, view.w, view.h]);

  // C2：Canvas 模式（强制 或 >CANVAS_AUTO_NODES 自动降级）——场景树构建（世界坐标）
  const useCanvas = forceBackend === 'canvas' || layout.nodes.length > CANVAS_AUTO_NODES;
  const canvasScene = useCanvas
    ? buildSceneFromLayout({
        nodes: visibleNodes.map((ln) => ({
          id: ln.node.id,
          box: renderBoxOf(ln.node.id, ln.box),
          depth: ln.depth,
          text: ln.node.text ?? null,
          isEntity: ln.node.type === 'entity',
          entityKind: ln.node.type === 'entity' ? (ln.node.ref?.kind ?? null) : null,
          childCount: ln.node.children.length,
          collapsed: collapsedIds?.has(ln.node.id) ?? false,
          selected: selectedId === ln.node.id,
        })),
        links: visibleLinks.flatMap((l) => {
          const from = renderBoxOf(
            l.fromId,
            derived.boxes.get(l.fromId) ?? { x: 0, y: 0, w: 0, h: 0 },
          );
          const to = renderBoxOf(l.toId, derived.boxes.get(l.toId) ?? { x: 0, y: 0, w: 0, h: 0 });
          return [{ from, to, toId: l.toId }];
        }),
        branchColorOf: (id: string) => token.color.branches[derived.branchIndex.get(id) ?? 0],
        token,
      })
    : null;
  const viewMs = performance.now() - start;

  const root = useMemo(() => layout.nodes.find((n) => n.depth === 0), [layout]);
  const draggedLn = nodeDrag ? layout.nodes.find((n) => n.node.id === nodeDrag.nodeId) : undefined;

  // 首次尺寸就绪后自动适配。
  // 依赖 epoch（尺寸就绪经 setSize→notify→epoch+1）：初始挂载时 viewW 尚为 1，
  // 若不监听 epoch，RO 到达后该 effect 不会重跑，fit 将被永久跳过。
  useEffect(() => {
    if (viewport.viewW > 10 && !didInitialFit.current) {
      didInitialFit.current = true;
      viewport.fitBounds(layout.bounds);
    }
  }, [viewport, layout, epoch]);

  // 布局变化 → 节点位置过渡（M5-T2）：旧坐标 → 新坐标插值 + 新增淡入/删除淡出。
  // useLayoutEffect 保证无「跳变首帧」；动画由 FrameScheduler 链式 rAF 驱动，结束后立即休眠。
  // 大图保护（> NODE_ANIM_MAX_NODES）或系统「减少动态」→ 跳过动画直接落位（prev 快照仍更新）。
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = layout;
    if (!prev || prev === layout) return;
    if (
      prev.nodes.length > NODE_ANIM_MAX_NODES ||
      layout.nodes.length > NODE_ANIM_MAX_NODES ||
      prefersReducedMotion()
    ) {
      return;
    }
    frame.animate({
      from: toNodeFrame(prev.nodes),
      to: toNodeFrame(layout.nodes),
      duration: NODE_ANIM_MS,
      interpolate: lerpNodeFrame,
      onFrame: (nf) => setAnim(nf),
      onDone: () => setAnim(null),
    });
  }, [layout, frame]);

  // 拖拽期间：Esc 取消拖拽 + 全局禁用文本选择（M5-T5）；结束后恢复
  useEffect(() => {
    if (!nodeDrag) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setNodeDrag(null);
    };
    window.addEventListener('keydown', onKey);
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.userSelect = prevSelect;
    };
  }, [nodeDrag]);

  // E6：连接拖拽全局跟踪（move 更新引导线；up 命中目标 → onEdgeConnect；Esc 取消）
  useEffect(() => {
    if (!connectDrag) return;
    const toWorld = (cx: number, cy: number): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      return rect ? viewport.toWorld(cx - rect.left, cy - rect.top) : { x: 0, y: 0 };
    };
    const onMove = (e: PointerEvent): void => {
      const w = toWorld(e.clientX, e.clientY);
      let hoverId: string | null = null;
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const ln = layout.nodes[i]!;
        if (ln.node.id === connectDrag.sourceId) continue;
        if (nodeHitTest(ln.box, w.x, w.y, 6)) {
          hoverId = ln.node.id;
          break;
        }
      }
      setConnectDrag((c) => (c ? { ...c, x: w.x, y: w.y, hoverId } : c));
    };
    const onUp = (e: PointerEvent): void => {
      const w = toWorld(e.clientX, e.clientY);
      let target: string | null = null;
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const ln = layout.nodes[i]!;
        if (ln.node.id === connectDrag.sourceId) continue;
        if (nodeHitTest(ln.box, w.x, w.y, 6)) {
          target = ln.node.id;
          break;
        }
      }
      setConnectDrag(null);
      onEdgeConnectRef.current?.(connectDrag.sourceId, target, e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConnectDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectDrag, viewport, layout]);

  // 拖拽排除集：拖拽节点自身 + 其子树（不可作为落点目标）——子树悬停需可见反馈（warn），
  // 因此仅排除自身（子树目标仍可命中，由 planDrop 判非法 → 拒绝反馈）
  const dragExcluded = useMemo(() => (nodeDrag ? new Set([nodeDrag.nodeId]) : null), [nodeDrag]);

  // 视图变化 → 对外上报统计（T5 性能面板）。
  // 触发只绑定 epoch/layout（稳定值）；渲染体实时值经 ref 快照读取——
  // 避免把每帧变化的 viewMs/数组 identity 放入 deps 造成无限 setState 循环。
  const statsRef = useRef<MapStats>({
    epoch: 0,
    totalNodes: 0,
    visibleNodes: 0,
    visibleLinks: 0,
    lod: 'full',
    viewMs: 0,
  });
  statsRef.current = {
    epoch,
    totalNodes: layout.nodes.length,
    visibleNodes: visibleNodes.length,
    visibleLinks: visibleLinks.length,
    lod,
    viewMs,
  };
  useEffect(() => {
    onStatsRef.current?.(statsRef.current);
  }, [epoch, layout]);

  // 外部 API（fit / zoomBy / resetZoom / focusNode——M5-T3 全部平滑动画）
  useEffect(() => {
    const api: MapViewApi = {
      fit: () => viewport.fitBoundsAnimated(layout.bounds),
      zoomBy: (f) => viewport.zoomAt(viewport.viewW / 2, viewport.viewH / 2, f),
      resetZoom: () =>
        viewport.animateTo(
          { k: 1, x: viewport.viewW / 2, y: viewport.viewH / 2 },
          VIEWPORT_ANIM_MS,
        ),
      focusNode: (id) => {
        const ln = layout.nodes.find((n) => n.node.id === id);
        if (!ln) return;
        const { k } = viewport.transform;
        const cx = ln.box.x + ln.box.w / 2;
        const cy = ln.box.y + ln.box.h / 2;
        // 保持当前 k，将节点中心平移到视口中心（平移 + 缩放同时插值）
        viewport.animateTo(
          { k, x: viewport.viewW / 2 - cx * k, y: viewport.viewH / 2 - cy * k },
          VIEWPORT_ANIM_MS,
        );
      },
    };
    if (apiRef) apiRef.current = api;
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [viewport, layout, apiRef]);

  // 卸载清理：取消挂起帧（空闲零活动的收尾）
  useEffect(() => () => frame.dispose(), [frame]);

  // ---------- 交互：pan（拖拽 + 惯性阻尼）/ zoom（滚轮 + 越界回弹）/ fit（双击）/ 点选 ----------
  // 画布手势：四个处理器（Down / Move / Up / Cancel）与 pinch / dragRef 状态
  // 全部由 useMapGestures 承载（T2 第 3 小步，渐进迁移完成）。
  const { pinch, dragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } =
    useMapGestures({
      viewport,
      layout,
      visibleNodes,
      nodeDrag,
      setNodeDrag,
      dragExcluded,
      onNodeMove: (op) => onNodeMoveRef.current?.(op),
      onNodeClick: (ln, info) => onNodeClickRef.current?.(ln, info),
    });
  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // M5-T4：滚轮以光标为锚（zoomAt 锚点保持世界坐标不动）+ 越界软回弹
      viewport.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport]);

  if (root === undefined) return null;

  const { k, x, y } = viewport.transform;
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: token.color.canvas,
      }}
    >
      <div
        ref={wheelRef}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: token.color.canvasGlow,
          cursor: dragRef.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          // 拖拽文件进画布时的高亮提示（P1 上传管线）
          outline: fileDragActive ? `2px dashed ${token.color.selection}` : undefined,
          outlineOffset: -6,
        }}
        // 文件拖入 → 上传图库（P1）：dragover 阻止默认以允许 drop；drop 透传文件列表
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            if (!fileDragActive) setFileDragActive(true);
          }
        }}
        onDragLeave={() => setFileDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setFileDragActive(false);
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length > 0) onAssetFilesRef.current?.(files);
        }}
        // 粘贴图片/文件 → 上传图库
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length > 0) {
            e.preventDefault();
            onAssetFilesRef.current?.(files);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => {
          e.preventDefault();
          const w = worldPointOf(e, e.currentTarget, viewport);
          // 命中节点 → 传该节点；空白 → 传 null（两条分支合并为一）
          const ln = hitNodeAt(visibleNodes, w);
          onNodeContextRef.current?.(ln, e.clientX, e.clientY);
        }}
        onDoubleClick={(e) => {
          // 双击：命中 text 节点 → 请求进入编辑；空白/非 text → 平滑适配视图
          const w = worldPointOf(e, e.currentTarget, viewport);
          const ln = hitNodeAt(visibleNodes, w);
          if (ln) {
            if (ln.node.type === 'text') onEditStartRef.current?.(ln.node.id);
            return;
          }
          viewport.fitBoundsAnimated(layout.bounds);
        }}
      >
        {/* C2：Canvas 模式（forceBackend 或 >CANVAS_AUTO_NODES）——场景树 → 2D 画布；SVG 层让位。
            交互不依赖 DOM 元素：pointer 命中走坐标（nodeHitTest），编辑浮层为容器层 div */}
        {useCanvas ? (
          canvasScene !== null && (
            <CanvasSurface
              scene={canvasScene}
              width={viewport.viewW}
              height={viewport.viewH}
              transform={{ x, y, k }}
            />
          )
        ) : (
          <svg
            width={viewport.viewW}
            height={viewport.viewH}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            <g transform={`translate(${x} ${y}) scale(${k})`}>
              <g>
                {visibleLinks.map((ln) => {
                  const fromBox = derived.boxes.get(ln.fromId);
                  const toBox = derived.boxes.get(ln.toId);
                  if (!fromBox || !toBox) return null;
                  const palette = token.color.branches[derived.branchIndex.get(ln.toId) ?? 0];
                  // 连线随节点同步插值：端点取动画帧盒（防「节点动、线不动」脱节）
                  const p = buildLinkPath(
                    token,
                    renderBoxOf(ln.fromId, fromBox),
                    renderBoxOf(ln.toId, toBox),
                    palette,
                  );
                  // E7 审查修复：关系属性可见——chip 显示 label ?? rel ?? via（只填 rel 也可见）；
                  // note/完整属性走 hover <title>
                  const childNode = nodeByIdx.get(ln.toId);
                  const ann = childNode?.note?.edge as
                    | { rel?: string; label?: string; note?: string; style?: { color?: string } }
                    | undefined;
                  const annObj = typeof ann === 'object' && ann !== null ? ann : undefined;
                  const via =
                    typeof childNode?.note?.via === 'string' ? (childNode.note.via as string) : '';
                  const labelText = annObj?.label ?? annObj?.rel ?? via;
                  const chipStroke = annObj?.style?.color ?? p.stroke;
                  // 性能：cubicMidNormal 含正则解析——仅标注树边计算（无标注 = 无标签，跳过热路径）
                  const mid = labelText !== '' ? cubicMidNormal(p.d) : null;
                  return (
                    <g key={ln.path}>
                      {
                        backend.render(
                          backend.link({ d: p.d, stroke: p.stroke, strokeWidth: p.width }),
                        ) as ReactElement
                      }
                      {/* 仅右键触发编辑（左键保持画布平移，蒋指导反馈①）；hover <title> 呈现全部属性。
                        性能：低 LOD（缩小时）跳过命中区/chip——10px 透明命中区在缩小视图无交互价值且翻倍 DOM
                        E8：且仅在关系模式下挂载——浏览态树边不可编辑 */}
                      {onTreeEdgeEditRef.current && lod === 'full' && relationModeRef.current && (
                        <path
                          data-tree-edge-hit
                          data-tree-edge-child={ln.toId}
                          d={p.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={10}
                          style={{ pointerEvents: 'stroke' }}
                          onContextMenu={(e) => {
                            // 阻断冒泡：防止容器 onContextMenu 同时弹节点菜单（双浮窗冲突）
                            e.preventDefault();
                            e.stopPropagation();
                            onTreeEdgeEditRef.current?.(ln.toId, e.clientX, e.clientY);
                          }}
                        >
                          <title>
                            {[annObj?.rel ?? '（树形关系）', annObj?.note ?? '']
                              .filter(Boolean)
                              .join('\n')}
                          </title>
                        </path>
                      )}
                      {/* E8：关系标签「线中生长」——触点（线上小芽）+ 短茎 + 小胶囊（字号 10/高 14） */}
                      {labelText && mid && (
                        <g data-tree-edge-label>
                          <EdgeLabel
                            ax={mid.x}
                            ay={mid.y}
                            nx={mid.nx}
                            ny={mid.ny}
                            text={labelText}
                            stroke={chipStroke}
                            token={token}
                          />
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
              {/* E5：自由边叠加层（树形之上的文档级标注边；仅 SVG 后端） */}
              {!useCanvas && visibleFreeEdges.length > 0 && rootNode && (
                <FreeEdgeLayer
                  edges={visibleFreeEdges}
                  // E8 P0：端点无盒必须返回 undefined（原退化成零盒 → 边被拉向世界原点，视觉「位置不对」）
                  boxOf={edgeBoxOf}
                  root={rootNode}
                  collapsed={collapsedIds ?? EMPTY_COLLAPSED}
                  token={token}
                  selectedKey={selectedEdgeKey}
                  onSelect={(edge, sx, sy) => onEdgeClickRef.current?.(edge, sx, sy)}
                  interactive={relationMode}
                  // E8：避障路由（低 LOD 时为空数组 → 自动退化为原贝塞尔）
                  obstacles={edgeObstacles}
                  // Issue #3：手动覆盖（拖端点 / bend；双击 bend 恢复自动优化）
                  toWorld={toWorld}
                  onManualChange={(edge, manual) => onEdgeManualChangeRef.current?.(edge, manual)}
                  onRoutesChange={handleRoutesChange}
                />
              )}
              <g>
                {visibleNodes.map((ln) => {
                  const m = derived.metrics.get(ln.node.id);
                  if (!m) return null;
                  const palette =
                    token.color.branches[derived.branchIndex.get(ln.node.id) ?? 0] ??
                    token.color.branches[0]!;
                  const entityKind = ln.node.type === 'entity' ? (ln.node.ref?.kind ?? null) : null;
                  const style = nodeCardStyle(
                    token,
                    palette,
                    ln.depth >= 2 ? 'leaf' : 'branch',
                    entityKind,
                  );
                  const isDragged = nodeDrag?.nodeId === ln.node.id;
                  return (
                    <NodeG
                      key={ln.node.id}
                      node={ln}
                      style={style}
                      metrics={m}
                      token={token}
                      depth={ln.depth}
                      root={ln.depth === 0}
                      chipX={entityKind !== null ? chipXOf(m, char) : null}
                      // 编辑态不画 SVG 文字：内联编辑器（NodeTextOverlay）是浮在节点盒上的
                      // <input>，两层文字会同时可见并互相穿插——
                      // 暗色主题下编辑器底色只有 7% 不透明度（entityFill:
                      // rgba(255,255,255,.07)），底下的 SVG 文字会直接透出来。
                      // 编辑时让 <input> 独占文字层，节点盒本体仍照常绘制（提供底色）。
                      noText={lodSkipText(lod, ln.depth) || ln.node.id === editingId}
                      selected={selectedId === ln.node.id}
                      hasChildren={ln.node.children.length > 0}
                      collapsed={collapsedIds?.has(ln.node.id) ?? false}
                      onToggleCollapse={
                        onToggleCollapseRef.current && ln.node.children.length > 0 && ln.depth > 0
                          ? () => onToggleCollapseRef.current?.(ln.node.id)
                          : undefined
                      }
                      expanded={expandedId === ln.node.id}
                      bodyHeight={
                        expandedId === ln.node.id ? Math.max(0, ln.box.h - commentAreaH) : undefined
                      }
                      assetBaseUrl={assetBaseUrl}
                      // 拖拽中：原节点置灰（透明度降），浮空克隆跟随光标；落点目标高亮（合法/拒绝）
                      anim={
                        isDragged
                          ? {
                              x: ln.box.x,
                              y: ln.box.y,
                              w: ln.box.w,
                              h: ln.box.h,
                              opacity: 0.45,
                              scale: 1,
                            }
                          : animBoxes?.get(ln.node.id)
                      }
                      dragTarget={
                        nodeDrag?.moved && nodeDrag.targetId === ln.node.id
                          ? nodeDrag.valid
                            ? 'valid'
                            : 'invalid'
                          : undefined
                      }
                    />
                  );
                })}
              </g>
              {/* 淡出中的被删节点（M5-T2 ghost）：动画期间随帧淡出，结束后随 anim 清空移除 */}
              {visibleGhosts.length > 0 && (
                <g data-ghost-group>
                  {visibleGhosts.map((g) => {
                    const a = animBoxes?.get(g.node.id);
                    if (!a) return null;
                    const m = derived.metrics.get(g.node.id) ?? derived.metricFn(g.node);
                    const palette =
                      token.color.branches[derived.branchIndex.get(g.node.id) ?? 0] ??
                      token.color.branches[0]!;
                    const entityKind = g.node.type === 'entity' ? (g.node.ref?.kind ?? null) : null;
                    const style = nodeCardStyle(
                      token,
                      palette,
                      g.depth >= 2 ? 'leaf' : 'branch',
                      entityKind,
                    );
                    return (
                      <NodeG
                        key={`ghost-${g.node.id}`}
                        node={g}
                        style={style}
                        metrics={m}
                        token={token}
                        depth={g.depth}
                        root={g.depth === 0}
                        chipX={entityKind !== null ? chipXOf(m, char) : null}
                        noText={lodSkipText(lod, g.depth)}
                        hasChildren={g.node.children.length > 0}
                        collapsed={collapsedIds?.has(g.node.id) ?? false}
                        anim={a}
                      />
                    );
                  })}
                </g>
              )}
              {/* M5-T5：拖拽浮空克隆（跟随光标，置顶） */}
              {nodeDrag?.moved && draggedLn && (
                <g data-drag-layer style={{ pointerEvents: 'none' }}>
                  <g data-drag-clone>
                    <NodeG
                      node={draggedLn}
                      style={nodeCardStyle(
                        token,
                        token.color.branches[derived.branchIndex.get(draggedLn.node.id) ?? 0] ??
                          token.color.branches[0]!,
                        draggedLn.depth >= 2 ? 'leaf' : 'branch',
                        draggedLn.node.type === 'entity'
                          ? (draggedLn.node.ref?.kind ?? null)
                          : null,
                      )}
                      metrics={
                        derived.metrics.get(draggedLn.node.id) ?? derived.metricFn(draggedLn.node)
                      }
                      token={token}
                      depth={draggedLn.depth}
                      root={draggedLn.depth === 0}
                      chipX={
                        draggedLn.node.type === 'entity' && draggedLn.node.ref?.kind
                          ? chipXOf(
                              derived.metrics.get(draggedLn.node.id) ??
                                derived.metricFn(draggedLn.node),
                              char,
                            )
                          : null
                      }
                      noText={lodSkipText(lod, draggedLn.depth)}
                      hasChildren={draggedLn.node.children.length > 0}
                      collapsed={collapsedIds?.has(draggedLn.node.id) ?? false}
                      anim={{
                        x: draggedLn.box.x + nodeDrag.dx / k,
                        y: draggedLn.box.y + nodeDrag.dy / k,
                        w: draggedLn.box.w,
                        h: draggedLn.box.h,
                        opacity: 0.85,
                        scale: 1,
                      }}
                    />
                  </g>
                  {/* 落点指示器：child → 目标虚线环；before/after → 目标边缘插入线（合法 selection / 拒绝 warn） */}
                  {nodeDrag.targetId &&
                    (() => {
                      const t = layout.nodes.find((n) => n.node.id === nodeDrag.targetId);
                      if (!t) return null;
                      const stroke = nodeDrag.valid ? token.color.selection : token.color.warn;
                      if (nodeDrag.mode === 'child') {
                        return (
                          <g data-drop-indicator>
                            <rect
                              x={t.box.x - 4}
                              y={t.box.y - 4}
                              width={t.box.w + 8}
                              height={t.box.h + 8}
                              rx={token.radius.node + 4}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={2}
                              strokeDasharray="5 3"
                            />
                          </g>
                        );
                      }
                      const iy = nodeDrag.mode === 'before' ? t.box.y - 5 : t.box.y + t.box.h + 5;
                      return (
                        <g data-drop-indicator>
                          <line
                            x1={t.box.x - 6}
                            y1={iy}
                            x2={t.box.x + t.box.w + 6}
                            y2={iy}
                            stroke={stroke}
                            strokeWidth={2}
                          />
                        </g>
                      );
                    })()}
                </g>
              )}
              {/* E7：连接手柄（选中节点；加大命中区 + 卡外偏移；拖拽中悬停目标高亮）
                E8：仅关系模式挂载——浏览态不暴露连线入口 */}
              {!useCanvas &&
                selectedId != null &&
                relationModeRef.current &&
                (() => {
                  const ln = layout.nodes.find((n) => n.node.id === selectedId);
                  if (!ln) return null;
                  const box = renderBoxOf(ln.node.id, ln.box);
                  const hx = ln.side === -1 ? box.x - 6 : box.x + box.w + 6;
                  const hy = box.y + box.h / 2;
                  const hover = connectDrag?.hoverId
                    ? layout.nodes.find((n) => n.node.id === connectDrag.hoverId)
                    : null;
                  return (
                    <g data-connect-handle-group>
                      {connectDrag && hover && (
                        <rect
                          data-connect-target
                          x={hover.box.x - 5}
                          y={hover.box.y - 5}
                          width={hover.box.w + 10}
                          height={hover.box.h + 10}
                          rx={token.radius.node + 5}
                          fill="none"
                          stroke={token.color.selection}
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      {connectDrag && (
                        <line
                          data-connect-guide
                          x1={hx}
                          y1={hy}
                          x2={connectDrag.x}
                          y2={connectDrag.y}
                          stroke={token.color.selection}
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      <circle
                        data-connect-handle-hit
                        cx={hx}
                        cy={hy}
                        r={16}
                        fill="transparent"
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          viewport.cancelAnim();
                          const rect = containerRef.current?.getBoundingClientRect();
                          const w = rect
                            ? viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top)
                            : { x: hx, y: hy };
                          setConnectDrag({ sourceId: selectedId, x: w.x, y: w.y, hoverId: null });
                        }}
                      />
                      <circle
                        data-connect-handle
                        cx={hx}
                        cy={hy}
                        r={8}
                        fill={token.color.selection}
                        stroke={token.color.canvas}
                        strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    </g>
                  );
                })()}
            </g>
          </svg>
        )}
        {/* 文本内联编辑 overlay：屏幕坐标定位（F2 → editingId） */}
        {editingId != null && (
          <NodeTextOverlay
            editingId={editingId}
            layout={layout}
            viewport={viewport}
            token={token}
            onCommit={onEditCommitRef.current}
            onCancel={onEditCancelRef.current}
            // v1.3.0：主题编辑态 Shift+Enter → 切到该节点描述编辑
            onDescEditRequest={(id) => onDescEditRequestRef.current?.(id)}
          />
        )}
        {/* 快速注释"生长"：展开节点在下方渲染注释区（连体 + 内置滚动；锚定节点屏幕位置） */}
        {expandedId != null && (
          <ExpandCommentOverlay
            expandedId={expandedId}
            layout={layout}
            viewport={viewport}
            token={token}
            onChange={(qa) => onQaChangeRef.current?.(expandedId, qa)}
            onClose={() => onToggleExpandRef.current?.(expandedId)}
          />
        )}
        {/* v1.3.0 幕布描述：视口内凡有 note.desc 的节点在下方渲染引用块（默认收缩一行，点击展开） */}
        <DescOverlays
          visible={visibleNodes}
          viewport={viewport}
          token={token}
          descEditingId={descEditingId}
          descExpandedIds={descExpandedIds}
          onToggle={(id) => onDescToggleRef.current?.(id)}
          onCommit={(id, t) => onDescCommitRef.current?.(id, t)}
          onCancel={() => onDescCancelRef.current?.()}
        />
      </div>
    </div>
  );
}

/** 实体 kind chip 起点（contentX - kindW - 6；与内核 displayMetrics 排版一致） */
function chipXOf(m: { contentX: number; kindLabel: string | null }, char: CharMeasure): number {
  if (!m.kindLabel) return 0;
  return m.contentX - (char(m.kindLabel) + 10) - 6;
}

/** 两盒的包围盒（并集；边跨度裁剪用——覆盖连线经过的全部区域） */
function spanBoxOf(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** 三次贝塞尔 d 串 → t=0.5 中点（树边标签 chip 锚定） */
