/**
 * 边（free edge）相关的三块浮层（从 `MindmapStage` 抽出，T1 结构治理续）：
 *
 *   ① 树自然线关系标注（E7，右键树边弹出）
 *   ② 连线创建器（E5，拖拽连线的目标候选 + rel/dir/样式）
 *   ③ 边编辑浮窗（E5，rel/dir/label/note/样式 + 失效标记）
 *
 * 三者与 `useEdgeActions` 是同一件事的两半：hook 管数据与选中态，本组件管交互。
 * 合在一起抽走后，`MindmapStage` 只保留一个 `<EdgeDraftLayer ... />`。
 *
 * 不是什么：不含边的图形路由与渲染（`FreeEdgeLayer`），那些在 `packages/react`。
 */
import type { EditorController } from '@mindcanvas/react';
import {
  anchorOfNode,
  EdgeEditor,
  edgesOf,
  findDuplicateEdge,
  LinkCreator,
  mergeStyleAt,
  patchEdgeAt,
  removeEdgeAt,
  TreeEdgeEditor,
  type DocEdge,
  type EdgeStyle,
  type TreeEdgeAnn,
} from '@mindcanvas/react';
import type { EdgeActions } from './hooks/useEdgeActions.js';
import { nodeById } from './hooks/useEdgeActions.js';

export interface EdgeDraftLayerProps {
  controller: EditorController;
  edgeActions: EdgeActions;
  /** 树边标注：正在编辑的树边（null = 未打开） */
  treeEdgeEdit: { childId: string; x: number; y: number } | null;
  /** 连线创建器：拖拽起点（null = 未打开） */
  linkDraft: { sourceId: string; x: number; y: number } | null;
  onCloseTreeEdge: () => void;
  onCloseLinkDraft: () => void;
}

export function EdgeDraftLayer({
  controller,
  edgeActions,
  treeEdgeEdit,
  linkDraft,
  onCloseTreeEdge,
  onCloseLinkDraft,
}: EdgeDraftLayerProps) {
  // 取局部 const：TS 无法对 obj.prop 跨表达式收窄类型，不取局部变量守卫生效不了
  const selEdgeOpen = edgeActions.selEdge;

  return (
    <>
      {/* ① 树自然线关系标注（note.edge 结构化对象；仅右键树边弹出） */}
      {treeEdgeEdit && (
        <TreeEdgeEditor
          childId={treeEdgeEdit.childId}
          ann={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            const e = n?.note?.edge;
            return e && typeof e === 'object' ? (e as TreeEdgeAnn) : null;
          })()}
          viaLabel={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            return typeof n?.note?.via === 'string' ? (n.note.via as string) : '';
          })()}
          x={treeEdgeEdit.x}
          y={treeEdgeEdit.y}
          onChange={(ann) =>
            controller.updateNote(treeEdgeEdit.childId, ann ? { edge: ann } : { edge: undefined })
          }
          onClose={onCloseTreeEdge}
        />
      )}

      {/* ② 连线创建器（确认 → root note.edges 追加，经 update-node 可撤销） */}
      {linkDraft && (
        <LinkCreator
          choices={edgeActions.nodeChoices}
          x={linkDraft.x}
          y={linkDraft.y}
          onCreate={(edge: DocEdge) => {
            const from =
              edgeActions.anchorById.get(linkDraft.sourceId) ??
              anchorOfNode(controller.root, linkDraft.sourceId) ??
              '';
            onCloseLinkDraft();
            if (!from) return;
            edgeActions.connectEdge(from, edge.to, edge.rel, linkDraft.x, linkDraft.y);
            // 创建器携带的 dir/label/note/style 需落到（可能已存在的）边上
            const cur = edgesOf(controller.root.note);
            const idx = findDuplicateEdge(cur, { from, to: edge.to, rel: edge.rel });
            const extras: Partial<DocEdge> = {};
            if (edge.dir) extras.dir = edge.dir;
            if (edge.label) extras.label = edge.label;
            if (edge.note) extras.note = edge.note;
            if (edge.style) extras.style = edge.style;
            if (Object.keys(extras).length > 0 && idx >= 0) {
              edgeActions.writeEdges(patchEdgeAt(cur, idx, extras));
            }
          }}
          onClose={onCloseLinkDraft}
        />
      )}

      {/* ③ 边编辑浮窗（rel/dir/label/note + 样式即时落 root.note.edges；删除可撤销） */}
      {edgeActions.edgeSel && selEdgeOpen && (
        <EdgeEditor
          edge={{
            key: selEdgeOpen.key,
            index: selEdgeOpen.index,
            rel: selEdgeOpen.rel,
            dir: selEdgeOpen.dir,
            from: selEdgeOpen.from,
            to: selEdgeOpen.to,
            ...(selEdgeOpen.label !== undefined ? { label: selEdgeOpen.label } : {}),
            ...(selEdgeOpen.note !== undefined ? { note: selEdgeOpen.note } : {}),
            ...(selEdgeOpen.style !== undefined ? { style: selEdgeOpen.style } : {}),
            ...(selEdgeOpen.invalidAt !== undefined ? { invalidAt: selEdgeOpen.invalidAt } : {}),
            ...(selEdgeOpen.routingSide !== undefined
              ? { routingSide: selEdgeOpen.routingSide }
              : {}),
          }}
          x={edgeActions.edgeSel.x}
          y={edgeActions.edgeSel.y}
          currentD={edgeActions.selEdgeCurrentD}
          // Issue #3 / forceSide：routingSide 经 patch 写回（含 undefined = 恢复自动）
          onChange={(patch: Partial<DocEdge>) => {
            edgeActions.writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index, patch),
            );
          }}
          onStyle={(patch: EdgeStyle) => {
            edgeActions.writeEdges(
              mergeStyleAt(edgesOf(controller.root.note), selEdgeOpen.index, patch),
            );
          }}
          onInvalidate={() => {
            edgeActions.writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index, {
                invalidAt: new Date().toISOString(),
              }),
            );
          }}
          onRestore={() => {
            edgeActions.writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index, {
                invalidAt: undefined,
              }),
            );
          }}
          onDelete={() => {
            edgeActions.writeEdges(removeEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index));
            edgeActions.setEdgeSel(null);
          }}
          onClose={() => edgeActions.setEdgeSel(null)}
        />
      )}
    </>
  );
}
