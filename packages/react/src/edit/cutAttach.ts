/**
 * A5（G2）：切断树边 / 接回子树——领域命令层。
 *
 * 是什么：
 * - `planCutTreeEdge`：切断 A→B（真实父子树边）——B 子树移为**文档根直接分支（末尾）**、
 *   centers 标记 detached；引用按「前树解析 nodeId → 后树重建锚」迁移（A2 地基）。
 * - `planAttachIsland`：detached 分支显式接回目标父节点（清 detached、坐标进历史区）。
 * - 两者都产出 **TreeOp[]**，交 `controller.applyTransaction` 原子提交
 *   （全批预校验、失败零副作用、一次 history——禁止以「连调多次 apply」替代）。
 *
 * 不是什么：
 * - 不碰自由边删除（那是边级操作，不拆树）；不做 UI（菜单在 NodeContextMenu/TreeEdgeEditor）
 * - 不做截断式文本替换（迁移一律走 planReferenceMigration 的 nodeId 语义）
 *
 * 深度约束：.mm.md heading 层级 H1–H6（根=1）→ 节点最大相对深度 5。
 * 切断后 B 新深度=1；接回后 B 新深度=目标深度+1——超限即结构化拒绝，不硬凑。
 */
import {
  applyOp,
  findNode,
  getNode,
  planReferenceMigration,
  type AnchorRef,
  type EditableNode,
  type Note,
  type TreeOp,
} from '@mindcanvas/kernel';
import { collectCenters, ensureNodeCid, isRec, removeCenter, upsertCenter } from '../render/centers.js';
import { anchorOfNode } from '../render/freeEdges.js';

/** .mm.md heading 层级上限（H6）→ 节点相对根的最大深度（根深度 0） */
export const MAX_NODE_DEPTH = 5;

export type CutAttachErrorCode =
  | 'not-found'
  | 'is-root'
  | 'already-detached'
  | 'not-detached'
  | 'attach-to-self'
  | 'attach-to-descendant'
  | 'depth-limit'
  | 'reference-conflict';

export type CutAttachPlan =
  | { ok: true; ops: TreeOp[] }
  | { ok: false; error: { code: CutAttachErrorCode; message: string } };

/** 节点子树内的最大相对深度（叶子 = 0） */
export function subtreeMaxDepth(node: EditableNode): number {
  let max = 0;
  const walk = (n: EditableNode, d: number): void => {
    if (d > max) max = d;
    for (const c of n.children) walk(c, d + 1);
  };
  walk(node, 0);
  return max;
}

/** 节点相对根的深度 */
function depthOf(root: EditableNode, id: string): number | null {
  let found: number | null = null;
  const walk = (n: EditableNode, d: number): boolean => {
    if (n.id === id) {
      found = d;
      return true;
    }
    for (const c of n.children) if (walk(c, d + 1)) return true;
    return false;
  };
  walk(root, 0);
  return found;
}

/** target 是否位于 subtree（含 subtree 根自身）内 —— 接回防成环 */
function isWithin(subtree: EditableNode, id: string): boolean {
  if (subtree.id === id) return true;
  return subtree.children.some((c) => isWithin(c, id));
}

const ANCHOR_NOTE_KEYS = ['centers', 'center_pos', 'edges', 'links', 'groups'] as const;

/**
 * 盘点全树 note 锚引用（design §5 清单：centers.at / center_pos.at / edges 两端 /
 * links[].to / groups[].members）。noteKey 用**会话内节点 id**（迁移 update 的定位键）。
 * 未知/非数组形状静默跳过——与「未知元数据保留但不承诺自动迁移」的纪律一致。
 */
