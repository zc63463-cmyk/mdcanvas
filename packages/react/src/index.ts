/**
 * @mindcanvas/react 入口（K3 渲染层）。
 * theme：三主题令牌系统（ADR-0003）；render：渲染核心（T2 按需渲染 + 视口裁剪/LOD）。
 */

export type { EntityRef } from '@mindcanvas/kernel';
export type {
  AssetInsertAction,
  AssetItem,
  AssetPanelProps,
} from './chrome/AssetPanel.js';
export {
  ASSET_ACTION_LABEL,
  AssetPanel,
  BUILTIN_ASSET_ITEMS,
} from './chrome/AssetPanel.js';
// FA1-T4：内置矢量图标集
export { BUILTIN_ICONS, builtinIconById, matchBuiltinIcons } from './chrome/assetIcons.js';
export type { BuiltinIcon } from './chrome/assetIcons.js';
// FA1-T5：SVG 主题染色与自包含
export {
  isInlineableSvgText,
  isMonochromeSvg,
  sanitizeInlineSvg,
  svgFromDataUrl,
  svgToDataUrl,
  tintSvgToCurrentColor,
} from './render/svgTint.js';
export {
  assetDiagnostics,
  hasAssetIn,
} from './chrome/assetDiagnostics.js';
export type { AssetHost } from './chrome/assetHost.js';
export {
  DemoAssetHost,
  isImageFileName,
  kindOfFileName,
} from './chrome/assetHost.js';
export { IdbAssetHost } from './chrome/idbAssetHost.js';
// FA2-T4：工作区资产真落盘（写入 ./assets/，相对路径引用）
export { WorkspaceAssetHost } from './chrome/workspaceAssetHost.js';
export type { WorkspaceWriter } from './chrome/workspaceAssetHost.js';
export type {
  ContextMenuItem,
  ContextMenuProps,
} from './chrome/ContextMenu.js';
export { ContextMenu } from './chrome/ContextMenu.js';
export type { DescBlockProps } from './chrome/DescBlock.js';
export {
  DESC_BAR_W,
  DESC_EDIT_MIN_LINES,
  DESC_INDENT,
  DESC_LINE_H,
  DESC_SOFT_MAX_LINES,
  DESC_PAD,
  DescBlock,
  estimateDescHeight,
} from './chrome/DescBlock.js';
export type {
  NodeChoice,
  TreeEdgeAnn,
} from './chrome/EdgeEditor.js';
export {
  appendEdge,
  collectNodeChoices,
  EDGE_STYLE_PRESETS,
  EdgeEditor,
  edgesOf,
  findDuplicateEdge,
  LinkCreator,
  mergeStyleAt,
  patchEdgeAt,
  REL_TEMPLATES,
  RoutingSideToggle,
  removeEdgeAt,
  TreeEdgeEditor,
} from './chrome/EdgeEditor.js';
export type {
  EdgeListItem,
  EntityGraphPanelProps,
} from './chrome/EntityGraphPanel.js';

export { EntityGraphPanel } from './chrome/EntityGraphPanel.js';
export type {
  EntityCandidate,
  EntityPickerProps,
} from './chrome/EntityPicker.js';
export { EntityPicker } from './chrome/EntityPicker.js';
export type { ErrorBoundaryProps } from './chrome/ErrorBoundary.js';
export { ErrorBoundary } from './chrome/ErrorBoundary.js';
export type {
  EntityRelation,
  EntityRelationNode,
} from './chrome/entityGraph.js';
export {
  collectEntityRelations,
  radialLayout,
} from './chrome/entityGraph.js';
export {
  isEscapedEntityInput,
  unescapeEntityInput,
} from './chrome/entityInput.js';
export type {
  EntityHost,
  EntityRecord,
} from './chrome/entityStore.js';
export {
  ENTITY_STORE_MAX,
  entityKeyOf,
  HttpEntityHost,
  LocalEntityStore,
} from './chrome/entityStore.js';
export type { ExportPngResult } from './chrome/exportPng.js';
export {
  exportPng,
  readSvgSize,
  renderPng,
} from './chrome/exportPng.js';
export type { ExportSvgOptions } from './chrome/exportSvg.js';
export { exportSvg } from './chrome/exportSvg.js';
export type { FlipCardProps } from './chrome/FlipCard.js';
export { FlipCard } from './chrome/FlipCard.js';
export type { GlassCardProps } from './chrome/GlassCard.js';
export { GlassCard } from './chrome/GlassCard.js';
export type { GrowthCommentPanelProps } from './chrome/GrowthCommentPanel.js';
export {
  estimateCommentAreaHeight,
  GCP_HEADER_H,
  GCP_INPUT_H,
  GCP_MAX_ROWS,
  GCP_PAD,
  GCP_ROW_H,
  GROW_EXPAND_W,
  GrowthCommentPanel,
} from './chrome/GrowthCommentPanel.js';
export type { NoteSection } from './chrome/note.js';
export { formatNote } from './chrome/note.js';
export type { OutlinePanelProps } from './chrome/OutlinePanel.js';
export { OutlinePanel } from './chrome/OutlinePanel.js';
export type { QaEditorProps } from './chrome/QaEditor.js';
export { QaEditor } from './chrome/QaEditor.js';

