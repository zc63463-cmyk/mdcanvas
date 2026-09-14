/**
 * P1 · 节点卡背面：`note.md` 源文的 **markdown 只读渲染**（受限子集）。
 *
 * 定位（设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md` §5）：
 * 渲染只读、无副作用、**范围收敛**——不自研完备语法、不引第二套行内语法。
 *
 * 范围清单（支持）：
 *   标题 h1–h6 / 无序·有序·嵌套列表 / 任务列表（只读 checkbox）/ 引用块（可嵌套）/
 *   围栏代码块（``` 与 ~~~）/ 水平线 / 段落；行内 = `kernel/layout/inline.ts` 同口径
 *   （**strong / code / link** 三类，zip 化；不解释斜体、删除线、转义与自动链接）；
 *   链接 = http(s) 白名单（外链 `target=_blank rel="noopener noreferrer"`）+
 *   内部锚（`node:` / `cid:` / `@kind:id`，点 `onJumpToAnchor`，与 L 批 TextLinkSpans
 *   同款回调机制；锚语法由 kernel `parseLinkAnchor` 判定）。
 *
 * 范围外（**按纯文本呈现，不执行**）：图片（`!` 前缀链接形态；不加载、字面文本）、裸 HTML
 * （无元素生成；本组件全程**无 `dangerouslySetInnerHTML`**，输出走 React 元素树）、
 * 表格（按段落文本行）、自动链接 / 脚注 / 公式（不解）。
 *
 * 文件名与 `chrome/note.ts`（R15 翻卡背面分区格式化）语义不同：那是固定字段分区，
 * 本文件渲染的是 markdown 源文，两者不混用。
 */
import type { CSSProperties, ReactNode } from 'react';
import { parseLinkAnchor, tokenizeInline } from '@mindcanvas/kernel';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

// ---------- 块级解析（行扫描；范围即上文清单） ----------

export type CardBackBlock =
  | { t: 'heading'; level: number; text: string }
  | { t: 'paragraph'; text: string }
  | { t: 'code'; text: string }
  | { t: 'hr' }
  | { t: 'quote'; blocks: CardBackBlock[] }
  | { t: 'list'; ordered: boolean; start: number; items: CardBackItem[] };

export interface CardBackItem {
  /** 任务列表勾选态；`undefined` = 普通条目（非任务） */
  checked: boolean | undefined;
  /** 条目文本（多行合段；空串 = 无文本） */
  text: string;
  /** 嵌套列表（仅列表块；条目内其余缩进行按续行并入 text） */
  subs: CardBackBlock[];
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const RE_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const RE_HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const RE_QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const RE_LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const RE_TASK = /^\[([ xX])\][ \t]+(.*)$/;

/** 缩进宽度（tab 按 4 空格折算，与 kernel parser 的列表口径一致） */
function indentWidth(ws: string): number {
  return ws.replace(/\t/g, '    ').length;
}

interface FenceOpen {
  ch: string;
  len: number;
}

function matchFenceOpen(line: string): FenceOpen | null {
  const m = line.match(RE_FENCE);
  if (m === null) return null;
  const marker = m[1] ?? '';
  return { ch: marker.charAt(0), len: marker.length };
}

function isFenceClose(line: string, open: FenceOpen): boolean {
  const t = line.trim();
  if (t.length < open.len) return false;
  for (const c of t) {
    if (c !== open.ch) return false;
  }
  return true;
}

/** 该行是否可作为「新块起点」（段落的终止条件；与主循环的块判定同序） */
function startsBlock(line: string): boolean {
  return (
    matchFenceOpen(line) !== null ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_LIST.test(line)
  );
}

/**
 * 解析 `note.md` → 块序列。纯函数，无副作用（调用方决定是否渲染）。
 *
 * 简化口径（子集取舍，均有测试钉住）：
 * - 空行分隔块；列表内空行后随「同级条目」则列表延续，否则列表结束；
 * - 引用块要求每行带 `>`（不做 lazy continuation）；标题不做 setext、不剥闭合 `#`；
 * - 围栏未闭合 → 直到文末（内容原样）；缩进代码块 / 多段列表项不支持。
 */
export function parseCardBackMd(md: string): CardBackBlock[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return parseBlocks(lines, 0, lines.length);
}

function parseBlocks(lines: readonly string[], start: number, end: number): CardBackBlock[] {
  const out: CardBackBlock[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = matchFenceOpen(line);
    if (fence !== null) {
      const code: string[] = [];
      i += 1;
      while (i < end) {
        const cur = lines[i] ?? '';
        if (isFenceClose(cur, fence)) {
          i += 1;
          break;
        }
        code.push(cur);
        i += 1;
      }
      out.push({ t: 'code', text: code.join('\n') });
      continue;
    }
    const h = line.match(RE_HEADING);
    if (h !== null) {
      out.push({ t: 'heading', level: (h[1] ?? '').length, text: h[2] ?? '' });
      i += 1;
      continue;
    }
    if (RE_HR.test(line)) {
      out.push({ t: 'hr' });
      i += 1;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < end) {
        const q = (lines[i] ?? '').match(RE_QUOTE);
        if (q === null) break;
        inner.push(q[1] ?? '');
        i += 1;
      }
      out.push({ t: 'quote', blocks: parseBlocks(inner, 0, inner.length) });
      continue;
    }
    const li = line.match(RE_LIST);
    if (li !== null) {
      const res = parseList(lines, i, end, indentWidth(li[1] ?? ''));
      out.push(res.block);
      i = res.next;
      continue;
    }
    const para: string[] = [];
    while (i < end) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || startsBlock(cur)) break;
      para.push(cur.trim());
      i += 1;
    }
    out.push({ t: 'paragraph', text: para.join('\n') });
  }
  return out;
}

