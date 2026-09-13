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
import { updateNode, walkNodes, type EditableNode } from '../src/tree/treeOps.js';

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

// ---------- F2：岛级缓存（未编辑岛零重算；非破坏式平移） ----------

/** 非空取值辅助（测试内避免 `!`——lint 水位纪律） */
function req<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null) throw new Error(`req 失败：${msg}`);
  return v;
}

/** 计数 measure：记录被度量的节点 id——「未重算」的最强证据 = measure 零调用 */
function countingMeasure(): {
  measure: (n: EditableNode) => { w: number; h: number };
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    measure: (n) => {
      calls.push(n.id);
      return measure(n);
    },
  };
}

/** 子树第一个最深叶子 */
function deepLeaf(node: EditableNode): EditableNode {
  let cur = node;
  while (cur.children.length > 0) cur = req(cur.children[0], 'deepLeaf child');
  return cur;
}

/** 子树全部 id */
function subtreeIds(node: EditableNode): Set<string> {
  const out = new Set<string>();
  walkNodes(node, (n) => out.add(n.id));
  return out;
}

describe('F2：岛级缓存（未编辑岛零重算；非破坏式平移）', () => {
  it('★ 编辑最后一个岛 → 前序未编辑岛节点引用复用、其它岛零度量、全输出逐位等价', () => {
    const root0 = buildTree(5);
    const first = specsOf(root0, 3);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    const r1 = layoutForest(first.specs, measure, collapsed, { cache, measureKey: 'K' });
    const byId1 = new Map(r1.nodes.map((n) => [n.node.id, n]));

    // 编辑【最后一个中心】子树内最深叶子（文本加长 → 自身几何变化；
    // 前序岛的 origin 不受影响：pos 岛 origin 恒定、rightMost 演进只看前序 bounds）
    const picks = pickCenters(root0, 3);
    const island3 = req(picks[2], '第 3 个中心');
    const leaf = deepLeaf(island3);
    const edited = updateNode(root0, leaf.id, { text: `${leaf.text ?? ''}#加长` });

    const second = specsOf(edited, 3);
    const spy = countingMeasure();
    const r2 = layoutForest(second.specs, spy.measure, collapsed, { cache, measureKey: 'K' });
    const byId2 = new Map(r2.nodes.map((n) => [n.node.id, n]));

    // ① 未编辑岛（中心 1、2）节点引用复用（placedAt 命中 → 直接复用上次平移产物）
    const ids1 = subtreeIds(req(first.specs[1], '中心 1').node);
    const ids2 = subtreeIds(req(first.specs[2], '中心 2').node);
    let checked = 0;
    for (const id of [...ids1, ...ids2]) {
      const b = byId1.get(id);
      const a = byId2.get(id);
      expect(a, `节点 ${id} 缺失`).toBeDefined();
      expect(a, `未编辑岛节点 ${id} 应引用复用`).toBe(b);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);

    // ② 编辑岛（中心 3）重算：引用必变
    expect(byId2.get(island3.id), '编辑岛应重算（新对象）').not.toBe(byId1.get(island3.id));

    // ③ 未编辑岛零度量：中心 1、2 中无一节点被重新 measure
    for (const id of [...ids1, ...ids2]) {
      expect(spy.calls.includes(id), `节点 ${id} 不应被重新度量`).toBe(false);
    }

    // ④ 全输出与无缓存路径逐位等价（编辑后的每一步都不得漂移）
    const full = layoutForest(second.specs, measure, collapsed);
    expectBitIdentical(r2, full, '编辑后（缓存开 vs 关）');
  });

  it('★ 幂等性：同文档连续 3 次（缓存开）输出逐位相同（坑 1 判别）', () => {
    const root = buildTree(5);
    const { specs } = specsOf(root, 3);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    const r1 = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });
    const r2 = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });
    const r3 = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });

    expectBitIdentical(r1, r2, '幂等 1→2');
    expectBitIdentical(r2, r3, '幂等 2→3');
  });

  it('★ 编辑序列（20 步，pos 夹具）：每步缓存开/关逐位等价', () => {
    let root = buildTree(5);
    const leafIds = pickCenters(root, 3).map((c) => deepLeaf(c).id);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    for (let step = 0; step < 20; step++) {
      const i = step % 3;
      root = updateNode(root, req(leafIds[i], `第 ${i} 个叶子 id`), {
        text: `step${step}-加长文本`,
      });
      const { specs } = specsOf(root, 3);
      const inc = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });
      const full = layoutForest(specs, measure, collapsed);
      expectBitIdentical(inc, full, `step ${step}`);
    }
  });

  it('★ 编辑序列（8 步，无 pos 夹具）：前岛放大挤动后岛（place 重建路径），每步逐位等价', () => {
    let root = buildTree(5);
    const leafIds = pickCenters(root, 3).map((c) => deepLeaf(c).id);
    const collapsed = new Set<string>();
    const cache = new LayoutCache();

    for (let step = 0; step < 8; step++) {
      const i = step % 3;
      root = updateNode(root, req(leafIds[i], `叶子 ${i}`), {
        text: `s${step}-更长-文本-长-长-长`,
      });
      const { specs } = specsOf(root, 3, { pos: false });
      const inc = layoutForest(specs, measure, collapsed, { cache, measureKey: 'K' });
      const full = layoutForest(specs, measure, collapsed);
      expectBitIdentical(inc, full, `auto step ${step}`);
    }
  });

  it('折叠集引用变化 → 整体重算且逐位等价（契约：身份比较）', () => {
    const root = buildTree(5);
    const { specs } = specsOf(root, 3);
    const cache = new LayoutCache();
    const c1 = new Set<string>();
    layoutForest(specs, measure, c1, { cache, measureKey: 'K' });

    const inner = req(pickCenters(root, 3)[1], '中心 2').children[0];
    const c2 = new Set<string>(inner ? [inner.id] : []);
    const spy = countingMeasure();
    const inc = layoutForest(specs, spy.measure, c2, { cache, measureKey: 'K' });
    const full = layoutForest(specs, measure, c2);
    expectBitIdentical(inc, full, '折叠变化');

    // 整体重算：此前在缓存里的未编辑岛节点也被重新度量
    const ids1 = subtreeIds(req(specs[1], '中心 1').node);
    expect(
      [...ids1].some((id) => spy.calls.includes(id)),
      '折叠集换引用后未编辑岛也应重算',
    ).toBe(true);
  });

  it('measureKey 变化 → 整体重算且逐位等价', () => {
    const root = buildTree(5);
    const { specs } = specsOf(root, 3);
    const cache = new LayoutCache();
    const collapsed = new Set<string>();
    layoutForest(specs, measure, collapsed, { cache, measureKey: 'K1' });

    const spy = countingMeasure();
    const inc = layoutForest(specs, spy.measure, collapsed, { cache, measureKey: 'K2' });
    const full = layoutForest(specs, measure, collapsed);
    expectBitIdentical(inc, full, '度量键变化');

    const ids2 = subtreeIds(req(specs[2], '中心 2').node);
    expect([...ids2].some((id) => spy.calls.includes(id))).toBe(true);
  });
});
