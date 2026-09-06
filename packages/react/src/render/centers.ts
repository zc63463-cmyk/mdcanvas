/**
 * 中心（升格节点）数据层 —— G6′ 混合布局。
 *
 * 与 freeEdges.ts 同构：`root.note.centers` 是**文档级**标注数组，
 * 节点数据保持纯净（不往节点上挂坐标/方向）。
 *
 * 设计（与边 manual、markvault placement 同一原则）：
 * - **路径锚**定位（`node:总览/工作`），不记 id —— astToEditable 每次解析都重新生成 id
 * - **坐标缺失即自动布局**：没有 x/y 的中心由 layoutForest 按 bounds 排开
 * - **存在即生效**：只有列在 centers 里的节点才是中心；移除即降格回自动布局
 * - **降格不清坐标**（用户决策④）：坐标留在 note 里，再升格可吸附回原位；
 *   真正要复位时才显式清除 x/y
 *
 * 纯函数，零 DOM。
 */
import {
  parseLinkAnchor,
  resolveLinkAnchor,
  type AnchorResolutionState,
  type EditableNode,
  type GrowDir,
  type Note,
} from '@mindcanvas/kernel';
import { collectEntityOccurrences, splitEntityAnchor } from './freeEdges.js';

/** 文档级中心标注（root.note.centers 数组成员；协议透传形状） */
export interface DocCenter {
  /** 路径锚（node:根/… 或实体 @kind:id） */
  at: string;
  /** 生长方向；缺省 right */
  dir?: string;
  /** 世界坐标（.mm.md 往返后可能为数字串——读侧 num() 容错还原） */
  x?: number | string;
  y?: number | string;
  /** G3：与语义父级的跨岛父子连接显示；缺省 hide（兼容旧数据） */
  parent_link?: string;
  /** G2（A5）：切断独立标记（往返后可能为 "true" 字符串；detached 岛不画容器边、禁普通降格） */
  detached?: boolean | string;
}

/** 解析后的中心（会话内；key = `c${index}` 定位 root.note.centers 数组） */
export interface Center {
  key: string;
  index: number;
  /** 解析到的节点 id（null = 锚失效，渲染层应跳过） */
  nodeId: string | null;
  /** 原始路径锚 */
  at: string;
  /** 生长方向（已校验，非法值回落 right） */
  dir: GrowDir;
  /** 坐标（null = 交由 layoutForest 自动排列） */
  pos: { x: number; y: number } | null;
  /** G3 跨岛父子连接显示（已校验；缺省 hide） */
  parentLink: 'show' | 'hide';
  /** G2（A5）：切断标记（detached 中心禁普通降格、不画容器线） */
  detached: boolean;
  state: AnchorResolutionState;
}

/** parent_link 合法值校验（缺省/非法 → hide） */
export function isParentLink(v: unknown): v is 'show' | 'hide' {
  return v === 'show' || v === 'hide';
}

export const GROW_DIRS: readonly GrowDir[] = ['right', 'left', 'down', 'up'];

const GROW_DIR_VALUES: readonly string[] = GROW_DIRS;

export function isGrowDir(v: unknown): v is GrowDir {
  return typeof v === 'string' && GROW_DIR_VALUES.includes(v);
}

/** 未知协议形状的窄化守卫（读侧容错；运行期类型收窄，不做断言转换） */
export function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 数值容错读取：note 数值字面量经 .mm.md 往返（kernel parseMm 裸标量保字符串，
 * v1.0.0 冻结协议行为）会变成 "250" 这类数字串——读侧还原，不回写。
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** detached 布尔容错（同上：往返后 "true" 字符串） */
function isDetachedFlag(v: unknown): boolean {
  return v === true || v === 'true';
}

