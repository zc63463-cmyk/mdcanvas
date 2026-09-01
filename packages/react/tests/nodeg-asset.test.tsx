// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function assetLayout() {
  const root = makeTextNode('根', [
    makeEntityNode({ kind: 'img', id: 'demo-assets/demo-diagram.svg' }),
    makeEntityNode({ kind: 'draw', id: 'demo-assets/board.svg' }),
    makeEntityNode({ kind: 'issue', id: '1' }),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

describe('NodeG：@img/@draw 资产预览渲染', () => {
  it('img/draw 实体节点渲染 <image> 且 href 拼接 assetBaseUrl（导图根 + 相对路径）', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const imgs = container.querySelectorAll('image');
    const hrefs = Array.from(imgs).map((i) => i.getAttribute('href'));
    expect(hrefs).toContain('/demo-assets/demo-diagram.svg');
    expect(hrefs).toContain('/demo-assets/board.svg');
  });

  it('非资产实体（@issue）不渲染 <image>', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('image').length).toBe(2);
  });
});
