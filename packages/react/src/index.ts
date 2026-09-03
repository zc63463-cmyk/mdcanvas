/**
 * @mindcanvas/react 入口（K3 渲染层）。
 * theme：三主题令牌系统（ADR-0003）；render：渲染核心（T2 按需渲染 + 视口裁剪/LOD）。
 */

export type { EntityRef } from '@mindcanvas/kernel';
export type {
  AssetItem,
  AssetPanelProps,
} from './chrome/AssetPanel.js';
export { AssetPanel } from './chrome/AssetPanel.js';
export {
  assetDiagnostics,
  hasAssetIn,
} from './chrome/assetDiagnostics.js';
export type { AssetHost } from './chrome/assetHost.js';
export {
  DemoAssetHost,
  kindOfFileName,
} from './chrome/assetHost.js';
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
  DESC_MAX_LINES,
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
  buildEditable,
  buildEntities,
  createDescMeasure,
  createExpandMeasure,
  layoutDemo,
} from './demo/pipeline.js';
export type {
  DescMenuActions,
  EdgeMenuActions,
  EntityMenuActions,
} from './edit/contextMenuItems.js';
export {
  contextMenuItemsFor,
  getNodeLabel,
} from './edit/contextMenuItems.js';
export type { EditorControllerOptions } from './edit/controller.js';
export { EditorController } from './edit/controller.js';
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
} from './edit/keys.js';
export type { OverlayEditorProps } from './edit/OverlayEditor.js';
export { OverlayEditor } from './edit/OverlayEditor.js';
export { collapsedAncestors } from './edit/reveal.js';
export type {
  FsFileHandle,
  FsFileSystemWindow,
  FsWritable,
  SaveResult,
} from './edit/save.js';
export {
  installBeforeUnload,
  MM_FILE_TYPES,
  saveMarkdown,
} from './edit/save.js';
export { useEditor } from './edit/useEditor.js';
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
