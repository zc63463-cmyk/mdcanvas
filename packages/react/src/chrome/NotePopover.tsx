/**
 * 节点注释浮窗（v1.4.0）—— 取代「快速注释向下生长展开」。
 *
 * 一个浮窗，两个区域：
 *   ① 序列区域：`note`（条目列表，取代 qa），可增删改
 *   ② 纯文本区域：`note_text`（一整段），textarea 编辑
 * 两者**共存**于同一浮窗，不是二选一的类型；各自内部滚动，都不占节点空间。
 *
 * 交互：悬停节点 → 本组件以预览态浮出；点击 → 由上层置为 pinned，此时可编辑。
 *
 * 不是什么：不参与布局（绝对定位浮在画布上），不改变节点盒高度，
 * 因此不会挤压相邻节点 —— 长内容应该放这里，而不是塞进 `desc`。
 */
import { useEffect, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { QaEditor } from './QaEditor.js';

/** 单个区域的最大高度（超出内部滚动，浮窗整体不被撑爆） */
const REGION_MAX_H = 160;

export interface NotePopoverProps {
  /** 序列区域条目 */
  seq: readonly string[];
  /** 纯文本区域内容 */
  text: string;
  /** 屏幕坐标（浮窗左上角） */
  x: number;
  y: number;
  /** 是否固定（固定后才可编辑） */
  pinned: boolean;
  token: TokenSet;
  onChangeSeq: (seq: string[]) => void;
  onChangeText: (text: string) => void;
  onClose: () => void;
}

export function NotePopover({
  seq,
  text,
  x,
  y,
  pinned,
  token,
  onChangeSeq,
  onChangeText,
  onClose,
}: NotePopoverProps) {
  const [draft, setDraft] = useState(text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // 外部文本变化（切换节点 / 落盘后）→ 同步草稿，避免编辑到一半被覆盖
  useEffect(() => setDraft(text), [text]);

  const sectionStyle = {
    maxHeight: REGION_MAX_H,
    overflowY: 'auto',
  } as const;

  return (
    <div
      data-note-popover
      data-note-pinned={pinned ? 'true' : 'false'}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 260,
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(12px)',
        padding: 10,
        zIndex: 70,
        fontFamily: CHROME.fontFamily,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            flex: 1,
            color: CHROME.text,
            fontSize: CHROME.fontSizeSmall,
            fontWeight: 600,
          }}
        >
          节点注释
        </span>
        {!pinned && (
          <span style={{ color: CHROME.textMuted, fontSize: 10 }}>点击固定</span>
        )}
        <button
          type="button"
          aria-label="关闭注释"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: CHROME.textMuted,
            cursor: 'pointer',
            fontSize: 12,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ✕
        </button>
      </div>

      {/* ① 序列区域 */}
      <div data-note-seq style={{ ...sectionStyle, marginBottom: 8 }}>
        {pinned ? (
          <QaEditor
            items={seq}
            onChange={onChangeSeq}
            token={token}
            title="序列"
            placeholder="新增条目…（回车提交）"
          />
        ) : seq.length === 0 ? null : (
          <>
            <div
              style={{
                color: token.color.annotationAccent,
                fontSize: CHROME.fontSizeSmall,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              序列
            </div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {seq.map((s, i) => (
                <li
                  key={i}
                  style={{
                    color: CHROME.text,
                    fontSize: CHROME.fontSizeSmall,
                    lineHeight: 1.6,
                  }}
                >
                  {s}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {/* ② 纯文本区域 */}
      <div data-note-textarea style={sectionStyle}>
        <div
          style={{
            color: CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          正文
        </div>
        {pinned ? (
          <textarea
            ref={taRef}
            value={draft}
            placeholder="整段说明…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== text) onChangeText(draft);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              minHeight: 72,
              border: `1px solid ${CHROME.panelBorder}`,
              background: 'transparent',
              color: CHROME.text,
              borderRadius: CHROME.radiusSmall,
              padding: '4px 6px',
              fontSize: CHROME.fontSizeSmall,
              fontFamily: CHROME.fontFamily,
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
            }}
          />
        ) : (
          <div
            style={{
              color: CHROME.text,
              fontSize: CHROME.fontSizeSmall,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {text === '' ? (
              <span style={{ color: CHROME.textMuted }}>（无正文）</span>
            ) : (
              text
            )}
          </div>
        )}
      </div>
    </div>
  );
}
