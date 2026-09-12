// @vitest-environment jsdom
/**
 * G-P0：自由边路由重算治理 —— pan 期「路由整表重算」机制判别用例（先红）
 *
 * 判别指标 = `routeAesthetic` 的调用次数（vi.mock 包装计数）：
 *   基线（`visibleFreeEdges` 每帧产出新数组 → FreeEdgeLayer 路由 memo 击穿）
 *     → 每次平移每个可见边 ≥ 1 次调用（**先红**）；
 *   G-P1（内容键 identity 稳定化）后 → 纯平移（成员不变）**0 次**（绿）。
 *
 * 为什么用 routeAesthetic 调用次数：它直接对应「重算一次整表」的原子成本
 * （每边一次；跨边协调与跳线都在其外层，随整表重算一并发生）。
 *
 * 场景：5 节点树（LOD 阈值内）+ 2 条自由边（root.note.edges）。
 * 平移用真实指针路径驱动（pointerDown/Move/Up 于手势层，起点远离节点盒），
 * 与 `mapview-pan-memo.test.tsx` 同款——保证「平移确实生效」的证据位可断言。
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { MapView } from '../src/render/MapView.js';

/** routeAesthetic 调用计数（vi.mock 工厂内闭包引用，调用时求值——无 TDZ 问题） */
let routeCalls = 0;

vi.mock('../src/render/edgeRouting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/edgeRouting.js')>();
  return {
    ...actual,
    routeAesthetic: (...args: Parameters<typeof actual.routeAesthetic>) => {
      routeCalls++;
      return actual.routeAesthetic(...args);
    },
  };
});

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function mount() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  root.note = {
    edges: [
      { from: 'node:根/分支 A', to: 'node:根/分支 B', rel: 'blocks' },
      { from: 'node:根/分支 A/叶 1', to: 'node:根/分支 A/叶 2', rel: 'relates-to' },
    ],
  };
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel };
}

/** 投影 g 的 transform（平移是否生效的证据位） */
const projectionTransform = (c: HTMLElement): string | null =>
  c.querySelector('svg > g')?.getAttribute('transform') ?? null;

/** 纯平移一步（起点远离节点盒 → 走 pan 分支；单步位移 > 3px 阈值） */
function panStep(wheel: HTMLElement, dx: number, dy: number): void {
  const x = -4000;
  const y = -4000;
  fireEvent.pointerDown(wheel, { clientX: x, clientY: y, pointerId: 1, bubbles: true });
  fireEvent.pointerMove(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
}

/** 等若干帧（MapView 经 rAF 帧调度重渲染；jsdom 下须异步等帧） */
const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

beforeEach(() => {
  routeCalls = 0;
});

it('纯平移（可见集成员不变）不重算任何路由（routeAesthetic 调用次数 = 0）', async () => {
  const { container, wheel } = mount();
  await flushFrames(); // 首帧渲染 + 稳定

  // 夹具有效性：两条自由边都完成路由（否则本用例是空转）
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  // 计数器有效性：首帧确实调用过 routeAesthetic（mock 包装命中）
  expect(routeCalls, '首帧未发生任何 routeAesthetic 调用——mock 包装未生效?').toBeGreaterThan(0);

  routeCalls = 0; // 清零点：只看「纯平移」这一段
  const t0 = projectionTransform(container);
  panStep(wheel, 40, 25);
  await flushFrames();
  panStep(wheel, -15, 60);
  await flushFrames();

  // 平移确实生效（否则本用例是空转）
  expect(projectionTransform(container)).not.toBe(t0);
  // 判别指标：纯平移 0 次路由重算（基线会 ≥ 2：每次平移 × 每条可见边）
  expect(routeCalls, `pan 期整表重算了 ${routeCalls} 次 routeAesthetic——identity 未稳定`).toBe(0);
});
