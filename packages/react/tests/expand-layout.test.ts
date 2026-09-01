/**
 * 展开态布局重排：节点"向下生长"参与布局——展开节点加宽加高，相邻节点被推开让位。
 * 纯逻辑（无 DOM），直接断言 layoutDemo/createExpandMeasure 输出。
 */
import { describe, expect, it } from 'vitest';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { createCharMeasure } from '../src/render/domMeasure.js';
import { createExpandMeasure, createDescMeasure, layoutDemo } from '../src/demo/pipeline.js';
import { estimateCommentAreaHeight, GROW_EXPAND_W } from '../src/chrome/GrowthCommentPanel.js';
import {
  estimateDescHeight,
  DESC_LINE_H,
  DESC_PAD,
  DESC_MAX_LINES,
} from '../src/chrome/DescBlock.js';

function baseMeasure() {
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  // 固定度量：避免依赖 DOM canvas
  return () => ({ w: 120, h: 36 });
}

describe('createExpandMeasure：展开节点加宽注入', () => {
  it('展开节点 → 宽=定值、高=本体+注释区高', () => {
    const base = baseMeasure();
    const measure = createExpandMeasure(base, 'exp-1', GROW_EXPAND_W, estimateCommentAreaHeight());
    const a = { id: 'exp-1', type: 'text' as const, text: 'A', children: [] as never[] };
    const b = { id: 'other', type: 'text' as const, text: 'B', children: [] as never[] };
    const ma = measure(a as never);
    const mb = measure(b as never);
    expect(ma.w).toBe(GROW_EXPAND_W);
    expect(ma.h).toBe(36 + estimateCommentAreaHeight());
    // 其他节点不受影响
    expect(mb).toEqual({ w: 120, h: 36 });
  });

  it('展开节点本体文本更长时取 max（不截断节点标题）', () => {
    const base = () => ({ w: 400, h: 36 }); // 比定值宽
    const measure = createExpandMeasure(base, 'exp-1', GROW_EXPAND_W, estimateCommentAreaHeight());
    const a = { id: 'exp-1', type: 'text' as const, text: 'A', children: [] as never[] };
    expect(measure(a as never).w).toBe(400);
  });

  it('expandedId = null → 原样返回 base（不包装）', () => {
    const base = baseMeasure();
    expect(createExpandMeasure(base, null, GROW_EXPAND_W, 100)).toBe(base);
  });
});

describe('layoutDemo 展开态：布局重排（推开相邻节点）', () => {
  function tree() {
    // A 有子节点 C；展开 A 时 C 应随 A 变高被下推
    const a = makeTextNode('分支 A', [makeTextNode('C')]);
    const b = makeTextNode('分支 B');
    const root = makeTextNode('根', [a, b]);
    return astToEditable(root)!;
  }

  it('展开分支 A → A 变宽变高（底边向下生长），子节点 C 不与 A 重叠', () => {
    const editable = tree();
    const aId = editable.children![0]!.id;
    const cId = editable.children![0]!.children![0]!.id;
    const base = layoutMindmap(editable, () => ({ w: 120, h: 36 }), new Set());
    const baseA = base.nodes.find((n) => n.node.id === aId)!;
    const expanded = layoutMindmap(
      editable,
      createExpandMeasure(
        () => ({ w: 120, h: 36 }),
        aId,
        GROW_EXPAND_W,
        estimateCommentAreaHeight(),
      ),
      new Set(),
    );
    const expA = expanded.nodes.find((n) => n.node.id === aId)!;
    const expC = expanded.nodes.find((n) => n.node.id === cId)!;
    // A 变宽变高
    expect(expA.box.w).toBe(GROW_EXPAND_W);
    expect(expA.box.h).toBeGreaterThan(baseA.box.h);
    // A 向下生长：底边（y+h）增大，为注释区让出空间
    expect(expA.box.y + expA.box.h).toBeGreaterThan(baseA.box.y + baseA.box.h);
    // 布局重排保证 C 与展开后的 A 不重叠（左右或上下任一分离即可）
    const sepX = expC.box.x >= expA.box.x + expA.box.w || expA.box.x >= expC.box.x + expC.box.w;
    const sepY = expC.box.y >= expA.box.y + expA.box.h || expA.box.y >= expC.box.y + expC.box.h;
    expect(sepX || sepY).toBe(true);
  });
});