export type { NotePopoverProps } from './chrome/NotePopover.js';
export { NotePopover } from './chrome/NotePopover.js';
export type { NoteGrowthPanelProps } from './chrome/NoteGrowthPanel.js';
export { estimateNoteAreaHeight, NoteGrowthPanel } from './chrome/NoteGrowthPanel.js';
export type {
  RelationTypeConfig,
  SemanticGroup,
} from './chrome/relationSchema.js';
export {
  DEFAULT_RELATION_TYPES,
  defaultRelationSchema,
  RelationSchema,
  SEMANTIC_GROUPS,
} from './chrome/relationSchema.js';
export type { SearchPanelProps } from './chrome/SearchPanel.js';
export { SearchPanel } from './chrome/SearchPanel.js';
export type { ShortcutHelpPanelProps } from './chrome/ShortcutHelpPanel.js';
export { ShortcutHelpPanel } from './chrome/ShortcutHelpPanel.js';
export {
  SCALE_NOTICE_HUGE,
  SCALE_NOTICE_LARGE,
  scaleNoticeFor,
} from './chrome/scaleNotice.js';
export { ThemeSwitcher } from './chrome/ThemeSwitcher.js';
export type {
  DemoLayout,
  DemoSource,
} from './demo/pipeline.js';
export {
  buildCenterSpecs,
  buildIslandView,
  buildEditable,
  buildEntities,
  createDescMeasure,
  createFixedNoteMeasure,
  idsMeasureKey,
  createExpandMeasure,
  layoutDemo,
} from './demo/pipeline.js';
export type {
  DescMenuActions,
  EdgeMenuActions,
  EntityMenuActions,
  SectionMenuActions,
} from './edit/contextMenuItems.js';
export {
  contextMenuItemsFor,
  getNodeLabel,
} from './edit/contextMenuItems.js';
export type { EditorControllerOptions } from './edit/controller.js';
export { EditorController } from './edit/controller.js';
export {
  applyAnchorUpdateToNote,
  collectReferenceAnchors,
  MAX_NODE_DEPTH,
  planAttachIsland,
  planCutTreeEdge,
  subtreeMaxDepth,
} from './edit/cutAttach.js';
export type { CutAttachErrorCode, CutAttachPlan } from './edit/cutAttach.js';
export type { DocEntry } from './edit/docLibrary.js';

