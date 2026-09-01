/**
 * layout 模块入口：布局引擎（六布局 + 裁剪 + 关系边 + 度量注入 + 默认实现 + 内置注册）。
 * relations 因本地 EntityRef/Box 与 protocol/mindmap 重名，以显式命名导出（避免 export * 冲突）。
 */
export * from './inline.js';
export * from './wrap.js';
export * from './mindmap.js';
export * from './layouts.js';
export * from './nodeLayout.js';
export * from './cull.js';
export * from './fit.js';
export * from './minimap.js';
export * from './measure.js';
export * from './builtin.js';
export {
  normalizeRel,
  collectRelRefs,
  resolveRelTargets,
  buildRelGeometries,
  type RelEntry,
  type ResolvedRel,
  type RelGeometry,
} from './relations.js';
