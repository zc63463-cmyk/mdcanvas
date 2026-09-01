import { describe, expect, it } from 'vitest';
import {
  getLayout,
  isLayoutKind,
  layoutFishbone,
  layoutLogic,
  layoutOrg,
  layoutTimeline,
  type LayoutKind,
} from '../src/layout/layouts.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

const measure = (): { w: number; h: number } => ({ w: 100, h: 30 });

function fixture(): EditableNode {
  return t('r', [t('a', [t('a1'), t('a2')]), t('b', [t('b1')])]);
}

const boxById = (
  nodes: Array<{ node: EditableNode; box: { x: number; y: number; w: number; h: number } }>,
  id: string,
) => nodes.find((n) => n.node.id === id)?.box;

describe('layout/layouts：org 组织架构（自顶向下行式）', () => {
  const r = layoutOrg(fixture(), measure, new Set());

  it('覆盖全部可见节点（前序），links = 非根可见节点数', () => {
    expect(r.nodes.map((n) => n.node.id)).toEqual(['r', 'a', 'a1', 'a2', 'b', 'b1']);
    expect(r.links).toHaveLength(5);
  });

  it('同层同行：根在第 0 行，一级子同 y；子行在根下方', () => {
    const root = boxById(r.nodes, 'r');
    const a = boxById(r.nodes, 'a');
    const b = boxById(r.nodes, 'b');
    const a1 = boxById(r.nodes, 'a1');
    expect(a && root ? a.y > root.y : false).toBe(true);
    expect(a && b ? a.y === b.y : false).toBe(true);
    expect(a1 && a ? a1.y > a.y : false).toBe(true);
  });
});

describe('layout/layouts：timeline 横向时间轴（深度列）', () => {
  const r = layoutTimeline(fixture(), measure, new Set());

  it('覆盖全部节点，links 一致', () => {
    expect(r.nodes).toHaveLength(6);
    expect(r.links).toHaveLength(5);
  });

  it('深度向右展开：一级子 x 相同列且位于根右', () => {
    const a = boxById(r.nodes, 'a');
    const b = boxById(r.nodes, 'b');
    const root = boxById(r.nodes, 'r');
    expect(a && root ? a.x > root.x : false).toBe(true);
    expect(a && b ? a.x === b.x : false).toBe(true);
  });

  it('折叠节点不展开子女（links 相应减少）', () => {
    const r2 = layoutTimeline(fixture(), measure, new Set(['a']));
    expect(r2.nodes.map((n) => n.node.id)).not.toContain('a1');
    // r-a, r-b, b-b1（a 子树折叠）
    expect(r2.links).toHaveLength(3);
  });
});

describe('layout/layouts：fishbone 鱼骨（一级分支上下交错）', () => {
  const r = layoutFishbone(fixture(), measure, new Set());

  it('覆盖全部节点，links 一致', () => {
    expect(r.nodes).toHaveLength(6);
    expect(r.links).toHaveLength(5);
  });

  it('一级分支左右分侧（+1/-1 交替）且位于根右侧', () => {
    const a = r.nodes.find((n) => n.node.id === 'a');
    const b = r.nodes.find((n) => n.node.id === 'b');
    expect(a?.side).toBe(1);
    expect(b?.side).toBe(-1);
    expect(a && b ? a.box.x > 0 && b.box.x > 0 : false).toBe(true);
  });
});

describe('layout/layouts：logic 单侧逻辑图（全部同侧延伸）', () => {
  it('logic-right：全部 side=1，一级子位于根右缘右侧且沿文档序 y 单调递增', () => {
    const r = layoutLogic(fixture(), measure, new Set(), 1);
    expect(r.nodes.filter((n) => n.depth > 0).every((n) => n.side === 1)).toBe(true);
    expect(r.links).toHaveLength(5);
    const root = boxById(r.nodes, 'r');
    const a = boxById(r.nodes, 'a');
    const b = boxById(r.nodes, 'b');
    const a1 = boxById(r.nodes, 'a1');
    expect(a && root ? a.x >= root.x + root.w : false).toBe(true);
    expect(a && b ? a.y < b.y : false).toBe(true);
    expect(a1 && a ? a1.x >= a.x + a.w : false).toBe(true);
  });

  it('logic-left：对称镜像，全部 side=-1，一级子左缘在根左缘左侧且 x 单调不递增', () => {
    const r = layoutLogic(fixture(), measure, new Set(), -1);
    expect(r.nodes.filter((n) => n.depth > 0).every((n) => n.side === -1)).toBe(true);
    const root = boxById(r.nodes, 'r');
    const a = boxById(r.nodes, 'a');
    const a1 = boxById(r.nodes, 'a1');
    expect(a && root ? (a.x ?? 0) + (a.w ?? 0) <= root.x : false).toBe(true);
    expect(a1 && a ? (a1.x ?? 0) + (a1.w ?? 0) <= a.x : false).toBe(true);
  });

  it('折叠行为与 mindmap 一致（a 折叠时 a1/a2 不可见）', () => {
    const r = layoutLogic(fixture(), measure, new Set(['a']), 1);
    expect(r.nodes.map((n) => n.node.id)).not.toContain('a1');
    expect(r.links).toHaveLength(3); // r-a, r-b, b-b1
  });

  it('边界：无子女根 → 仅根节点、零连线', () => {
    const r = layoutLogic(t('only'), measure, new Set(), 1);
    expect(r.nodes).toHaveLength(1);
    expect(r.links).toHaveLength(0);
  });

  it('边界：折叠根 → 一级子全部不可见', () => {
    const r = layoutLogic(fixture(), measure, new Set(['r']), 1);
    expect(r.nodes.map((n) => n.node.id)).toEqual(['r']);
    expect(r.links).toHaveLength(0);
  });

  it('注册表识别 logic-right/logic-left 且可执行', () => {
    expect(isLayoutKind('logic-right')).toBe(true);
    expect(getLayout('logic-right')).toBeDefined();
    expect(getLayout('logic-left')(fixture(), measure, new Set()).nodes).toHaveLength(6);
  });

  it('未知布局类型回退思维导图（getLayout 兜底）', () => {
    const fallback = getLayout('bogus' as LayoutKind);
    expect(fallback).toBe(getLayout('mindmap'));
    expect(fallback(fixture(), measure, new Set()).nodes).toHaveLength(6);
  });
});
