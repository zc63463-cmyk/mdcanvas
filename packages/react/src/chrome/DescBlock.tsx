/**
 * DescBlock —— 幕布风格「描述」块（v1.3.0）。
 *
 * 语义（对齐幕布官方 mubu.com/help/20）：描述是对某一主题的**解释和说明**，
 * 显示在节点下方，纯文本，支持自动收缩（默认一行 / 点击展开全文）。
 * 与 GrowthCommentPanel（快速注释 qa：点击展开的多条目列表）是**两套并存**的机制。
 *
 * 视觉：引用块形态——左侧竖线 + 缩进 + 小字号 + 弱化色（与节点本体区分层级）。
 *
 * 缩放一致性：所有尺寸/字号 × scale，与 SVG 节点盒严格对齐（参考 GrowthCommentPanel 纪律）。
 *
 * 编辑：Shift+Enter 进入（上层快捷键分发）；textarea 内 Enter 换行、
 *      Shift+Enter 提交并返回主题、Esc 取消、blur 提交；空文本 = 删除描述。
 */
import { useEffect, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

export interface DescBlockProps {
  /** 描述文本（多行以 \n 分隔） */
  text: string;
  /** 是否处于编辑态（textarea 覆盖） */
  editing?: boolean;
  /** 是否展开全文（false = 收缩为一行 + 省略号） */
  expanded?: boolean;
  token: TokenSet;
  /** 屏幕坐标（描述区左上角，由上层按节点 + 本体高换算） */
  x: number;
  y: number;
  width: number;
  /** 描述区高度（由 estimateDescHeight 决定，屏幕 px） */
  height: number;
  /** 视口缩放 k（内容随地图缩放，与 SVG 对齐；缺省 1） */
  scale?: number;
  /**
   * 浮出模式（v1.3.0 编辑性能深度优化）：节点盒**没有**为描述预留高度时（新建描述场景 ——
   * measure 不含 editing 状态，否则进入/退出编辑会触发全树重排），描述区绝对定位浮出在节点
   * 下方并覆盖相邻内容。视觉上仍是"向下生长"，但不参与布局 → 进入/退出编辑零重排。
   */
  floating?: boolean;
  /** 点击描述区 → 切换展开/收缩 */
  onToggle?: () => void;
  /** 提交文本（空串 = 删除描述） */
  onCommit?: (text: string) => void;
  /** 取消编辑 */
  onCancel?: () => void;
}

/** 描述区行高（世界 px，k=1） */
export const DESC_LINE_H = 15;
/** 描述区上下内边距 */
export const DESC_PAD = 5;
/** 左侧引用竖线宽度 */
export const DESC_BAR_W = 2;
/** 竖线后的文字缩进 */
export const DESC_INDENT = 8;
/** 展开态最多显示行数（超出内置滚动） */
export const DESC_MAX_LINES = 6;
/**
 * 编辑态预留行数（交互时序关键常量）：进入编辑时**立即**分配这块高度，再让用户键入。
 *
 * 背景（用户反馈）：原实现按 text 内容反推高度 → 编辑态 text 仍为空 → 只给 1 行，
 * 用户开始打字时输入框是折叠的，看不见自己在打什么。正确时序应是「先变大 → 再键入 → 空则回退**：
 *   ① 进入编辑 → measure 预留 DESC_EDIT_MIN_LINES 行高度（节点"先生长一行"）
 *   ② 用户键入 → 高度已在，输入过程始终可见
 *   ③ 无内容提交/取消 → 上层回退到非编辑态高度（收缩一行）
 * 布局 measure 与 overlay 必须共用同一函数且都传入 editing 标志，否则节点本体与描述区会错位。

 */
export const DESC_EDIT_MIN_LINES = 1; // 编辑态预留一行（同 collapsed 高度，避免"键入后才变大"）

/**
 * 描述区高度估算（布局 measure 与 overlay 共用，必须一致）。
 * @param editing 是否编辑态 —— 为真时直接返回预留高度，不依赖 text 内容（见 DESC_EDIT_MIN_LINES 注释。

 *
 * 重要：编辑态必须**先于内容**确定高度，否则会出现"键入后才变大、打字时看不见"的体验问题。
 */
export function estimateDescHeight(expanded: boolean, text: string, editing = false): number {
  // 编辑态：立即预留固定编辑空间（先变大再键入）
  if (editing) return DESC_EDIT_MIN_LINES * DESC_LINE_H + DESC_PAD * 2;
  if (!expanded) return DESC_LINE_H + DESC_PAD * 2;
  // 性能：用字符计数替代 split('\n') —— 避免为超长描述（上千行）创建临时数组。
  // 展开态行数封顶 DESC_MAX_LINES，数到上限即可提前退出。
  const lines = countLines(text, DESC_MAX_LINES);
  return lines * DESC_LINE_H + DESC_PAD * 2;
}

/** 数换行符个数（=行数-1），最多数到 cap 行即提前退出（性能：不扫描全文、不建数组） */
function countLines(text: string, cap: number): number {
  if (text === '') return 1;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines++;
      if (lines >= cap) return cap;
    }
  }
  return lines;
}

