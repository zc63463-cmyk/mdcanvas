// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EntityGraphPanel } from '../src/chrome/EntityGraphPanel.js';
import type { EntityRelation } from '../src/chrome/entityGraph.js';

const rels: EntityRelation[] = [
  {
    ref: { kind: 'issue', id: '1' },
    kind: 'issue',
    title: '门户显示优化',
    refNodes: [
      { nodeId: 'n1', text: '任务 A' },
      { nodeId: 'n2', text: '任务 B' },
    ],
  },
  {
    ref: { kind: 'doc', id: 'docs/a.md' },
    kind: 'doc',
    title: '01 架构',
    refNodes: [{ nodeId: 'n3', text: '关联文档' }],
  },
];

describe('EntityGraphPanel（F1：实体关系图视图）', () => {
  it('实体列表：kind 徽章 + 标题 + 引用数', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll('[data-entity-item]');
    expect(items.length).toBe(2);
    expect(container.textContent).toContain('@issue');
    expect(container.textContent).toContain('门户显示优化');
    expect(container.textContent).toContain('@doc');
    expect(container.textContent).toContain('2'); // issue 引用数
  });

  it('点实体 → 径向图出现（中心 + 引用节点 + 连线）', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull(); // 未选中 → 提示
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).not.toBeNull();
    expect(container.querySelector('[data-entity-center]')).not.toBeNull();
    expect(container.querySelectorAll('[data-ref-node]').length).toBe(2);
    expect(container.querySelectorAll('svg[data-relation-graph] line').length).toBe(2);
  });

  it('点引用节点 → onFocusNode(nodeId)', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={focus} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    fireEvent.click(container.querySelectorAll('[data-ref-node]')[0]!);
    expect(focus).toHaveBeenCalledWith('n1');
  });

  it('activeRefKey → 对应实体项高亮（data-active）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        activeRefKey="doc:docs/a.md"
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const items = container.querySelectorAll('[data-entity-item]');
    expect(items[1]!.getAttribute('data-active')).toBeDefined();
    expect(items[0]!.getAttribute('data-active')).toBeNull();
  });

  it('空关系 → 空态引导；关闭按钮 → onClose', () => {
    const close = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={[]} onFocusNode={vi.fn()} onClose={close} />,
    );
    expect(container.textContent).toContain('暂无实体引用');
    fireEvent.click(container.querySelector('[data-relation-close]')!);
    expect(close).toHaveBeenCalled();
  });
});

// ---------- E4：语义边区（连线一等公民）+ 星型降级 ----------
import type { EdgeListItem } from '../src/chrome/EntityGraphPanel.js';

const edgeItems: EdgeListItem[] = [
  {
    key: 'n1#0',
    rel: 'blocks',
    dir: 'fwd',
    sourceId: 'n1',
    sourceText: '任务 A',
    targetId: 'n4',
    targetText: '里程碑 M2',
  },
  {
    key: 'n3#0',
    rel: 'relates-to',
    dir: 'back',
    sourceId: 'n3',
    sourceText: '关联文档',
    targetId: null,
    targetText: 'issue:777',
  },
];

describe('EntityGraphPanel 语义边区（E4）', () => {
  it('edges 传入 → 连线区渲染（rel + 方向箭头 + 目标文本）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        edges={edgeItems}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const section = container.querySelector('[data-edge-section]');
    expect(section).not.toBeNull();
    expect(container.textContent).toContain('连线 2');
    expect(container.textContent).toContain('blocks');
    expect(container.textContent).toContain('任务 A → 里程碑 M2');
    expect(container.textContent).toContain('关联文档 ← issue:777');
  });

  it('点边行 → onFocusNode(源节点)', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={[]} edges={edgeItems} onFocusNode={focus} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelectorAll('[data-edge-item]')[0]!);
    expect(focus).toHaveBeenCalledWith('n1');
  });

  it('星型降级：仅点实体条目才出现星图；边行点击不触星图', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        edges={edgeItems}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull(); // 默认无星图
    fireEvent.click(container.querySelectorAll('[data-edge-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull();
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).not.toBeNull();
  });

  it('缺省 edges（向后兼容）→ 无连线区；既有行为不变', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('[data-edge-section]')).toBeNull();
    expect(container.querySelectorAll('[data-entity-item]').length).toBe(2);
  });
});
