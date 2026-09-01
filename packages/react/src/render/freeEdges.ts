/**
 * 画布级标注边（E5 存储重构·边一等公民修订版）：
 * - 边是【文档级标注对象】（root note 透传键 `edges`），不是节点属性——同一对节点
 *   在不同画布可有不同关系与连线；节点数据保持纯净
 * - 锚存路径/实体锚（跨会话稳定——运行时 nodeId 每次解析都变），会话内经内核
 *   note-anchor 三态判定解析为 nodeId
 * - note.links 契约保留为 B 线语义层（跟着节点走的知识），画布 UI 不读写它
 * - relVisualOf 提供语义默认视觉；edge.style（color/dashed/width）用户自定义覆盖
 * 纯函数无 DOM；渲染组装在 MapView 的 FreeEdgeLayer。
 */
import {
  parseLinkAnchor,
  resolveLinkAnchor,
  type AnchorResolutionState,
  type EditableNode,
  type LinkDir,
} from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import { collapsedAncestors } from '../edit/reveal.js';
import { defaultRelationSchema } from '../chrome/relationSchema.js';

/** 用户自定义连线样式（覆盖 rel 语义默认值） */
export interface EdgeStyle {
  color?: string;
  dashed?: boolean;
  /** 线宽 px（缺省走 rel 默认） */
  width?: number;
}

/** 边来源（E6.1·来源溯源：manual 人工 / inferred AI 提议 / imported 导入） */
export type EdgeSource = 'manual' | 'inferred' | 'imported';

/**
 * 边的「人工锁定」几何（Issue #3：拖端点 / bend 控制点结果）。
 * 定义在 freeEdges.ts（数据契约层）而非 FreeEdgeLayer.tsx（渲染层）——
 * 后者依赖前者，反向 import 会形成循环依赖。
 */
export interface EdgeManual {
  /** 手动指定的源锚点（归一化 0–1，相对源盒） */
  from?: { x: number; y: number };
  /** 手动指定的靶锚点（归一化 0–1，相对靶盒） */
  to?: { x: number; y: number };
  /** 手动指定的曲率（bend handle 拖动结果） */
  curvature?: number;
}

/** 文档级边标注（root note.edges 数组成员；协议透传形状） */
export interface DocEdge {
  /** 源锚（node:根/… 路径锚 或 实体锚 kind:id） */
  from: string;
  /** 目标锚 */
  to: string;
  rel: string;
  dir?: LinkDir;
  label?: string;
  note?: string;
  style?: EdgeStyle;
  /** 软失效时间戳（ISO；存在 = 已失效而非删除——恢复即清空） */
  invalidAt?: string;
  /** 来源标记（B 线 AI 提议边识别前置） */
  source?: EdgeSource;
  /** 人工锁定几何（Issue #3：存在 = 停用自动路由，尊重用户明确意图） */
  manual?: EdgeManual;
  /**
   * 绕行侧（对标 markvault-js routingSide）：'left' | 'right' | undefined = 自动。
   * 透传键，与 manual 并存但语义不同 —— manual 记录精确几何，routingSide 只定方向、
   * 曲率仍由算法在该侧内择优。
   */
  routingSide?: 'left' | 'right';
}

/** 解析后的自由边（会话内；key = `e${index}` 定位 root.note.edges 数组） */
export interface FreeEdge {
  key: string;
  index: number;
  sourceId: string | null;
  targetId: string | null;
  /** 源/目标原始锚文本（解析失败时面板兜底显示） */
  from: string;
  to: string;
  rel: string;
  dir: LinkDir;
  label?: string;
  note?: string;
  style?: EdgeStyle;
  invalidAt?: string;
  source?: EdgeSource;
  /**
   * 人工锁定：用户手动调整过这条连线后记录的手工几何（归一化锚点 + 曲率）。
   * 一旦存在，自动路由立即停用 —— 与 XMind / MindManager / Miro 的交互契约一致。
   * 对应 Issue #3；透传键，遵循 spec 未知键透传纪律。
   */
  manual?: { from?: { x: number; y: number }; to?: { x: number; y: number }; curvature?: number };
  /**
   * 绕行侧（对标 markvault-js routingSide）：'left' | 'right' | undefined = 自动（由美学评分决定）。
   * 用户一键定向用 —— 比拖 bend 控制点快得多，且可持久化。透传键，遵循 spec 未知键透传纪律。
   */
  routingSide?: 'left' | 'right';
  state: AnchorResolutionState;
}

