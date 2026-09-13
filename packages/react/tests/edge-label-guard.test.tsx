// @vitest-environment jsdom
/**
 * R4-3③：空 label 保护——rel 为空串时不再渲染空胶囊（标签整体不出现）。
 * label 非空 → 照常；label 空串 + rel 非空 → 回落 rel（保信息）；rel 兜底照常。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider, glassToken, FreeEdgeLayer } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { layoutMindmap } from '@mindcanvas/kernel';

function mountWithEdges(noteEdges: Array<Record<string, unknown>>) {
  const root: EditableNode = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
  root.note = { edges: noteEdges };
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const ln of layout.nodes) boxes.set(ln.node.id, ln.box);
  const edges = noteEdges.map((e, i) => ({
    key: `e${i}`,
    index: i,
    sourceId: (root.children[0] as EditableNode).id,
    targetId: (root.children[1] as EditableNode).id,
    from: 'node:根/A',
    to: 'node:根/B',
    rel: typeof e.rel === 'string' ? e.rel : '',
    dir: 'fwd' as const,
    state: 'well-formed' as const,
    ...(typeof e.label === 'string' ? { label: e.label } : {}),
  }));
  return render(
    <ThemeProvider>
      <svg>
        <FreeEdgeLayer
          edges={edges}
          boxOf={(id) => boxes.get(id)}
          root={root}
          collapsed={new Set()}
          token={glassToken}
        />
      </svg>
    </ThemeProvider>,
  );
}

describe('空 label 保护（R4-3③）', () => {
  it('rel 空串 → 不渲染空胶囊', () => {
    const { container } = mountWithEdges([{ rel: '', source: 'manual' }]);
    expect(container.querySelectorAll('[data-edge-label]').length).toBe(0);
  });

  it('label 非空 → 照常渲染；label 空串 + rel 非空 → 回落 rel；rel 兜底照常', () => {
    const labeled = mountWithEdges([{ rel: 'blocks', label: '硬依赖' }]);
    expect(labeled.container.querySelectorAll('[data-edge-label]').length).toBe(1);

    const emptyLabel = mountWithEdges([{ rel: 'blocks', label: '' }]);
    expect(emptyLabel.container.querySelectorAll('[data-edge-label]').length).toBe(1);

    const relOnly = mountWithEdges([{ rel: 'blocks' }]);
    expect(relOnly.container.querySelectorAll('[data-edge-label]').length).toBe(1);
  });
});
