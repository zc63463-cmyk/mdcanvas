/**
 * F 批：森林布局缓存（F1 通道 + F2 岛级 + F3 岛内）——**第一判据是逐位等价**。
 *
 * 判据为什么必须是"逐位"而不是"看起来对"：
 * - 缓存唯一能伤到用户的失效模式 = 静默陈旧几何（同族：stableByKeys 跨文档误复用 / selEdge 跨边复用）；
 * - 单次快照等价证明不了「原地平移 + 缓存复用 = 几何逐次漂移」——必须在**编辑序列**下逐步对比。
 * - 比较用 Object.is（区分 -0/+0，最严口径）；nodes 顺序本身也是判据的一部分。
 *
 * 夹具形态与 C5 取证脚本（scripts/bench-islands-matrix.mjs）同款：
 * 3 叉树 N∈{364,1093,3280} × 中心数 k∈{1,3,8}（BFS 前 k 个后代升格，坐标沿圆周散布）。
 */
import { describe, expect, it } from 'vitest';
import { LayoutCache, type LayoutResult } from '../src/layout/mindmap.js';
import { layoutForest, type CenterSpec } from '../src/layout/forest.js';
import { layoutIslands, projectIslands, type ValidatedCenterSpec } from '../src/layout/islands.js';
import type { EditableNode } from '../src/tree/treeOps.js';

// ---------- C5 同款夹具 ----------

/** 3 叉树：depth d → 节点数 (3^(d+1)−1)/2（d=5:364 / d=6:1093 / d=7:3280） */
function buildTree(depth: number): EditableNode {
  let seq = 0;
  const mk = (d: number): EditableNode => {
    seq += 1;
    const node: EditableNode = {
      id: `n${seq}`,
      type: 'text',
      text: d === 0 ? '根' : `n${seq}`,
      children: [],
    };
    if (d < depth) for (let i = 0; i < 3; i++) node.children.push(mk(d + 1));
    return node;
  };
  return mk(0);
}

const measure = (n: EditableNode): { w: number; h: number } => ({
  w: 40 + (n.text ? n.text.length : 0) * 6,
  h: 30,
});

/** BFS 收集前 k 个后代作为中心（一级分支优先；k=8 时含嵌套升格——与 C5 一致） */
function pickCenters(root: EditableNode, k: number): EditableNode[] {
  const out: EditableNode[] = [];
  const q = [...root.children];
  while (q.length > 0 && out.length < k) {
    const n = q.shift();
    if (!n) break;
    out.push(n);
    for (const c of n.children) q.push(c);
  }
  return out;
}

/**
 * 升格 k 个中心 → 投影 → 转 CenterSpec（layoutForest 输入）。
 * pos=null 的条目走自动排列分支（origin 计算另一条路径）。
 */
function specsOf(
  root: EditableNode,
  k: number,
  opts: { pos?: boolean } = {},
): { specs: CenterSpec[]; projection: ReturnType<typeof projectIslands> } {
  const picks = pickCenters(root, k);
  const centers: ValidatedCenterSpec[] = picks.map((node, i) => {
    const angle = (i / Math.max(k, 1)) * 2 * Math.PI;
    return {
      nodeId: node.id,
      at: `node:${node.id}`,
      dir: 'right',
      pos:
        opts.pos === false
          ? null
          : { x: Math.round(700 * Math.cos(angle)), y: Math.round(500 * Math.sin(angle)) },
      state: 'well-formed',
    };
  });
  const projection = projectIslands(root, centers);
  const specs: CenterSpec[] = projection.islands.map((island) => ({
    node: island.projectedRoot,
    dir: island.direction,
    ...(island.position !== null ? { pos: island.position } : {}),
  }));
  return { specs, projection };
}

// ---------- 逐位比较器（Object.is 口径；失败时给首个差异的完整上下文） ----------

function boxField(
  box: { x: number; y: number; w: number; h: number },
  k: 'x' | 'y' | 'w' | 'h',
): number {
  return box[k];
}

