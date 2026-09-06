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
import { pathOfNode } from '@mindcanvas/kernel';
import { anchorOfNode, collectCenters, contextMenuItemsFor, ContextMenu, planAttachIsland, readGrowDir, removeCenter, upsertCenter, type EditorController } from '@mindcanvas/react';
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
  /** C3：当前文档名（复制中心编号的「文档名#cid」格式） */
  docName: string;
  /** 打开实体 picker（改引用） */
  setPicker: (v: { nodeId: string; query: string; current: { kind: string; id: string } | null } | null) => void;
  /** 打开侧面板（'relation' 等） */
  setPanel: (v: PanelId) => void;
  /** 开始连线（以该节点为源） */
  setLinkDraft: (v: { sourceId: string; x: number; y: number } | null) => void;
  /** 进入描述编辑 */
  setDescEditingId: (id: string) => void;
  /**
   * 打开固定 note 笔记（内容可为空 —— 用户可能正要新建）。
   * 传**索引路径**而非 id：文档重新解析会重建 id，路径才能稳定复现同一个节点。
   */
  setPinnedNotePath: (path: number[], editing?: boolean) => void;
  /** A5：接回/事务失败的告警回调（命令层结构化拒绝 → 用户可见提示） */
  onAttachError?: (message: string) => void;
  onClose: () => void;
}

export function NodeContextMenu({
  ctxMenu,
  controller,
  relationMode,
  docName,
  setPicker,
  setPanel,
  setLinkDraft,
  setDescEditingId,
  setPinnedNotePath,
  onAttachError,
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
        // note 笔记入口：固定展示并进入编辑（与描述是不同内容）
        { onStart: (id) => setPinnedNotePath(pathOfNode(controller.root, id) ?? [], true) },
        // G6′：中心升格 / 降格。坐标写进 root.note.centers（文档级，节点保持纯净）
        {
          isCenter: (id) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return false;
            return collectCenters(controller.root).some((c) => c.at === at);
          },
          // G3：跨岛父级连接显示状态（缺省 hide）
          parentLinkOf: (id) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return 'hide';
            return (
              collectCenters(controller.root).find((c) => c.at === at)?.parentLink ?? 'hide'
            );
          },
          onToggleParentLink: (id, next) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return;
            const nextNote = upsertCenter(controller.root.note, at, { parentLink: next });
            controller.updateNote(controller.root.id, {
              centers: nextNote.centers ?? undefined,
            });
          },
          // G2（A5）：切断独立标记与接回（成环/深度校验在命令层，失败经 onAttachError 上报）
          isDetached: (id) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return false;
            return (
              collectCenters(controller.root).find((c) => c.at === at)?.detached ?? false
            );
          },
          onAttach: (id, targetParentId) => {
            const plan = planAttachIsland(controller.root, id, targetParentId);
            if (!plan.ok) {
              onAttachError?.(plan.error.message);
              return;
            }
            const result = controller.applyTransaction(plan.ops);
            if (!result.ok) onAttachError?.(result.error.message);
          },
          onPromote: (id, dir) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return;
            const next = upsertCenter(controller.root.note, at, { dir });
            controller.updateNote(controller.root.id, { centers: next.centers ?? undefined });
          },
          onDemote: (id) => {
            const at = anchorOfNode(controller.root, id);
            if (!at) return;
            const next = removeCenter(controller.root.note, at);
            const centers = next.centers as unknown[] | undefined;
            const history = next.center_pos as unknown[] | undefined;
            controller.updateNote(controller.root.id, {
              // 清空后连键一起删（undefined 键被 updateNote 清除），避免留 centers: []
              centers: centers && centers.length > 0 ? centers : undefined,
              center_pos: history && history.length > 0 ? history : undefined,
            });
          },
          // C3：中心 cid 查询与复制（格式「文档名#cid」——跨文件时代天然兼容 doc+cid 寻址）
          cidOf: (id) => collectCenters(controller.root).find((c) => c.nodeId === id)?.cid,
          onCopyCid: (id) => {
            const cid = collectCenters(controller.root).find((c) => c.nodeId === id)?.cid;
            if (!cid) return;
            void navigator.clipboard?.writeText(`${docName}#${cid}`);
          },
        },
        // D3′：生长方向（note.dir 语义意图；updateNote 合并写——
        // dir: undefined 删键 = 恢复继承；OpHistory 天然覆盖 undo）
        {
          explicitDirOf: (id) => readGrowDir(nodeById(controller.root, id)?.note, id),
          onSetGrowDir: (id, dir) => {
            controller.updateNote(id, { dir: dir ?? undefined });
          },
        },
      )}
      onClose={onClose}
    />
  );
}
