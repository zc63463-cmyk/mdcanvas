/**
 * G-P3：等价性守护 —— 「每边成本」优化（G-P3a 解析器预计算 + 障碍预构建表）与旧路径逐字段等价。
 *
 * 本文件在**接线前**先立标准（对当时生产旧路径必绿），接线路径后仍须绿；
 * 任一路径语义/顺序漂移即变红。覆盖（确定性随机，mulberry32）：
 *  ① freeEdgeEndpoints：随机树（含折叠子树）× 随机折叠集 × 随机边
 *     （normal / 自关联 / ghost 靶点 / 缺盒 / 零盒 / 不在树中的 id / null 端）→
 *     旧路径 vs resolve 注入路径**逐字段相等**（含 renderable / ghost / from / to）；
 *  ② ObstacleTable.without：与旧 filter+map 逐项**同序同引用**相等；
 *  ③ 整表重算管线模拟：旧管线（每端点 DFS + 每边 filter/map）vs 新管线（解析器 + 表复用）
 *     → 全部 RouteResult 逐位相等（d 字符串 / points / mid / nx / ny / routed）。
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import { edgeResolverOf, freeEdgeEndpoints, type FreeEdge } from '../src/render/freeEdges.js';
import { buildObstacleTable } from '../src/render/obstacleTable.js';
import { routeAesthetic } from '../src/render/edgeRouting.js';

/** 确定性伪随机（与 scripts/bench-freeedge.mjs 同款 mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandScene {
  root: EditableNode;
  nodes: EditableNode[];
  collapsed: Set<string>;
  boxes: Map<string, Box>;
  boxOf: (id: string) => Box | undefined;
}

/** 随机树 + 随机折叠 + 盒怪癖（缺盒 15% / 零盒 10% / 正常盒） */
function makeScene(rnd: () => number, count: number): RandScene {
  const nodes: EditableNode[] = [];
  for (let i = 0; i < count; i++) nodes.push(makeTextNode('n' + i));
  for (let i = 1; i < count; i++) {
    const parent = nodes[Math.floor(rnd() * i)];
    const node = nodes[i];
    if (parent && node) parent.children.push(node);
  }
  const root = nodes[0];
  if (!root) throw new Error('empty scene');
  const collapsed = new Set<string>();
  for (const n of nodes) {
    if (n !== root && rnd() < 0.3) collapsed.add(n.id);
  }
  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    const r = rnd();
    if (r < 0.15) continue; // 缺盒
    if (r < 0.25) boxes.set(n.id, { x: rnd() * 500, y: rnd() * 300, w: 0, h: 0 }); // 零盒
    else
      boxes.set(n.id, {
        x: rnd() * 1200,
        y: rnd() * 700,
        w: 40 + rnd() * 120,
        h: 20 + rnd() * 40,
      });
  }
  return { root, nodes, collapsed, boxes, boxOf: (id) => boxes.get(id) };
}

/** 随机端点：null 12% / 不在树中的 id 12% / 树内节点 */
function randomEnd(rnd: () => number, nodes: EditableNode[]): string | null {
  const r = rnd();
  if (r < 0.12) return null;
  if (r < 0.24) return 'missing-' + Math.floor(rnd() * 100);
  const n = nodes[Math.floor(rnd() * nodes.length)];
  return n ? n.id : null;
}

function mkEdge(key: string, sourceId: string | null, targetId: string | null): FreeEdge {
  return {
    key,
    index: 0,
    sourceId,
    targetId,
    from: 'x',
    to: 'y',
    rel: 'relates-to',
    dir: 'fwd',
    state: 'well-formed',
  };
}