function parseList(
  lines: readonly string[],
  start: number,
  end: number,
  baseIndent: number,
): { block: CardBackBlock; next: number } {
  const firstMarker = (lines[start] ?? '').match(RE_LIST)?.[2] ?? '-';
  const ordered = /\d/.test(firstMarker);
  const parsedStart = ordered ? Number.parseInt(firstMarker, 10) : 1;
  const startNum = Number.isFinite(parsedStart) ? parsedStart : 1;
  const items: CardBackItem[] = [];
  let i = start;
  while (i < end) {
    const m = (lines[i] ?? '').match(RE_LIST);
    if (m === null) break;
    if (indentWidth(m[1] ?? '') !== baseIndent) break;
    if (/\d/.test(m[2] ?? '') !== ordered) break; // 序号 ↔ 符号切换 = 新列表
    let text = m[3] ?? '';
    let checked: boolean | undefined;
    const task = text.match(RE_TASK);
    if (task !== null) {
      checked = (task[1] ?? ' ') !== ' ';
      text = task[2] ?? '';
    }
    const cont: string[] = [];
    if (text !== '') cont.push(text);
    const subs: CardBackBlock[] = [];
    i += 1;
    while (i < end) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '') {
        // 空行：后随同级条目 → 列表延续（跳到该条目）；否则列表结束
        let j = i + 1;
        while (j < end && (lines[j] ?? '').trim() === '') j += 1;
        const nxt = (lines[j] ?? '').match(RE_LIST);
        if (
          nxt !== null &&
          indentWidth(nxt[1] ?? '') === baseIndent &&
          /\d/.test(nxt[2] ?? '') === ordered
        ) {
          i = j;
        }
        break;
      }
      const nm = cur.match(RE_LIST);
      if (nm !== null) {
        const ind = indentWidth(nm[1] ?? '');
        if (ind > baseIndent) {
          const sub = parseList(lines, i, end, ind);
          subs.push(sub.block);
          i = sub.next;
          continue;
        }
        break; // 同级/更浅：交回外层循环
      }
      if (indentWidth((cur.match(/^[ \t]*/) ?? [''])[0]) > baseIndent) {
        cont.push(cur.trim());
        i += 1;
        continue;
      }
      break; // 缩进不足的非标记行：列表结束
    }
    items.push({ checked, text: cont.join('\n'), subs });
  }
  return { block: { t: 'list', ordered, start: startNum, items }, next: i };
}

// ---------- React 渲染（元素树；无 HTML 串直插） ----------

export interface CardBackMarkdownProps {
  /** `note.md` 源文（空串/纯空白 → 不渲染，返回 null） */
  md: string;
  token: TokenSet;
  /** 内部锚跳转回调（缺省 → 锚只渲染不可点，与 L 批 TextLinkSpans 缺省纪律一致） */
  onJumpToAnchor?: (anchor: string) => void;
}

