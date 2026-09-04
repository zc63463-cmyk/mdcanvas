/**
 * demo 数据管线（T3：parseMm → astToEditable → layoutMindmap → 渲染 的组成示例）。
 * kernel = 纯只读依赖（协议解析 / 布局 / 度量抽象），react 侧注入 DOM 精确度量。
 * demo 画布文本来自 kernel fixtures（apps/canvas 内 `?raw` 引入）。
 */
import {
  astToEditable,
  layoutMindmap,
  parseMm,
  refKey,
  type LayoutCache,
} from '@mindcanvas/kernel';
import type {
  Diagnostic,
  EditableNode,
  Entity,
  EntityRef,
  LayoutResult,
  CharMeasure,
  MeasureFn,
} from '@mindcanvas/kernel';
import { createNodeMeasure } from '../render/domMeasure.js';
import { estimateCommentAreaHeight, GROW_EXPAND_W } from '../chrome/GrowthCommentPanel.js';
import { estimateDescHeight, estimateDescWidth } from '../chrome/DescBlock.js';

export interface DemoSource {
  editable: EditableNode | null;
  refs: EntityRef[];
  diagnostics: Diagnostic[];
}

/** `.mm.md` 文本 → 可编辑树（协议层事实源） */
export function buildEditable(source: string): DemoSource {
  const { root, refs, diagnostics } = parseMm(source);
  return { editable: astToEditable(root), refs, diagnostics };
}

/** refs + 标题表 → entity 表（缺口 = unresolved，驱动警示角标演示） */
export function buildEntities(
  refs: EntityRef[],
  titleByRef: Record<string, { title: string; status?: string; ref?: string }>,
): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const r of refs) {
    const k = refKey(r);
    const spec = titleByRef[k];
    map.set(
      k,
      spec
        ? {
            kind: r.kind,
            id: r.id,
            title: spec.title,
            status: spec.status ?? 'open',
            ref: spec.ref ?? null,
          }
        : {
            kind: r.kind,
            id: r.id,
            title: null,
            status: 'unresolved',
            ref: null,
            meta: { unresolved_reason: 'not-found' },
          },
    );
  }
  return map;
}

export interface DemoLayout {
  layout: LayoutResult;
  /** 注入 measure（可复用于后续折叠重布局） */
  measure: ReturnType<typeof createNodeMeasure>;
}

/** 展开态节点加宽（快速注释"生长"）：宽=定值，高=本体+注释区高（参与布局 → 推开其他节点） */
export function createExpandMeasure(
  base: MeasureFn,
  expandedId: string | null,
  expandW: number,
  extraH: number,
): MeasureFn {
  if (expandedId === null) return base;
  return (node) => {
    if (node.id !== expandedId) return base(node);
    const b = base(node);
    return { w: Math.max(expandW, b.w), h: b.h + extraH };
  };
}

/**
 * 描述区（note.desc）加高：凡有描述的节点，布局高度 += 描述区高度（参与布局 → 推开其他节点）。
 * 与 createExpandMeasure（qa 快速注释：仅单个 expandedId 生效）的区别——
 * 描述是**常驻可见**的（默认收缩一行），对所有有 desc 的节点无条件生效。
 */
/**
 * 把 id 集合编码进度量键。
 *
 * ⚠️ **不能用 size 代替** —— 内核 `LayoutCache` 只靠 measureKey 字符串判定失效
 * （`mindmap.ts:101-104`，同时比较 collapsedIds 的**引用**）。而调用方的
 * collapsedIds 通常是稳定引用（如 `controller.collapsed`），于是键就成了唯一依据：
 * 若只编码数量，"展开 A" 换成 "展开 B"（数量都是 1）键不变 → 缓存未作废 →
 * 布局仍是旧的（A 还高着、B 没变高）。
 *
 * 排序后拼接：成员相同则键相同（稳定，不因遍历顺序抖动）。
 */
export function idsMeasureKey(ids: ReadonlySet<string>): string {
  return [...ids].sort().join(',');
}

export function createDescMeasure(base: MeasureFn, char: CharMeasure): MeasureFn {
  return (node) => {
    const b = base(node);
    const raw = node.note?.desc;
    const desc = typeof raw === 'string' ? raw : '';
    // 描述区**始终**参与布局（无展开/收缩态）。
    // 幕布语义：描述是轻量单行文本 —— 不自动折行，长了**横向撑开**节点盒；
    // 只有显式 `\n` 才增高。超过软上限后由描述区内部滚动。
    if (desc === '') return b;
    const dh = estimateDescHeight(desc);
    const dw = estimateDescWidth(desc, char);
    return { w: Math.max(b.w, dw), h: b.h + dh };
  };
}

/** layoutMindmap + DOM 精确度量（T3：替换默认估算的注入点）。
 *  M5-T6：传入 cache → 增量布局（仅重算受影响分支）；measureKey 覆盖字体/实体/展开态变化（由调用方给出版本令牌）。 */
export function layoutDemo(
  editable: EditableNode,
  entities: Map<string, Entity>,
  char: CharMeasure,
  collapsedIds: Set<string> = new Set(),
  expandedId: string | null = null,
  cache?: LayoutCache,
  measureKey?: string,
): DemoLayout {
  const base = createNodeMeasure(char, entities);
  const withQa = expandedId
    ? createExpandMeasure(base, expandedId, GROW_EXPAND_W, estimateCommentAreaHeight())
    : base;
  // 注意：measure 不含 editing 状态（见 createDescMeasure 注释）——编辑态不触发全树重排
  const measure = createDescMeasure(withQa, char);
  return {
    layout: layoutMindmap(
      editable,
      measure,
      collapsedIds,
      cache ? { cache, measureKey: measureKey ?? undefined } : undefined,
    ),
    measure,
  };
}