describe('G-P3 等价性守护', () => {
  it('① freeEdgeEndpoints：resolve 注入路径与旧路径逐字段相等（随机树/折叠/边）', () => {
    const rnd = mulberry32(0xbeef);
    for (let s = 0; s < 25; s++) {
      const scene = makeScene(rnd, 8 + Math.floor(rnd() * 12));
      const resolver = edgeResolverOf(scene.root, scene.collapsed, scene.boxOf);
      for (let j = 0; j < 14; j++) {
        // 每 7 条强制一条自关联（fromId === toId 退化路径）
        const selfCase = j % 7 === 3;
        const src = randomEnd(rnd, scene.nodes);
        const tgt = selfCase ? src : randomEnd(rnd, scene.nodes);
        const edge = mkEdge(`e${s}-${j}`, src, tgt);
        const oldEps = freeEdgeEndpoints(edge, scene.boxOf, scene.root, scene.collapsed);
        const newEps = freeEdgeEndpoints(
          edge,
          scene.boxOf,
          scene.root,
          scene.collapsed,
          resolver,
        );
        expect(newEps).toEqual(oldEps);
      }
    }
  });

  it('② ObstacleTable.without：与旧 filter+map 逐项同序同引用相等', () => {
    const rnd = mulberry32(0xcafe);
    for (let s = 0; s < 40; s++) {
      const count = 10 + Math.floor(rnd() * 31);
      const obstacles: { id: string; box: Box }[] = [];
      for (let i = 0; i < count; i++) {
        obstacles.push({
          id: 'o' + i,
          box: { x: rnd() * 800, y: rnd() * 400, w: 20 + rnd() * 100, h: 16 + rnd() * 30 },
        });
      }
      const table = buildObstacleTable(obstacles);
      const pairs: [string, string][] = [
        ['o0', 'o1'], // 两端都在场
        ['o' + (count - 1), 'o' + count], // 一端缺场
        ['none-a', 'none-b'], // 全缺场（零拷贝路径）
        ['o2', 'o2'], // 同 id 两次（自关联）
      ];
      for (const [f, t] of pairs) {
        const old = obstacles.filter((o) => o.id !== f && o.id !== t).map((o) => o.box);
        const got = table.without(f, t);
        expect(got).toEqual(old);
        expect(got.length).toBe(old.length);
        old.forEach((b, i) => expect(got[i]).toBe(b)); // 顺序不变 + 同引用
      }
    }
    // 空障碍：without 应返回空数组
    expect(buildObstacleTable([]).without('a', 'b')).toEqual([]);
  });

  it('③ 整表重算管线模拟：旧管线 vs 新管线 RouteResult 逐位相等（含跨边累积）', () => {
    const rnd = mulberry32(0xdead);
    for (let s = 0; s < 12; s++) {
      const scene = makeScene(rnd, 10 + Math.floor(rnd() * 20));
      // 障碍 = 有盒节点全量（与生产一致：端点也在障碍集内，按 id 排除）
      const obstacles: { id: string; box: Box }[] = [];
      for (const n of scene.nodes) {
        const b = scene.boxes.get(n.id);
        if (b) obstacles.push({ id: n.id, box: b });
      }
      const edges: FreeEdge[] = [];
      for (let j = 0; j < 6; j++) {
        const a = scene.nodes[Math.floor(rnd() * scene.nodes.length)];
        const b = scene.nodes[Math.floor(rnd() * scene.nodes.length)];
        if (a && b) edges.push(mkEdge(`p${s}-${j}`, a.id, b.id));
      }

      const runOld = (): { key: string; route: ReturnType<typeof routeAesthetic> }[] => {
        const out: { key: string; route: ReturnType<typeof routeAesthetic> }[] = [];
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const eps = freeEdgeEndpoints(e, scene.boxOf, scene.root, scene.collapsed);
          if (!eps.renderable) continue;
          const obs = obstacles
            .filter((o) => o.id !== eps.fromId && o.id !== eps.toId)
            .map((o) => o.box);
          const route = routeAesthetic(eps.from, eps.to, obs, polylines, {});
          out.push({ key: e.key, route });
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };

      const runNew = (): { key: string; route: ReturnType<typeof routeAesthetic> }[] => {
        const out: { key: string; route: ReturnType<typeof routeAesthetic> }[] = [];
        const resolver = edgeResolverOf(scene.root, scene.collapsed, scene.boxOf);
        const table = buildObstacleTable(obstacles);
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const eps = freeEdgeEndpoints(e, scene.boxOf, scene.root, scene.collapsed, resolver);
          if (!eps.renderable) continue;
          const route = routeAesthetic(eps.from, eps.to, table.without(eps.fromId, eps.toId), polylines, {});
          out.push({ key: e.key, route });
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };

      expect(runNew()).toEqual(runOld());
    }
  });
});
