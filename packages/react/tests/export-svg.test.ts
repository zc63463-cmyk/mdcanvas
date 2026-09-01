import { describe, expect, it } from 'vitest';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { exportSvg } from '../src/chrome/exportSvg.js';
import { glassToken } from '../src/theme/tokens.js';
import { createNodeMeasure } from '../src/render/domMeasure.js';
import { createCharMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function layoutOf() {
  const root = astToEditable(makeTextNode('根', [makeTextNode('分支 A'), makeTextNode('分支 B')]))!;
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

describe('SVG 导出（GH-T4：全图导出）', () => {
  it('导出包含：svg 根 + 画布底 + 全部节点卡 + 全部连线', () => {
    const layout = layoutOf();
    const svg = exportSvg(layout, glassToken, { title: 'demo' });
    expect(svg.startsWith('<svg xmlns=')).toBe(true);
    expect(svg).toContain('<title>demo</title>');
    expect(svg).toContain('<rect'); // 画布底 + 节点卡
    // 3 节点 + 2 连线
    expect((svg.match(/<g transform=/g) ?? []).length).toBe(3);
    expect((svg.match(/<path d=/g) ?? []).length).toBe(2);
    expect(svg).toContain('根');
    expect(svg).toContain('分支 A');
  });

  it('view 缺省 = 全图（bounds 外扩）；显式 view 只导出可见部分', () => {
    const layout = layoutOf();
    const full = exportSvg(layout, glassToken);
    expect(full).toContain('viewBox='); // 外扩 bounds
    // 显式小视口（仅含根附近）→ 节点数变少
    const b = layout.bounds;
    const tiny = exportSvg(layout, glassToken, {
      view: { x: b.minX, y: b.minY, w: 1, h: 1 },
    });
    expect((tiny.match(/<g transform=/g) ?? []).length).toBeLessThan(3);
  });

  it('特殊字符转义（& < > 不破坏 XML）', () => {
    const root = astToEditable(makeTextNode('A & B <C>', []))!;
    const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
    const svg = exportSvg(layout, glassToken);
    expect(svg).toContain('A &amp; B &lt;C&gt;');
    expect(svg).not.toContain('A & B <C>');
  });
});
