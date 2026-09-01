import { describe, expect, it } from 'vitest';
import { defaultMeasure, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import { THEMES } from '../src/theme/tokens.js';
import {
  buildLinkPath,
  computeBranchIndex,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
} from '../src/render/geometry.js';

const classic = THEMES.classic;
const sticker = THEMES.sticker;
const glass = THEMES.glass;

describe('nodeCardStyle：节点卡片样式（全令牌驱动）', () => {
  it('classic 分支卡 = 分支色板；叶卡 = 分支 leaf 浅化变体', () => {
    const b = classic.color.branches[0]!;
    const card = nodeCardStyle(classic, b, 'branch');
    expect(card.fill).toBe('#fef2e4');
    expect(card.stroke).toBe('#d97706');
    expect(card.radius).toBe(9);
    const leaf = nodeCardStyle(classic, b, 'leaf');
    expect(leaf.fill).toBe('#fff7ec');
    expect(leaf.stroke).toBe('#e8a34e');
    expect(leaf.radius).toBe(8);
  });

  it('sticker 叶卡回退 leafDefault（橄榄贴）；分支卡带 drop-shadow', () => {
    const card = nodeCardStyle(sticker, sticker.color.branches[1], 'branch');
    expect(card.filter).toContain('drop-shadow');
    const leaf = nodeCardStyle(sticker, sticker.color.branches[1], 'leaf');
    expect(leaf.fill).toBe('#eaf3de');
    expect(leaf.stroke).toBe('#639922');
  });

  it('glass 分支卡半透明白；叶卡霓虹（对照 V8 SVG）', () => {
    const card = nodeCardStyle(glass, glass.color.branches[0], 'branch');
    expect(card.fill).toBe('rgba(255,255,255,.05)');
    expect(card.stroke).toBe('rgba(255,255,255,.18)');
    const leaf = nodeCardStyle(glass, glass.color.branches[0], 'leaf');
    expect(leaf.fill).toBe('rgba(122,233,196,.08)');
    expect(leaf.stroke).toBe('rgba(122,233,196,.35)');
  });

  it('实体节点按 KIND_META 语义色描边（跨主题一致）', () => {
    for (const t of [classic, sticker, glass]) {
      const card = nodeCardStyle(t, t.color.branches[0], 'branch', 'issue');
      expect(card.stroke).toBe('#d97706'); // KIND_META.issue
      expect(card.fill).toBe(t.color.entityFill);
      expect(card.text).toBe(t.color.entityText);
    }
  });

  it('缺色板时回退 branches[0]（根节点）', () => {
    const card = nodeCardStyle(classic, undefined, 'branch');
    expect(card.fill).toBe('#fef2e4');
  });
});

describe('buildLinkPath：连线语言分支', () => {
  const parent: Box = { x: 0, y: 0, w: 100, h: 40 };
  const child: Box = { x: 200, y: 0, w: 80, h: 30 };
  it('classic color-curve：注入分支色后描边=分支色，曲线=compactBezier', () => {
    const p = buildLinkPath(classic, parent, child, classic.color.branches[2]);
    expect(p.stroke).toBe('#0c8599');
    expect(p.d.startsWith('M ')).toBe(true);
    expect(p.d.includes('C ')).toBe(true);
  });

  it('sticker wavy：任意曲线为双弧 S 形（两个 C 段）', () => {
    const p = buildLinkPath(sticker, parent, child);
    expect(p.stroke).toBe('#c9c4b8'); // 灰连线
    const cCount = (p.d.match(/C /g) ?? []).length;
    expect(cCount).toBe(2);
  });

  it('glass soft：柔和贝塞尔，退避灰连线', () => {
    const p = buildLinkPath(glass, parent, child);
    // #646b7d：对 glass 底色 #16181d 约 3.4:1；旧值 #3a3f4d 仅 2.3:1，深色主题下连线近乎不可见
    expect(p.stroke).toBe('#646b7d');
    expect(p.width).toBe(1.2);
  });

  it('wavy 支持左侧反向（dir=-1）且以 M 开头', () => {
    const leftChild: Box = { x: -300, y: 10, w: 80, h: 30 };
    const p = buildLinkPath(sticker, child, leftChild);
    expect(p.d.startsWith('M ')).toBe(true);
  });
});

describe('几何工具', () => {
  it('nodeHitTest：盒内命中 + pad 外扩', () => {
    const box: Box = { x: 10, y: 10, w: 100, h: 40 };
    expect(nodeHitTest(box, 60, 30)).toBe(true);
    expect(nodeHitTest(box, 5, 30)).toBe(false);
    expect(nodeHitTest(box, 5, 30, 6)).toBe(true);
  });

  it('computeBranchIndex：一级分支=自身序，深层继承', () => {
    const root = makeTextNode('root', [
      makeTextNode('b1', [makeTextNode('b1-1')]),
      makeTextNode('b2'),
    ]);
    const layout = layoutMindmap(root, defaultMeasure, new Set());
    const idx = computeBranchIndex(layout.nodes);
    expect(idx.get(root.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b1')!.node.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b1-1')!.node.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b2')!.node.id)).toBe(1);
  });

  it('LOD：阈值化简、省略叶文本', () => {
    expect(lodFor(1)).toBe('full');
    expect(lodFor(0.3)).toBe('detail');
    expect(lodFor(0.2)).toBe('skeleton');
    expect(lodSkipText('full', 3)).toBe(false);
    expect(lodSkipText('detail', 2)).toBe(true);
    expect(lodSkipText('detail', 1)).toBe(false);
    expect(lodSkipText('skeleton', 0)).toBe(true);
  });
});
