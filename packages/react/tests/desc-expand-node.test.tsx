// @vitest-environment jsdom
/**
 * 节点「放大展开」的行为守卫（2026-09-03）：
 *
 * 表现形式是**浮出卡片**（沿用 floating 视觉），且它是**节点的附属** ——
 * 挂在节点本体 rect 下方，不是嵌在节点盒内部；但它**占布局**，
 * 会挤压相邻节点（树变形）。
 *
 * 这三者曾经两两混淆过：
 *   ① floating = 不占布局（错，它只是视觉开关）
 *   ② 占布局 = 画在节点盒内（错，可以预留高度后画在盒外）
 * 这里把最终的几何关系锁住。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  astToEditable,
  layoutMindmap,
  LayoutCache,
  type EditableNode,
  makeTextNode,
} from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createDescMeasure, idsMeasureKey } from '../src/demo/pipeline.js';
import { commentAreaH } from '../src/render/overlays.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function treeWithDesc() {
  const child = makeTextNode('有注释的节点');
  child.note = { desc: '第一行注释\n第二行注释' };
  const other = makeTextNode('另一个节点');
  return { root: makeTextNode('根', [child, other]), childId: child.id };
}

/**
 * 构造 + 渲染。**要点：astToEditable 每次调用都会重新生成节点 id**，
 * 所以只转换一次并复用同一个 editable —— 否则拿到的 id 与 layout 里的对不上
 * （曾两次误判：一次是"浮出视觉没生效"，一次是"rect 高度取不到"）。
 */
function renderExpanded(expand: boolean) {
  const { root, childId } = treeWithDesc();
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const base = createNodeMeasure(char, new Map());

  // 真实画布（layoutDemo）也是这么算的：描述区高度经 createDescMeasure 计入 box.h
  const probeLayout = layoutMindmap(editable, createDescMeasure(base, new Set(), new Set()), new Set());
  const targetId = probeLayout.nodes.find((n) => n.node.note?.desc !== undefined)?.node.id ?? '';

  const expandIds: Set<string> = expand ? new Set([targetId]) : new Set();
  const layout = layoutMindmap(editable, createDescMeasure(base, new Set(), expandIds), new Set());

  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        expandedNodeIds={expandIds}
      />
    </ThemeProvider>,
  );
  return { container, targetId, childId, layout };
}

/** 节点本体 rect 的高度（NodeG 内第一个 rect 就是本体，height = bodyHeight 或 box.h） */
function bodyRectHeight(container: HTMLElement, nodeId: string): number {
  const g = container.querySelector(`[data-node-id="${nodeId}"]`);
  const rect = g?.querySelector('rect');
  return rect ? Number(rect.getAttribute('height')) : -1;
}

/**
 * 度量键必须编码**成员**而非数量。
 *
 * 内核 LayoutCache 只比较 measureKey 字符串 + collapsedIds 的**引用**
 * （mindmap.ts:101-104）。调用方的 collapsedIds 通常引用稳定（controller.collapsed），
 * 于是 measureKey 成了唯一依据：只编码 size 的话，"展开 A" 换成 "展开 B"
 * （数量都是 1）键不变 → 缓存未作废 → 布局还是旧的（A 还高着、B 没变高）。
 */
/**
 * 同时开启「快速注释展开」和「描述区放大展开」—— 两个附属区都挂在 rect 下方，
 * 必须上下排开而不是叠在一起。
 */
function renderBothExpanded() {
  const { root } = treeWithDesc();
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const base = createNodeMeasure(char, new Map());

  const probe = layoutMindmap(editable, createDescMeasure(base, new Set(), new Set()), new Set());
  const targetId = probe.nodes.find((n) => n.node.note?.desc !== undefined)?.node.id ?? '';

  // 给该节点补上 qa，让它能进入"快速注释展开"
  const target = editable.children[0]!;
  target.note = { ...(target.note ?? {}), qa: ['问题一', '问题二'] };

  const expandIds: Set<string> = new Set([targetId]);
  const measure = (n: EditableNode): { w: number; h: number } => {
    const b = base(n);
    const desc = typeof n.note?.desc === 'string' ? n.note.desc : '';
    const dh = createDescMeasure(base, new Set(), expandIds)(n).h - b.h;
    // qa 展开也要计入（createExpandMeasure 的语义：本体 + 注释区）
    const qa = n.id === targetId ? commentAreaH : 0;
    if (desc === '' && qa === 0) return b;
    return { w: b.w, h: b.h + dh + qa };
  };
  const layout = layoutMindmap(editable, measure, new Set());

  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        expandedId={targetId}
        expandedNodeIds={expandIds}
      />
    </ThemeProvider>,
  );
  return { container, targetId };
}

