/**
 * 节点显示度量：测量（布局引擎）与渲染（NodeG）共用的唯一事实源。
 * 保证"盒子按行数撑高、文本按行渲染"两侧数据一致——换行显示的核心。
 */
import { KIND_FALLBACK_COLOR, KIND_META, refKey } from '../protocol/types.js';
import { safeHref } from '../protocol/uri.js';
import type { Entity } from '../protocol/types.js';
import type { EditableNode } from '../tree/treeOps.js';
import { wrapText } from './wrap.js';
import { inlineWidth, tokenizeInline } from './inline.js';
import type { InlineToken } from './inline.js';

export const LINE_H = 16;
export const TITLE_MAX_ENTITY = 200;
export const TITLE_MAX_TEXT = 260;
export const TITLE_MAX_IMAGE = 240;
const PAD_X = 12;
const MIN_H = 34;
/** 资产预览区高度（@img/@draw 专属）：布局必须为其预留，否则图片被压进文本高度的条带 */
const ASSET_H = 96;
/** 资产区与文本区的垂直间隙 */
const ASSET_GAP = 8;
/** 可预览的资产 kind（与 NodeG 的渲染判定同源；新增资产 kind 需同步此处） */
const ASSET_KINDS: readonly string[] = ['img', 'draw'];

export interface DisplayMetrics {
  w: number;
  h: number;
  /** 标题行（换行后） */
  lines: string[];
  /** 每行的行内富文本 token（渲染用；未闭合按纯文本） */
  tokens: InlineToken[][];
  /** 最长行宽度 */
  lineW: number;
  /** 标题区起点 x */
  contentX: number;
  kindLabel: string | null;
  kindColor: string;
  warn: boolean;
  badgeText: string | null;
  badgeW: number;
  badgeX: number;
  entityUrl: string | null;
  hasNote: boolean;
  /**
   * 资产预览区高度（仅 @img/@draw 实体 > 0；其余节点为 0）。
   * 渲染侧据此把图片区与文本区垂直分离——布局与渲染共用同一数值，防止图文重叠。
   * （1.0.1 新增可选字段：符合 ADR-0004「minor 可加不可改」）
   */
  assetH?: number;
}

/** 行宽：普通字体度量与 token 加权度量取大（防富文本加宽溢出节点盒） */
function lineWidthOf(line: string, measure: (s: string) => number): number {
  return Math.max(measure(line), inlineWidth(tokenizeInline(line), measure));
}

/**
 * displayMetrics 的引用键缓存：text/image 节点不依赖 entities，node 对象引用
 * 在不可变更新下保持不变 → WeakMap 命中即精确失效（无需 TTL）；entity 节点
 * 依赖 entities 动态标题，始终直算不落缓存。
 */
export function cachedMetrics(
  cache: WeakMap<EditableNode, DisplayMetrics>,
  node: EditableNode,
  entities: Map<string, Entity>,
  measure: (s: string) => number,
): DisplayMetrics {
  if (node.type !== 'entity') {
    const hit = cache.get(node);
    if (hit) return hit;
    const m = displayMetrics(node, entities, measure);
    cache.set(node, m);
    return m;
  }
  return displayMetrics(node, entities, measure);
}

export function displayMetrics(
  node: EditableNode,
  entities: Map<string, Entity>,
  measure: (s: string) => number,
): DisplayMetrics {
  if (node.type === 'entity' && node.ref) {
    const ent = entities.get(refKey(node.ref));
    const warn = ent === undefined || ent.status === 'unresolved';
    const title = ent?.title ?? `${node.ref.kind}:${node.ref.id}`;
    const kindLabel = `@${node.ref.kind}`;
    const kindColor = KIND_META[node.ref.kind]?.color ?? KIND_FALLBACK_COLOR;
    const kindW = measure(kindLabel) + 10;
    const lines = wrapText(title, TITLE_MAX_ENTITY, measure);
    const tokens = lines.map((l) => tokenizeInline(l));
    const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
    const warnW = warn ? 16 : 0;
    const badgeText = ent?.status && ent.status !== 'unresolved' ? ent.status : null;
    const badgeW = badgeText !== null ? measure(badgeText) + 14 : 0;
    const entityUrl = safeHref(ent?.ref ?? null);
    const hasNote = Boolean(node.note);
    const iconW = (entityUrl !== null ? 13 : 0) + (hasNote ? 15 : 0);
    const contentX = PAD_X + kindW + 6;
    const w = Math.ceil(
      contentX +
        warnW +
        lineW +
        (badgeW > 0 ? badgeW + 8 : 0) +
        (iconW > 0 ? iconW + 6 : 0) +
        PAD_X,
    );
    // 资产节点（@img/@draw）：布局必须为预览区预留高度，否则渲染时图片只能挤进文本高度的条带并与文字重叠
    const assetH = ASSET_KINDS.includes(node.ref.kind) ? ASSET_H : 0;
    const textH = lines.length * LINE_H + 12;
    const h = Math.max(MIN_H, textH + (assetH > 0 ? assetH + ASSET_GAP : 0));
    return {
      w,
      h,
      lines,
      tokens,
      lineW,
      contentX,
      kindLabel,
      kindColor,
      warn,
      badgeText,
      badgeW,
      badgeX: contentX + warnW + lineW + 6,
      entityUrl,
      hasNote,
      assetH,
    };
  }
  if (node.type === 'image') {
    const lines = wrapText(`🖼 ${node.url ?? ''}`, TITLE_MAX_IMAGE, measure);
    const tokens = lines.map((l) => tokenizeInline(l));
    const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
    const w = Math.ceil(PAD_X + lineW + PAD_X);
    const h = Math.max(MIN_H, lines.length * LINE_H + 12);
    return {
      w,
      h,
      lines,
      tokens,
      lineW,
      contentX: PAD_X,
      kindLabel: null,
      kindColor: KIND_FALLBACK_COLOR,
      warn: false,
      badgeText: null,
      badgeW: 0,
      badgeX: 0,
      entityUrl: null,
      hasNote: Boolean(node.note),
    };
  }
  const lines = wrapText(node.text ?? '', TITLE_MAX_TEXT, measure);
  const tokens = lines.map((l) => tokenizeInline(l));
  const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
  const hasNote = Boolean(node.note);
  const w = Math.ceil(Math.max(44, PAD_X + lineW + (hasNote ? 17 : 0) + PAD_X));
  const h = Math.max(MIN_H, lines.length * LINE_H + 12);
  return {
    w,
    h,
    lines,
    tokens,
    lineW,
    contentX: PAD_X,
    kindLabel: null,
    kindColor: KIND_FALLBACK_COLOR,
    warn: false,
    badgeText: null,
    badgeW: 0,
    badgeX: 0,
    entityUrl: null,
    hasNote,
  };
}
