/**
 * @mindcanvas/kernel 入口。
 * K2 后：protocol（事实源）+ entity + registry + plugin + tree（编辑树 + TreeOp）+ layout（布局引擎）。
 */

/** K0 占位常量：内核包身份标识（apps/canvas 组合入口依赖链路冒烟；K1 后可移除） */

export {
  REGISTERED_KINDS,
  KIND_META,
  KIND_FALLBACK_COLOR,
  validateId,
  stripOrgPrefix,
} from './protocol/types.js';

export type {
  RegisteredKind,
  EntityRef,
  Entity,
  UnresolvedReason,
  MindNode,
  Note,
  Diagnostic,
  ParseResult,
} from './protocol/types.js';

export const kernelPlaceholder = '@mindcanvas/kernel';

export {
  isUnresolved,
  resolveAll,
} from './entity/entity.js';
export type { Resolver } from './entity/entity.js';

export {
  BUILTIN_LAYOUT_KINDS,
  registerBuiltinLayouts,
} from './layout/builtin.js';
export type { LayoutInput } from './layout/builtin.js';

export {
  filterVisibleLinks,
  isBoxInView,
  worldViewportRect,
} from './layout/cull.js';
export type {
  LinkEndpoint,
  Transform2D,
} from './layout/cull.js';

export { fitIntoView } from './layout/fit.js';
export type {
  FitOptions,
  FitTransform,
  Rect,
  Viewport,
} from './layout/fit.js';

export {
  inlineWidth,
  stripInline,
  tokenizeInline,
} from './layout/inline.js';
export type {
  InlineToken,
  InlineType,
} from './layout/inline.js';

export {
  getLayout,
  isLayoutKind,
  layoutFishbone,
  layoutLogic,
  layoutOrg,
  layoutTimeline,
} from './layout/layouts.js';
export type {
  LayoutFunc,
  LayoutKind,
} from './layout/layouts.js';

export {
  defaultCharMeasure,
  defaultMeasure,
} from './layout/measure.js';
export type { CharMeasure } from './layout/measure.js';

export {
  __subtreeHeightCache,
  annotateTree,
  bezierLink,
  buildLayoutTree,
  collectLayout,
  compactBezier,
  H_GAP,
  layoutBounds,
  LayoutCache,
  layoutMindmap,
  orgBeamLink,
  orthogonalPath,
  placeSubtree,
  subtreeHeightCached,
  V_GAP,
} from './layout/mindmap.js';
export type {
  Box,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
  LinkBuilder,
  LinkGeometry,
  MeasureFn,
} from './layout/mindmap.js';

export {
  minimapNodeRects,
  minimapPointToWorld,
  minimapRects,
} from './layout/minimap.js';
export type { MinimapRects } from './layout/minimap.js';

export {
  cachedMetrics,
  displayMetrics,
  LINE_H,
  TITLE_MAX_ENTITY,
  TITLE_MAX_IMAGE,
  TITLE_MAX_TEXT,
} from './layout/nodeLayout.js';
export type { DisplayMetrics } from './layout/nodeLayout.js';

export {
  buildRelGeometries,
  collectRelRefs,
  normalizeRel,
  resolveRelTargets,
} from './layout/relations.js';
export type {
  RelEntry,
  RelGeometry,
  ResolvedRel,
} from './layout/relations.js';

export {
  tokenize,
  wrapText,
} from './layout/wrap.js';

export { Plugin } from './plugin/plugin.js';

export { GOLDEN_CASES } from './protocol/goldenCases.js';
export type { GoldenCase } from './protocol/goldenCases.js';

export {
  parseMm,
  tryParseRef,
} from './protocol/parser.js';

export {
  serializeMm,
  verifyRoundTrip,
} from './protocol/serializer.js';

export {
  refKey,
  unresolvedEntity,
} from './protocol/types.js';

export { safeHref } from './protocol/uri.js';

export {
  hasNote,
  nodeAtPath,
  noteOf,
  pathOfNode,
} from './protocol/note.js';
export type { NodeNoteData, NodePath } from './protocol/note.js';

export { registerBuiltinKinds } from './registry/builtin.js';

export { ChannelRegistry } from './registry/channel.js';
export type { Channel } from './registry/channel.js';

export { createKernelRegistries } from './registry/index.js';
export type { KernelRegistries } from './registry/index.js';

export { KindRegistry } from './registry/kind.js';
export type { KindMeta } from './registry/kind.js';

export { LayoutRegistry } from './registry/layout.js';
export type { LayoutAlgorithm } from './registry/layout.js';

export {
  parseLinkAnchor,
  resolveGroups,
  resolveLinkAnchor,
  resolveLinks,
} from './registry/note-anchor.js';
export type {
  AnchorResolution,
  AnchorResolutionState,
  LinkAnchor,
  LinkDir,
  ResolvedGroup,
  ResolvedGroupMember,
  ResolvedLink,
} from './registry/note-anchor.js';

export { NoteKeyRegistry } from './registry/note-key.js';
export type { NoteKeyHandler } from './registry/note-key.js';

export { Registry } from './registry/registry.js';
export type { UnregisterHandle } from './registry/registry.js';

export { RendererRegistry } from './registry/renderer.js';

export { SemanticsRegistry } from './registry/semantics.js';
export type { SemRoleMapping } from './registry/semantics.js';

export { History } from './tree/history.js';

export {
  applyOp,
  invertOp,
  OpHistory,
} from './tree/tree-op.js';
export type {
  EntityRefInput,
  NodePatch,
  RecordedOp,
  TreeOp,
} from './tree/tree-op.js';

export {
  addChild,
  astToEditable,
  collapseFromLevel,
  collectRefs,
  depthOf,
  descendantCount,
  duplicateNode,
  editableToAst,
  findNode,
  firstChildId,
  getNode,
  isInSubtree,
  makeEntityNode,
  makeImageNode,
  makeTextNode,
  MAX_TREE_DEPTH,
  moveNode,
  newId,
  nextSiblingId,
  nodeByPath,
  parentIdOf,
  pathOf,
  prevSiblingId,
  removeNode,
  searchNodes,
  updateNode,
  walkNodes,
} from './tree/treeOps.js';
export type {
  EditableNode,
  NodeLocation,
} from './tree/treeOps.js';
