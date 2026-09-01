/**
 * 节点右键菜单项（从 app 层下沉：纯函数可测）。
 * 既有项语义完全保留；N2 追加实体节点专属三项（改引用… / 在关系图中显示 / 转为纯文本）——
 * 实体项的画布侧动作由调用方注入（entityActions），缺省则不追加（向后兼容）。
 *
 * v1.3.0 扩展：可选 descActions —— 在「新建子节点」与「新建同级节点」之间插入「编辑描述」入口，
 * 与 Shift+Enter 同一动作（进入节点下方幕布描述 note.desc 的行内编辑）。
 */
import { getNode, type EditableNode } from '@mindcanvas/kernel';
import type { ContextMenuItem } from '../chrome/ContextMenu.js';
import type { EditorController } from './controller.js';

/** 实体菜单的画布侧动作（picker / 关系面板由调用方持有） */
export interface EntityMenuActions {
  /** 打开实体 picker 改引用 */
  onEditRef: (id: string) => void;
  /** 打开关系图谱面板并定位该实体 */
  onShowInGraph: (id: string) => void;
}

/** 边菜单的画布侧动作（E3：连线到…） */
export interface EdgeMenuActions {
  /** 以该节点为源新建连线 */
  onStartLink: (id: string) => void;
}

/** v1.3.0 幕布描述菜单动作 */
export interface DescMenuActions {
  /** 进入该节点描述的行内编辑（缺省 = 隐藏该入口） */
  onStart: (id: string) => void;
}

export function contextMenuItemsFor(
  controller: EditorController,
  id: string,
  entityActions?: EntityMenuActions,
  edgeActions?: EdgeMenuActions,
  descActions?: DescMenuActions,
): ContextMenuItem[] {
  const isRoot = id === controller.root.id;
  const items: ContextMenuItem[] = [
    {
      label: '新建子节点',
      onSelect: () => {
        const cid = controller.addChild(id);
        controller.select(cid);
        controller.startEdit(cid);
      },
    },
  ];
  // v1.3.0：幕布描述入口（位于「新建子节点」与「新建同级节点」之间；根节点也提供）
  if (descActions) {
    items.push({
      label: '编辑描述',
      onSelect: () => descActions.onStart(id),
    });
  }
  if (!isRoot) {
    items.push({
      label: '新建同级节点',
      onSelect: () => {
        const sid = controller.addSibling(id);
        if (sid !== null) {
          controller.select(sid);
          controller.startEdit(sid);
        }
      },
    });
  }
  items.push(
    { label: '编辑', onSelect: () => controller.startEdit(id) },
    { label: '折叠 / 展开', onSelect: () => controller.toggleCollapse(id) },
  );
  // E3：连线到…（以该节点为源新建自由边；树形之外的语义连接）
  if (edgeActions) {
    items.push({ label: '连线到…', onSelect: () => edgeActions.onStartLink(id) });
  }
  // N2：实体节点专属项（改引用 / 关系图定位 / 转纯文本）
  if (entityActions) {
    const node = getNode(controller.root, id);
    if (node && node.type === 'entity' && node.ref) {
      items.push(
        { label: '改引用…', onSelect: () => entityActions.onEditRef(id) },
        { label: '在关系图中显示', onSelect: () => entityActions.onShowInGraph(id) },
        { label: '转为纯文本', onSelect: () => controller.setEntityRef(id, null) },
      );
    }
  }
  if (!isRoot) {
    items.push(
      { label: '缩进', onSelect: () => controller.indent(id) },
      { label: '反缩进', onSelect: () => controller.outdent(id) },
      {
        label: '删除节点',
        danger: true,
        onSelect: () => {
          if (confirm(`删除节点「${getNodeLabel(controller.root, id)}」及其全部子节点？`)) {
            controller.removeNode(id);
            controller.select(null);
          }
        },
      },
    );
  }
  return items;
}

/** 节点显示名（菜单文案用） */
export function getNodeLabel(root: EditableNode, id: string): string {
  const n = getNode(root, id);
  if (!n) return '节点';
  if (root.id === id) return n.text ?? '根';
  return n.text ?? '（无文本）';
}