/** 链接触发的按下不冒泡（比照 TextLinkSpans：点链接 = 跳转意图，不承担宿主手势职责） */
function stopProp(e: { stopPropagation(): void }): void {
  e.stopPropagation();
}

const HTTP_RE = /^https?:\/\//i;
const H_EM = [1.45, 1.28, 1.14, 1.06, 1, 0.95];

/**
 * URL 形态判定（与 `edit/textLinks.ts` 的 T-A6 口径逐字一致）：
 * `scheme://` 与已知非内部 scheme 一律**不认作内部锚**——否则 `[a](mailto:x@y)`
 * 会被 kernel 实体锚正则（宽松 `kind:id`）误吞成 `mailto` 实体锚（L 批实测同款坑）。
 */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const NON_ANCHOR_SCHEMES = new Set(['mailto', 'tel', 'file', 'data', 'javascript']);

function isUrlLike(target: string): boolean {
  if (URL_SCHEME_RE.test(target)) return true;
  const m = /^([^:\s][^:]*?):/.exec(target);
  return m !== null && NON_ANCHOR_SCHEMES.has((m[1] ?? '').toLowerCase());
}

const rootStyle: CSSProperties = {
  color: CHROME.text,
  fontSize: CHROME.fontSizeSmall,
  fontFamily: CHROME.fontFamily,
  lineHeight: 1.6,
  wordBreak: 'break-word',
};
const paraStyle: CSSProperties = { margin: '6px 0', whiteSpace: 'pre-wrap' };
const preStyle: CSSProperties = {
  margin: '8px 0',
  padding: '6px 8px',
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  overflowX: 'auto',
  fontSize: '0.95em',
  lineHeight: 1.5,
};
const codeTextStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Consolas, monospace',
  whiteSpace: 'pre',
};
const inlineCodeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Consolas, monospace',
  background: CHROME.panelBg,
  borderRadius: 4,
  padding: '0 3px',
  fontSize: '0.95em',
};
const hrStyle: CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${CHROME.panelBorder}`,
  margin: '10px 0',
};
const quoteStyle: CSSProperties = {
  margin: '8px 0',
  padding: '2px 0 2px 10px',
  borderLeft: `2px solid ${CHROME.neonSoft}`,
  color: CHROME.textMuted,
};
const listStyle: CSSProperties = { margin: '6px 0', paddingLeft: 20 };
const liStyle: CSSProperties = { lineHeight: 1.6 };
const checkboxStyle: CSSProperties = { marginRight: 5, verticalAlign: 'middle' };

function headingStyle(level: number): CSSProperties {
  return {
    margin: '10px 0 6px',
    fontWeight: 600,
    fontSize: `${H_EM[level - 1] ?? 1}em`,
    lineHeight: 1.35,
  };
}

/**
 * 行内渲染（`tokenizeInline` 同口径 + 图片降级 + 链接分类）。
 * 图片：markdown 的「`!` + 链接」在 token 层 = 文本 `!` + link —— 合并回**字面文本**，
 * 不生成 `<img>`（行内代码内的图片语法是 code token，天然不被拆散）。
 */
function renderInline(
  text: string,
  token: TokenSet,
  onJumpToAnchor: ((anchor: string) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const tokens = tokenizeInline(text);
  const linkStyle: CSSProperties = {
    color: token.color.linkStroke,
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  };
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i];
    if (tk === undefined) continue;
    const next = tokens[i + 1];
    if (tk.t === 'text' && tk.text.endsWith('!') && next !== undefined && next.t === 'link') {
      const before = tk.text.slice(0, -1);
      if (before !== '') out.push(before);
      // 注意：感叹号用 \x21 转义写 —— 避免「感叹号+方括号」在源码连写触发 budget 的
      // bang 哑正则假阳性（非断言）；输出字符串与图片语法逐字一致
      out.push(`\x21[${next.text}](${next.href ?? ''})`);
      i += 1;
      continue;
    }
    if (tk.t === 'text') {
      out.push(tk.text);
      continue;
    }
    if (tk.t === 'strong') {
      out.push(<strong key={`${keyPrefix}s${i}`}>{tk.text}</strong>);
      continue;
    }
    if (tk.t === 'code') {
      out.push(
        <code key={`${keyPrefix}c${i}`} style={inlineCodeStyle}>
          {tk.text}
        </code>,
      );
      continue;
    }
    const target = (tk.href ?? '').trim();
    if (HTTP_RE.test(target)) {
      out.push(
        <a
          key={`${keyPrefix}a${i}`}
          href={target}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={stopProp}
          onClick={stopProp}
          style={linkStyle}
        >
          {tk.text}
        </a>,
      );
      continue;
    }
    if (!isUrlLike(target) && parseLinkAnchor(target) !== null) {
      const clickable = onJumpToAnchor !== undefined;
      out.push(
        <span
          key={`${keyPrefix}n${i}`}
          data-note-md-anchor={target}
          onPointerDown={stopProp}
          onClick={(e) => {
            e.stopPropagation();
            if (clickable) onJumpToAnchor(target);
          }}
          style={{ ...linkStyle, cursor: clickable ? 'pointer' : 'default' }}
        >
          {tk.text}
        </span>,
      );
      continue;
    }
    // 白名单外（javascript: / mailto: / scheme:// / 裸域名 / 空目标等）→ 字面文本，不可点
    out.push(`[${tk.text}](${target})`);
  }
  return out;
}

function HeadingView({
  level,
  text,
  token,
  onJumpToAnchor,
  k,
}: {
  level: number;
  text: string;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  const style = headingStyle(level);
  const children = renderInline(text, token, onJumpToAnchor, k);
  switch (level) {
    case 1:
      return <h1 style={style}>{children}</h1>;
    case 2:
      return <h2 style={style}>{children}</h2>;
    case 3:
      return <h3 style={style}>{children}</h3>;
    case 4:
      return <h4 style={style}>{children}</h4>;
    case 5:
      return <h5 style={style}>{children}</h5>;
    default:
      return <h6 style={style}>{children}</h6>;
  }
}

function ListView({
  block,
  token,
  onJumpToAnchor,
  k,
}: {
  block: Extract<CardBackBlock, { t: 'list' }>;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  const items = block.items.map((item, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（无重排、无内部状态），与仓内位置键纪律一致
    <li key={`i${i}`} style={liStyle}>
      {item.checked !== undefined && (
        <input type="checkbox" checked={item.checked} disabled readOnly style={checkboxStyle} />
      )}
      {item.text !== '' && <span>{renderInline(item.text, token, onJumpToAnchor, `${k}i${i}`)}</span>}
      {item.subs.map((sub, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
        <BlockView key={`s${j}`} block={sub} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}s${j}`} />
      ))}
    </li>
  ));
  if (block.ordered) {
    return (
      <ol start={block.start > 1 ? block.start : undefined} style={listStyle}>
        {items}
      </ol>
    );
  }
  return <ul style={listStyle}>{items}</ul>;
}

