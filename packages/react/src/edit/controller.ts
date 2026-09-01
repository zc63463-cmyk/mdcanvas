/**
 * EditorController —— 编辑器交互核心（T1）。
 * 硬约束 1：一切编辑经 TreeOp（applyOp）+ OpHistory（undo/redo 记录逆操作），禁止直接改树内存。
 * - 变更 → epoch++ → 经 FrameScheduler 单帧广播（复用 K3 调度纪律：无永续 rAF）
 * - 折叠/选中/编辑态是独立瞬时状态（不进 history，参考源同语义）
 * - serialize 走 kernel serializeMm(editableToAst(root))——canonical 往返保证
 */
import {
  editableToAst,
  findNode,
  getNode,
  makeEntityNode,
  makeTextNode,
  nodeByPath,
  OpHistory,
  parentIdOf,
  pathOf,
  serializeMm,
  type EditableNode,
  type Note,
  type TreeOp,
} from '@mindcanvas/kernel';
import { FrameScheduler } from '../render/scheduler.js';

export interface EditorControllerOptions {
  /** 编辑初始文本（新建节点/同级默认文案） */
  newText?: string;
  /**
   * 折叠状态持久化（应用层注入；缺省 = 不持久化）。
   * 存「索引路径」而非 id：节点 id 每次解析重生成（newId），跨刷新不可靠；
   * 路径在结构未变时稳定（pathOf/nodeByPath）。
   */
  storage?: { load: () => number[][]; save: (paths: number[][]) => void };
}

export class EditorController {
  /** 折叠集合（不可变 Set：toggle 产出新引用，驱动布局重算） */
  collapsed = new Set<string>();
  selectedId: string | null = null;
  editingId: string | null = null;
  dirty = false;

  private history: OpHistory;
  private listeners = new Set<() => void>();
  private frame: FrameScheduler;
  private broadcasting = false;
  private epoch = 0;
  private newText: string;
  private storage: EditorControllerOptions['storage'];

  constructor(initial: EditableNode, opts: EditorControllerOptions = {}, frame?: FrameScheduler) {
    this.history = new OpHistory(initial);
    this.newText = opts.newText ?? '新节点';
    this.frame = frame ?? new FrameScheduler();
    this.storage = opts.storage;
    // 折叠持久化：构造时按路径恢复（节点 id 每次解析重生成，路径在结构未变时稳定）
    const saved = this.storage?.load();
    if (saved && saved.length > 0) {
      for (const p of saved) {
        const n = nodeByPath(this.root, p);
        if (n) this.collapsed.add(n.id);
      }
    }
  }

  get root(): EditableNode {
    return this.history.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo();
  }

  get canRedo(): boolean {
    return this.history.canRedo();
  }

  // useSyncExternalStore：epoch 单调 → 变更触发重渲；渲染时读字段为最新
  getSnapshot = (): number => this.epoch;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  // ---------- 编辑原语（全部经 TreeOp + OpHistory） ----------

  /** 应用任意合法 op（返回应用后的根；非法/不可逆/被拒绝 → 原根，不置脏不广播） */
  apply(op: TreeOp): EditableNode {
    const before = this.root;
    const next = this.history.apply(op);
    if (next !== before) {
      this.dirty = true;
      this.notify();
    }
    return next;
  }

  /** 新建子节点（Tab）；返回新节点 id */
  addChild(parentId: string, text?: string): string {
    const child = makeTextNode(text ?? this.newText);
    this.apply({ type: 'add-child', parentId, child });
    return child.id;
  }

  /** 新建实体子节点（图库插入 @img/@draw 引用）；返回新节点 id */
  addEntityChild(parentId: string, ref: { kind: string; id: string }): string {
    const child = makeEntityNode(ref);
    this.apply({ type: 'add-child', parentId, child });
    return child.id;
  }

  /** 新建同级节点（Enter）；根无同级 → null */
  addSibling(id: string, text?: string): string | null {
    if (id === this.root.id) return null;
    const loc = findNode(this.root, id);
    if (!loc) return null;
    const child = makeTextNode(text ?? this.newText);
    this.apply({ type: 'add-child', parentId: loc.parent.id, child, index: loc.index + 1 });
    return child.id;
  }

  /** 删除节点（含子树；根不可删）；返回是否成功 */
  removeNode(id: string): boolean {
    if (id === this.root.id) return false;
    this.apply({ type: 'remove-node', id });
    if (this.selectedId === id) this.selectedId = null;
    return true;
  }

  /** 编辑文本（F2 → 提交）；空文本不回写（保留原值，参考源语义） */
  updateText(id: string, text: string): void {
    if (text.trim() === '') return;
    this.apply({ type: 'update-node', id, patch: { text } });
  }

  /**
   * 转实体 / 转回文本（M1 实体 picker）：
   * - ref 非空 → 节点变实体（type='entity' + ref），文本保留作显示
   * - ref 为 null → 清引用转回文本节点（type='text'）
   * 经 TreeOp（可 undo/redo，与其余编辑同管线）
   */
  setEntityRef(id: string, ref: { kind: string; id: string } | null): void {
    this.apply({
      type: 'update-node',
      id,
      patch: { type: ref ? 'entity' : 'text', ref: ref ?? undefined },
    });
  }

