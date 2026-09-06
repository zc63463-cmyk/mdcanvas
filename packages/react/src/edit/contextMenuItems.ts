/**
 * 节点右键菜单项（从 app 层下沉：纯函数可测）。
 * 既有项语义完全保留；N2 追加实体节点专属三项（改引用… / 在关系图中显示 / 转为纯文本）——
 * 实体项的画布侧动作由调用方注入（entityActions），缺省则不追加（向后兼容）。
 *
 * v1.3.0 扩展：可选 descActions —— 在「新建子节点」与「新建同级节点」之间插入「编辑描述」入口，
 * 与 Shift+Enter 同一动作（进入节点下方幕布描述 note.desc 的行内编辑）。
 * v1.4.0 扩展：可选 noteActions —— 追加「编辑 note笔记」，打开节点下方的固定笔记。
 * 两种内容不同：desc 常驻节点盒内，固定 note 笔记在节点下方向下生长并参与布局。
 */
import { getNode, type EditableNode, type GrowDir } from '@mindcanvas/kernel';
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

/**
 * note 笔记菜单动作。
 * 与「编辑描述」是两种不同内容：描述常驻节点盒内，note 笔记在节点下方布局区。
 */
export interface NoteMenuActions {
  /** 打开该节点的固定 note 笔记并进入编辑（缺省 = 隐藏该入口） */
  onStart: (id: string) => void;
}

/**
 * G6′ 中心菜单动作（升格 / 降格 / 父级连接显示切换）。
 * 升格 = 该子树从根下提出来成为可拖拽摆放的中心；降格 = 回到自动树布局。
 */
export interface CenterMenuActions {
  /** 升格为中心并指定生长方向 */
  onPromote: (id: string, dir: GrowDir) => void;
  /** 降格为普通节点（坐标进历史区，再升格可吸附回原位） */
  onDemote: (id: string) => void;
  /** 该节点当前是否已是中心 */
  isCenter: (id: string) => boolean;
  /** G3：该中心当前的跨岛父级连接显示状态（缺省 hide） */
  parentLinkOf: (id: string) => 'show' | 'hide';
  /** G3：切换跨岛父级连接显示（只影响显示，不改变语义归属） */
  onToggleParentLink: (id: string, next: 'show' | 'hide') => void;
  /** G2（A5）：该中心是否为切断独立（detached）——detached 禁普通降格，走显式接回 */
  isDetached: (id: string) => boolean;
  /** G2（A5）：接回 detached 分支到目标父节点（成环/深度超限由命令层拒绝并提示） */
  onAttach: (id: string, targetParentId: string) => void;
}

export function contextMenuItemsFor(
  controller: EditorController,
  id: string,
  entityActions?: EntityMenuActions,
  edgeActions?: EdgeMenuActions,
  descActions?: DescMenuActions,
  noteActions?: NoteMenuActions,
  centerActions?: CenterMenuActions,
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
  // note 笔记与「编辑描述」并列 —— 两者是不同内容，不是同一功能的两处入口。
  if (noteActions) {
    items.push({
      label: '编辑 note笔记',
      onSelect: () => noteActions.onStart(id),
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
  // G6′：中心升格 / 降格（根节点不可升格 —— 它要么是所有未升格分支的容器，
  // 要么在全部子节点升格后自然成为空壳）
  if (centerActions && !isRoot) {
    if (centerActions.isCenter(id)) {
      const detached = centerActions.isDetached(id);
      if (detached) {
        // G2（A5）：detached 无有效父级 → 禁普通降格；接回 = 显式命令（选中目标节点后操作）
        const target = controller.selectedId;
        const attachable =
          target !== null && target !== id
            ? { targetId: target }
            : null;
        items.push({
          label:
            attachable !== null
              ? '接为所选节点的子树'
              : '接为子树（先选中目标父节点）',
          disabled: attachable === null,
          onSelect: () => {
            if (attachable === null) return;
            centerActions.onAttach(id, attachable.targetId);
          },
        });
      } else {
        // 非切断中心 → 普通降格出口（坐标进历史区，再升格可吸附回原位）
        items.push({
          label: '降格为普通节点',
          onSelect: () => centerActions.onDemote(id),
        });
      }
      // G3：跨岛父级连接显示切换（detached 强制不显示容器线，无切换意义）
      if (!detached) {
        const pl = centerActions.parentLinkOf(id);
        items.push({
          label: pl === 'show' ? '隐藏父级连接' : '显示父级连接',
          onSelect: () => centerActions.onToggleParentLink(id, pl === 'show' ? 'hide' : 'show'),
        });
      }
    } else {
      // G6″（A3）：任意深度节点可升格（用户批准的产品核心）。
      // v1 的「仅根直接子节点」守卫源于布局层重复投影缺陷——A3 起由 kernel
      // projectIslands 递归投影根治（深层升格从父岛剔除、独立成岛），菜单不再设限。
      for (const [dir, label] of [
        ['right', '向右'],
        ['left', '向左'],
        ['down', '向下'],
        ['up', '向上'],
      ] as const) {
        items.push({
          label: `升为中心 › ${label}`,
          onSelect: () => centerActions.onPromote(id, dir),
        });
      }
    }
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
