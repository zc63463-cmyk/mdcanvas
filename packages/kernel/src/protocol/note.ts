/**
 * 节点注释（note）的读取与迁移（v1.4.0）。
 *
 * 协议上用**两个顶层键**表达同一浮窗的两个区域：
 *   - `note: [条目...]`      → 序列区域（列表）
 *   - `note_text: "一整段"`  → 纯文本区域（多行标量，`\n` 转义）
 *
 * 为什么不用嵌套 mapping（`note: { seq, text }`）：项目自研的 note YAML 解析器
 * 只支持顶层键 + 一层扁平对象列表，不支持嵌套 mapping。改用两个平级键后，
 * parser / serializer 都无需改动即可往返。
 *
 * 迁移：旧文件的 `qa`（快速注释）在**读取时**作为 `note` 的回退；
 * 写入一律写 `note` —— 旧文件可读，新文件不再产生 `qa`。
 */
import type { MindNode, Note } from './types.js';

/** 节点注释的两个区域（同一浮窗内共存，可只填其一） */
export interface NodeNoteData {
  /** 序列区域：条目列表 */
  seq: string[];
  /** 纯文本区域：整段文本（空串 = 该区域不存在） */
  text: string;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * 读取节点的注释内容。
 *
 * 兼容顺序：`note` → 回退到 `qa`（旧快速注释）。
 * 纯文本区域只读 `note_text`（无历史包袱）。
 */
export function noteOf(node: MindNode | undefined | null): NodeNoteData {
  const note = node?.note as Note | undefined;
  if (!note) return { seq: [], text: '' };
  const seq = asStringArray(note.note);
  // qa 回退：旧文件的快速注释迁到序列区域（qa 本来就是条目列表）
  const fallback = seq.length > 0 ? seq : asStringArray(note.qa);
  const text = typeof note.note_text === 'string' ? note.note_text : '';
  return { seq: fallback, text };
}

/** 该节点是否有任何注释内容（决定要不要显示浮窗入口） */
export function hasNote(node: MindNode | undefined | null): boolean {
  const { seq, text } = noteOf(node);
  return seq.length > 0 || text !== '';
}
