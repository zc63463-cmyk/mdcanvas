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
import { layoutMindmapBranched } from '../src/layout/branching.js';
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
    // 反方(left)：整体在父左侧；细节(down)：整体在父下方 —— 显式声明必须落位
    expect(a.x + a.w).toBeLessThanOrEqual(p.x);
    expect(d.y).toBeGreaterThanOrEqual(p.y + p.h);
    // 正方**未声明** → 局部性优先：保持经典布局的基准位置，不再断言其左右
    // （经典布局是整体算法，它可能落在左侧）。局部性由下方对照测试严格保证。
  });

  it('★ 局部性：未声明方向的兄弟保持经典布局位置（不因旁支声明而重排）', () => {
    const { root, issue, inFavor, explicit } = forkFixture();
    // 基准：完全不声明任何方向
    const baseline = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    // 只给「反方」「细节」声明方向，「正方」不声明
    const withDir = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    // 未声明的「正方」坐标必须与基准完全一致（逐像素）
    const b = boxOf(baseline, inFavor.id);
    const w = boxOf(withDir, inFavor.id);
    expect(w.x).toBe(b.x);
    expect(w.y).toBe(b.y);
  });

  it('★ 局部性：只给一个深叶子声明方向 → 旁支整条分支坐标不变', () => {
    // 根 → 甲(甲一,甲二) / 乙(乙一,乙二) / 丙(丙一,丙二)
    const leaf = makeTextNode('丙二');
    const root = makeTextNode('根', [
      makeTextNode('甲', [makeTextNode('甲一'), makeTextNode('甲二')]),
      makeTextNode('乙', [makeTextNode('乙一'), makeTextNode('乙二')]),
      makeTextNode('丙', [makeTextNode('丙一'), leaf]),
    ]);
    const baseline = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    const withOne = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: new Map<string, GrowDir>([[leaf.id, 'up']]),
      islandDir: 'right',
    });
    // 甲、乙 两条旁支（含子孙）逐像素不变
    for (const text of ['甲', '甲一', '甲二', '乙', '乙一', '乙二']) {
      const b = baseline.nodes.find((n) => n.node.text === text);
      const w = withOne.nodes.find((n) => n.node.text === text);
      expect(b).toBeDefined();
      expect(w).toBeDefined();
      expect(w!.box.x).toBe(b!.box.x);
      expect(w!.box.y).toBe(b!.box.y);
    }
    // 声明的那个必须真的动到父节点上方（方向生效，不是「什么都没做」）
    const c = withOne.nodes.find((n) => n.node.text === '丙')!;
    const l = withOne.nodes.find((n) => n.node.text === '丙二')!;
    expect(l.box.y + l.box.h).toBeLessThan(c.box.y);
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

describe('上下生长对称性与层距（浏览器实测修复：up 曾误用 H_GAP）', () => {
  const fixed = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 24 });

  function withDir(text: string, dir: GrowDir, children: EditableNode[] = []): EditableNode {
    return { ...makeTextNode(text, children), note: { dir } };
  }

  it('★ up 与 down 的父子层距相等（对称，不再一远一近）', () => {
    const down = layoutMindmapBranched(
      makeTextNode('根', [withDir('子', 'down')]),
      fixed,
      new Set(),
    );
    const up = layoutMindmapBranched(makeTextNode('根', [withDir('子', 'up')]), fixed, new Set());
    const rootDown = boxOf(down, down.nodes[0]!.node.id);
    const childDown = boxOf(down, down.nodes[1]!.node.id);
    const rootUp = boxOf(up, up.nodes[0]!.node.id);
    const childUp = boxOf(up, up.nodes[1]!.node.id);

    const gapDown = childDown.y - (rootDown.y + rootDown.h);
    const gapUp = rootUp.y - (childUp.y + childUp.h);
    expect(gapDown).toBeGreaterThan(0);
    expect(gapUp).toBeGreaterThan(0);
    expect(gapUp).toBe(gapDown); // 对称：核心回归点
  });

  it('up 子节点完全位于父上方，且与父不重叠', () => {
    const res = layoutMindmapBranched(makeTextNode('根', [withDir('子', 'up')]), fixed, new Set());
    const root = boxOf(res, res.nodes[0]!.node.id);
    const child = boxOf(res, res.nodes[1]!.node.id);
    expect(child.y + child.h).toBeLessThan(root.y);
  });

  it('★ 多层 up：各层层距一致（不因层级加深而变远）', () => {
    const grand = withDir('孙', 'up');
    const child = withDir('子', 'up', [grand]);
    const res = layoutMindmapBranched(makeTextNode('根', [child]), fixed, new Set());
    const [r, c, g] = res.nodes;
    const gap1 = r!.box.y - (c!.box.y + c!.box.h);
    const gap2 = c!.box.y - (g!.box.y + g!.box.h);
    expect(gap1).toBe(gap2);
  });

  it('up + down 同存：两侧层距对称', () => {
    const res = layoutMindmapBranched(
      makeTextNode('根', [withDir('上子', 'up'), withDir('下子', 'down')]),
      fixed,
      new Set(),
    );
    const root = boxOf(res, res.nodes[0]!.node.id);
    const up = boxOf(res, res.nodes[1]!.node.id);
    const down = boxOf(res, res.nodes[2]!.node.id);
    const gapUp = root.y - (up.y + up.h);
    const gapDown = down.y - (root.y + root.h);
    expect(gapUp).toBe(gapDown);
  });

  it('up/down 组水平并排：子间距与经典 org（SUB_GAP）一致', () => {
    const res = layoutMindmapBranched(
      makeTextNode('根', [withDir('A', 'down'), withDir('B', 'down')]),
      fixed,
      new Set(),
    );
    const a = boxOf(res, res.nodes[1]!.node.id);
    const b = boxOf(res, res.nodes[2]!.node.id);
    expect(b.x).toBeGreaterThan(a.x + a.w); // 并排不重叠
    expect(b.x - (a.x + a.w)).toBe(28); // SUB_GAP
  });
});