export { DocLibrary, SOURCE_KEEP, UNTAGGED } from './edit/docLibrary.js';
export type {
  DocumentHost,
  MindDoc,
} from './edit/document.js';
export {
  isMindDocFile,
  LocalDocHost,
} from './edit/document.js';
export type { EditorKeyAction } from './edit/keys.js';
export {
  EDITOR_KEY_BINDINGS,
  matchEditorKey,
  matchPreDirKey,
} from './edit/keys.js';
export type {
  RadialEffect,
  RadialEvent,
  RadialGeometry,
  RadialGeometryConfig,
  RadialItem,
  RadialOrigin,
  RadialPhase,
  RadialReduceCtx,
  RadialSlotKey,
  RadialState,
} from './edit/radialActions.js';
export {
  hitTest,
  itemAt,
  RADIAL_GEOMETRY_DEFAULTS,
  RADIAL_HOLD_MS,
  RADIAL_IDLE,
  RADIAL_ITEMS_V1,
  RADIAL_SLOTS,
  radialGeometryFor,
  radialGeometryOf,
  radialReduce,
  slotForArrowKey,
  visibleArcs,
} from './edit/radialActions.js';
export {
  ChargeArc,
  floatLabelStyle,
  RADIAL_ACCENT,
  RADIAL_DANGER,
  RADIAL_SURFACE_CSS,
  RadialRing,
  RadialStyles,
  ringArcPath,
  slotCenterDeg,
} from './chrome/radialSurface.js';
export type { RadialRingProps } from './chrome/radialSurface.js';
export type { OverlayEditorProps } from './edit/OverlayEditor.js';
export { OverlayEditor } from './edit/OverlayEditor.js';
export { collapsedAncestors } from './edit/reveal.js';
export type {
  FsFileHandle,
  FsFileSystemWindow,
  FsWritable,
  SaveOutcome,
  SaveResult,
} from './edit/save.js';
export {
  installBeforeUnload,
  isEmbeddedFrame,
  MM_FILE_TYPES,
  MM_OPEN_TYPES,
  saveMarkdown,
  writeToHandle,
} from './edit/save.js';
export { useEditor } from './edit/useEditor.js';
// FA1-T2：句柄跨会话持久化（IndexedDB 结构化克隆）
export {
  deleteFileHandle,
  deleteDirectoryHandle,
  getDirectoryHandle,
  getFileHandle,
  setDirectoryHandle,
  setFileHandle,
  verifyPermission,
  WORKSPACE_ROOT_KEY,
} from './edit/handleStore.js';
export type { PermissionAware } from './edit/handleStore.js';
// FA2-T1：本地目录工作区（showDirectoryPicker）
export {
  ASSETS_DIR,
  DirectoryWorkspaceHost,
  filterTree,
  flattenDirs,
  flattenFiles,
  isDirectoryPickerSupported,
  SCAN_SKIP_DIRS,
} from './edit/directoryHost.js';
export type { ScanOptions } from './edit/directoryHost.js';
export {
  isDirEntry,
  isFileEntry,
  isWorkspaceDocName,
} from './edit/directoryTypes.js';
export type {
  FsDirectoryHandle,
  FsEntryHandle,
  WorkspaceDir,
  WorkspaceFile,
  WorkspaceNode,
} from './edit/directoryTypes.js';
export { DemoPlugin } from './plugins/demoPlugin.js';
export type {
  BackendKind,
  ImageDraw,
  LinkDraw,
  NodeCardDraw,
  RenderBackend,
  ScenePrimitive,
  TextDraw,
} from './render/backend.js';
export {
  createSvgBackend,
  SvgBackend,
  sceneToSvg,
} from './render/backend.js';
export {
  createCharMeasure,
  createDisplayMetricsFn,
  createNodeMeasure,
} from './render/domMeasure.js';
export type { EdgeLabelProps } from './render/EdgeLabel.js';
export {
  cubicMidNormal,
  EDGE_LABEL_FONT,
  EDGE_LABEL_H,
  EdgeLabel,
  pillWidthOf,
  textWidthOf,
} from './render/EdgeLabel.js';
export type {
  AestheticWeights,
  EdgeCrossing,
  RouteObstacle,
  RouteResult,
} from './render/edgeRouting.js';
export {
  bezierFromAnchors,
  corridorObstacles,
  DEFAULT_BLOCK_PADDING,
  DEFAULT_CORRIDOR_MARGIN,
  DEFAULT_CURVATURE_STEPS,
  edgeAnchorCandidates,
  findCrossings,
  inferBowSide,
  pathWithJumps,
  pointClearance,
  polylineHitsObstacle,
  routeAesthetic,
  sampleCubic,
  segmentIntersectsRect,
} from './render/edgeRouting.js';
export type {
  EdgeRouteEntry,
  FreeEdgeLayerProps,
} from './render/FreeEdgeLayer.js';
export { FreeEdgeLayer } from './render/FreeEdgeLayer.js';
export type {
  DocEdge,
  EdgeEndpoints,
  EdgeManual,
  EdgeSource,
  EdgeStyle,
  FreeEdge,
} from './render/freeEdges.js';
export {
  anchorOfNode,
  borderPoint,
  buildFreeEdgePath,
  collectEntityOccurrences,
  collectFreeEdges,
  edgeVisualOf,
  freeEdgeEndpoints,
  normalAtMid,
  relVisualOf,
  splitEntityAnchor,
} from './render/freeEdges.js';

// G6′ 中心（升格节点）数据层：root.note.centers + 历史坐标 root.note.center_pos
export {
  collectCenterHistory,
  collectCenters,
  ensureNodeCid,
  forgetCenterPos,
  GROW_DIRS,
  isGrowDir,
  planPromoteCenter,
  rememberCenterPos,
  removeCenter,
  upsertCenter,
} from './render/centers.js';
export type { Center, CenterPosEntry, DocCenter, PromotePlan } from './render/centers.js';

