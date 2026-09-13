/**
 * 文档切换 hook —— B1 逻辑从 `MindmapStage.tsx` 抽出（纯搬迁，动作与依赖逐字保留）。
 *
 * 语义（原 effect，MindmapStage.tsx:371-395）：
 * - `doc.source` 变化 = 真正的文档切换 → controller.reset（清 history/折叠/选中）
 *   + 实体表重建 + 收起 QA 展开 + 适配视图（fit）。
 * - 首挂跳过其后 4 个动作（controller 首次创建 + MapView 初始 fit 已处理，避免重复动画），
 *   但**首挂仍要**把文档内实体引用登记进候选宿主（跨文档复用）。
 *
 * 依赖纪律（E 批判别）：**保存路径不得改写 `doc.source`**（见
 * docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md）——deps 严格锁在 `doc.source`：
 * 不得改用对象身份（`doc`）或把 `savedSource`/`ts`/`handle` 放进 deps，
 * 否则保存路径的写回（E 批起只动 savedSource）会误触发文档重建。
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { EditableNode, Entity, EntityRef } from '@mindcanvas/kernel';
import type { EditorController, EntityHost, MapViewApi, MindDoc } from '@mindcanvas/react';
import { buildEntities } from '@mindcanvas/react';

export interface DocumentSwitchOptions {
  doc: MindDoc;
  editable: EditableNode | null;
  refs: EntityRef[];
  entities: Map<string, Entity>;
  entityHost: EntityHost;
  /** 引用标题表（buildEntities 的第二入参；apps 层为 GATEWAY_TITLES） */
  gatewayTitles: Record<string, { title: string; status?: string }>;
  controllerRef: RefObject<EditorController | null>;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  setExpandedQaId: Dispatch<SetStateAction<string | null>>;
  apiRef: RefObject<MapViewApi | null>;
}

export function useDocumentSwitch({
  doc,
  editable,
  refs,
  entities,
  entityHost,
  gatewayTitles,
  controllerRef,
  setEntities,
  setExpandedQaId,
  apiRef,
}: DocumentSwitchOptions): void {
  // B1 文档切换：新 source → controller.reset（清 history/折叠/选中）+ 实体表重建 + 展开收起 + 适配视图
  // 首挂跳过（controller 首次创建 + MapView 初始 fit 已处理；避免重复动画）
  const firstDocEffectRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保持 [doc.source]（原 eslint-disable 注释），行为由 useDocumentSwitch.test 判别
  useEffect(() => {
    if (!editable) return;
    const isFirst = firstDocEffectRef.current;
    firstDocEffectRef.current = false;
    // N1：文档内实体引用登记进候选宿主（首挂与切换都登记 → 跨文档可复用）
    entityHost.remember(
      refs
        .filter((r) => r.kind !== 'img' && r.kind !== 'draw')
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          title: entities.get(`${r.kind}:${r.id}`)?.title ?? null,
        })),
      doc.name,
    );
    if (isFirst) return;
    controllerRef.current?.reset(editable);
    setEntities(buildEntities(refs, gatewayTitles));
    setExpandedQaId(null);
    apiRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.source]);
}