describe('createDescMeasure：幕布描述加高（v1.3.0）', () => {
  const base = () => ({ w: 120, h: 36 });
  const nodeWith = (id: string, desc?: string) =>
    ({
      id,
      type: 'text',
      text: id,
      note: desc === undefined ? undefined : { desc },
      children: [],
    }) as never;

  it('有 desc 的节点 → 高度 += 描述区高（收缩一行）', () => {
    const measure = createDescMeasure(base, undefined);
    const m = measure(nodeWith('n1', '这是一段描述'));
    const collapsedH = estimateDescHeight(false, 'x');
    expect(m).toEqual({ w: 120, h: 36 + collapsedH });
  });

  it('无 desc 的节点 → 原样（零影响，向后兼容）', () => {
    const measure = createDescMeasure(base, undefined);
    expect(measure(nodeWith('n1'))).toEqual({ w: 120, h: 36 });
    expect(measure(nodeWith('n1', ''))).toEqual({ w: 120, h: 36 });
  });

  it('展开态节点 → 高度按行数增加（比收缩态更高）', () => {
    const expandedIds = new Set(['n1']);
    const measure = createDescMeasure(base, expandedIds);
    const multi = '第一行\n第二行\n第三行';
    const mExp = measure(nodeWith('n1', multi));
    const mCol = measure(nodeWith('n2', multi));
    expect(mExp.h).toBeGreaterThan(mCol.h);
    expect(mExp.h).toBe(36 + estimateDescHeight(true, multi));
  });

  it('与 createExpandMeasure（qa）可叠加：描述 + 快速注释同时生效', () => {
    const desc = '描述文本';
    const withQa = createExpandMeasure(base, 'n1', GROW_EXPAND_W, estimateCommentAreaHeight());
    const measure = createDescMeasure(withQa, undefined);
    const m = measure(nodeWith('n1', desc));
    expect(m.w).toBe(GROW_EXPAND_W);
    expect(m.h).toBe(36 + estimateCommentAreaHeight() + estimateDescHeight(false, desc));
  });

  it('性能：measure 只依赖 desc 内容 —— editing 状态不改变任何节点高度（避免进入/退出编辑全树重排）', () => {
    const a = makeTextNode('A');
    a.note = { desc: '已有描述' };
    const editable = astToEditable(a)!;
    const aId = editable.id;
    const char = (
      () => (_s: string) =>
        8
    )() as never;
    // layoutDemo 已不接受 descEditingId（性能设计）——measure 输出恒定，
    // 因此「进入编辑 / 退出编辑」不会改变 measureKey → LayoutCache 命中 → 零全树重排。
    const r = layoutDemo(editable, new Map(), char, new Set(), null, undefined, undefined);
    const n = r.layout.nodes.find((x) => x.node.id === aId)!;
    // 有 desc → 加高（与是否编辑无关）
    expect(n.box.h).toBeGreaterThan(36);
    // 无 desc → 不加高（编辑态由 overlay 浮出，不占布局）
    const b = makeTextNode('B');
    const r2 = layoutDemo(
      astToEditable(b)!,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
    );
    expect(r2.layout.nodes[0]!.box.h).toBeLessThanOrEqual(36);
  });

  it('性能：estimateDescHeight 用字符计数替代 split（超长描述不建临时数组，行数封顶后提前退出）', () => {
    // 1000 行描述：展开态应封顶 DESC_MAX_LINES，且不该因 split 产生大数组开销
    const long = Array.from({ length: 1000 }, (_, i) => `行${i}`).join('\n');
    const h = estimateDescHeight(true, long);
    expect(h).toBe(DESC_MAX_LINES * DESC_LINE_H + DESC_PAD * 2);
    // 收缩态恒为一行（与内容长度无关）
    expect(estimateDescHeight(false, long)).toBe(DESC_LINE_H + DESC_PAD * 2);
    // 空文本至少一行
    expect(estimateDescHeight(true, '')).toBe(DESC_LINE_H + DESC_PAD * 2);
  });

  it('空 desc 提交回退：desc 置 undefined 后 measure 回到原高', () => {
    // 场景 A：有 desc → 加高
    const withDesc = makeTextNode('A');
    withDesc.note = { desc: '原 desc' };
    const ed1 = astToEditable(withDesc)!;
    const char = (
      () => (_s: string) =>
        8
    )() as never;
    const a1 = layoutDemo(ed1, new Map(), char, new Set(), null, undefined, undefined);
    expect(a1.layout.nodes.find((n) => n.node.text === 'A')!.box.h).toBeGreaterThan(36);

    // 场景 B：controller.updateNote({desc: undefined}) 清空后 → measure 不加高 → 节点回到原高
    const cleared = makeTextNode('A');
    cleared.note = undefined;
    const ed2 = astToEditable(cleared)!;
    const a2 = layoutDemo(ed2, new Map(), char, new Set(), null, undefined, undefined);
    expect(a2.layout.nodes[0]!.box.h).toBeLessThanOrEqual(36);
  });

  it('layoutDemo 传 descExpandedIds → 有描述节点实际变高（端到端）', () => {
    const a = makeTextNode('分支 A', [makeTextNode('C')]);
    // 给 A 挂描述（两行）
    a.note = { desc: '这是 A 的描述\n第二行' };
    const root = makeTextNode('根', [a, makeTextNode('分支 B')]);
    const editable = astToEditable(root)!;
    const aId = editable.children![0]!.id;
    // 固定字符度量（不依赖 DOM canvas）
    const char = (
      () => (_s: string) =>
        8
    )() as never;
    const collapsed = layoutDemo(editable, new Map(), char, new Set(), null, undefined, undefined);
    const expanded = layoutDemo(
      editable,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
      new Set([aId]),
    );
    const ca = collapsed.layout.nodes.find((n) => n.node.id === aId)!;
    const ea = expanded.layout.nodes.find((n) => n.node.id === aId)!;
    // 展开全文后 A 更高
    expect(ea.box.h).toBeGreaterThan(ca.box.h);
    // 收缩态也比无描述时高（描述常驻参与布局）
    const noDesc = layoutDemo(
      astToEditable(
        makeTextNode('根', [makeTextNode('分支 A', [makeTextNode('C')]), makeTextNode('分支 B')]),
      )!,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
    );
    const nd = noDesc.layout.nodes.find((n) => n.node.text === '分支 A')!;
    expect(ca.box.h).toBeGreaterThan(nd.box.h);
  });
});
