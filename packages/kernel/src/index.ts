/**
 * @mindcanvas/kernel 入口。
 * K2 后：protocol（事实源）+ entity + registry + plugin + tree（编辑树 + TreeOp）+ layout（布局引擎）。
 */
export * from './protocol/parser.js';
export * from './protocol/serializer.js';
export * from './protocol/uri.js';
export * from './protocol/goldenCases.js';
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
export * from './entity/index.js';
export * from './registry/index.js';
export * from './plugin/index.js';
export * from './tree/index.js';
export * from './layout/index.js';

/** K0 占位常量：内核包身份标识（apps/canvas 组合入口依赖链路冒烟；K1 后可移除） */
export const kernelPlaceholder = '@mindcanvas/kernel';
