/**
 * mind-node 协议类型 · entity-ref v0.2.1 对齐（v0.2.2 增补跨库前缀校验）
 * 三项目（Forge 知识画布 / markvault-js MindFlow / markvault-reborn）共享的协议层
 */

/** 已注册 kind（v0.2 六类 + v0.2.1 增补 idea + 资产 img/draw = 九类） */
export type RegisteredKind =
  | 'issue'
  | 'pr'
  | 'doc'
  | 'milestone'
  | 'note'
  | 'idea'
  | 'annotation'
  | 'img'
  | 'draw';

export const REGISTERED_KINDS: readonly RegisteredKind[] = [
  'issue',
  'pr',
  'doc',
  'milestone',
  'note',
  'idea',
  'annotation',
  'img',
  'draw',
];

/**
 * 轻量实体引用。kind 保持 string：未知 kind 依协议保留
 * （W-UNKNOWN-KIND，前向兼容 v0.3 新增 kind 的存量文件）。
 */
export interface EntityRef {
  kind: string;
  id: string;
}

/** 节点笔记（.mm.md 笔记块 YAML；未知字段容忍透传） */
export interface Note {
  one_liner?: string;
  decisions?: string[];
  status?: string;
  next?: string | string[];
  reminder?: string;
  /**
   * 幕布风格「描述」（v1.3.0）：对某一主题的解释和说明，纯文本，显示在节点下方。
   * 对齐幕布官方（mubu.com/help/20）：Shift+Enter 编辑，支持自动收缩（默认一行 / 点击展开全文）。
   * 与 note.qa（快速注释：多条目列表，点击展开）是两套并存机制——描述常驻可见，qa 按需展开。
   * 多行以 \n 分隔；空串视为无描述（写回时置 undefined 删除）。
   */
  desc?: string;
  [key: string]: unknown;
}

/** MindNode 三分结构（v0.2.1） */
export interface MindNode {
  type: 'text' | 'image' | 'entity';
  text?: string;
  url?: string;
  ref?: EntityRef;
  note?: Note;
  children: MindNode[];
}

/** 诊断（line 为 1 起原始行号；message 不参与 golden 比较） */
export interface Diagnostic {
  code: string;
  line: number;
  message: string;
}

export interface ParseResult {
  root: MindNode | null;
  refs: EntityRef[];
  diagnostics: Diagnostic[];
}

/** Entity 统一形状（resolver 输出；v0.2 加法扩展 meta） */
export interface Entity {
  kind: string;
  id: string;
  title: string | null;
  status: string | null;
  ref: string | null;
  meta?: Record<string, unknown> & { unresolved_reason?: string };
}

export type UnresolvedReason =
  | 'not-found'
  | 'unreachable'
  | 'unsupported-environment'
  | 'unknown-kind';

/** 构造 unresolved Entity（resolver 失败统一返回，不抛异常） */
export function unresolvedEntity(ref: EntityRef, reason: UnresolvedReason): Entity {
  return {
    kind: ref.kind,
    id: ref.id,
    title: null,
    status: 'unresolved',
    ref: null,
    meta: { unresolved_reason: reason },
  };
}

/** resolveMany 的 Map key 形式（v0.2 固化） */
export function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

const ISSUE_PR_ID_RE = /^[1-9][0-9]*$/;
// erratum(v0.2.1)：增补案前缀正则为全小写，但其 T27 用例 pomodoroXII（混合大小写）期望合法、
// T28 的 MARKVAULT（大写起始）期望非法 —— 按 golden 判定口径修正为：小写起始、混合大小写允许。
const IDEA_ID_RE = /^([a-z][a-zA-Z0-9_-]*:)?[1-9][0-9]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 此处 \x00-\x1F 是刻意排除（字符类取反 [^...]，语义「id 不得含 @、冒号与控制字符」），非意外写入控制字符
const NAME_ID_RE = /^[^@:\x00-\x1F]+$/;
const ANNOTATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// v0.2.2 跨库引用前缀：`org` 单段或 `org/repo` 双段（Forgejo 仓库命名符 [A-Za-z0-9_.-]）+ 冒号
const ORG_PREFIX_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?:/;

/** 剥离可选跨库前缀，返回实体本体 id（无前缀 → 原样） */
export function stripOrgPrefix(id: string): string {
  const m = id.match(ORG_PREFIX_RE);
  return m ? id.slice(m[0].length) : id;
}

/** 资产/文档相对路径校验：非空、无逃逸段（. / .. / 空段）、无反斜杠、段命名合法 */
function isAssetPath(body: string): boolean {
  if (!body || body.startsWith('/') || body.includes('\\') || body.length > 512) return false;
  const segs = body.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  return segs.every((s) => NAME_ID_RE.test(s));
}

/** kind 级 id 校验（v0.2 各 kind + v0.2.1 idea 特例 + v0.2.2 跨库前缀） */
export function validateId(kind: string, id: string): boolean {
  if (kind === 'idea') {
    // v0.2.1 受控特例：可选 project 前缀（org 名），含恰好一个冒号；跨库前缀语法不作用于 idea
    return IDEA_ID_RE.test(id);
  }
  // v0.2.2：跨库前缀（org 单段 / org/repo 双段）剥离后校验实体本体
  const body = stripOrgPrefix(id);
  switch (kind) {
    case 'issue':
    case 'pr':
      return ISSUE_PR_ID_RE.test(body);
    case 'doc':
    case 'img':
    case 'draw':
      return isAssetPath(body);
    case 'milestone':
    case 'note': {
      const t = body.trim();
      return t.length > 0 && NAME_ID_RE.test(t);
    }
    case 'annotation':
      return ANNOTATION_ID_RE.test(id);
    default:
      // 未注册 kind：不做 id 校验（原样保留 + W-UNKNOWN-KIND）
      return true;
  }
}

/** kind 元信息（resolver / UI 共用：类型色与显示名） */
export const KIND_META: Record<string, { color: string; label: string }> = {
  issue: { color: '#d97706', label: 'issue' },
  pr: { color: '#6741d9', label: 'pr' },
  doc: { color: '#2f9e44', label: 'doc' },
  milestone: { color: '#0c8599', label: 'milestone' },
  note: { color: '#888780', label: 'note' },
  idea: { color: '#e8590c', label: 'idea' },
  annotation: { color: '#5c7cfa', label: 'annotation' },
  img: { color: '#12b886', label: 'img' },
  draw: { color: '#e64980', label: 'draw' },
};

/** 未知 kind 的降级色 */
export const KIND_FALLBACK_COLOR = '#888780';
