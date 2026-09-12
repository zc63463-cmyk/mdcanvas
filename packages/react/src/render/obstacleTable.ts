/**
 * G-P3：障碍集预构建表（自由边路由整表重算的内层分配优化）。
 *
 * 旧实现每条边都跑
 *   `obstacles.filter((o) => o.id !== fromId && o.id !== toId).map((o) => o.box)`
 * —— 两次 O(N) 遍历 + 两个新数组；整表重算成本 ≈ E×N×2。
 * 本表把「盒数组」与「id → 下标」构建一次，`without()` 只做一次 O(N) 的整数比较过滤；
 * 端点不在障碍集时**零拷贝复用**（动画期/幽灵边的常见情形）。
 *
 * 语义等价（含顺序——routeAesthetic 对障碍顺序敏感）由 `freeedge-equivalence.test.ts` 钉死：
 * `without(f, t)` 与 `obstacles.filter((o) => o.id !== f && o.id !== t).map((o) => o.box)`
 * 逐项相同。前提：障碍集内 id 唯一（生产方 `edgeObstaclesOf` 由 layout.nodes 映射而来）。
 */
import type { Box } from '@mindcanvas/kernel';

export interface ObstacleTable {
  /** 预构建盒数组（与输入同序；routeAesthetic 顺序敏感，不得重排） */
  readonly boxes: readonly Box[];
  /** 排除两端点后的障碍数组（端点不在障碍集 → 复用 boxes 引用，零分配） */
  without(fromId: string, toId: string): readonly Box[];
}

/** 空表单例（无障碍场景复用，避免每次新建对象） */
export const EMPTY_OBSTACLE_TABLE: ObstacleTable = {
  boxes: [],
  without: () => [],
};

export function buildObstacleTable(
  obstacles: readonly { id: string; box: Box }[],
): ObstacleTable {
  if (obstacles.length === 0) return EMPTY_OBSTACLE_TABLE;
  const boxes = obstacles.map((o) => o.box);
  const idxOf = new Map<string, number>();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o) idxOf.set(o.id, i);
  }
  return {
    boxes,
    without(fromId, toId) {
      const i1 = idxOf.get(fromId);
      const i2 = idxOf.get(toId);
      if (i1 === undefined && i2 === undefined) return boxes;
      return boxes.filter((_box, i) => i !== i1 && i !== i2);
    },
  };
}