export function DescBlock({
  text,
  editing = false,
  expanded = false,
  token,
  x,
  y,
  width,
  height,
  scale = 1,
  floating = false,
  onToggle,
  onCommit,
  onCancel,
}: DescBlockProps) {
  const s = scale;
  const [draft, setDraft] = useState(text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // 进入编辑态：同步草稿并聚焦（光标移到末尾）
  useEffect(() => {
    if (editing) {
      setDraft(text);
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }, [editing, text]);

  const commit = (): void => {
    onCommit?.(draft.trim());
  };

  if (!editing && text === '') return null;

  const pad = DESC_PAD * s;
  const barW = DESC_BAR_W * s;
  const indent = DESC_INDENT * s;
  const fontSize = 10 * s;
  const lineH = DESC_LINE_H * s;
  const barColor = token.color.linkStroke ?? CHROME.panelBorder;

  return (
    <div
      data-desc-block
      data-desc-expanded={expanded ? 'true' : 'false'}
      data-desc-editing={editing ? 'true' : 'false'}
      data-desc-floating={floating ? 'true' : 'false'}
      onClick={(e) => {
        e.stopPropagation();
        if (!editing) onToggle?.();
      }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        boxSizing: 'border-box',
        padding: `${pad}px ${pad}px ${pad}px ${pad + barW + indent}px`,
        fontFamily: CHROME.fontFamily,
        overflow: 'hidden',
        cursor: editing ? 'text' : 'pointer',
        pointerEvents: 'auto',
        userSelect: editing ? 'text' : 'none',
        // 浮出模式（无预留高度的新建编辑）：加实体背景 + 圆角 + 阴影 + 高层级，
        // 确保覆盖相邻节点内容时依然清晰可读（不占布局 → 零重排的代价是视觉遮挡）。
        ...(floating
          ? {
              background: CHROME.panelBg ?? 'rgba(20,22,28,.97)',
              borderRadius: 6 * s,
              zIndex: 60,
              border: `1px solid ${token.color.linkStroke ?? CHROME.panelBorder}`,
            }
          : null),
      }}
      title={editing ? undefined : expanded ? '点击收起描述' : '点击展开全文描述'}
    >
      {/* 左侧引用竖线（引用块视觉核心） */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: pad,
          top: pad,
          bottom: pad,
          width: barW,
          background: barColor,
          borderRadius: barW / 2,
          opacity: 0.75,
        }}
      />
      {editing ? (
        <textarea
          ref={taRef}
          data-desc-input
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && e.shiftKey) {
              // Shift+Enter：提交并返回主题（幕布「切换主题与描述」语义）
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel?.();
            }
          }}
          onBlur={commit}
          placeholder="输入描述…（Shift+Enter 完成，Enter 换行）"
          // 关键（mubu 深度反馈）：编辑态强制 textarea 视觉单行——「打字时折叠」。
          // 内部 value 仍可装多行（按 Enter 输入 \n），但视觉只显示一行（nowrap + ellipsis + overflow:hidden），
          // 防止键入后输入框撑高造成 measure 重算抖动（"键入后才变大"反模式）。
          style={
            {
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: CHROME.text,
              fontFamily: CHROME.fontFamily,
              fontSize,
              lineHeight: 1.5,
              resize: 'none',
              padding: 0,
              margin: 0,
              display: 'block',
              whiteSpace: 'pre',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            } as React.CSSProperties
          }
        />
      ) : (
        <div
          data-desc-text
          style={{
            fontSize,
            lineHeight: 1.5,
            color: CHROME.textMuted,
            whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
            wordBreak: expanded ? 'break-word' : undefined,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxHeight: '100%',
            // 展开态超出 DESC_MAX_LINES 时内置滚动
            overflowY: expanded ? 'auto' : 'hidden',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