/**
 * 实体节点锚解析（@kind:id[#N] → 树中实体节点的 nodeId）。
 *
 * anchorOfNode 对实体节点产出 `@kind:id`（多次出现加 #N），但内核 resolveLinkAnchor
 * 对实体锚只验语法、不定位节点（ADR-0004：实体存在性归 resolver）。中心投影需要
 * nodeId 才能划岛，故在此按 anchorOfNode 的逆向规则解析：
 * 唯一出现 → 裸锚命中；多次出现 → 必须带 #N（裸锚多命中 = stale，与内核同名歧义语义一致）。
 */
function resolveEntityCenterAnchor(
  root: EditableNode,
  at: string,
): { state: AnchorResolutionState; nodeId?: string } {
  const { base, occurrence } = splitEntityAnchor(at);
  const list = collectEntityOccurrences(root).get(base);
  if (!list || list.length === 0) return { state: 'dangling' };
  if (occurrence === null) {
    if (list.length > 1) return { state: 'stale' };
    return { state: 'well-formed', nodeId: list[0] };
  }
  const idx = occurrence - 1;
  const hit = idx >= 0 ? list[idx] : undefined;
  return hit !== undefined ? { state: 'well-formed', nodeId: hit } : { state: 'dangling' };
}

/** 收集全部中心（路径锚 → nodeId） */
export function collectCenters(root: EditableNode): Center[] {
  const raw = root.note?.centers;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: Center[] = [];
  raw.forEach((item, index) => {
    if (!isRec(item)) return;
    if (typeof item.at !== 'string') return;
    const parsed = parseLinkAnchor(item.at);
    let res: { state: AnchorResolutionState; nodeId?: string } | null = null;
    if (parsed && parsed.kind === 'node') {
      res = resolveLinkAnchor(root, parsed);
    } else if (parsed && parsed.kind === 'entity') {
      // 实体节点升格（G6″ A3）：@issue:8 这类锚同样定位到树中实体节点
      res = resolveEntityCenterAnchor(root, item.at);
    }
    const x = num(item.x);
    const y = num(item.y);
    out.push({
      key: `c${index}`,
      index,
      nodeId: res?.nodeId ?? null,
      at: item.at,
      dir: isGrowDir(item.dir) ? item.dir : 'right',
      // 坐标必须成对：缺一个就整体交给自动排列
      pos: x !== undefined && y !== undefined ? { x, y } : null,
      // G3：非法值回落 hide（缺省隐藏，兼容旧数据）
      parentLink: isParentLink(item.parent_link) ? item.parent_link : 'hide',
      // G2：detached 标记（容错 "true" 字符串；其它值视为未切断——旧数据兼容）
      detached: isDetachedFlag(item.detached),
      state: res?.state ?? 'stale',
    });
  });
  return out;
}

/**
 * 写入/更新一个中心（按路径锚匹配；已存在则更新 dir/pos）。
 * 返回新的 note 对象（不可变；不改动传入值）。
 */
export function upsertCenter(
  note: Note | undefined,
  at: string,
  patch: {
    dir?: GrowDir;
    x?: number;
    y?: number;
    parentLink?: 'show' | 'hide';
    detached?: boolean;
  } = {},
): Note {
  const raw = note?.centers;
  const list: DocCenter[] = Array.isArray(raw)
    ? raw.filter((i): i is DocCenter => isRec(i))
    : [];
  const idx = list.findIndex((c) => c.at === at);
  const prev: DocCenter = (idx >= 0 ? list[idx] : undefined) ?? { at };
  const next: DocCenter = { ...prev, at };
  if (patch.dir !== undefined) next.dir = patch.dir;
  // G3：parent_link 只在显式指定时写入（新升格缺省不写 = hide，协议面保持最小）
  if (patch.parentLink !== undefined) {
    if (patch.parentLink === 'show') next.parent_link = 'show';
    else delete next.parent_link; // hide 为缺省语义，不落字段
  }
  // G2：detached 只在显式指定时写入；false 删字段（未切断 = 缺省语义）
  if (patch.detached !== undefined) {
    if (patch.detached === true) next.detached = true;
    else delete next.detached;
  }

  // 未显式给坐标时，优先保留当前已有的有效成对坐标；仅在新升格或当前位置无效时恢复历史位置。
  const currentX = num(prev.x);
  const currentY = num(prev.y);
  const history = collectCenterHistory(note);
  const remembered = history.get(at);
  if (patch.x !== undefined && patch.y !== undefined) {
    next.x = patch.x;
    next.y = patch.y;
  } else if (currentX !== undefined && currentY !== undefined) {
    next.x = currentX;
    next.y = currentY;
  } else if (remembered) {
    next.x = remembered.x;
    next.y = remembered.y;
  } else {
    delete next.x;
    delete next.y;
  }
  // dir 缺省时补上，避免读取侧反复回落
  if (next.dir === undefined) next.dir = 'right';

  const outList = idx >= 0 ? list.map((c, i) => (i === idx ? next : c)) : [...list, next];
  const out: Note = { ...(note ?? {}) };
  out.centers = outList;
  return out;
}

