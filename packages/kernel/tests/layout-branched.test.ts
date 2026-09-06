/**
 * D2′ 节点级生长方向（思想分叉）布局分组调度测试：
 * - 回归闸门：无显式 dir → 与 layoutMindmap 逐盒一致（旧文件零变更）
 * - 同节点多向分叉：左/右/下分组挂对应侧
 * - 继承链：缺省继承最近显式 → islandDir；孙节点可再覆盖
 * - 邻侧防叠：相邻方向组（left↔down 等）布局后 bounds 不相交
 * - 连线形态：right/left 组用贝塞尔（含 C 曲线），down/up 组用正交梁线（无 C）
 * - 折叠语义：折叠节点子女不布局
 */
import { describe, expect, it } from 'vitest';
import { layoutMindmapBranched } from '../src/layout/layouts.js';
import { layoutMindmap, type LayoutResult } from '../src/layout/mindmap.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';
import type { GrowDir } from '../src/layout/forest.js';

/** 定长度量（可复现）：宽随文本长度，高固定 */
const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

function boxOf(res: LayoutResult, id: string) {
  const ln = res.nodes.find((n) => n.node.id === id);
  if (!ln) throw new Error(`节点 ${id} 不在布局结果中`);
  return ln.box;
}

/** 指定方向组成员的并集包围盒 */
function unionBox(res: LayoutResult, ids: string[]) {
  const boxes = ids.map((id) => boxOf(res, id));
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.w)),
    maxY: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 三向分叉标准夹具：议题 → 反方(left) / 正方(继承) / 细节(down) */
function forkFixture() {
  const root = makeTextNode('根', [
    makeTextNode('议题', [makeTextNode('反方'), makeTextNode('正方'), makeTextNode('细节')]),
  ]);
  const issue = root.children[0]!;
  const [against, inFavor, detail] = issue.children;
  const explicit = new Map<string, GrowDir>([
    [against!.id, 'left'],
    [detail!.id, 'down'],
  ]);
  return { root, issue, against: against!, inFavor: inFavor!, detail: detail!, explicit };
}

describe('layoutMindmapBranched：回归闸门（旧文件零变更）', () => {
  it('无显式 dir → 与 layoutMindmap 逐盒一致', () => {
    const root = makeTextNode('根', [
      makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]),
      makeTextNode('B'),
    ]);
    const classic = layoutMindmap(root, measure, new Set());
    const branched = layoutMindmapBranched(root, measure, new Set());
    const boxesOf = (r: LayoutResult) =>
      r.nodes.map((n) => ({ id: n.node.id, ...n.box }));
    expect(boxesOf(branched)).toEqual(boxesOf(classic));
    expect(branched.bounds).toEqual(classic.bounds);
    expect(branched.links.length).toBe(classic.links.length);
  });

  it('explicit 映射存在但树中无命中节点 → 同样回退经典布局', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    const explicit = new Map<string, GrowDir>([['ghost-id', 'left']]);
    const classic = layoutMindmap(root, measure, new Set());
    const branched = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
    });
    expect(branched.nodes.map((n) => ({ id: n.node.id, ...n.box }))).toEqual(
      classic.nodes.map((n) => ({ id: n.node.id, ...n.box })),
    );
  });
});

describe('layoutMindmapBranched：同节点多向分叉', () => {
  it('★ 左/右/下三向分组挂到父节点对应侧', () => {
    const { root, issue, against, inFavor, detail, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const p = boxOf(res, issue.id);
    const a = boxOf(res, against.id);
    const f = boxOf(res, inFavor.id);
    const d = boxOf(res, detail.id);
    // 反方(left)：整体在父左侧；正方(继承 right)：整体在父右侧；细节(down)：整体在父下方
    expect(a.x + a.w).toBeLessThanOrEqual(p.x);
    expect(f.x).toBeGreaterThanOrEqual(p.x + p.w);
    expect(d.y).toBeGreaterThanOrEqual(p.y + p.h);
  });

  it('嵌套覆盖：无声明子节点继承最近显式祖先方向，孙节点可再覆盖', () => {
    const root = makeTextNode('根', [
      makeTextNode('议题', [
        makeTextNode('反方', [makeTextNode('论据A'), makeTextNode('论据B', [makeTextNode('要点')])]),
      ]),
    ]);
    const issue = root.children[0]!;
    const against = issue.children[0]!;
    const evA = against.children[0]!;
    const evB = against.children[1]!;
    const point = evB.children[0]!;
    const explicit = new Map<string, GrowDir>([
      [against.id, 'left'],
      [point.id, 'down'], // 孙节点显式覆盖：不随反方的 left
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const a = boxOf(res, against.id);
    const ea = boxOf(res, evA.id);
    const eb = boxOf(res, evB.id);
    const pt = boxOf(res, point.id);
    // 论据A/B 继承反方的 left：挂在反方左侧
    expect(ea.x + ea.w).toBeLessThanOrEqual(a.x);
    expect(eb.x + eb.w).toBeLessThanOrEqual(a.x);
    // 要点显式 down：挂在论据B 下方而非左侧
    expect(pt.y).toBeGreaterThanOrEqual(eb.y + eb.h);
  });

  it('折叠语义：折叠父节点后其子女不参与布局', () => {
    const { root, issue, against, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set([issue.id]), {
      explicitDirByNodeId: explicit,
    });
    expect(res.nodes.find((n) => n.node.id === against.id)).toBeUndefined();
    expect(res.nodes.find((n) => n.node.id === issue.id)).toBeDefined();
  });
});

describe('layoutMindmapBranched：邻侧防叠（布局期一次推开）', () => {
  it('★ left 组长子树与 down 组宽子树布局后 bounds 不相交', () => {
    // left 组：深链（纵向长）；down 组：多子（横向宽）——无防叠时两簇在左下象限相交
    const root = makeTextNode('根', [
      makeTextNode('议题', [
        makeTextNode('反方甲', [makeTextNode('链一', [makeTextNode('链二', [makeTextNode('链三')])])]),
        makeTextNode('反方乙'),
        makeTextNode('细节一', [makeTextNode('细A'), makeTextNode('细B'), makeTextNode('细C')]),
      ]),
    ]);
    const issue = root.children[0]!;
    const [l1, l2, d1] = issue.children;
    const leftIds = [l1!.id, l1!.children[0]!.id, l1!.children[0]!.children[0]!.id,
      l1!.children[0]!.children[0]!.children[0]!.id, l2!.id];
    const downIds = [d1!.id, ...d1!.children.map((c) => c.id)];
    const explicit = new Map<string, GrowDir>([
      [l1!.id, 'left'],
      [l2!.id, 'left'],
      [d1!.id, 'down'],
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const leftBox = unionBox(res, leftIds);
    const downBox = unionBox(res, downIds);
    expect(intersects(leftBox, downBox)).toBe(false);
  });
});

describe('layoutMindmapBranched：连线形态按子方向选择', () => {
  it('right/left 组用贝塞尔（含 C 曲线），down 组用正交梁线（无 C）', () => {
    const { root, issue, against, inFavor, detail, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const linkTo = (id: string) => res.links.find((l) => l.toId === id);
    // 复审修复验证：down 组不得因方向桥接失效而回退贝塞尔
    expect(String(linkTo(against.id)!.path)).toContain('C');
    expect(String(linkTo(inFavor.id)!.path)).toContain('C');
    expect(String(linkTo(detail.id)!.path)).not.toContain('C');
  });
});
