// @vitest-environment jsdom
/**
 * C3：嵌套中心移动语义收口——**子岛不随父岛拖动**（钉住 + 文档化）。
 *
 * 语义裁决（计划 §1.2 / C-A3）：子岛有独立坐标身份（pos / center_pos），
 * 父岛拖动**不带动**子岛——否则与「独立落位」承诺冲突。
 *
 * 本文件走**真实管线**（与画布同源）：
 *   root.note.centers（含节点 note.cid）→ collectCenters → buildIslandView
 *   → specs → layoutForest → MapView（islandMembers = membersByRoot）
 * 判别断言：
 * - 投影层：父岛成员已剔除升格子岛（membersByRoot 不含对方成员）；
 * - 渲染层：拖 P → P 岛成员盒位移、C 岛成员盒**不动**；拖 C → 反向。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutForest, makeTextNode } from '@mindcanvas/kernel';
import { collectCenters } from '../src/render/centers.js';
import { buildIslandView } from '../src/demo/pipeline.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 嵌套两岛夹具：root → P（升格）→ [p1, C（升格）→ c1]。
 * P 岛成员 = [P, p1]；C 岛成员 = [C, c1]（C 从 P 岛剔除）。
 * jsdom 视口 0×0 + cull margin 双重外扩 → 有效可见范围约 ±256：
 * 两岛贴近原点摆放（pos = 岛根盒中心），保证全部成员都真实渲染（防裁剪假绿）。
 */
function nestedFixture() {
  const root = astToEditable(
    makeTextNode('root', [makeTextNode('P', [makeTextNode('p1'), makeTextNode('C', [makeTextNode('c1')])])]),
  );
  if (root === null) throw new Error('fixture broken: astToEditable returned null');
  const p = root.children[0];
  if (p === undefined) throw new Error('fixture broken: P missing');
  const p1 = p.children[0];
  if (p1 === undefined) throw new Error('fixture broken: p1 missing');
  const c = p.children[1];
  if (c === undefined) throw new Error('fixture broken: C missing');
  const c1 = c.children[0];
  if (c1 === undefined) throw new Error('fixture broken: c1 missing');
  p.note = { cid: 'c1' };
  c.note = { cid: 'c2' };
  root.note = {
    centers: [
      { at: 'node:root/P', dir: 'right', cid: 'c1', x: 0, y: 0 },
      { at: 'node:root/P/C', dir: 'right', cid: 'c2', x: 120, y: 0 },
    ],
  };
  return { root, p, p1, c, c1 };
}

function transformOf(container: HTMLElement, id: string): string | null {
  return container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;
}

function setup() {
  const f = nestedFixture();
  const view = buildIslandView(f.root, collectCenters(f.root));
  if (view.specs === null) throw new Error('fixture broken: specs null');
  const layout = layoutForest(view.specs, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        centerIds={new Set([f.p.id, f.c.id])}
        islandMembers={view.membersByRoot}
        onCenterMove={vi.fn()}
      />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]');
  if (!(wheel instanceof HTMLElement)) throw new Error('fixture broken: wheel missing');
  const centerOf = (id: string) => {
    const n = layout.nodes.find((x) => x.node.id === id);
    if (n === undefined) throw new Error(`fixture broken: layout node ${id} missing`);
    return { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 };
  };
  return { container, wheel, centerOf, f, view };
}

describe('C3 嵌套跟随语义：投影层（升格子岛从父岛剔除）', () => {
  it('membersByRoot：P 岛 = [P, p1]、C 岛 = [C, c1]，互不含对方成员', () => {
    const f = nestedFixture();
    const view = buildIslandView(f.root, collectCenters(f.root));
    expect(view.membersByRoot.get(f.p.id)).toEqual([f.p.id, f.p1.id]);
    expect(view.membersByRoot.get(f.c.id)).toEqual([f.c.id, f.c1.id]);
  });
});

describe('C3 嵌套跟随语义：拖父中心 P → 子岛 C 不随动（判别钉住）', () => {
  it('拖 P：P 岛成员盒位移、C 岛成员盒不动', () => {
    const { container, wheel, centerOf, f } = setup();
    const pBefore = transformOf(container, f.p.id);
    const p1Before = transformOf(container, f.p1.id);
    const cBefore = transformOf(container, f.c.id);
    const c1Before = transformOf(container, f.c1.id);
    // 防裁剪假绿：四个成员都必须真实渲染
    expect(pBefore).not.toBeNull();
    expect(p1Before).not.toBeNull();
    expect(cBefore).not.toBeNull();
    expect(c1Before).not.toBeNull();

    const pPos = centerOf(f.p.id);
    fireEvent.pointerDown(wheel, { clientX: pPos.x, clientY: pPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, {
      clientX: pPos.x + 30,
      clientY: pPos.y + 20,
      pointerId: 1,
      bubbles: true,
    });

    // P 岛成员位移（预览生效）
    expect(transformOf(container, f.p.id)).not.toBe(pBefore);
    expect(transformOf(container, f.p1.id)).not.toBe(p1Before);
    // ★ C 岛成员不随父岛动（钉住「不跟随」）
    expect(transformOf(container, f.c.id)).toBe(cBefore);
    expect(transformOf(container, f.c1.id)).toBe(c1Before);
  });
});

describe('C3 嵌套跟随语义：拖子中心 C → 父岛 P 不随动（反向）', () => {
  it('拖 C：C 岛成员盒位移、P 岛成员盒不动', () => {
    const { container, wheel, centerOf, f } = setup();
    const pBefore = transformOf(container, f.p.id);
    const p1Before = transformOf(container, f.p1.id);
    const cBefore = transformOf(container, f.c.id);
    const c1Before = transformOf(container, f.c1.id);
    expect(pBefore).not.toBeNull();
    expect(cBefore).not.toBeNull();

    const cPos = centerOf(f.c.id);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, {
      clientX: cPos.x + 30,
      clientY: cPos.y + 20,
      pointerId: 1,
      bubbles: true,
    });

    // C 岛成员位移
    expect(transformOf(container, f.c.id)).not.toBe(cBefore);
    expect(transformOf(container, f.c1.id)).not.toBe(c1Before);
    // ★ P 岛成员不动（反向钉住）
    expect(transformOf(container, f.p.id)).toBe(pBefore);
    expect(transformOf(container, f.p1.id)).toBe(p1Before);
  });
});