  /** 编辑 note（merge patch；undefined 值键被清除——删除 qa 等场景） */
  updateNote(id: string, patch: Partial<Note>): void {
    const node = getNode(this.root, id);
    if (!node) return;
    const next: Record<string, unknown> = { ...(node.note ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    this.apply({ type: 'update-node', id, patch: { note: next as Note } });
  }

  /** 撤销 / 重做（OpHistory 逆操作） */
  undo(): boolean {
    const next = this.history.undo();
    if (!next) return false;
    this.dirty = true;
    this.notify();
    return true;
  }

  redo(): boolean {
    const next = this.history.redo();
    if (!next) return false;
    this.dirty = true;
    this.notify();
    return true;
  }

  // ---------- 折叠（瞬时状态，不进 history；变更写回 storage） ----------

  /** 显式折叠/展开（Ctrl+[ 折叠 / Ctrl+] 展开）；同态重复设置幂等 */
  setCollapsed(id: string, collapsed: boolean): void {
    const has = this.collapsed.has(id);
    if (has === collapsed) return;
    const next = new Set(this.collapsed);
    if (collapsed) next.add(id);
    else next.delete(id);
    this.commitCollapsed(next);
  }

  /** 切换折叠态（Space） */
  toggleCollapse(id: string): void {
    const next = new Set(this.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.commitCollapsed(next);
  }

  private commitCollapsed(next: Set<string>): void {
    this.collapsed = next;
    if (this.storage) {
      const paths: number[][] = [];
      for (const id of next) {
        const p = pathOf(this.root, id);
        if (p) paths.push(p);
      }
      this.storage.save(paths);
    }
    this.notify();
  }

  // ---------- 层级调整（Shift+Tab 缩进 / Ctrl+Shift+Tab 反缩进；move-node op） ----------

  /** 缩进：移入前一个兄弟的子节点末尾；返回是否发生移动 */
  indent(id: string): boolean {
    if (id === this.root.id) return false;
    const loc = findNode(this.root, id);
    if (!loc || loc.index === 0) return false;
    const prev = loc.parent.children[loc.index - 1]!;
    return this.applyMove(id, prev.id, prev.children.length);
  }

  /** 反缩进：上移一级为父节点的后一兄弟；返回是否发生移动 */
  outdent(id: string): boolean {
    if (id === this.root.id) return false;
    const loc = findNode(this.root, id);
    if (!loc || loc.parent.id === this.root.id) return false;
    const parentLoc = findNode(this.root, loc.parent.id);
    if (!parentLoc) return false;
    return this.applyMove(id, parentLoc.parent.id, parentLoc.index + 1);
  }

  private applyMove(id: string, targetParentId: string, index: number): boolean {
    const before = this.root;
    this.apply({ type: 'move-node', id, targetParentId, index });
    return this.root !== before;
  }

  // ---------- 方向键导航（↑↓←→；尊重折叠：折叠节点子节点不可达） ----------

  /**
   * 方向键移动选中：返回新选中 id（无变化 → null）。
   * down/up：可见前序下一/上一节点；right：子节点优先（钻入）否则下一可见；
   * left：父节点优先（返回）否则上一可见。
   */
  navigate(dir: 'up' | 'down' | 'left' | 'right'): string | null {
    const id = this.selectedId;
    if (id === null) return null;
    const ids = this.visibleIds();
    const i = ids.indexOf(id);
    if (i < 0) return null;
    let target: string | null = null;
    switch (dir) {
      case 'down':
        target = ids[i + 1] ?? null;
        break;
      case 'up':
        target = ids[i - 1] ?? null;
        break;
      case 'right':
        target = ids[i + 1] ?? null;
        break;
      case 'left': {
        const parent = parentIdOf(this.root, id);
        target = parent !== null ? parent : (ids[i - 1] ?? null);
        break;
      }
    }
    if (target === null || target === id) return null;
    this.selectedId = target;
    this.notify();
    return target;
  }

  /** 可见节点前序 id 表（折叠节点的子节点被跳过——布局也裁剪它们） */
  private visibleIds(): string[] {
    const out: string[] = [];
    const walk = (n: EditableNode): void => {
      out.push(n.id);
      if (this.collapsed.has(n.id)) return;
      for (const c of n.children) walk(c);
    };
    walk(this.root);
    return out;
  }

  // ---------- 选中 / 编辑态 ----------

  select(id: string | null): void {
    this.selectedId = id;
    this.notify();
  }

  startEdit(id: string | null): void {
    this.editingId = id;
    this.notify();
  }

  /** 提交编辑：空文本 = 取消（参考源：不把节点改空）；Esc/blur 分支在组件层 */
  commitEdit(id: string, text: string): void {
    this.editingId = null;
    if (text.trim() !== '') this.updateText(id, text);
    this.notify();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.notify();
  }

  // ---------- 序列化 / 保存态 ----------

  /** canonical .mm.md 文本（round-trip 保证由 serializeMm + verifyRoundTrip 承载） */
  serialize(): string {
    return serializeMm(editableToAst(this.root));
  }

  /** 保存成功后清脏标记 */
  markSaved(): void {
    this.dirty = false;
    this.notify();
  }

  /** 打开新文件时重置（history 分支清空 + 折叠清空并持久化） */
  reset(initial: EditableNode): void {
    this.history.reset(initial);
    this.collapsed = new Set();
    this.storage?.save([]);
    this.selectedId = null;
    this.editingId = null;
    this.dirty = false;
    this.notify();
  }

  /** 组件卸载清理 */
  dispose(): void {
    this.frame.dispose();
    this.listeners.clear();
  }

  private notify(): void {
    this.epoch += 1;
    if (this.broadcasting) return;
    this.broadcasting = true;
    this.frame.request(() => {
      this.broadcasting = false;
      for (const l of [...this.listeners]) l();
    });
  }
}
