/**
 * 节点右键菜单（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 菜单项由 `contextMenuItemsFor` 生成，含四组动作：
 *   ① 通用（新建/编辑/层级/折叠/删除）
 *   ② 实体节点专属（改引用 → 开 picker；在关系图中显示 → 开面板）
 *   ③ 关系模式专属（连线到… → 以该节点为源新建自由边；E8 仅关系模式暴露）
 *   ④ 幕布描述（右键「编辑描述」= 与 Shift+Enter 同一动作）
 *
 * 为什么整块抽走：菜单项的构造（24 行）与 `<ContextMenu>` 的渲染是同一件事，
 * 分开只会让主函数留着一堆 setState 回调。
 *
 * 不是什么：不含菜单项的渲染与键盘交互（`ContextMenu` 自己管）。
 */
import { contextMenuItemsFor, ContextMenu, type EditorController } from '@mindcanvas/react';
import { nodeById } from './hooks/useEdgeActions.js';

/** 侧面板标识（与 MindmapStage 的 panel 状态一致；null = 全部关闭） */
export type PanelId = 'search' | 'relation' | 'outline' | 'assets' | null;

/** 右键菜单状态：目标节点 + 屏幕坐标 */
export interface CtxMenuState {
  nodeId: string;
  x: number;
  y: number;
}

export interface NodeContextMenuProps {
  /** 当前右键目标（null = 未打开，由调用方决定是否渲染） */
  ctxMenu: CtxMenuState;
  controller: EditorController;
  /** 是否关系编辑模式（决定是否有「连线到…」入口） */
  relationMode: boolean;
  /** 打开实体 picker（改引用） */
  setPicker: (v: { nodeId: string; query: string; current: { kind: string; id: string } | null } | null) => void;
  /** 打开侧面板（'relation' 等） */
  setPanel: (v: PanelId) => void;
  /** 开始连线（以该节点为源） */
  setLinkDraft: (v: { sourceId: string; x: number; y: number } | null) => void;
  /** 进入描述编辑 */
  setDescEditingId: (id: string) => void;
  /** 打开节点注释浮窗并固定（内容可为空 —— 用户可能正要新建） */
  setPinnedNoteId: (id: string) => void;
  onClose: () => void;
}

export function NodeContextMenu({
  ctxMenu,
  controller,
  relationMode,
  setPicker,
  setPanel,
  setLinkDraft,
  setDescEditingId,
  setPinnedNoteId,
  onClose,
}: NodeContextMenuProps) {
  return (
    <ContextMenu
      x={ctxMenu.x}
      y={ctxMenu.y}
      items={contextMenuItemsFor(
        controller,
        ctxMenu.nodeId,
        {
          // N2：实体节点专属动作（改引用 → 开 picker；在关系图中显示 → 开面板）
          onEditRef: (id) => {
            const n = nodeById(controller.root, id);
            setPicker({
              nodeId: id,
              query: n?.text ?? '',
              current: n?.ref ? { kind: n.ref.kind, id: n.ref.id } : null,
            });
          },
          onShowInGraph: () => setPanel('relation'),
        },
        relationMode
          ? {
              // E3：连线到…（以该节点为源新建自由边）；E8：仅关系模式提供该入口
              onStartLink: (id) => setLinkDraft({ sourceId: id, x: ctxMenu.x, y: ctxMenu.y }),
            }
          : undefined,
        // v1.3.0 幕布描述入口：右键「编辑描述」= 与 Shift+Enter 同一动作
        { onStart: (id) => setDescEditingId(id) },
        // v1.4.0 节点注释入口：打开浮窗（与描述是不同内容）
        { onStart: (id) => setPinnedNoteId(id) },
      )}
      onClose={onClose}
    />
  );
}
