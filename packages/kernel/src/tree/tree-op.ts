/**
 * TreeOp —— 可重放树操作（K2 唯一新设计）。
 * 把树变更提炼为操作对象：op 携带全部参数（不依赖闭包/时序），applyOp 为纯函数。
 * CRDT 留缝：将来 Loro/Yjs 多设备同步只需把 op 序列喂给 CRDT（调研第二辑 §5 结论 2）。
 * op 集以 treeOps 现有能力为准（addChild/removeNode/moveNode/updateNode），不臆造。
 */
import {
  addChild,
  findNode,
  getNode,
  moveNode,
  removeNode,
  updateNode,
  type EditableNode,
} from './treeOps.js';

/**
 * 节点字段补丁（与 updateNode 的 patch 一致）。
 * M1 加 'type'：实体 picker 需要「文本节点 ↔ 实体节点」互转（type 是实体渲染的判定依据）；
 * 属加宽（既有字段语义与行为均不变）。
 */
export type NodePatch = Partial<Pick<EditableNode, 'text' | 'url' | 'ref' | 'note' | 'type'>>;

/** 实体引用入参（setEntityRef 用；与 EntityRef 同形但解耦具体类型定义） */
export interface EntityRefInput {
  kind: string;
  id: string;
}

/** 可重放树操作（判别联合）：覆盖 treeOps 的增删移改四能力 */
export type TreeOp =
  /** 添加子节点（index 缺省 = 末尾） */
  | { type: 'add-child'; parentId: string; child: EditableNode; index?: number }
  /** 删除节点（含子树；根不可删） */
  | { type: 'remove-node'; id: string }
  /** 移动节点（拒绝根移动/移动到自身子树/深度超限） */
  | { type: 'move-node'; id: string; targetParentId: string; index: number }
  /** 更新节点字段（text/url/ref/note） */
  | { type: 'update-node'; id: string; patch: NodePatch };

/** 应用操作到树（纯函数，返回新根；非法 / 找不到目标 → 原样返回） */
export function applyOp(root: EditableNode, op: TreeOp): EditableNode {
  switch (op.type) {
    case 'add-child':
      return addChild(root, op.parentId, op.child, op.index);
    case 'remove-node':
      return removeNode(root, op.id).root;
    case 'move-node':
      return moveNode(root, op.id, op.targetParentId, op.index).root;
    case 'update-node':
      return updateNode(root, op.id, op.patch);
  }
}

/**
 * 计算逆操作（基于应用前树状态）。
 * - add-child → remove-node(child.id)
 * - remove-node → add-child(parentId, node, index)（恢复原位）
 * - move-node → move-node(id, 原父 id, 原索引)
 * - update-node → update-node(id, 原字段值)
 * 非法（目标缺失 / 根删除等）→ null（调用方视为不可逆，跳过）。
 */
export function invertOp(root: EditableNode, op: TreeOp): TreeOp | null {
  switch (op.type) {
    case 'add-child': {
      return { type: 'remove-node', id: op.child.id };
    }
    case 'remove-node': {
      const loc = findNode(root, op.id);
      if (!loc) return null;
      return { type: 'add-child', parentId: loc.parent.id, child: loc.node, index: loc.index };
    }
    case 'move-node': {
      const loc = findNode(root, op.id);
      if (!loc) return null;
      return { type: 'move-node', id: op.id, targetParentId: loc.parent.id, index: loc.index };
    }
    case 'update-node': {
      const node = getNode(root, op.id);
      if (!node) return null;
      const prev: NodePatch = {};
      if (op.patch.text !== undefined) prev.text = node.text;
      if (op.patch.url !== undefined) prev.url = node.url;
      if (op.patch.ref !== undefined) prev.ref = node.ref;
      if (op.patch.note !== undefined) prev.note = node.note;
      // M1：type 参与逆操作（实体↔文本互转的 undo 一致性）
      if (op.patch.type !== undefined) prev.type = node.type;
      return { type: 'update-node', id: op.id, patch: prev };
    }
  }
}

/** 记录操作：op + 其逆操作（undo 时应用逆操作） */
export interface RecordedOp {
  op: TreeOp;
  inverse: TreeOp;
}

/**
 * OpHistory —— op 序列 + 逆操作的 undo/redo（K2 新设计）。
 * 与快照式 History<T>（参考源，已移植）并存：本类以 op 序列维护状态（CRDT 留缝），
 * 快照式供快照场景使用 —— 两种机制并存说明见 K2-report。
 */
export class OpHistory {
  private root: EditableNode;
  private past: RecordedOp[] = [];
  private future: RecordedOp[] = [];

  constructor(
    initial: EditableNode,
    private readonly limit = 100,
  ) {
    this.root = initial;
  }

  /** 当前根节点 */
  get current(): EditableNode {
    return this.root;
  }

  /** 应用操作并记录（截断 redo 分支；非法 / 不可逆 → 原样返回） */
  apply(op: TreeOp): EditableNode {
    const inverse = invertOp(this.root, op);
    if (inverse === null) return this.root;
    this.root = applyOp(this.root, op);
    this.past.push({ op, inverse });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return this.root;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 撤销：应用逆操作；无历史 → null */
  undo(): EditableNode | null {
    const rec = this.past.pop();
    if (!rec) return null;
    this.root = applyOp(this.root, rec.inverse);
    this.future.push(rec);
    return this.root;
  }

  /** 重做：重放原操作；无 redo 分支 → null */
  redo(): EditableNode | null {
    const rec = this.future.pop();
    if (!rec) return null;
    this.root = applyOp(this.root, rec.op);
    this.past.push(rec);
    return this.root;
  }

  /** 重置（打开新文件） */
  reset(initial: EditableNode): void {
    this.root = initial;
    this.past = [];
    this.future = [];
  }
}