function BlockView({
  block,
  token,
  onJumpToAnchor,
  k,
}: {
  block: CardBackBlock;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  switch (block.t) {
    case 'heading':
      return (
        <HeadingView
          level={block.level}
          text={block.text}
          token={token}
          onJumpToAnchor={onJumpToAnchor}
          k={`${k}h`}
        />
      );
    case 'paragraph':
      return <p style={paraStyle}>{renderInline(block.text, token, onJumpToAnchor, `${k}p`)}</p>;
    case 'code':
      return (
        <pre style={preStyle}>
          <code style={codeTextStyle}>{block.text}</code>
        </pre>
      );
    case 'hr':
      return <hr style={hrStyle} />;
    case 'quote':
      return (
        <blockquote style={quoteStyle}>
          {block.blocks.map((sub, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
            <BlockView key={`q${i}`} block={sub} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}q${i}`} />
          ))}
        </blockquote>
      );
    case 'list':
      return <ListView block={block} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}l`} />;
    default:
      return null;
  }
}

/** 节点卡背面 markdown 只读视图（纯展示；空源文 → null，调用方不渲染背面） */
export function CardBackMarkdown({ md, token, onJumpToAnchor }: CardBackMarkdownProps) {
  if (md.trim() === '') return null;
  const blocks = parseCardBackMd(md);
  return (
    <div data-note-back-md style={rootStyle}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
        <BlockView key={`b${i}`} block={b} token={token} onJumpToAnchor={onJumpToAnchor} k={`b${i}`} />
      ))}
    </div>
  );
}
