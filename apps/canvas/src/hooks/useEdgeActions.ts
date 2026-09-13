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
import type { EditableNode, LinkDir } from '@mindcanvas/kernel';
import { defaultRelationSchema } from '@mindcanvas/react';
import type { EditorController, FreeEdge } from '@mindcanvas/react';
import {
  anchorOfNode,
  appendEdge,
  collectFreeEdges,
  collectNodeChoices,
  edgesOf,
  findDuplicateEdge,
  patchEdgeAt,
  removeEdgeAt,
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
  /** R3-4：选中边是否处于「指定侧无解 → 直穿降级」（值比较，同值不触发） */
  selEdgeForcedSideFallback: boolean;
  /** 选中态本身（key + 屏幕坐标） */
  edgeSel: { key: string; x: number; y: number } | null;
  setEdgeSel: (v: { key: string; x: number; y: number } | null) => void;
  /** 整体写回 note.edges（空数组 = 删除该字段） */
  writeEdges: (edges: DocEdge[]) => void;
  /** R2-1：重挂指定边的指定端（唯一重挂写路径：writeEdges + patchEdgeAt；不动 invalidAt） */
  reattachEdge: (index: number, side: 'from' | 'to', anchor: string) => void;
  /** R2-3：删除指定边（同一写路径：writeEdges + removeEdgeAt） */
  deleteEdge: (index: number) => void;
  /** R4-1：复制一条（同字段克隆追加；一次 undo 可回滚） */
  duplicateEdge: (index: number) => void;
  /**
   * R4-2：反向（数据层反转）——交换 from/to；rel 三态（成对反向换名 / 对称不变 /
   * 未注册不变 + message）；渲染端保形（manual 交换 + routingSide 翻转，同 R3-3）；
   * 与 dir 正交（不改 dir）。单补丁一次写一条 history。
   */
  reverseEdge: (index: number) => { relChanged: boolean; message?: string };
  /**
   * R4-1：标记失效 / 恢复；R4-4 升级为级联（限定语义）——同一对节点间存在
   * reverseOf(rel) 的成对反向边（rel 非对称、已注册）→ 同一 invalidAt 时间戳
   * 同步标记 / 同步清除（已失效不覆盖原戳、已有效恢复为 no-op）。
   * 返回 cascaded = 联动条数（宿主提示「已同步 N 条反向关系」）。
   */
  setEdgeInvalid: (index: number, invalid: boolean) => { cascaded: number };
  /**
   * R3-3：切换方向（渲染端语义契约，R3-A3）——fwd ↔ back 时同一补丁内交换
   * manual.from/to 并翻转 routingSide（两端锚点与其侧向保位，手工把手不跳）；
   * both 与 fwd 同向（freeEdges.ts:433 的 forward 判据）→ 仅写 dir 不交换。
   * 单个补丁、一次写、一条 history（一次 undo 全回滚）。
   */
  setEdgeDir: (index: number, dir: LinkDir) => void;
  /** 写入「人工锁定」几何；null = 清空锁定恢复自动 */
  writeEdgeManual: (index: number, manual: EdgeManual | null) => void;
  /**
   * 建边（R4-3① 去重口径：只对**未失效**边查重——同名失效边不吞新建，并存保留）。
   * 返回 created=是否新建；skippedInvalid=同键失效边条数（宿主提示用）。
   */
  connectEdge: (
    from: string,
    to: string,
    rel: string,
    sx: number,
    sy: number,
  ) => { created: boolean; skippedInvalid: number };
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
  const [selEdgeFallback, setSelEdgeFallback] = useState(false);
  const handleEdgeRoutes = useCallback((routes: ReadonlyMap<string, EdgeRouteEntry>) => {
    const key = selEdgeKeyRef.current;
    const entry = key ? routes.get(key) : undefined;
    const d = entry?.route.d;
    setSelEdgeD((prev) => (prev === d ? prev : d));
    // R3-4：与 selEdgeD 同款值比较——同值不 setState，掐断重渲死循环
    const fb = entry?.route.forcedSideFallback === true;
    setSelEdgeFallback((prev) => (prev === fb ? prev : fb));
  }, []);
  const selEdgeCurrentD = selEdge ? selEdgeD : undefined;
  const selEdgeForcedSideFallback = selEdge !== null ? selEdgeFallback : false;

  const writeEdges = useCallback(
    (edges: DocEdge[]): void => {
      controller.updateNote(
        controller.root.id,
        edges.length > 0 ? { edges } : { edges: undefined },
      );
    },
    [controller],
  );

  const reattachEdge = useCallback(
    (index: number, side: 'from' | 'to', anchor: string): void => {
      const cur = edgesOf(controller.root.note);
      const patch: Partial<DocEdge> = side === 'from' ? { from: anchor } : { to: anchor };
      writeEdges(patchEdgeAt(cur, index, patch));
    },
    [controller, writeEdges],
  );

  const deleteEdge = useCallback(
    (index: number): void => {
      writeEdges(removeEdgeAt(edgesOf(controller.root.note), index));
    },
    [controller, writeEdges],
  );

  const setEdgeDir = useCallback(
    (index: number, dir: LinkDir): void => {
      const cur = edgesOf(controller.root.note);
      const item = cur[index];
      if (!item) return;
      const forwardBefore = item.dir !== 'back';
      const forwardAfter = dir !== 'back';
      if (forwardBefore === forwardAfter) {
        writeEdges(patchEdgeAt(cur, index, { dir }));
        return;
      }
      const patch: Partial<DocEdge> = { dir };
      if (item.manual !== undefined) {
        patch.manual = { ...item.manual, from: item.manual.to, to: item.manual.from };
      }
      if (item.routingSide !== undefined) {
        patch.routingSide = item.routingSide === 'left' ? 'right' : 'left';
      }
      writeEdges(patchEdgeAt(cur, index, patch));
    },
    [controller, writeEdges],
  );

  const duplicateEdge = useCallback(
    (index: number): void => {
      const cur = edgesOf(controller.root.note);
      const item = cur[index];
      if (!item) return;
      writeEdges(appendEdge(cur, { ...item }));
    },
    [controller, writeEdges],
  );

  const setEdgeInvalid = useCallback(
    (index: number, invalid: boolean): { cascaded: number } => {
      const cur = edgesOf(controller.root.note);
      const item = cur[index];
      if (!item) return { cascaded: 0 };
      const cfg = defaultRelationSchema.getConfig(item.rel);
      const reverseId = defaultRelationSchema.reverseOf(item.rel);
      // R4-A4 级联边界：仅成对反向（非对称、已注册、reverse ≠ 自身）联动
      const cascades =
        cfg !== undefined && cfg.isSymmetric !== true && reverseId !== null && reverseId !== item.rel;
      const patch: Partial<DocEdge> = invalid
        ? { invalidAt: new Date().toISOString() }
        : { invalidAt: undefined };
      let next = patchEdgeAt(cur, index, patch);
      let cascaded = 0;
      if (cascades && reverseId !== null) {
        const source = next[index];
        if (!source) return { cascaded: 0 };
        const ts = source.invalidAt;
        next = next.map((e, i) => {
          if (i === index) return e;
          const samePair =
            (e.from === item.from && e.to === item.to) ||
            (e.from === item.to && e.to === item.from);
          if (!samePair || e.rel !== reverseId) return e;
          if (invalid && e.invalidAt !== undefined) return e; // 不覆盖既有标记
          if (!invalid && e.invalidAt === undefined) return e; // 恢复 no-op
          cascaded += 1;
          return invalid ? { ...e, invalidAt: ts } : { ...e, invalidAt: undefined };
        });
      }
      writeEdges(next);
      return { cascaded };
    },
    [controller, writeEdges],
  );

  const reverseEdge = useCallback(
    (index: number): { relChanged: boolean; message?: string } => {
      const cur = edgesOf(controller.root.note);
      const item = cur[index];
      if (!item) return { relChanged: false };
      const cfg = defaultRelationSchema.getConfig(item.rel);
      const reverse = defaultRelationSchema.reverseOf(item.rel);
      const patch: Partial<DocEdge> = { from: item.to, to: item.from };
      let relChanged = false;
      let message: string | undefined;
      if (reverse !== null && reverse !== item.rel) {
        patch.rel = reverse;
        relChanged = true;
      } else if (cfg === undefined) {
        // R4-A2：未注册/无反向 → rel 不变 + 一次提示（不静默、不阻断）
        message = `关系「${item.rel}」未注册反向——已交换两端，关系名保持不变`;
      }
      if (item.manual !== undefined) {
        patch.manual = { ...item.manual, from: item.manual.to, to: item.manual.from };
      }
      if (item.routingSide !== undefined) {
        patch.routingSide = item.routingSide === 'left' ? 'right' : 'left';
      }
      writeEdges(patchEdgeAt(cur, index, patch));
      return { relChanged, message };
    },
    [controller, writeEdges],
  );

  const writeEdgeManual = useCallback(
    (index: number, manual: EdgeManual | null): void => {
      const cur = edgesOf(controller.root.note);
      writeEdges(patchEdgeAt(cur, index, { manual: manual ?? undefined }));
    },
    [controller, writeEdges],
  );

  const connectEdge = useCallback(
    (from: string, to: string, rel: string, sx: number, sy: number): { created: boolean; skippedInvalid: number } => {
      const cur = edgesOf(controller.root.note);
      const dup = findDuplicateEdge(cur, { from, to, rel });
      // R4-3①：命中未失效边 → 选中旧边（防重叠双线）；命中的是失效边 → 不吞新建（并存）
      if (dup >= 0 && cur[dup]?.invalidAt === undefined) {
        setEdgeSel({ key: `e${dup}`, x: sx, y: sy });
        return { created: false, skippedInvalid: 0 };
      }
      const arr = appendEdge(cur, { from, to, rel, source: 'manual' });
      writeEdges(arr);
      setEdgeSel({ key: `e${arr.length - 1}`, x: sx, y: sy });
      const skippedInvalid =
        dup >= 0
          ? cur.filter(
              (e) => e.from === from && e.to === to && e.rel === rel && e.invalidAt !== undefined,
            ).length
          : 0;
      return { created: true, skippedInvalid };
    },
    [controller, writeEdges],
  );

  return {
    freeEdges,
    nodeChoices,
    anchorById,
    selEdge,
    selEdgeCurrentD,
    selEdgeForcedSideFallback,
    edgeSel,
    setEdgeSel,
    writeEdges,
    writeEdgeManual,
    reattachEdge,
    deleteEdge,
    duplicateEdge,
    setEdgeInvalid,
    reverseEdge,
    setEdgeDir,
    connectEdge,
    handleEdgeRoutes,
  };
}
