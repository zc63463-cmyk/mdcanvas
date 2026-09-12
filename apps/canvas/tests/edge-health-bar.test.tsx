// @vitest-environment jsdom
/**
 * EdgeHealthBar（R0-2）：边健康度诊断条。
 *
 * 行为规格（派遣计划 R0-2）：
 * - 仅当 problems.length > 0 渲染；全健康 → 不渲染（阴性对照钉死此条件）
 * - 文案 `⚠ 关系线诊断：N 条（悬空 X / 陈旧 Y / 失效 Z）` + 最多 3 条明细 + 其余略
 * - pointerEvents: 'none'（不挡画布）；不做点击跳转（归 R2）
 *
 * MindmapStage 接线冒烟：健康网关（无边）挂载后不出现诊断条（覆盖 stage 内
 * edgeHealthOf 的 useMemo 求值路径不抛错；出现分支由组件级用例覆盖——stage 无
 * 注入缝，边数据无法从外部种入内置 controller，与仓库「面板细粒度行为走组件
 * 测试」的分工一致）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { makeEntityNode, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { EdgeHealthBar, edgeHealthOf } from '@mindcanvas/react';
import MindmapStage from '../src/MindmapStage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** 缺元素即抛错（替代 `!` 非空断言——新代码零 lint 告警纪律） */
function q(selector: string, root: ParentNode): Element {
  const el = root.querySelector(selector);
  if (el === null) throw new Error(`element not found: ${selector}`);
  return el;
}

/** 1 条 dangling 边的最小夹具 */
function danglingRoot(): EditableNode {
  const root = makeTextNode('根', [makeTextNode('A')]);
  root.note = { edges: [{ from: 'node:根/A', to: 'node:根/不存在', rel: 'relates-to' }] };
  return root;
}

/** 5 条坏边夹具（明细截断用） */
function messyRoot(): EditableNode {
  const root = makeTextNode('根', [
    makeTextNode('A'),
    makeTextNode('分支', [makeEntityNode({ kind: 'issue', id: '8' }), makeEntityNode({ kind: 'issue', id: '8' })]),
  ]);
  root.note = {
    edges: [
      { from: 'node:根/A', to: 'node:根/坏1', rel: 'relates-to' }, // dangling
      { from: 'node:根/A', to: 'node:根/坏2', rel: 'relates-to' }, // dangling
      { from: 'node:根/A', to: '@issue:8', rel: 'relates-to' }, // stale（同名歧义）
      { from: 'node:根/A', to: 'node:根/A', rel: 'relates-to' }, // selfAnchor
      { from: 'node:根/A', to: 'node:根/坏3', rel: 'relates-to' }, // dangling
    ],
  };
  return root;
}

describe('EdgeHealthBar 组件', () => {
  it('全健康（problems 为空）→ 不渲染', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(root)} bottom={178} />);
    expect(container.querySelector('[data-edge-health-bar]')).toBeNull();
  });

  it('1 条 dangling → 条出现、计数正确、明细含锚文本与状态', () => {
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(danglingRoot())} bottom={178} />);
    const bar = q('[data-edge-health-bar]', container);
    expect(bar.textContent).toContain('关系线诊断：1 条（悬空 1 / 陈旧 0 / 失效 0）');
    expect(bar.textContent).toContain('node:根/不存在');
    expect(bar.textContent).toContain('悬空');
    // 非阻塞：不挡画布
    expect((bar as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('5 条坏边 → 明细最多 3 条 + 「其余 N 条略」', () => {
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(messyRoot())} bottom={178} />);
    const bar = q('[data-edge-health-bar]', container);
    expect(bar.textContent).toContain('关系线诊断：5 条（悬空 3 / 陈旧 1 / 失效 0）');
    expect(bar.querySelectorAll('[data-edge-health-detail]').length).toBe(3);
    expect(bar.textContent).toContain('其余 2 条略');
  });
});

describe('MindmapStage 接线冒烟', () => {
  it('健康内置网关挂载 → 不出现边健康度条（接线求值路径不抛错）', () => {
    const { container } = render(<MindmapStage />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-edge-health-bar]')).toBeNull();
  });
});