describe('度量键与布局缓存', () => {
  it('idsMeasureKey：成员不同键不同；成员相同则键稳定（不受遍历顺序影响）', () => {
    expect(idsMeasureKey(new Set(['a']))).not.toBe(idsMeasureKey(new Set(['b'])));
    expect(idsMeasureKey(new Set(['b', 'a']))).toBe(idsMeasureKey(new Set(['a', 'b'])));
  });

  it('数量相同但成员变化时，布局必须重算（不能命中过期缓存）', () => {
    const { root } = treeWithDesc();
    const editable = astToEditable(root)!;
    // collapsedIds **复用同一个对象** —— 真实场景是 controller.collapsed，引用稳定
    const collapsedIds = new Set<string>();
    const cache = new LayoutCache();
    const base = (): { w: number; h: number } => ({ w: 120, h: 34 });
    const [nodeA, nodeB] = [editable.children[0]!, editable.children[1]!];

    const boxHOf = (ids: Set<string>, which: EditableNode): number => {
      const l = layoutMindmap(
        editable,
        createDescMeasure(base, new Set(), ids),
        collapsedIds,
        { cache, measureKey: 'k|' + idsMeasureKey(ids) },
      );
      return l.nodes.find((n) => n.node.id === which.id)!.box.h;
    };

    // A 也带 desc（treeWithDesc 只给第一个节点加了 note）—— 这里给 B 补上，
    // 才能让"两个节点都能展开"这件事说得通
    nodeB.note = { desc: 'B 的注释\n第二行' };

    const a1 = boxHOf(new Set([nodeA.id]), nodeA);
    const b1 = boxHOf(new Set([nodeA.id]), nodeB);
    const a2 = boxHOf(new Set([nodeB.id]), nodeA);
    const b2 = boxHOf(new Set([nodeB.id]), nodeB);

    // 展开谁，谁就该更高；换人展开后高度必须跟着换
    expect(a1).toBeGreaterThan(b1);
    expect(b2).toBeGreaterThan(a2);
    // 关键：第二轮不是第一轮的复读
    expect(a2).toBeLessThan(a1);
    expect(b2).toBeGreaterThan(b1);
  });
});

describe('节点放大展开（浮出附属 + 占布局）', () => {
  it('未展开：描述区不带浮出卡片样式', () => {
    const { container } = renderExpanded(false);
    const blocks = container.querySelectorAll('[data-desc-block]');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.getAttribute('data-desc-floating')).toBe('false');
  });

  it('展开后：描述区沿用浮出卡片视觉（data-desc-floating=true）', () => {
    const { container } = renderExpanded(true);
    const floating = container.querySelector('[data-desc-block][data-desc-floating="true"]');
    expect(floating).not.toBeNull();
  });

  it('描述块是节点的**附属**而非内部：本体 rect 只画本体高，其余归附属区', () => {
    const collapsed = renderExpanded(false);
    const expanded = renderExpanded(true);

    const collapsedBox = collapsed.layout.nodes.find(
      (n) => n.node.id === collapsed.targetId,
    )!.box.h;
    const expandedBox = expanded.layout.nodes.find((n) => n.node.id === expanded.targetId)!.box.h;
    const collapsedRect = bodyRectHeight(collapsed.container, collapsed.targetId);
    const expandedRect = bodyRectHeight(expanded.container, expanded.targetId);

    // ① 本体 rect 明显矮于布局盒 —— 差值就是附属区（浮出描述块画在那里，
    //    也就是挂在 rect 下方）。若 rect 画满整高，说明描述块被塞进了节点内部。
    expect(collapsedRect).toBeGreaterThan(0);
    expect(collapsedRect).toBeLessThan(collapsedBox);
    expect(expandedRect).toBeLessThan(expandedBox);

    // ② 本体 rect 本身不变（无论描述区多大，节点本体就那么高）
    expect(expandedRect).toBe(collapsedRect);

    // ③ 展开后**布局盒**变高 —— 附属区长大 → 占布局、挤压相邻节点
    expect(expandedBox).toBeGreaterThan(collapsedBox);
  });

  it('qa 展开 + 描述区展开：注释区排在描述块之上，两者不重叠', () => {
    const { container, targetId } = renderBothExpanded();

    const panel = container.querySelector('[data-grow-comment]');
    const desc = container.querySelector('[data-desc-block]');
    expect(panel).not.toBeNull();
    expect(desc).not.toBeNull();

    const top = (el: Element): number => Number.parseFloat((el as HTMLElement).style.top);
    const height = (el: Element): number => Number.parseFloat((el as HTMLElement).style.height);

    // 注释区整体必须落在描述块**上方**（允许 1px 浮点误差）
    const panelBottom = top(panel!) + height(panel!);
    expect(panelBottom).toBeLessThanOrEqual(top(desc!) + 1);
    expect(targetId).not.toBe('');
  });

  it('展开是**占布局**的：measure 为该节点加高（挤压相邻节点，而非遮挡）', () => {
    const { root } = treeWithDesc();
    const node = root.children[0]!;
    const base = (): { w: number; h: number } => ({ w: 100, h: 34 });

    const collapsed = createDescMeasure(base, new Set(), new Set())(node);
    const expanded = createDescMeasure(base, new Set(), new Set([node.id]))(node);

    expect(expanded.h).toBeGreaterThan(collapsed.h);
    // 且是软上限（不是按内容无限撑高）
    expect(expanded.h).toBeLessThan(34 + 40 * 15);
  });
});
