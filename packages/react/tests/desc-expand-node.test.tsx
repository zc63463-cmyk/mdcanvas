// @vitest-environment jsdom
/**
 * 节点「放大展开」的行为守卫（2026-09-03）：
 * 表现形式是**浮出卡片**（沿用 floating 视觉），但同时**占布局** ——
 * measure 为该节点加高，于是会挤压相邻节点（树变形）。
 * 这两者曾经被混为一谈（一度以为 floating = 不占布局），这里锁住组合。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, type EditableNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createDescMeasure } from '../src/demo/pipeline.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function layoutOf(root: EditableNode) {
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

function treeWithDesc() {
  const child = makeTextNode('有注释的节点');
  child.note = { desc: '第一行注释\n第二行注释' };
  const other = makeTextNode('另一个节点');
  return { root: makeTextNode('根', [child, other]), childId: child.id, otherId: other.id };
}

/**
 * 构造一棵树并渲染。**expand 时用的 id 必须与树里的节点 id 一致**，
 * 所以整个流程（建树 → 取 id → 渲染）必须在同一个函数内完成 ——
 * 分开写会因 makeTextNode 每次生成新 id 而匹配不上。
 */
function renderExpanded(expand: boolean) {
  const { root } = treeWithDesc();
  const { layout, char } = layoutOf(root);
  // id 必须从 **layout** 里取：astToEditable 转换后 id 未必与原始树一致，
  // 用原始树里的 id 构造 Set 会匹配不上（曾因此误判"浮出视觉没生效"）。
  const targetId = layout.nodes.find((n) => n.node.note?.desc !== undefined)?.node.id ?? '';
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        expandedNodeIds={expand ? new Set([targetId]) : new Set()}
      />
    </ThemeProvider>,
  );
  return { container, targetId };
}

describe('节点放大展开（浮出卡片 + 占布局）', () => {
  it('未展开：描述区不带浮出卡片样式', () => {
    const { container } = renderExpanded(false);
    // 有 desc 的节点默认渲染描述区，但不是浮出卡片
    const blocks = container.querySelectorAll('[data-desc-block]');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.getAttribute('data-desc-floating')).toBe('false');
  });

  it('展开后：描述区沿用浮出卡片视觉（data-desc-floating=true）', () => {
    const { container } = renderExpanded(true);
    const floating = container.querySelector('[data-desc-block][data-desc-floating="true"]');
    expect(floating).not.toBeNull();
  });

  it('展开是**占布局**的：measure 为该节点加高（挤压相邻节点，而非遮挡）', () => {
    // 同一棵树取节点，保证 id 一致
    const { root, childId } = treeWithDesc();
    const node = root.children[0]!;
    const base = (): { w: number; h: number } => ({ w: 100, h: 34 });

    const collapsed = createDescMeasure(base, new Set(), new Set())(node);
    const expanded = createDescMeasure(base, new Set(), new Set([childId]))(node);

    expect(expanded.h).toBeGreaterThan(collapsed.h);
    // 且仍是软上限（不是按内容无限撑高）
    expect(expanded.h).toBeLessThan(34 + 40 * 15);
  });
});