// v1.5.0 Section 锚解析（T2）：resolveSections 三态 + W-SECTION-DANGLING 诊断
// （唯一实现在 kernel/registry/section-anchor.ts，此处转发便于 canvas 单包导入）
export { resolveSections } from '@mindcanvas/kernel';
export type { ResolvedSection, SectionDiagnostic } from '@mindcanvas/kernel';

// D 包：节点级生长方向 note.dir（思想分叉）协议层（集成人统一导出）
export {
  collectDeclaredGrowDir,
  collectExplicitDir,
  effectiveGrowDir,
  inferChildDir,
  probeDirRoundTrip,
  readGrowDir,
  summarizeGrowDirDiagnostics,
  upsertGrowDir,
} from './render/growDir.js';
export type { GrowDirDiagnostic } from './render/growDir.js';

export type {
  CardLevel,
  LinkPathResult,
  LodLevel,
  NodeCardStyle,
} from './render/geometry.js';
export {
  buildLinkPath,
  computeBranchIndex,
  LOD_AUTO_NODES,
  linkEndpoints,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
  wavyPath,
} from './render/geometry.js';
export type { LinkGProps } from './render/LinkG.js';
export { LinkG } from './render/LinkG.js';
export type {
  MapStats,
  MapViewApi,
  MapViewProps,
} from './render/MapView.js';
export { MapView } from './render/MapView.js';

// v1.5.0 Section 渲染层（Phase 1 子树锚定）：帧模型纯几何 + 背景层组件
export {
  buildSectionViews,
  SECTION_PADDING,
  SECTION_PALETTE,
  SECTION_TITLE_H,
} from './render/sectionFrames.js';
export type {
  SectionFrame,
  SectionGhost,
  SectionPaletteEntry,
  SectionView,
} from './render/sectionFrames.js';
export { SectionLayer } from './render/SectionLayer.js';
export {
  NODE_ANIM_MAX_NODES,
  NODE_ANIM_MS,
  NODE_FADE_IN_SCALE,
  NODE_FADE_OUT_SCALE,
  PAN_INERTIA_TAU,
  PAN_INERTIA_TRIGGER,
  PAN_SAMPLE_WINDOW,
  prefersReducedMotion,
  VIEWPORT_ANIM_MS,
  ZOOM_BOUNCE_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_OVERSHOOT,
} from './render/motion.js';
export type { NodeGProps } from './render/NodeG.js';

export { NodeG } from './render/NodeG.js';
export type {
  DropMode,
  DropPlan,
} from './render/nodeDrag.js';
export {
  dragExcludedIds,
  dropModeFor,
  isDescendantOf,
  planDrop,
} from './render/nodeDrag.js';
export type { SceneInput } from './render/sceneBuilder.js';
export {
  buildSceneFromLayout,
  CANVAS_AUTO_NODES,
} from './render/sceneBuilder.js';
export type {
  AnimateOptions,
  EasingFn,
  FrameSchedulerOptions,
  LerpFn,
} from './render/scheduler.js';
export {
  easeInOutQuad,
  easeOutCubic,
  easeOutQuad,
  FrameScheduler,
  lerpNumber,
  linear,
} from './render/scheduler.js';
export type {
  AnimatedBox,
  NodeFrame,
} from './render/transition.js';
export {
  lerpNodeFrame,
  toNodeFrame,
} from './render/transition.js';
export type {
  PanSample,
  Transform,
  WorldPoint,
} from './render/viewport.js';
export {
  estimatePanVelocity,
  ViewportController,
} from './render/viewport.js';
export { PluginHost } from './runtime/pluginHost.js';
export type { KindBadgeRenderer } from './runtime/registries.js';
export { createReactRegistries } from './runtime/registries.js';
export type { SearchHit } from './search/search.js';
export {
  nodeTitle,
  searchMind,
} from './search/search.js';
export {
  ThemeProvider,
  useTheme,
} from './theme/ThemeContext.js';
export {
  CHROME,
  classicToken,
  DEFAULT_THEME,
  glassToken,
  stickerToken,
  THEMES,
} from './theme/tokens.js';
export type {
  BranchColor,
  BranchLeaf,
  LineLanguage,
  NodeShape,
  ThemeId,
  TokenSet,
} from './theme/types.js';