export function collectReferenceAnchors(root: EditableNode): AnchorRef[] {
  const refs: AnchorRef[] = [];
  const walk = (n: EditableNode): void => {
    const note = n.note; // Note 自带索引签名，直读免断言
    if (note) {
      for (const key of ANCHOR_NOTE_KEYS) {
        const arr = note[key];
        if (!Array.isArray(arr)) continue;
        arr.forEach((item, i) => {
          if (key === 'groups') {
            if (!isRec(item)) return;
            const members = item.members;
            if (!Array.isArray(members)) return;
            members.forEach((m, j) => {
              if (typeof m === 'string') {
                refs.push({ noteKey: n.id, field: `groups[${i}].members[${j}]`, anchor: m });
              }
            });
            return;
          }
          if (!isRec(item)) return;
          if (typeof item.at === 'string') {
            // centers[].at 携带所属对象 cid → anchor-migrate 走 cid 双轨（按身份重建 at 提示）
            refs.push({
              noteKey: n.id,
              field: `${key}[${i}].at`,
              anchor: item.at,
              ...(typeof item.cid === 'string' ? { cid: item.cid } : {}),
            });
          }
          if (typeof item.from === 'string') {
            refs.push({ noteKey: n.id, field: `${key}[${i}].from`, anchor: item.from });
          }
          if (typeof item.to === 'string') {
            refs.push({ noteKey: n.id, field: `${key}[${i}].to`, anchor: item.to });
          }
        });
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return refs;
}

/** 把单条锚迁移写回 note（不可变；field 形如 `centers[0].at` / `groups[1].members[2]`） */
export function applyAnchorUpdateToNote(
  note: Note | undefined,
  field: string,
  to: string,
): Note {
  const m = /^([a-z_]+)\[(\d+)\](?:\.([a-z]+))?$/.exec(field);
  if (!m) return note ?? {};
  const key = m[1];
  if (!key) return note ?? {};
  const idx = Number(m[2]);
  const leaf = m[3];
  const base: Note = note ?? {};
  const raw = base[key]; // 索引签名直读
  if (!Array.isArray(raw)) return base;
  const list = raw.slice();
  if (leaf === undefined) {
    // groups[i].members[j] —— 整条即锚字符串（经由 members 路径时 m[3] 为 members 的场景见下）
    list[idx] = to;
  } else {
    const cur = list[idx];
    if (!isRec(cur)) return base;
    const obj = { ...cur };
    obj[leaf] = to;
    list[idx] = obj;
  }
  const out: Note = { ...base };
  out[key] = list;
  return out;
}

/** groups[i].members[j] 形态的 field 解析（三层） */
function applyGroupMemberUpdate(note: Note | undefined, field: string, to: string): Note {
  const m = /^groups\[(\d+)\]\.members\[(\d+)\]$/.exec(field);
  if (!m) return note ?? {};
  const gi = Number(m[1]);
  const mi = Number(m[2]);
  const base: Note = note ?? {};
  const raw = base.groups;
  if (!Array.isArray(raw)) return base;
  const groups = raw.slice();
  const cur = groups[gi];
  if (!isRec(cur)) return base;
  const g = { ...cur };
  if (!Array.isArray(g.members)) return base;
  const members = g.members.slice();
  members[mi] = to;
  g.members = members;
  groups[gi] = g;
  const out: Note = { ...base };
  out.groups = groups;
  return out;
}

/** 迁移 updates → 追加 update-node ops（基于 staged 树逐条应用，保证 note 全量 patch 顺序一致） */
function migrationOps(
  staged: EditableNode,
  updates: readonly { noteKey: string; field: string; to: string }[],
  ops: TreeOp[],
): { staged: EditableNode; conflicts: boolean } {
  let cur = staged;
  for (const u of updates) {
    const node = getNode(cur, u.noteKey);
    if (!node) continue;
    const isGroupMember = u.field.startsWith('groups[') && u.field.includes('.members[');
    const nextNote = isGroupMember
      ? applyGroupMemberUpdate(node.note, u.field, u.to)
      : applyAnchorUpdateToNote(node.note, u.field, u.to);
    cur = applyOp(cur, { type: 'update-node', id: u.noteKey, patch: { note: nextNote } });
    ops.push({ type: 'update-node', id: u.noteKey, patch: { note: nextNote } });
  }
  return { staged: cur, conflicts: false };
}

/** 模拟应用 ops（事务预演——与 applyTransaction 同一套 applyOp 语义） */
function simulate(root: EditableNode, ops: readonly TreeOp[]): EditableNode {
  let cur = root;
  for (const op of ops) cur = applyOp(cur, op);
  return cur;
}

/**
 * 切断 A→B（G2 推荐案，已批准）：B 子树移为文档根直接分支（末尾）+ detached 标记。
 * 引用迁移；新歧义阻断提交（结构化冲突）。
 *
 * @param opts.pos B 岛根当前可见本体中心（UI 层从布局取，防首次落位跳变）；缺省自动排列
 */
export function planCutTreeEdge(
  root: EditableNode,
  childId: string,
  opts: { pos?: { x: number; y: number } } = {},
): CutAttachPlan {
  if (childId === root.id) {
    return { ok: false, error: { code: 'is-root', message: '文档根不可切断' } };
  }
  const loc = findNode(root, childId);
  if (!loc) return { ok: false, error: { code: 'not-found', message: '目标节点不存在' } };
  const center = collectCenters(root).find((c) => c.nodeId === childId);
  if (center?.detached) {
    return { ok: false, error: { code: 'already-detached', message: '该分支已是切断独立状态' } };
  }
  // 深度约束：B 移为根直接子（新深度 1）后，子树最深节点 ≤ 5
  const dMax = subtreeMaxDepth(loc.node);
  if (1 + dMax > MAX_NODE_DEPTH) {
    return {
      ok: false,
      error: {
        code: 'depth-limit',
        message: `子树深度超限：切断后最深层级将超过 H${MAX_NODE_DEPTH + 1}（当前子树相对深度 ${dMax}）`,
      },
    };
  }

  const beforeAt = anchorOfNode(root, childId) ?? '';
  const ops: TreeOp[] = [];
  // ① 结构移动：非根直接子 → 移到根末尾（保留孩子顺序；已是直接子则只做标记）
  if (loc.parent.id !== root.id) {
    ops.push({ type: 'move-node', id: childId, targetParentId: root.id, index: root.children.length });
  }
  // ② detached 标记（先按 before 锚 upsert；锚迁移由 ④ 统一改写为新锚）
  // 事务内自动分配/沿用 cid：节点已有 cid 沿用，无则分配（bump next_cid，永不复用）
  const { rootNote, nodeNote, cid, allocated } = ensureNodeCid(root.note, loc.node.note);
  if (allocated) {
    ops.push({ type: 'update-node', id: childId, patch: { note: nodeNote } });
  }
  const dir = center?.dir ?? 'right';
  const posPatch = opts.pos !== undefined ? { x: opts.pos.x, y: opts.pos.y } : {};
  const noteAfterUpsert = upsertCenter(rootNote, beforeAt, {
    dir,
    detached: true,
    cid,
    ...posPatch,
  });
  ops.push({ type: 'update-node', id: root.id, patch: { note: noteAfterUpsert } });

  // ③④ 预演应用 → 引用迁移（前树解析 → 后树重建锚 → 回验）
  let staged = simulate(root, ops);
  const refs = collectReferenceAnchors(root);
  const plan = planReferenceMigration(root, staged, refs);
  if (!plan.ok) {
    const c = plan.conflicts[0];
    return {
      ok: false,
      error: {
        code: 'reference-conflict',
        message: c
          ? `引用迁移冲突（${c.code} @ ${c.field}）：${c.message ?? '新路径不可唯一表示'}`
          : '引用迁移冲突：新路径不可唯一表示',
      },
    };
  }
  const mig = migrationOps(staged, plan.updates, ops);
  staged = mig.staged;

  // ⑤ B 自身中心条目对齐新锚——迁移 refs 基于 before 收集，**首次切断时 centers
  // 尚不存在**（detached op 才写入），收集不到该条目 → at 会停在旧锚（dangling）。
  // 幂等：若迁移已改写 at（再切断场景），此处 findIndex 找不到旧锚则跳过。
  const newAt = anchorOfNode(staged, childId);
  if (newAt !== null && newAt !== beforeAt) {
    const rootNode = getNode(staged, root.id);
    const raw = rootNode?.note?.centers;
    if (rootNode && Array.isArray(raw)) {
      const list = raw.slice();
      const i = list.findIndex((c) => isRec(c) && c.at === beforeAt);
      if (i >= 0) {
        const cur = list[i];
        if (isRec(cur)) list[i] = { ...cur, at: newAt };
        const noteNew: Note = { ...(rootNode.note ?? {}) };
        noteNew.centers = list;
        const op: TreeOp = { type: 'update-node', id: root.id, patch: { note: noteNew } };
        ops.push(op);
        staged = applyOp(staged, op);
      }
    }
  }
  return { ok: true, ops };
}

/**
 * 接回 detached 分支到目标父节点：move + 清 detached（坐标进历史区，保留位置记忆）。
 * 拒绝：接自身/接任意后代（成环）、深度超限、目标不存在、目标非 detached。
 */
export function planAttachIsland(
  root: EditableNode,
  childId: string,
  targetParentId: string,
): CutAttachPlan {
  if (childId === root.id) {
    return { ok: false, error: { code: 'is-root', message: '文档根不可接回' } };
  }
  const loc = findNode(root, childId);
  if (!loc) return { ok: false, error: { code: 'not-found', message: '目标节点不存在' } };
  const center = collectCenters(root).find((c) => c.nodeId === childId);
  if (!center?.detached) {
    return { ok: false, error: { code: 'not-detached', message: '该节点不是切断独立的分支' } };
  }
  const target = getNode(root, targetParentId);
  if (!target) {
    return { ok: false, error: { code: 'not-found', message: '目标父节点不存在' } };
  }
  if (targetParentId === childId) {
    return { ok: false, error: { code: 'attach-to-self', message: '不能接回到自身' } };
  }
  if (isWithin(loc.node, targetParentId)) {
    return { ok: false, error: { code: 'attach-to-descendant', message: '不能接回到自身子树内（成环）' } };
  }
  const dt = depthOf(root, targetParentId) ?? 0;
  const dMax = subtreeMaxDepth(loc.node);
  if (dt + 1 + dMax > MAX_NODE_DEPTH) {
    return {
      ok: false,
      error: {
        code: 'depth-limit',
        message: `接回后子树深度超限（目标深度 ${dt}，子树相对深度 ${dMax}，上限 H${MAX_NODE_DEPTH + 1}）`,
      },
    };
  }

  const beforeAt = anchorOfNode(root, childId) ?? '';
  // 事务内确保节点持有 cid（无则分配；降格/接回不回收节点 cid，再升格沿用）
  const { rootNote, nodeNote, allocated } = ensureNodeCid(root.note, loc.node.note);
  const ops: TreeOp[] = [
    { type: 'move-node', id: childId, targetParentId, index: target.children.length },
  ];
  if (allocated) {
    ops.push({ type: 'update-node', id: childId, patch: { note: nodeNote } });
  }
  // 清 detached（降格语义但**保留坐标**：坐标进 center_pos 历史区，再切断可吸附回原位）
  const noteAfterRemove = removeCenter(rootNote, beforeAt, false);
  ops.push({ type: 'update-node', id: root.id, patch: { note: noteAfterRemove } });

  let staged = simulate(root, ops);
  const refs = collectReferenceAnchors(root);
  const plan = planReferenceMigration(root, staged, refs);
  if (!plan.ok) {
    const c = plan.conflicts[0];
    return {
      ok: false,
      error: {
        code: 'reference-conflict',
        message: c
          ? `引用迁移冲突（${c.code} @ ${c.field}）：${c.message ?? '新路径不可唯一表示'}`
          : '引用迁移冲突：新路径不可唯一表示',
      },
    };
  }
  const mig = migrationOps(staged, plan.updates, ops);
  staged = mig.staged;
  return { ok: true, ops };
}
