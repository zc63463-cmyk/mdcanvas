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
import { astToEditable, layoutMindmap, type EditableNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createDescMeasure } from '../src/demo/pipeline.js';
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

  const expandIds = expand ? new Set([targetId]) : new Set();
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
