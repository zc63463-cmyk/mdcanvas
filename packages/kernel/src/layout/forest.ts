/**
 * G6′ 森林布局：多个「中心」各自局部布局后按坐标平移合并。
 *
 * 设计要点（与项目既有原则同构）：
 * - **复用而非改写**：每个中心内部交给现成的布局函数（logic-right / logic-left /
 *   org / org-up），本模块只做「局部布局 → 平移 → 合并」，布局算法一行不改
 * - **只有中心有坐标**：子树内节点的位置仍由算法决定，不落进事实源
 * - **缺失 pos 即自动排列**：无坐标的中心按 bounds 宽度依次横向排开
 *
 * ⚠️ 平移后必须**重新生成** links：path 字符串内含绝对坐标，
 * 只平移节点盒会让连线留在原地。
 */
import type { EditableNode } from '../tree/treeOps.js';
import {
  bezierLink,
  collectLayout,
  layoutBounds,
  orgBeamLink,
  orgBeamLinkUp,
  type GrowDir,
  type LayoutResult,
  type LayoutNode,
  type LinkBuilder,
  type LinkGeometry,
  type MeasureFn,
} from './mindmap.js';
import { layoutLogic, layoutOrg, type LayoutKind } from './layouts.js';

/** 中心生长方向（四向）。
 *  定义在 mindmap.ts（布局基座）——forest 与 layouts 都依赖它；
 *  若定义留在本文件，layouts 取型会形成 forest↔layouts 循环依赖（depcruise 拦截实证）。
 *  此处转出口保持既有导入路径（islands/pipeline/kernel index）不受影响。 */
export type { GrowDir } from './mindmap.js';

/** 一个中心：升格的节点 + 生长方向 + 可选摆放坐标 */
export interface CenterSpec {
  /** 中心节点（作为该子树的根做局部布局） */
  node: EditableNode;
  /** 子树生长方向 */
  dir: GrowDir;
  /**
   * 中心（根）节点**中心**的世界坐标。
   * 缺省 → 由 layoutForest 按 bounds 自动横向排布。
   */
  pos?: { x: number; y: number };
}

/** 方向 → 局部布局函数（仅取 nodes/bounds，links 稍后统一重建） */
const LAYOUT_BY_DIR: Record<GrowDir, (r: EditableNode, m: MeasureFn, c: Set<string>) => LayoutResult> =
  {
    right: (r, m, c) => layoutLogic(r, m, c, 1),
    left: (r, m, c) => layoutLogic(r, m, c, -1),
    down: (r, m, c) => layoutOrg(r, m, c, 1),
    up: (r, m, c) => layoutOrg(r, m, c, -1),
  };

/** 方向 → 连线构建器（与对应布局函数保持一致） */
const LINK_BY_DIR: Record<GrowDir, LinkBuilder> = {
  right: bezierLink,
  left: bezierLink,
  down: (p, c) =>
    orgBeamLink(p, c, (p.box.y + p.box.h + Math.min(...p.children.map((k) => k.box.y))) / 2),
  up: (p, c) =>
    orgBeamLinkUp(p, c, (p.box.y + Math.max(...p.children.map((k) => k.box.y + k.box.h))) / 2),
};

/** 方向 → 文档级布局类型（供 UI 复用同一套映射） */
export const LAYOUT_KIND_BY_DIR: Record<GrowDir, LayoutKind> = {
  right: 'logic-right',
  left: 'logic-left',
  down: 'org',
  up: 'org-up',
};

function emptyResult(): LayoutResult {
  return { nodes: [], links: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
}

/**
 * 森林布局。
 *
 * @param centers      中心清单（顺序影响自动排列次序）
 * @param measure      节点度量
 * @param collapsedIds 折叠集合（所有中心共享）
 * @param opts.gap     自动排列时相邻中心的间距（世界坐标 px）
 */
export function layoutForest(
  centers: readonly CenterSpec[],
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: { gap?: number } = {},
): LayoutResult {
  if (centers.length === 0) return emptyResult();

  const gap = opts.gap ?? 160;

  // ① 局部布局 + 记录每棵子树的局部尺寸
  const local = centers.map((spec) => {
    const res = LAYOUT_BY_DIR[spec.dir](spec.node, measure, collapsedIds);
    return {
      spec,
      res,
      w: res.bounds.maxX - res.bounds.minX,
      root: res.nodes.find((n) => n.parentId === null) ?? null,
    };
  });

  // ② 确定落点：有 pos 用 pos；无 pos 按局部宽度依次横向排开
  const origins: { x: number; y: number }[] = [];
  let cursorX = 0;
  for (const item of local) {
    if (item.spec.pos) {
      origins.push(item.spec.pos);
    } else {
      origins.push({ x: cursorX, y: 0 });
      cursorX += item.w + gap;
    }
  }

  // ③ 平移（令中心节点中心落在 origin）+ 重建 links + 合并
  const nodes: LayoutNode[] = [];
  const links: LinkGeometry[] = [];
  local.forEach((item, i) => {
    const origin = origins[i] ?? { x: 0, y: 0 };
    const root = item.root;
    // 局部布局中「根节点中心」的位置 → 需要平移到 origin
    const rcx = root ? root.box.x + root.box.w / 2 : 0;
    const rcy = root ? root.box.y + root.box.h / 2 : 0;
    const dx = origin.x - rcx;
    const dy = origin.y - rcy;
    for (const n of item.res.nodes) {
      n.box.x += dx;
      n.box.y += dy;
    }
    nodes.push(...item.res.nodes);
    if (root) links.push(...collectLayout(root, LINK_BY_DIR[item.spec.dir]).links);
  });

  return { nodes, links, bounds: layoutBounds(nodes) };
}

/** 方向 → 中文标签（UI 用） */
export const GROW_DIR_LABEL: Record<GrowDir, string> = {
  right: '向右',
  left: '向左',
  down: '向下',
  up: '向上',
};
