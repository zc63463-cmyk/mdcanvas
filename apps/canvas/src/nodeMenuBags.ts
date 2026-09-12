/**
 * 节点动作袋（右键菜单与**二级环**同一闭包）
 * ══════════════════════════════════════════════════════════════════════
 * T5 画布接线时从 `NodeContextMenu.tsx` 抽出：环席位与菜单项若各建一套闭包，
 * 「改的不是同一段实现」会随版本漂移——T5 验收明确要求**同一闭包**。
 *
 * 只抽**与位置无关**的三个袋（描述 / 笔记 / 中心：只依赖节点与文档事实）；
 * 依赖菜单坐标的袋（实体 picker、连线、生长方向的「自定义长度气泡」）留在 `NodeContextMenu`。
 *
 * 事实读取与行为与抽取前**逐行一致**（纯搬运，无改写）。
 */
import { pathOfNode } from '@mindcanvas/kernel';
import {
  anchorOfNode,
  collectCenters,
  planAttachIsland,
  removeCenter,
  upsertCenter,
  type CenterMenuActions,
  type DescMenuActions,
  type EditorController,
  type NoteMenuActions,
} from '@mindcanvas/react';

/** 宿主回调（形状与 `NodeContextMenu` 的 props 一致） */
export interface NodeBagHost {
  /** 进入描述编辑（盒内） */
  setDescEditingId: (id: string) => void;
  /** 打开固定笔记（盒下）；传**索引路径**（文档重解析会重建 id，路径才稳定） */
  setPinnedNotePath: (path: number[], editing?: boolean) => void;
  /** A5：接回/事务失败的告警回调（命令层结构化拒绝 → 用户可见提示） */
  onAttachError?: (message: string) => void;
}

/** v1.3.0 幕布描述入口：与 Shift+Enter 同一动作 */
export function makeDescActions(host: NodeBagHost): DescMenuActions {
  return { onStart: (id) => host.setDescEditingId(id) };
}

/** note 笔记入口：固定展示并进入编辑（与描述是不同内容） */
export function makeNoteActions(controller: EditorController, host: NodeBagHost): NoteMenuActions {
  return { onStart: (id) => host.setPinnedNotePath(pathOfNode(controller.root, id) ?? [], true) };
}

/** G6′ 中心升格/降格 + G2 接回 + G3 父级连接 + C3 编号复制（坐标写 root.note.centers，节点保持纯净） */
export function makeCenterActions(
  controller: EditorController,
  docName: string,
  host: NodeBagHost,
): CenterMenuActions {
  return {
    isCenter: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return false;
      return collectCenters(controller.root).some((c) => c.at === at);
    },
    // G3：跨岛父级连接显示状态（缺省 hide）
    parentLinkOf: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return 'hide';
      return collectCenters(controller.root).find((c) => c.at === at)?.parentLink ?? 'hide';
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
      return collectCenters(controller.root).find((c) => c.at === at)?.detached ?? false;
    },
    onAttach: (id, targetParentId) => {
      const plan = planAttachIsland(controller.root, id, targetParentId);
      if (!plan.ok) {
        host.onAttachError?.(plan.error.message);
        return;
      }
      const result = controller.applyTransaction(plan.ops);
      if (!result.ok) host.onAttachError?.(result.error.message);
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
  };
}