/**
 * 移除一个中心（降格）。
 *
 * @param dropPos  false（默认）= **坐标进历史区**，再升格可吸附回原位（用户决策④）；
 *                 true = 连坐标一起丢弃，彻底复位
 */
export function removeCenter(note: Note | undefined, at: string, dropPos = false): Note {
  const base: Note = note ?? {};
  const raw = base.centers;
  if (!Array.isArray(raw)) return base;
  const list = raw.filter((i): i is DocCenter => isRec(i));
  const idx = list.findIndex((c) => c.at === at);
  if (idx < 0) return base;

  const centers = list.filter((_, i) => i !== idx);
  let out: Note = { ...base, centers };

  // 降格前把当前坐标留档（供再升格吸附回原位）
  if (!dropPos) {
    const cur = list[idx];
    const x = cur ? num(cur.x) : undefined;
    const y = cur ? num(cur.y) : undefined;
    if (x !== undefined && y !== undefined) out = rememberCenterPos(out, at, { x, y });
  } else {
    out = forgetCenterPos(out, at);
  }
  return out;
}

/**
 * 历史坐标暂存区：`root.note.center_pos`。
 * 「存在即生效」的补充 —— 降格后坐标从 centers 移除，但在此留档，
 * 再次升格时由 posOfHistory 读回，实现「吸附回原位」。
 */
export interface CenterPosEntry {
  at: string;
  x: number;
  y: number;
}

export function collectCenterHistory(note: Note | undefined): Map<string, { x: number; y: number }> {
  const raw = note?.center_pos;
  const out = new Map<string, { x: number; y: number }>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!isRec(item)) continue;
    if (typeof item.at !== 'string') continue;
    const x = num(item.x);
    const y = num(item.y);
    if (x === undefined || y === undefined) continue;
    out.set(item.at, { x, y });
  }
  return out;
}

/** 写入历史坐标（覆盖同 at 的旧值） */
export function rememberCenterPos(
  note: Note | undefined,
  at: string,
  pos: { x: number; y: number },
): Note {
  const base: Note = note ?? {};
  const raw = base.center_pos;
  const list = Array.isArray(raw)
    ? raw.filter((i): i is CenterPosEntry => isRec(i))
    : [];
  const rest = list.filter((e) => e.at !== at);
  const out: Note = { ...base };
  out.center_pos = [...rest, { at, x: pos.x, y: pos.y }];
  return out;
}

/** 丢弃历史坐标（彻底复位） */
export function forgetCenterPos(note: Note | undefined, at: string): Note {
  const base: Note = note ?? {};
  const raw = base.center_pos;
  if (!Array.isArray(raw)) return base;
  const list = raw.filter((i): i is CenterPosEntry => isRec(i));
  const next = list.filter((e) => e.at !== at);
  if (next.length === list.length) return base;
  const out: Note = { ...base };
  out.center_pos = next;
  return out;
}