function expectBitIdentical(a: LayoutResult, b: LayoutResult, label: string): void {
  expect(a.nodes.length, `${label}：nodes 数`).toBe(b.nodes.length);
  expect(a.links.length, `${label}：links 数`).toBe(b.links.length);
  for (const [i, x] of a.nodes.entries()) {
    const y = b.nodes[i];
    if (!y) throw new Error(`${label}：b.nodes[${i}] 缺失`);
    expect(x.node.id, `${label}：nodes[${i}].id`).toBe(y.node.id);
    expect(x.side, `${label}：nodes[${i}].side`).toBe(y.side);
    expect(x.depth, `${label}：nodes[${i}].depth`).toBe(y.depth);
    expect(x.parentId, `${label}：nodes[${i}].parentId`).toBe(y.parentId);
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      const xv = boxField(x.box, k);
      const yv = boxField(y.box, k);
      expect(
        Object.is(xv, yv),
        `${label}：nodes[${i}].box.${k} 非逐位相等（${xv} vs ${yv}）`,
      ).toBe(true);
    }
  }
  for (const [i, x] of a.links.entries()) {
    const y = b.links[i];
    if (!y) throw new Error(`${label}：b.links[${i}] 缺失`);
    expect(x.path, `${label}：links[${i}].path`).toBe(y.path);
    expect(x.fromId, `${label}：links[${i}].fromId`).toBe(y.fromId);
    expect(x.toId, `${label}：links[${i}].toId`).toBe(y.toId);
    expect(x.depth, `${label}：links[${i}].depth`).toBe(y.depth);
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Object.is(a.bounds[k], b.bounds[k]), `${label}：bounds.${k}`).toBe(true);
  }
}

// ---------- F1：缓存通道 ----------

describe('F1：森林缓存通道（layoutForest / layoutIslands → 岛内）', () => {
  it('★ 传 cache 后 kernel 侧确实收到（键被森林入口记录）', () => {
    const root = buildTree(3);
    const { specs } = specsOf(root, 2);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    expect(cache.collapsedKey).toBeNull();

    layoutForest(specs, measure, collapsed, { cache, measureKey: 'K-forest' });

    expect(cache.collapsedKey).toBe(collapsed);
    expect(cache.measureKey).toBe('K-forest');
  });

  it('measureKey 变化 → 缓存作废并记录新键（身份比较契约）', () => {
    const root = buildTree(3);
    const { specs } = specsOf(root, 2);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    layoutForest(specs, measure, collapsed, { cache, measureKey: 'K1' });
    expect(cache.measureKey).toBe('K1');

    layoutForest(specs, measure, collapsed, { cache, measureKey: 'K2' });
    expect(cache.measureKey).toBe('K2');
    expect(cache.collapsedKey).toBe(collapsed);
  });

  it('layoutIslands 同样透传通道（A3 组装 API 不绕开缓存）', () => {
    const root = buildTree(3);
    const { projection } = specsOf(root, 2);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    layoutIslands(projection, measure, collapsed, { cache, measureKey: 'K-isl' });

    expect(cache.collapsedKey).toBe(collapsed);
    expect(cache.measureKey).toBe('K-isl');
  });
});

// ---------- F1：逐位等价基线（C5 矩阵） ----------

describe('F1：逐位等价基线（缓存开 vs 关闭；C5 矩阵 k×N）', () => {
  const MATRIX: Array<{ depth: number; k: number }> = [
    { depth: 5, k: 1 },
    { depth: 5, k: 3 },
    { depth: 5, k: 8 },
    { depth: 6, k: 1 },
    { depth: 6, k: 3 },
    { depth: 6, k: 8 },
    { depth: 7, k: 1 },
    { depth: 7, k: 3 },
    { depth: 7, k: 8 },
  ];

  for (const { depth, k } of MATRIX) {
    it(`N≈${depth} × k=${k}：nodes/links/bounds 全字段逐位相同`, () => {
      const root = buildTree(depth);
      const { specs } = specsOf(root, k);
      const collapsed = new Set<string>();
      const cache = new LayoutCache();

      const withCache = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });
      const full = layoutForest(specs, measure, collapsed);

      expectBitIdentical(withCache, full, `depth=${depth} k=${k}`);
    });
  }

  it('自动排列分支（无 pos）+ 有/无 pos 混搭：逐位相同', () => {
    const root = buildTree(4);
    const { specs } = specsOf(root, 3); // 根岛无 pos（自动排列）+ 3 个升格岛有 pos
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    // 混搭：第 1 个升格岛去 pos（自动排列）、第 2 个保留 pos、第 3 个去 pos——
    // origin 计算的「rightMost 演进」两条分支都被缓存路径走到。
    const mixed: CenterSpec[] = specs.map((s, i) => (i === 2 ? { node: s.node, dir: s.dir } : s));
    const withCache = layoutForest(mixed, measure, collapsed, { cache, measureKey: 'K' });
    const full = layoutForest(mixed, measure, collapsed);
    expectBitIdentical(withCache, full, 'mixed pos/auto');

    // 全自动排列（无 pos）
    const auto = specsOf(root, 3, { pos: false });
    const withCache2 = layoutForest(auto.specs, measure, collapsed, { cache, measureKey: 'K2' });
    const full2 = layoutForest(auto.specs, measure, collapsed);
    expectBitIdentical(withCache2, full2, 'all auto');
  });
});
