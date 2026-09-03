/**
 * 边（free edge）状态与操作的单一归属（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 收敛的内容：
 * - 派生数据：`freeEdges` / `nodeChoices` / `anchorById`
 * - 选中态：`edgeSel` + 由它派生的 `selEdge`、`selEdgeCurrentD`
 * - 写操作：`writeEdges` / `writeEdgeManual` / `connectEdge`
 *
 * 为什么整块抽走（而不是只搬浮层 JSX）：这三段浮层（树边标注 / 连线创建器 /
 * 边编辑）与上述数据、写操作是**同一件事的两半** —— 分开只会让两边都依赖
 * 主函数的一堆中间变量，props 越传越多。合并后主函数只持有一个 `edge` 对象。
 *
 * 不是什么：不含边的图形路由（`edgeRouting`）与渲染（`FreeEdgeLayer`），
 * 那些在 `packages/react`；本 hook 只管**文档级边标注数据与选中态**。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { EditableNode } from '@mindcanvas/kernel';
import type { EditorController, FreeEdge } from '@mindcanvas/react';
import {
  anchorOfNode,
  appendEdge,
  collectFreeEdges,
  collectNodeChoices,
  edgesOf,
  findDuplicateEdge,
  patchEdgeAt,
  type DocEdge,
  type EdgeManual,
  type EdgeRouteEntry,
} from '@mindcanvas/react';

/** 按 id 取节点（树遍历；供边面板显示节点文本用） */
export function nodeById(root: EditableNode, id: string): EditableNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = nodeById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

export interface EdgeActions {
  /** 全部自由边（文档级 note.edges 解析结果） */
  freeEdges: FreeEdge[];
  /** 连线候选节点（id + anchor） */
  nodeChoices: ReturnType<typeof collectNodeChoices>;
  /** 节点 id → 锚文本 */
  anchorById: Map<string, string>;
  /** 当前选中的边（含 index），未选为 null */
  selEdge: (FreeEdge & { index: number }) | null;
  /** 选中边当前的实际路径 d（供 EdgeEditor 推断 auto 模式的鼓向） */
  selEdgeCurrentD: string | undefined;
  /** 选中态本身（key + 屏幕坐标） */
  edgeSel: { key: string; x: number; y: number } | null;
  setEdgeSel: (v: { key: string; x: number; y: number } | null) => void;
  /** 整体写回 note.edges（空数组 = 删除该字段） */
  writeEdges: (edges: DocEdge[]) => void;
  /** 写入「人工锁定」几何；null = 清空锁定恢复自动 */
  writeEdgeManual: (index: number, manual: EdgeManual | null) => void;
  /** 建边；同 from+to+rel 已存在则直接选中打开编辑器（防重叠双线） */
  connectEdge: (from: string, to: string, rel: string, sx: number, sy: number) => void;
  /** 接收 FreeEdgeLayer 的实际路由结果（只存选中边的 d，见下） */
  handleEdgeRoutes: (routes: ReadonlyMap<string, EdgeRouteEntry>) => void;
}

export function useEdgeActions(controller: EditorController): EdgeActions {
  const [edgeSel, setEdgeSel] = useState<{ key: string; x: number; y: number } | null>(null);

  const freeEdges: FreeEdge[] = useMemo(() => collectFreeEdges(controller.root), [controller.root]);
  const nodeChoices = useMemo(() => collectNodeChoices(controller.root), [controller.root]);
  const anchorById = useMemo(() => {
    const m = new Map<string, string>();
    nodeChoices.forEach((c) => m.set(c.id, c.anchor));
    return m;
  }, [nodeChoices]);

  const selEdgeIndex = edgeSel ? Number(edgeSel.key.slice(1)) : -1;
  const selEdge: (FreeEdge & { index: number }) | null = useMemo(() => {
    if (!edgeSel) return null;
    const e = freeEdges.find((x) => x.key === edgeSel.key);
    return e ? { ...e, index: selEdgeIndex } : null;
  }, [edgeSel, freeEdges, selEdgeIndex]);

  // Opp 精确翻转：只留「选中边当前的 d」而非整个 routes Map —— 这是**值比较**短路的关键。
  // 存 Map 的话对象是引用、路由一重算就变，无法判断"内容是否真的变了"；
  // 存 d（字符串）可以值比较，内容不变就不 setState，从源头掐断
  // 「回调 → setState → 重渲染 → 回调」的自我触发（死循环）。
  const [selEdgeD, setSelEdgeD] = useState<string | undefined>(undefined);
  const selEdgeKeyRef = useRef<string | null>(null);
  selEdgeKeyRef.current = selEdge?.key ?? null;
  const handleEdgeRoutes = useCallback((routes: ReadonlyMap<string, EdgeRouteEntry>) => {
    const key = selEdgeKeyRef.current;
    const d = key ? routes.get(key)?.route.d : undefined;
    setSelEdgeD((prev) => (prev === d ? prev : d));
  }, []);
  const selEdgeCurrentD = selEdge ? selEdgeD : undefined;

  const writeEdges = useCallback(
    (edges: DocEdge[]): void => {
      controller.updateNote(
        controller.root.id,
        edges.length > 0 ? { edges } : { edges: undefined },
      );
    },
    [controller],
  );

  const writeEdgeManual = useCallback(
    (index: number, manual: EdgeManual | null): void => {
      const cur = edgesOf(controller.root.note);
      writeEdges(patchEdgeAt(cur, index, { manual: manual ?? undefined }));
    },
    [controller, writeEdges],
  );

  const connectEdge = useCallback(
    (from: string, to: string, rel: string, sx: number, sy: number): void => {
      const cur = edgesOf(controller.root.note);
      const dup = findDuplicateEdge(cur, { from, to, rel });
      if (dup >= 0) {
        setEdgeSel({ key: `e${dup}`, x: sx, y: sy });
        return;
      }
      const arr = appendEdge(cur, { from, to, rel, source: 'manual' });
      writeEdges(arr);
      setEdgeSel({ key: `e${arr.length - 1}`, x: sx, y: sy });
    },
    [controller, writeEdges],
  );

  return {
    freeEdges,
    nodeChoices,
    anchorById,
    selEdge,
    selEdgeCurrentD,
    edgeSel,
    setEdgeSel,
    writeEdges,
    writeEdgeManual,
    connectEdge,
    handleEdgeRoutes,
  };
}
