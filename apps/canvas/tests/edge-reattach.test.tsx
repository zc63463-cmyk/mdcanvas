// @vitest-environment jsdom
/**
 * R2-1：重挂锚点——hook 写路径 + 应用层可见性。
 *
 * 红线（派遣计划 R2-A2/A3）：
 * - 唯一写路径 useEdgeActions.reattachEdge（内部 writeEdges + patchEdgeAt）
 * - 重挂只 patch 指定端，不得清 invalidAt；同批只动这一项
 * - 一次 undo 回滚
 * 应用层：dangling（源锚未解析）→ 重挂后 state 派生 well-formed、
 * edgeHealthOf dangling 归零、画布 [data-free-edge] +1。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '@mindcanvas/react';
import {
  EditorController,
  edgeHealthOf,
  MapView,
} from '@mindcanvas/react';
import { useEdgeActions } from '../src/hooks/useEdgeActions.js';
import { createCharMeasure, createNodeMeasure } from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';

beforeEach(() => {
  // canvas 套件统一 pretendToBeVisual:false（无 rAF）——controller 调度需补桩
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function buildController(): EditorController {
  const built = astToEditable(
    makeTextNode('根', [
      makeTextNode('任务'),
      makeTextNode('生活'),
      makeTextNode('孤儿'),
    ]),
  );
  if (built === null) throw new Error('fixture broken');
  built.note = {
    edges: [
      // 源锚未解析（node:根/幽灵 不存在）→ 画布不画；invalidAt 用户标记须保留
      { from: 'node:根/幽灵', to: 'node:根/生活', rel: 'relates-to', invalidAt: '2026-09-01T00:00:00.000Z' },
    ],
  };
  return new EditorController(built);
}

describe('useEdgeActions.reattachEdge（唯一写路径）', () => {
  it('重挂 from → 仅该项 from 被改写；invalidAt 保留；一次 undo 回滚', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));

    act(() => {
      result.current.reattachEdge(0, 'from', 'node:根/任务');
    });

    const raw = controller.root.note?.edges;
    expect(Array.isArray(raw)).toBe(true);
    const edge = (raw as Array<Record<string, unknown>>)[0];
    expect(edge?.from).toBe('node:根/任务');
    expect(edge?.to).toBe('node:根/生活');
    expect(edge?.rel).toBe('relates-to');
    expect(edge?.invalidAt).toBe('2026-09-01T00:00:00.000Z'); // R2-A3：不得清除
    expect((raw as unknown[]).length).toBe(1); // 同批只动这一项

    expect(controller.undo()).toBe(true);
    const rawAfter = controller.root.note?.edges;
    expect(Array.isArray(rawAfter)).toBe(true);
    const restored = Array.isArray(rawAfter)
      ? (rawAfter as Array<Record<string, unknown>>)[0]
      : undefined;
    expect(restored?.from).toBe('node:根/幽灵');
  });
});

describe('重挂后画布可见性（应用层闭环）', () => {
  function mountMap(controller: EditorController) {
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
    return render(
      <ThemeProvider>
        <MapView layout={layout} documentRoot={controller.root} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
  }

  it('dangling 源锚边默认不画 → 重挂后 [data-free-edge] +1 且 state=well-formed', () => {
    const controller = buildController();
    const first = mountMap(controller);
    // 源锚未解析 → renderable:false → 画布不画（历史裁决：不画误导性直线）
    expect(first.container.querySelectorAll('[data-free-edge]').length).toBe(0);

    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.reattachEdge(0, 'from', 'node:根/任务');
    });
    first.unmount();

    // 重挂后：state 派生 well-formed；edgeHealthOf dangling 归零；画布画出
    const second = mountMap(controller);
    const drawn = second.container.querySelectorAll('[data-free-edge]');
    expect(drawn.length).toBe(1);
    expect(drawn[0]?.getAttribute('data-free-edge-state')).toBe('well-formed');
    expect(edgeHealthOf(controller.root).byState.dangling).toBe(0);
    expect(edgeHealthOf(controller.root).renderable).toBe(1);
  });
});
