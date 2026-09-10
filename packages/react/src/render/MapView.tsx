/**
 * MapView：渲染核心主体（dirty-flag 按需渲染 + 视口裁剪 + LOD）。
 * 调度纪律（硬验收：空闲 CPU ≈ 0，禁永续 rAF）：
 * - 视口变换（pan/zoom/fit）→ notify() → 脏标记 ∈ FrameScheduler（单帧 rAF，帧内合批；同帧多次变更只渲染一次）
 * - 无交互时零 rAF / 零 timer 挂起——空闲零活动
 * - 数据更改（新 layout）→ 派生 memo 重算 + epoch 触发一帧
 * 组件/几何分离：几何与命中检测在 geometry.ts（纯函数），本组件只做组装。
 */

import { hasNote, noteOf, resolveSections } from '@mindcanvas/kernel';
import type { CharMeasure, EditableNode, Entity, GrowDir } from '@mindcanvas/kernel';
import {
  type Box,
  type BoundaryLink,
  filterVisibleLinks,
  isBoxInView,
  type LayoutNode,
  type LayoutResult,
  type TreeOp,
} from '@mindcanvas/kernel';
import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DescBlock, estimateDescHeight } from '../chrome/DescBlock.js';
import { FLOATING_NOTE_GAP, NotePopover } from '../chrome/NotePopover.js';
import { estimateNoteAreaHeight } from '../chrome/NoteGrowthPanel.js';
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
import { collectDeclaredGrowDir } from './growDir.js';
import { fixedNotePanelsOf, noteLodFor } from './fixedNotePanels.js';
import type { LodLevel } from './geometry.js';
import {
  buildLinkPath,
  computeBranchIndex,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
  verticalBeamMap,
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
import { nodeAuxiliaryRegions } from './nodeAuxiliary.js';
import { SectionLayer } from './SectionLayer.js';
import { buildSectionViews, type SectionView } from './sectionFrames.js';
import { type DropMode, dropModeFor, planDrop } from './nodeDrag.js';
import { commentAreaH, DescOverlays, ExpandCommentOverlay, NodeTextOverlay } from './overlays.js';
import { PinchTracker } from './pinch.js';
import { buildSceneFromLayout, resolveBackend } from './sceneBuilder.js';
import { FrameScheduler } from './scheduler.js';
import { lerpNodeFrame, type NodeFrame, toNodeFrame } from './transition.js';
import { hitNodeAt, useMapGestures, worldPointOf } from './useMapGestures.js';
import {
  dropGlyph,
  dropHint,
  senseDropTarget,
  type DropBox,
  type DropTarget,
} from './dropSensing.js';
import { estimatePanVelocity, type PanSample, ViewportController } from './viewport.js';

export interface MapViewProps {
  layout: LayoutResult;
  /**
   * G6′复审修复：完整文档树根（controller.root）。
   * 文档级自由边（root.note.edges）收集与 FreeEdgeLayer 折叠祖先解析必须读完整内容树——
   * 森林/多中心投影下 layout.nodes 存在多个 depth===0 几何根（甚至不含文档根本身），
   * 不能从布局结果推断文档根。缺省回退首个几何根（旧单树布局下二者一致，兼容既有调用方）。
   */
  documentRoot?: EditableNode;
  /**
   * G6″（A3-2/G3）：跨岛父子连接（真实父子关系跨岛、且中心条目 parent_link: 'show'）。
   * 不参与自动布局，仅渲染为虚线连接（与树线/自由边视觉区分）。
   * 已知边界：Canvas 模式不渲染（与自由边同类限制），含本功能文档的 Canvas 门禁归 A6。
   */
  boundaryLinks?: readonly BoundaryLink[];
  /**
   * G6″（A4）：岛根 id → 岛成员 id 列表（含岛根自身）。
   * 中心拖动的实时整岛预览据此平移全部成员（节点卡、本地树线、跨岛线端点、附属区定位）。
   */
  islandMembers?: ReadonlyMap<string, readonly string[]>;
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
  /** 点击画布空白（未命中节点）：取消选中 / 收起放大展开 */
  onBlankClick?: () => void;

  // ---- 节点注释浮窗（v1.4.0）----
  /** 当前悬停的节点 id（由本组件内部命中检测维护） */
  onNoteHover?: (id: string | null) => void;
  /** 固定显示的 note 笔记节点 id（null = 无） */
  pinnedNoteId?: string | null;
  /** 可同时固定多个节点注释 */
  pinnedNoteIds?: readonly string[];
  /** 处于编辑态的已固定 note 笔记 */
  editingNoteIds?: readonly string[];
  /** 注释写回：序列区域 */
  onNoteChangeSeq?: (id: string, seq: string[]) => void;
  /** 注释写回：纯文本区域 */
  onNoteChangeText?: (id: string, text: string) => void;
  /** 关闭 note 笔记（点 x 或点空白） */
  onNoteClose?: (id?: string) => void;
  onNotePin?: (id: string) => void;
  /** 节点右键（hit-test；空白处命中 null；带屏幕坐标） */
  onNodeContext?: (node: LayoutNode | null, sx: number, sy: number) => void;
  /** 选中节点 id（高亮；null = 无） */
  selectedId?: string | null;
  /** 正在编辑的节点 id（渲染文本内联输入框） */
  editingId?: string | null;
  onEditCommit?: (id: string, text: string) => void;
  onEditCancel?: () => void;
  /**
   * G10：编辑态 Tab —— 提交 (id, text) 后建子节点并进入新节点编辑。
   * 未注入时 Tab 不启用连续生长（向后兼容）。
   */
  onEditTabGrow?: (id: string, text: string) => void;
  /** G6′：中心节点 id 集合（这些节点拖拽 = 移动坐标而非改树结构） */
  centerIds?: ReadonlySet<string>;
  /** G6′：中心拖拽结束 —— (id, 世界 dx, 世界 dy) */
  onCenterMove?: (id: string, worldDx: number, worldDy: number) => void;
  /** 双击节点请求进入编辑（仅 text 类型命中回调；由上层决定 select+startEdit） */
  onEditStart?: (id: string) => void;
  /** 折叠集合（缺省无折叠） */
  collapsedIds?: ReadonlySet<string>;
  onToggleCollapse?: (id: string) => void;
  /** v1.5.0 Section：幽灵态（dangling）一键清理——从根 note.sections 移除该条目（T4 接线） */
  onRemoveSection?: (sectionId: string) => void;
  /** 展开态节点 id（快速注释"生长"：节点向下变宽变高参与布局；null = 无展开） */
  expandedId?: string | null;
  /** 点击节点展开/收起（由上层决定 expandedId） */
  onToggleExpand?: (id: string) => void;
  /** 写回展开节点（或选中节点）的 note.qa 数组 */
  onQaChange?: (id: string, qa: string[]) => void;
  /** 资产基础 URL（透传给 NodeG：@img/@draw 实体渲染 <image> 预览时拼接；缺省不渲染） */
  assetBaseUrl?: string;
  /** 资产 URL 宿主解析（P0-1，透传 NodeG）：优先于 assetBaseUrl 拼接；undefined 回落拼接 */
  resolveAssetUrl?: (ref: { kind: string; id: string }) => string | undefined;
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
  /**
   * 带落点语义的素材投放（FA2-T3）：拖放时按光标所处区域判定
   * `icon`（文本核心）/ `media`（上下边缘）/ `child`（右侧桩）/ `free`（空白）。
   * 提供本回调时优先于 `onAssetFiles`；未提供的老调用方行为不变。
   */
  onAssetDrop?: (files: File[], target: DropTarget) => void;
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
/** 空折叠集常量。
 * 原先写 `collapsedIds ?? new Set()` —— 每次渲染都造一个新 Set，
 * 会让 `FreeEdgeLayer` 的路由 useMemo 依赖失效，**每次重渲染都把全部边重算一遍路由**
 * （100 条边 ≈ 0.5s），并且路由回调会自我触发形成死循环。此处固定为空集单例。
 */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();
const EMPTY_SECTION_VIEWS: readonly SectionView[] = [];

/** 避障障碍条目（节点 id + 世界坐标盒；动画期按 id 排除端点自身，见 FreeEdgeLayer 注释） */
export interface EdgeObstacleEntry {
  id: string;
  box: Box;
}

/**
 * P2-1 · 边避障障碍集决策（纯函数，可单测）。
 * 动画进行中（animating）或低 LOD（非 full）→ 传空数组关闭寻路：
 * routeAesthetic 自动走 S 形/直连快路径，成本从 O(E×锚点×曲率×采样×障碍) 降到 O(E)；
 * 动画是瞬态过渡，路由观感让步帧率，动画结束回到全速路由。
 */
export function edgeObstaclesOf(
  layout: { nodes: readonly { node: { id: string }; box: Box }[] },
  lod: LodLevel,
  animating: boolean,
): readonly EdgeObstacleEntry[] {
  if (animating || lod !== 'full') return [];
  return layout.nodes.map((ln) => ({ id: ln.node.id, box: ln.box }));
}

export function MapView({
  layout,
  documentRoot,
  boundaryLinks,
  islandMembers,
  entities,
  char,
  apiRef,
  forceBackend,
  onStats,
  onNodeClick,
  onBlankClick,
  onNoteHover,
  pinnedNoteId = null,
  pinnedNoteIds,
  editingNoteIds,
  onNoteChangeSeq,
  onNoteChangeText,
  onNoteClose,
  onNotePin,
  selectedId,
  editingId,
  onEditCommit,
  onEditCancel,
  onEditTabGrow,
  centerIds,
  onCenterMove,
  collapsedIds,
  onToggleCollapse,
  onRemoveSection,
  expandedId,
  onToggleExpand,
  onQaChange,
  onNodeContext,
  onEditStart,
  assetBaseUrl,
  resolveAssetUrl,
  onNodeMove,
  onAssetFiles,
  onAssetDrop,
  selectedEdgeKey,
  onEdgeClick,
  onEdgeManualChange,
  onEdgeRoutes,
  onTreeEdgeEdit,
  onEdgeConnect,
  relationMode = false,
  descEditingId = null,
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
  const onBlankClickRef = useRef(onBlankClick);
  const onNoteHoverRef = useRef(onNoteHover);
  onNoteHoverRef.current = onNoteHover;
  const onNoteCloseRef = useRef(onNoteClose);
  onNoteCloseRef.current = onNoteClose;
  /** 悬停中的节点 + 指针屏幕坐标（供预览定位；指针移动时更新坐标） */
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  /**
   * 悬停预览是独立浮窗；固定 note 笔记由布局预留区渲染，不在这里处理。
   */
  /**
   * note 的缩放档位（与几何 LOD 是两套：几何 LOD 管文本/命中区，这里管 note DOM 生不生成）。
   *   full  → 固定卡片 + 悬停浮窗
   *   badge → 只留角标，悬停仍以屏幕浮窗预览
   *   none  → note DOM 全剔除（正在编辑的除外，见下）
   */
  const noteLod = noteLodFor(viewport.transform.k);
  /**
   * 悬停预览恒为**屏幕空间浮窗**（宽度/字号固定，不随 k 缩放）——
   * 此前宽度取 `box.w * k`，画布缩小到 0.4 时浮窗被压成细条、文字撑爆容器。
   * anchorTop 供浮窗在空间不足时翻转到节点上方。
   */
  const noteTargets = useMemo(() => {
    const pinnedIds = pinnedNoteIds ?? (pinnedNoteId ? [pinnedNoteId] : []);
    const targets: { id: string; ln: LayoutNode; pinned: false }[] = [];
    if (hover && !pinnedIds.includes(hover.id)) {
      const ln = layout.nodes.find((n) => n.node.id === hover.id);
      if (ln && hasNote(ln.node)) targets.push({ id: hover.id, ln, pinned: false });
    }
    // 鸟瞰档：连悬停预览也不生成（DOM 与视觉噪点一起剔除）
    if (noteLod === 'none') return [];
    return targets.map(({ id, ln, pinned }) => {
      const { k, x: tx, y: ty } = viewport.transform;
      return {
        id,
        data: noteOf(ln.node),
        pinned,
        x: ln.box.x * k + tx,
        y: (ln.box.y + ln.box.h) * k + ty + FLOATING_NOTE_GAP,
        anchorTop: ln.box.y * k + ty,
        // 浮窗宽度对齐节点、字号不大于节点字号（屏幕口径：世界值 × k）
        nodeWidth: ln.box.w * k,
        nodeFontSize: nodeFontOf(token, ln.depth) * k,
      };
    });
  }, [pinnedNoteId, pinnedNoteIds, hover, layout, viewport.transform, noteLod, token]);
  const fixedNoteIds = useMemo(
    () => new Set(pinnedNoteIds ?? (pinnedNoteId ? [pinnedNoteId] : [])),
    [pinnedNoteId, pinnedNoteIds],
  );
  const editingNoteIdSet = useMemo(() => new Set(editingNoteIds), [editingNoteIds]);
  const view = viewport.worldRect(CULL_MARGIN);
  /**
   * 固定卡片只在 full 档位生成（badge/none 档位不挂载大卡片，只留角标）。
   *
   * 唯一例外：**正在编辑**的面板在任何档位都保留 —— 编辑态会自动升级为屏幕浮窗
   * （见 NotePopover 的 NOTE_EDIT_FLOAT_K），否则用户缩一下画布就会丢掉正在输入的内容。
   */
  const fixedNotePanels = useMemo(() => {
    if (noteLod !== 'full' && editingNoteIdSet.size === 0) return [];
    const panels = fixedNotePanelsOf(
      layout,
      fixedNoteIds,
      editingNoteIdSet,
      view,
      viewport.transform,
      estimateNoteAreaHeight(),
    );
    return noteLod === 'full' ? panels : panels.filter((p) => p.editing);
  }, [editingNoteIdSet, fixedNoteIds, layout, view, viewport.transform, noteLod]);
  onNodeClickRef.current = onNodeClick;
  onBlankClickRef.current = onBlankClick;
  const onNodeContextRef = useRef(onNodeContext);
  onNodeContextRef.current = onNodeContext;
  const onEditCommitRef = useRef(onEditCommit);
  onEditCommitRef.current = onEditCommit;
  const onEditCancelRef = useRef(onEditCancel);
  onEditCancelRef.current = onEditCancel;
  const onEditTabGrowRef = useRef(onEditTabGrow);
  onEditTabGrowRef.current = onEditTabGrow;
  const onCenterMoveRef = useRef(onCenterMove);
  onCenterMoveRef.current = onCenterMove;
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
  const onAssetDropRef = useRef(onAssetDrop);
  onAssetDropRef.current = onAssetDrop;
  // 可见节点镜像（供 senseAt 读取；见其注释里的 TDZ 说明）
  const visibleNodesRef = useRef<readonly (typeof layout.nodes)[number][]>([]);
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
  // E8：几何根以 depth===0 定位（原用 layout.nodes[0] 假定有序——折叠路由会算错祖先）
  const geometricRoot = useMemo(() => layout.nodes.find((n) => n.depth === 0)?.node, [layout]);
  // G6′复审修复：文档根 ≠ 几何根。森林/多中心投影下 layout.nodes 可有多个 depth===0
  // 几何根（layoutForest 甚至不输出文档根），collectFreeEdges 与 FreeEdgeLayer 的折叠
  // 祖先解析必须读【完整内容树】。显式 documentRoot 优先；缺省回退首个几何根
  // （旧单树布局下二者一致，兼容既有调用方与测试——MindmapStage 等产品壳必须显式传入）。
  const rootNode = documentRoot ?? geometricRoot;
  const freeEdges = useMemo(() => (rootNode ? collectFreeEdges(rootNode) : []), [rootNode]);

  // G6′ 用户回归：声明方向覆盖几何判据。全树声明方向（自身显式 ?? 最近显式祖先；岛默认
  // 不充当声明——中心节点特化）——铺宽的上分支组外侧子节点虽与父盒无 x 重叠，仍必须从
  // 父顶边中心出发梁线；而均衡模式下根左侧的无声明子节点不被岛 'right' 顶死右缘（否则
  // 连线横穿中心节点），回退几何自适应贴左缘。
  const growDirOf = useMemo(
    () => (rootNode ? collectDeclaredGrowDir(rootNode) : new Map<string, GrowDir>()),
    [rootNode],
  );

  // 文件拖入画布高亮（P1）
  const [fileDragActive, setFileDragActive] = useState(false);
  // FA2-T3：拖放落点预览（松手前即可预知会被设成图标/插图/子分支/自由节点）
  const [dropPreview, setDropPreview] = useState<{
    target: DropTarget;
    sx: number;
    sy: number;
  } | null>(null);

  /**
   * 落点判定（FA2-T3）：世界坐标 → 命中哪个节点、落在它的哪一块。
   *
   * 用 ref 读 visibleNodes 而非闭包：本函数在组件靠前处定义，
   * 而 `visibleNodes` 要到下面才声明（TDZ）—— 直接引用会编译不过。
   * ref 每渲染同步，读到的始终是当前帧的可见节点。
   */
  const senseAt = useCallback(
    (e: { clientX: number; clientY: number }, el: Element | null): DropTarget | null => {
      if (!el) return null;
      const w = worldPointOf(e, el, viewport);
      const boxes = visibleNodesRef.current.map((ln) => ({
        id: ln.node.id,
        box: { x: ln.box.x, y: ln.box.y, w: ln.box.w, h: ln.box.h } satisfies DropBox,
      }));
      return senseDropTarget(boxes, w);
    },
    [viewport],
  );

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
  // P2-1：动画期（animating）同样置空 → 路由走 S 形/直连快路径，并配合 FreeEdgeLayer
  // fastRouting 跳过交叉检测/跳线，避免动画每帧触发 O(E×A×C×S×O) + O(E²×P²) 的重算。
  const animating = anim !== null;
  const edgeObstacles = useMemo(
    () => edgeObstaclesOf(layout, lod, animating),
    [layout, lod, animating],
  );
  const start = performance.now();
  // 渲染盒 = 动画帧优先（M5-T2 过渡中）/ 布局盒（静止）
  const animBoxes = anim?.boxes;

  // G6″（A4）：中心岛拖动实时预览——拖动位移（屏幕 px）按当前缩放换算为世界位移，
  // 成员盒在唯一出口 renderBoxOf 上统一平移（节点卡/树线端点/裁剪/附属区派生自动跟随）。
  // 预览是纯会话态：不写 note、不进 history；提交/取消由手势层负责（design §7）。
  const centerPreview = useMemo(() => {
    if (!nodeDrag?.moved || !centerIds?.has(nodeDrag.nodeId) || !islandMembers) return null;
    const members = islandMembers.get(nodeDrag.nodeId);
    if (!members || members.length === 0) return null;
    const k = viewport.transform.k > 0 ? viewport.transform.k : 1;
    return { dx: nodeDrag.dx / k, dy: nodeDrag.dy / k, members: new Set(members) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDrag, centerIds, islandMembers, viewport.transform.k]);

  const renderBoxOf = (id: string, fallback: Box): Box => {
    const base = animBoxes?.get(id) ?? fallback;
    if (centerPreview && centerPreview.members.has(id)) {
      return { ...base, x: base.x + centerPreview.dx, y: base.y + centerPreview.dy };
    }
    return base;
  };

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

  // v1.5.0 Section 空间分区（T3）：解析根 note.sections → 帧模型（背景层，位于连线/节点之下）。
  // 纯渲染投影：不进 layout.nodes（不参与节点裁剪）、不污染 layout.bounds（fit 无回归）。
  // 成员清单优先岛成员（islandMembers），缺省回退内容树子树；取盒经 renderBoxOf 包装——
  // 中心拖拽预览偏移经 deps 传入，框随预览实时跟随（与节点/连线同一数据源）。
  const sectionViews = useMemo(() => {
    if (rootNode === undefined || !rootNode.note?.sections) return EMPTY_SECTION_VIEWS;
    const contentRoot: EditableNode = rootNode;
    const resolved = resolveSections(contentRoot);
    if (resolved.length === 0) return EMPTY_SECTION_VIEWS;
    // 内容树索引：子树成员与标题（岛成员缺失时兜底；含折叠隐藏的成员——AABB 只取有盒者，
    // memberCount 仍计全量子树，折叠徽标 +N 由此而来）
    const subtreeCache = new Map<string, string[]>();
    const titleCache = new Map<string, string>();
    const walk = (n: EditableNode): string[] => {
      const ids: string[] = [n.id];
      if (n.type === 'text' && n.text) titleCache.set(n.id, n.text);
      else if (n.type === 'entity' && n.ref) titleCache.set(n.id, `@${n.ref.kind}:${n.ref.id}`);
      for (const c of n.children) ids.push(...walk(c));
      subtreeCache.set(n.id, ids);
      return ids;
    };
    walk(contentRoot);
    return buildSectionViews({
      resolved,
      titleOf: (id) => titleCache.get(id) ?? id,
      memberIdsOf: (id) => islandMembers?.get(id) ?? subtreeCache.get(id) ?? [id],
      boxOf: (id) => {
        const b = derived.boxes.get(id);
        return b ? renderBoxOf(id, b) : undefined;
      },
      collapsedIds: collapsedIds ?? EMPTY_COLLAPSED,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootNode, islandMembers, derived, collapsedIds, animBoxes, centerPreview]);

  // Section 选中态（会话态；T5 接 Esc/空白退出三件套）
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  // v1.5.0 Section 标题栏拖拽（T4）：等价于「按住中心节点本体」——注入同一 nodeDrag，
  // 后续 pointermove/pointerup 由既有手势层接管（centerPreview 实时预览 + 单次 onCenterMove 提交
  // + Esc 零调用，全部沿用 mapview-center-drag 既有语义，零新写回通道）。
  // D1 守卫：root 非 center（手写 YAML 可能）→ 不启动拖拽（否则退化为节点重排，语义错误）。
  const handleSectionTitlePointerDown = (
    rootId: string,
    e: ReactPointerEvent<SVGGElement>,
  ): void => {
    if (!centerIds?.has(rootId)) return;
    viewport.cancelAnim();
    setNodeDrag({
      nodeId: rootId,
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
    e.stopPropagation();
  };
  // A4：节点卡（NodeG）直接读 ln.box——预览成员在此产出偏移副本（浅拷贝，children 引用共享）。
  const visibleNodes = layout.nodes
    .filter((n) => isBoxInView(renderBoxOf(n.node.id, n.box), view, CULL_MARGIN))
    .map((ln) => {
      if (!centerPreview || !centerPreview.members.has(ln.node.id)) return ln;
      return {
        ...ln,
        box: { ...ln.box, x: ln.box.x + centerPreview.dx, y: ln.box.y + centerPreview.dy },
      };
    });
  visibleNodesRef.current = visibleNodes;
  // 淡出中的被删节点（ghost）：仅动画期间存在，参与裁剪但不计入 stats
  const visibleGhosts =
    anim?.ghosts.filter((g) =>
      isBoxInView(animBoxes?.get(g.node.id) ?? g.box, view, CULL_MARGIN),
    ) ?? [];
  const visibleLinks = filterVisibleLinks(layout.links, derived.boxes, view, CULL_MARGIN);

  // G6′ 垂直连线共享梁：up/down 方向组共用一条水平梁（与内核 makeLinkByDir 公式一致）。
  // 每帧以当前（动画期 = 插值）盒重算分组 → 梁随节点动画同步；O(n)，与逐帧路径构建同阶。
  // dir：声明方向（growDirOf）——声明 up/down 时无视 x 重叠与否，一律并入垂直组。
  const visibleLinkGeoms = visibleLinks.flatMap((ln) => {
    const fb = derived.boxes.get(ln.fromId);
    const tb = derived.boxes.get(ln.toId);
    if (!fb || !tb) return [];
    return [
      {
        ln,
        fromId: ln.fromId,
        from: renderBoxOf(ln.fromId, fb),
        to: renderBoxOf(ln.toId, tb),
        dir: growDirOf.get(ln.toId),
      },
    ];
  });
  const linkBeamYs = verticalBeamMap(visibleLinkGeoms, (g) => g.dir);

  // G6″（A3-2/G3）：跨岛父子连接可见性——两端盒都在布局中（投影 owner 覆盖全树）才可画；
  // 端点盒缺失（如父端被折叠隐藏，布局不含该节点）时跳过，不误连到原点。
  // 折叠祖先锚定路由（既有折叠端点策略）归后续工作包接入。
  const visibleBoundaryLinks = useMemo(() => {
    if (!boundaryLinks || boundaryLinks.length === 0) return [];
    const inView = (b: Box): boolean =>
      b.x + b.w >= view.x - CULL_MARGIN &&
      b.x <= view.x + view.w + CULL_MARGIN &&
      b.y + b.h >= view.y - CULL_MARGIN &&
      b.y <= view.y + view.h + CULL_MARGIN;
    return boundaryLinks.filter((l) => {
      const fb = derived.boxes.get(l.fromId);
      const tb = derived.boxes.get(l.toId);
      if (!fb || !tb) return false;
      const sx = Math.min(fb.x, tb.x);
      const sy = Math.min(fb.y, tb.y);
      return inView({
        x: sx,
        y: sy,
        w: Math.max(fb.x + fb.w, tb.x + tb.w) - sx,
        h: Math.max(fb.y + fb.h, tb.y + tb.h) - sy,
      });
    });
  }, [boundaryLinks, derived, view.x, view.y, view.w, view.h]);

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
  // A6/T23 门禁在 resolveBackend：显式 forceBackend='svg' 压过自动降级（不静默丢岛/边）。
  const useCanvas = resolveBackend(forceBackend, layout.nodes.length) === 'canvas';
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
          return [{ fromId: l.fromId, from, to, toId: l.toId, dir: growDirOf.get(l.toId) }];
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
      // G6′：中心拖拽 = 移动坐标（带动子树），而非改树结构
      isCenter: centerIds ? (id) => centerIds.has(id) : undefined,
      onCenterMove: (id, wdx, wdy) => onCenterMoveRef.current?.(id, wdx, wdy),
      onNodeClick: (ln, info) => onNodeClickRef.current?.(ln, info),
      onBlankClick: () => onBlankClickRef.current?.(),
      onNodeHover: (id, at) => {
        setHover((prev) =>
          prev?.id === id ? prev : id === null ? null : { id, x: at.x, y: at.y });
        onNoteHoverRef.current?.(id);
      },
    });
  const wheelRef = useRef<HTMLDivElement | null>(null);
  // A4：拖岛期冻结滚轮缩放（design §7 首版策略：k 恒定 → 预览位移与提交位移口径一致）
  const nodeDragRef = useRef(nodeDrag);
  nodeDragRef.current = nodeDrag;
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (nodeDragRef.current) return; // 拖岛中：忽略缩放，避免预览/提交位移换算歧义
      const rect = el.getBoundingClientRect();
      // M5-T4：滚轮以光标为锚（zoomAt 锚点保持世界坐标不动）+ 越界软回弹
      viewport.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport]);

  // A4：拖岛取消路径（design §7 / T11）——Esc / window blur 时恢复原图：
  // 仅清预览状态（nodeDrag），不回调 onCenterMove → 不写 note、不进 history、不置 dirty。
  // pointercancel / 第二指 pinch 已由 useMapGestures 的 onPointerDown/Cancel 覆盖。
  useEffect(() => {
    if (!nodeDrag) return;
    const cancel = (): void => setNodeDrag(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancel);
    };
  }, [nodeDrag, setNodeDrag]);

  // v1.5.0 T5：Section 选中态退出三件套（Esc / 画布空白点击 / 再次点击同框）。
  // 选中是纯会话态（不落盘、不进 history）——退出同样零副作用。
  // 「再次点击」由 onSelect 收到同 id 时 toggle 实现（见 SectionLayer 的 onSelect 接线）。
  useEffect(() => {
    if (selectedSectionId === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelectedSectionId(null);
      }
    };
    const onDown = (e: PointerEvent): void => {
      // 点击落在 Section 本体（frame/titlebar/折叠钮）由该元素自行处置，不在此清除
      const t = e.target;
      if (t instanceof Element && t.closest('[data-section-id]')) return;
      setSelectedSectionId(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [selectedSectionId]);

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
            // FA2-T3：拖动过程中实时判定落点（松手前就能看到会被插成什么）
            const target = senseAt(e, e.currentTarget);
            setDropPreview(target ? { target, sx: e.clientX, sy: e.clientY } : null);
          }
        }}
        onDragLeave={() => {
          setFileDragActive(false);
          setDropPreview(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setFileDragActive(false);
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length === 0) {
            setDropPreview(null);
            return;
          }
          // 落点感知：优先带坐标的语义投放；上层没接就退回原「只上传图库」行为
          const sensed = senseAt(e, e.currentTarget);
          setDropPreview(null);
          if (onAssetDropRef.current) onAssetDropRef.current(files, sensed ?? { action: 'free', nodeId: null });
          else onAssetFilesRef.current?.(files);
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
              {/* v1.5.0 Section 背景层：永在连线/节点之下（T3）。逐框 isBoxInView 自裁剪
                  （view 已含 CULL_MARGIN）；Canvas 模式不经 SVG 分支 → 自动降级不渲染。 */}
              {sectionViews.length > 0 && (
                <SectionLayer
                  views={sectionViews.filter(
                    (v) => v.kind === 'ghost' || isBoxInView(v.bounds, view, 0),
                  )}
                  view={view}
                  k={k}
                  selectedId={selectedSectionId}
                  // T5 退出三件套之一：再次点击同框 → 取消选中（toggle）
                  onSelect={(id) =>
                    setSelectedSectionId((prev) => (prev === id ? null : id))
                  }
                  onToggleCollapse={
                    onToggleCollapseRef.current
                      ? (id) => onToggleCollapseRef.current?.(id)
                      : undefined
                  }
                  onRemoveGhost={onRemoveSection}
                  onTitlePointerDown={handleSectionTitlePointerDown}
                />
              )}
              <g>
                {visibleLinkGeoms.map((g) => {
                  const { ln, from, to, dir } = g;
                  const palette = token.color.branches[derived.branchIndex.get(ln.toId) ?? 0];
                  // 连线随节点同步插值：端点取动画帧盒（防「节点动、线不动」脱节）；
                  // 垂直连线取方向组共享梁高（up/down 组内同一条水平梁）
                  const p = buildLinkPath(token, from, to, palette, {
                    beamY: linkBeamYs.get(g),
                    dir,
                  });
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
                    // A6 冒烟修复：path 是 SVG d 字符串——两条几何形状相同的边会产出
                    // 相同 d → React 重复 key 警告。改用端点 id（一对节点间至多一条树边）。
                    <g key={`${ln.fromId}->${ln.toId}`}>
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
                {/* G6″（A3-2/G3）：跨岛父子连接（虚线，与树线/自由边视觉区分；不参与布局、不可交互）。
                    仅 SVG 后端——Canvas 模式不渲染（与自由边同类已知边界），含本功能文档的门禁归 A6。 */}
                {!useCanvas &&
                  visibleBoundaryLinks.map((l) => {
                    const fb = derived.boxes.get(l.fromId);
                    const tb = derived.boxes.get(l.toId);
                    if (!fb || !tb) return null;
                    const p = buildLinkPath(
                      token,
                      renderBoxOf(l.fromId, fb),
                      renderBoxOf(l.toId, tb),
                    );
                    return (
                      <path
                        key={`boundary-${l.fromId}-${l.toId}`}
                        data-boundary-link
                        d={p.d}
                        fill="none"
                        stroke={p.stroke}
                        strokeWidth={p.width}
                        strokeDasharray="6 4"
                        opacity={0.55}
                        style={{ pointerEvents: 'none' }}
                      >
                        <title>跨岛父子连接（升格中心 · parent_link: show）</title>
                      </path>
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
                  // P2-1：动画期跳过交叉检测/跳线（配合 obstacles 置空，降载至 O(E)）
                  fastRouting={animating}
                />
              )}
              <g>
                {visibleNodes.map((ln) => {
                  const m = derived.metrics.get(ln.node.id);
                  if (!m) return null;
                  // 附属区（快速注释 / 固定 note 笔记）从节点盒底部生长，正文只画剩余高度。
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
                  // A4：中心岛拖动 = 整岛偏移预览（成员已在原位平移渲染）——
                  // 不走「单节点置灰 + 浮空克隆」的改结构拖拽表现
                  const isDragged = nodeDrag?.nodeId === ln.node.id && !centerPreview;
                  return (
                    // A6 冒烟修复：列表项是无 key 的 <> Fragment → React missing-key 警告。
                    // key 必须挂在 Fragment上（NodeG 内层 key 不替代列表项 key）。
                    <Fragment key={ln.node.id}>
                    <NodeG
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
                      // expanded 仅代表快速注释展开；固定 note 笔记由独立 HTML 卡片绘制，
                      // 仍通过 bodyHeight 让出布局空间，但不能触发节点内的整块附属背景。
                      expanded={expandedId === ln.node.id}
                      bodyHeight={nodeAuxiliaryRegions(ln.box.h, {
                        qaHeight: expandedId === ln.node.id ? commentAreaH : 0,
                        fixedNoteHeight: fixedNoteIds.has(ln.node.id) ? estimateNoteAreaHeight() : 0,
                      }).body.h}
                      assetBaseUrl={assetBaseUrl}
                      resolveAssetUrl={resolveAssetUrl}
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
                    {/* v1.4.0：有节点注释的标记（右上角小圆点）—— 没有它用户无从发现
                        哪些节点挂着注释（注释本身不占节点空间、不显示在节点盒里）。 */}
                    {hasNote(ln.node) &&
                      noteLod !== 'none' &&
                      (noteLod === 'badge' || !lodSkipText(lod, ln.depth)) && (
                      <circle
                        data-note-badge={ln.node.id}
                        cx={ln.box.x + ln.box.w - 5}
                        cy={ln.box.y + 5}
                        r={3}
                        fill={token.color.annotationAccent ?? '#BA7517'}
                      />
                    )}
                    </Fragment>
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
              {/* A4：中心岛拖动不走浮空克隆（整岛已在原位偏移预览） */}
              {nodeDrag?.moved && draggedLn && !centerPreview && (
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
                      assetBaseUrl={assetBaseUrl}
                      resolveAssetUrl={resolveAssetUrl}
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
            // G10：key 强制随 editingId 重建。Tab 生长时 editingId 在同一事件内
            // 从旧节点直接切到新节点（无 null 中间态被渲染），若不重建则
            // OverlayEditor 的 useState(initial) 不会重置，输入框会残留上一节点文本。
            // （已由 tests/edit-tab-grow.test.tsx 变异验证：去掉 key 该测试即红。）
            key={editingId}
            editingId={editingId}
            layout={layout}
            viewport={viewport}
            token={token}
            onCommit={onEditCommitRef.current}
            onCancel={onEditCancelRef.current}
            // v1.3.0：主题编辑态 Shift+Enter → 切到该节点描述编辑
            onDescEditRequest={(id) => onDescEditRequestRef.current?.(id)}
            onTabGrow={onEditTabGrowRef.current}
          />
        )}
        {/* 快速注释"生长"：展开节点在下方渲染注释区（连体 + 内置滚动；锚定节点屏幕位置） */}
        {expandedId != null && (
          <ExpandCommentOverlay
            expandedId={expandedId}
            layout={layout}
            viewport={viewport}
            token={token}
            fixedNoteIds={fixedNoteIds}
            onChange={(qa) => onQaChangeRef.current?.(expandedId, qa)}
            onClose={() => onToggleExpandRef.current?.(expandedId)}
          />
        )}
        {/* v1.3.0 幕布描述：视口内凡有 note.desc 的节点在下方渲染引用块（完整换行，超长内部滚动） */}
        <DescOverlays
          visible={visibleNodes}
          viewport={viewport}
          token={token}
          descEditingId={descEditingId}
          fixedNoteIds={fixedNoteIds}
          expandedId={expandedId}
          onCommit={(id, t) => onDescCommitRef.current?.(id, t)}
          onCancel={() => onDescCancelRef.current?.()}
        />

        {/* 悬停预览不影响布局；点击后转为节点内的固定 note 笔记。 */}
        {noteTargets.map((noteTarget) => (
          <NotePopover
            key={noteTarget.id}
            seq={noteTarget.data.seq}
            text={noteTarget.data.text}
            mode="floating"
            x={noteTarget.x}
            y={noteTarget.y}
            anchorTop={noteTarget.anchorTop}
            viewportW={viewport.viewW}
            viewportH={viewport.viewH}
            // 宽度对齐节点长度；字号不大于节点内部字体（屏幕口径：世界值 × k）
            nodeWidth={noteTarget.nodeWidth}
            nodeFontSize={noteTarget.nodeFontSize}
            pinned={noteTarget.pinned}
            editing={false}
            token={token}
            onChangeSeq={(seq) => onNoteChangeSeq?.(noteTarget.id, seq)}
            onChangeText={(text) => onNoteChangeText?.(noteTarget.id, text)}
            onClose={() => onNoteCloseRef.current?.(noteTarget.id)}
            onPin={() => onNotePin?.(noteTarget.id)}
          />
        ))}
        {fixedNotePanels.map((panel) => (
          <NotePopover
            key={panel.id}
            seq={panel.data.seq}
            text={panel.data.text}
            pinned
            editing={panel.editing}
            token={token}
            // 世界空间卡片：基线尺寸 + 一次 scale(k)（不逐帧改内部字号）
            mode="embedded"
            scale={panel.k}
            x={panel.x}
            y={panel.y}
            width={panel.worldWidth}
            height={panel.worldHeight}
            // 世界口径：卡片宽度本就是节点基线宽；字号同样不大于节点字号
            nodeFontSize={nodeFontOf(token, panel.depth)}
            onChangeSeq={(seq) => onNoteChangeSeq?.(panel.id, seq)}
            onChangeText={(text) => onNoteChangeText?.(panel.id, text)}
            onClose={() => onNoteCloseRef.current?.(panel.id)}
          />
        ))}
      {/* FA2-T3：拖放落点预览 —— 松手前就能看到会被插成图标 / 插图 / 子分支 / 自由节点。
          position:fixed 直接用 clientX/clientY，省去一层坐标换算。 */}
      {dropPreview && (
        <div
          data-drop-preview
          data-drop-action={dropPreview.target.action}
          data-drop-node={dropPreview.target.nodeId ?? ''}
          style={{
            position: 'fixed',
            left: dropPreview.sx + 14,
            top: dropPreview.sy + 14,
            zIndex: 90,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 999,
            background: token.color.annotationBadge,
            border: `1px dashed ${token.color.selection}`,
            color: token.color.text,
            fontFamily: token.font.family,
            fontSize: token.font.sizeLeaf,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: token.color.selection }}>{dropGlyph(dropPreview.target.action)}</span>
          <span>{dropHint(dropPreview.target.action)}</span>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * 节点正文字号（世界 px，k=1）：叶用小一号 —— 与 DescBlock 的 descFontSize 同分档口径。
 * note 浮窗/卡片据此封顶自己的字号（笔记不得大于所属节点字体）。
 */
function nodeFontOf(token: TokenSet, depth: number): number {
  return depth >= 2 ? token.font.sizeLeaf : token.font.size;
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