/** 节点锚名（与内核 note-anchor 的 nodeAnchorName 对齐） */
function anchorName(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

/** 节点 → 稳定锚（node:根/路径 或 @kind:id；同一实体多次出现时加 `#序号` 消歧）
 *
 * E8 P0 修复（用户反馈②「没有基于节点建立起 / 位置不对」）：同一实体（如 `@issue:8`）
 * 在树中多处引用时，锚文本完全相同 → 连到「分支B 那个」的边会错锚到「分支A 那个」。
 * 按内核 spec §5.5「同名歧义用 #序号 消歧」：第 2 次起追加 `#N`（首次不加以保持向后兼容）。
 */
export function anchorOfNode(root: EditableNode, id: string): string | null {
  // 两趟：先统计同名实体出现数——仅当「该实体在树中出现多次」时才给所有出现加 #N
  // （只给第 2 个起加会让首个出现变成不可寻址，属设计缺陷）
  const occurrences = collectEntityOccurrences(root);
  const walk = (n: EditableNode, path: string[]): string | null => {
    const name = anchorName(n);
    // 空名节点（文本被清空 / 实体 ref 被清除）不占路径段，但【仍须下钻】——
    // 否则其整棵子树都拿不到锚 → 已有边集体退化为 dangling（与内核 effectiveChildren 对齐）
    const nextPath = name === '' ? path : [...path, name];
    if (name !== '' && n.id === id) {
      if (n.type === 'entity') {
        const list = occurrences.get(name);
        // 唯一出现 → 裸锚（向后兼容已有文档）；多次出现 → 全部带 #N 以便精确寻址
        if (!list || list.length <= 1) return name;
        const idx = list.indexOf(n.id);
        return idx >= 0 ? `${name}#${idx + 1}` : name;
      }
      return `node:${nextPath.join('/')}`;
    }
    for (const c of n.children) {
      const found = walk(c, nextPath);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, []);
}

/** 实体锚 → 基名 + 出现序号。
 *  兼容三种书写形态：`@kind:id`（anchorOfNode 产出）/ `kind:id`（内核契约）/ `@@kind:id`（历史残留）。
 *  `#N` 消歧后缀仅当剥离后仍是合法实体锚（`@kind:id`）才成立——避免误伤 id 自带 `#` 的实体（如 `@issue:#8`）。 */
export function splitEntityAnchor(anchor: string): { base: string; occurrence: number | null } {
  let s: string;
  if (anchor.startsWith('@@')) s = anchor.slice(1);
  else if (anchor.startsWith('@')) s = anchor;
  else s = `@${anchor}`;
  const m = s.match(/^(.+)#(\d+)$/);
  if (m && /^@[^:\s]+:[^\s]+$/.test(m[1]!)) {
    return { base: m[1]!, occurrence: Number(m[2]) };
  }
  return { base: s, occurrence: null };
}

/** 解析单个锚 → nodeId。
 *  节点锚 → 内核路径解析；实体锚 → 按出现列表定位（带 `#N` 取第 N 个；无 `#N` 仅在
 *  唯一出现时解析——多命中按 spec「宁可不写也不错写」返回 null，由渲染层呈现为悬空边）。 */
function resolveAnchorToId(
  root: EditableNode,
  anchor: string,
  entityOccurrences: Map<string, string[]>,
): string | null {
  const parsed = parseLinkAnchor(anchor);
  if (!parsed) return null;
  if (parsed.kind === 'node') return resolveLinkAnchor(root, parsed).nodeId ?? null;
  const { base, occurrence } = splitEntityAnchor(anchor);
  const list = entityOccurrences.get(base);
  if (list === undefined || list.length === 0) return null;
  if (occurrence !== null) return list[occurrence - 1] ?? null;
  return list.length === 1 ? list[0]! : null;
}

/** 收集树中全部实体锚的出现顺序（先序；同名多次出现 → 数组多项） */
export function collectEntityOccurrences(root: EditableNode): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const walk = (n: EditableNode): void => {
    const name = anchorName(n);
    if (name.startsWith('@')) {
      const list = map.get(name);
      if (list) list.push(n.id);
      else map.set(name, [n.id]);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return map;
}

/** 解析 root.note.edges 文档级标注边 → 会话内 FreeEdge[]（随树重建） */
export function collectFreeEdges(root: EditableNode): FreeEdge[] {
  const raw = root.note?.edges;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const entityOccurrences = collectEntityOccurrences(root);
  const out: FreeEdge[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return;
    const e = item as DocEdge;
    if (typeof e.from !== 'string' || typeof e.to !== 'string') return;
    const sourceId = resolveAnchorToId(root, e.from, entityOccurrences);
    const targetId = resolveAnchorToId(root, e.to, entityOccurrences);
    const state: AnchorResolutionState =
      sourceId !== null && targetId !== null ? 'well-formed' : 'dangling';
    out.push({
      key: `e${index}`,
      index,
      sourceId,
      targetId,
      from: e.from,
      to: e.to,
      rel: String(e.rel ?? ''),
      dir: e.dir ?? 'fwd',
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.note !== undefined ? { note: e.note } : {}),
      ...(e.style !== undefined ? { style: e.style } : {}),
      ...(e.invalidAt !== undefined ? { invalidAt: e.invalidAt } : {}),
      ...(e.source !== undefined ? { source: e.source } : {}),
      // Issue #3：人工锁定几何透传（DocEdge.manual → FreeEdge.manual）
      ...(e.manual !== undefined ? { manual: e.manual } : {}),
      ...(e.routingSide !== undefined ? { routingSide: e.routingSide } : {}),
      state,
    });
  });
  return out;
}

/** rel → 视觉：schema 注册词汇取语义色（E6.1）；未注册 → 中性灰虚线 */
export function relVisualOf(rel: string, token: TokenSet): { stroke: string; dashed: boolean } {
  const schemaColor = defaultRelationSchema.getConfig(rel)?.color;
  switch (rel) {
    case 'blocks':
      return { stroke: schemaColor ?? token.color.warn, dashed: false };
    case 'causes':
      return { stroke: schemaColor ?? token.color.accent ?? token.color.selection, dashed: false };
    case 'duplicates':
      return { stroke: schemaColor ?? token.color.annotationAccent, dashed: true };
    case 'relates-to':
      return { stroke: schemaColor ?? token.color.linkStroke, dashed: true };
    default:
      return { stroke: schemaColor ?? token.color.textMuted, dashed: true };
  }
}

/** 边最终视觉：style 用户自定义覆盖 rel 语义默认 */
export function edgeVisualOf(
  edge: FreeEdge,
  token: TokenSet,
): { stroke: string; dashed: boolean; width: number } {
  const base = relVisualOf(edge.rel, token);
  return {
    stroke: edge.style?.color ?? base.stroke,
    dashed: edge.style?.dashed ?? base.dashed,
    width: edge.style?.width ?? 1.6,
  };
}

/** 沿盒中心 → 外部点方向，取盒边界交点（边端点贴卡片边缘，不插进卡片内部）
 *  E8 增强：零尺寸盒 → 返回盒中心（避免 NaN 传播到 SVG path） */
export function borderPoint(box: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // 零尺寸或退化盒：直接返回中心（不应发生但防御性编程）
  if (box.w <= 0 || box.h <= 0) return { x: cx, y: cy };
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** 端点解析结果（渲染顺序已按 dir 归一：from = 箭尾，to = 箭头侧） */
export interface EdgeEndpoints {
  fromId: string;
  toId: string;
  from: Box;
  to: Box;
  /** 目标不可达（dangling / 实体未在画布）→ 幽灵锚点坐标（to 为合成盒） */
  ghost: boolean;
  /**
   * 可渲染性（E8 P0）：源锚未解析 / 端点盒缺失 → false。
   * 此前这类边以零盒渲染，视觉上是一条飞向世界原点 (0,0) 的线（用户反馈②「位置不对/丢失」）。
   * 调用方须据此跳过绘制——未解析的边由关系面板呈现，不在画布上画误导性几何。
   */
  renderable: boolean;
}

/** 端点解析：dir 箭头语义 + 折叠路由（先路由后判空——折叠子树内目标收缩到可视祖先）+ 幽灵锚点
 *  E8 增强修复：
 *  - 源锚未解析 → renderable=false（不再绘制飞向世界原点的误导性直线）
 *  - 零尺寸盒防护：盒未就绪（动画首帧 / LOD 降级）视为不可路由，杜绝 NaN 坐标
 *  - 幽灵锚点：源盒中心向「右下 45°」外推（避开自身卡片，视觉上明确表示「未锚定」）
 */
export function freeEdgeEndpoints(
  edge: FreeEdge,
  boxOf: (id: string) => Box | undefined,
  root: EditableNode,
  collapsed: ReadonlySet<string>,
): EdgeEndpoints {
  const GHOST_DIST = 120;
  /** 幽灵锚点合成盒：从源盒中心沿右下 45° 外推，落点不与源卡片重叠 */
  const synth = (b: Box): Box => ({
    x: b.x + b.w / 2 + GHOST_DIST * 0.7,
    y: b.y + b.h / 2 + GHOST_DIST * 0.7,
    w: 10,
    h: 10,
  });
  // 折叠路由：id 不可见（自身或祖先被折叠）→ 上溯到最近可视祖先（= 顶个被折叠祖先自身渲染）。
  // 必须先于 ghost 判定——否则折叠后目标不在布局节点集，边会错误指向幽灵锚点而不收缩。
  const route = (id: string): { id: string; box: Box } | null => {
    let effective = id;
    const hiddenBy = collapsedAncestors(root, collapsed, id);
    if (hiddenBy.length > 0) effective = hiddenBy[0]!;
    const box = boxOf(effective);
    if (!box) return null;
    // 零尺寸盒防护：节点存在但盒未就绪（动画首帧 / LOD 降级）→ 不可路由
    if (box.w <= 0 || box.h <= 0) return null;
    return { id: effective, box };
  };
  // E8：源不可解析 → 不可渲染（返回零盒但 renderable=false，调用方跳过）
  const VOID: Box = { x: 0, y: 0, w: 0, h: 0 };
  if (edge.sourceId === null)
    return { fromId: '', toId: '', from: VOID, to: VOID, ghost: false, renderable: false };
  const s = route(edge.sourceId);
  if (!s)
    return {
      fromId: edge.sourceId,
      toId: '',
      from: VOID,
      to: VOID,
      ghost: false,
      renderable: false,
    };
  if (edge.targetId === null) {
    // 幽灵锚点：dangling / 实体未在画布 —— 源盒右下外推
    return { fromId: s.id, toId: '', from: s.box, to: synth(s.box), ghost: true, renderable: true };
  }
  const t = route(edge.targetId);
  if (!t) {
    // 目标 ID 解析成功但无盒（折叠/LOD/时序）→ 幽灵模式，保留边而非丢弃
    return {
      fromId: s.id,
      toId: edge.targetId,
      from: s.box,
      to: synth(s.box),
      ghost: true,
      renderable: true,
    };
  }
  // dir 语义：fwd 源→目标；back 画布上反向绘制（箭头落在源端）；both 两端箭头（方向同 fwd）
  const forward = edge.dir !== 'back';
  return forward
    ? { fromId: s.id, toId: t.id, from: s.box, to: t.box, ghost: false, renderable: true }
    : { fromId: t.id, toId: s.id, from: t.box, to: s.box, ghost: false, renderable: true };
}

/** 边曲线：卡片边缘 → 边缘三次贝塞尔（垂直于连线方向的恒定弓高），
 *  返回 path、t=0.5 中点与单位法向（标签「从线中生长」的朝向；已归一为朝上/朝右优先） */
export function buildFreeEdgePath(
  a: Box,
  b: Box,
  curvature = 0.18,
): { d: string; mid: { x: number; y: number }; nx: number; ny: number } {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p0 = borderPoint(a, bc.x, bc.y);
  const p3 = borderPoint(b, ac.x, ac.y);
  const mx = (p0.x + p3.x) / 2;
  const my = (p0.y + p3.y) / 2;
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  // 法向弓高与边长成比例（上下弓由法向取负 y 侧——右向边向下弓，避开节点行）
  const bow = len * curvature;
  const nx = (-dy / len) * bow;
  const ny = (dx / len) * bow;
  const c1x = p0.x + dx * 0.35 + nx;
  const c1y = p0.y + dy * 0.35 + ny;
  const c2x = p0.x + dx * 0.65 + nx;
  const c2y = p0.y + dy * 0.65 + ny;
  const mid = {
    x: 0.125 * p0.x + 0.375 * c1x + 0.375 * c2x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * c1y + 0.375 * c2y + 0.125 * p3.y,
  };
  return {
    d: `M ${p0.x} ${p0.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p3.x} ${p3.y}`,
    mid,
    ...normalAtMid(p0, { x: c1x, y: c1y }, { x: c2x, y: c2y }, p3),
  };
}

/** 三次贝塞尔 t=0.5 处的单位法向（切向 B'(0.5) = 0.75·(P3 + P2 − P1 − P0)）；
 *  朝向归一：优先朝上（ny<0），近垂直时优先朝右（nx>0）——标签不压节点行 */
export function normalAtMid(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { nx: number; ny: number } {
  const tx = p3.x + p2.x - p1.x - p0.x;
  const ty = p3.y + p2.y - p1.y - p0.y;
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len;
  let ny = tx / len;
  // 朝下 → 翻转为朝上；近水平垂直（|ny| 小）且朝左 → 翻转为朝右
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}
