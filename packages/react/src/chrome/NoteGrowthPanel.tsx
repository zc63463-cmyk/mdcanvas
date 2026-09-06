/** 固定 note 笔记：节点向下生长后填充其布局预留区。 */
import { useRef } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { QaEditor } from './QaEditor.js';

const NOTE_HEADER_H = 24;
const NOTE_REGION_H = 78;
const NOTE_PAD = 6;

/** 固定 note 笔记与节点主体之间的布局间距（世界坐标）。 */
export const FIXED_NOTE_GAP = 12;
/** 固定预览卡片的紧凑稳定高度（世界坐标）；内容区域自身可滚动。 */
export const FIXED_NOTE_CARD_HEIGHT = 120;

/** 固定高度让多个 note 笔记的布局稳定，超出内容在区内滚动。 */
export function estimateNoteAreaHeight(): number {
  return FIXED_NOTE_GAP + FIXED_NOTE_CARD_HEIGHT;
}

export interface NoteGrowthPanelProps {
  seq: readonly string[];
  text: string;
  editing: boolean;
  token: TokenSet;
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  onChangeSeq: (seq: string[]) => void;
  onChangeText: (text: string) => void;
  onClose: () => void;
}

export function NoteGrowthPanel({
  seq,
  text,
  editing,
  token,
  x,
  y,
  width,
  height,
  scale = 1,
  onChangeSeq,
  onChangeText,
  onClose,
}: NoteGrowthPanelProps) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const s = scale;
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const commitText = (): void => {
    const next = textRef.current?.value ?? text;
    if (next !== text) onChangeText(next);
  };
  const section = {
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
    fontSize: CHROME.fontSizeSmall * s,
  } as const;

  return (
    <div
      data-note-growth-panel
      data-note-editing={editing ? 'true' : 'false'}
      role="region"
      aria-label="note 笔记"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      style={{
        position: 'absolute', left: x, top: y, width, height, boxSizing: 'border-box',
        padding: `${NOTE_PAD * s}px`, display: 'flex', flexDirection: 'column', gap: NOTE_PAD * s,
        overflow: 'hidden', pointerEvents: 'auto', zIndex: 65, fontFamily: CHROME.fontFamily,
        color: CHROME.text,
      }}
    >
      <div style={{ height: NOTE_HEADER_H * s, display: 'flex', alignItems: 'center', flex: 'none' }}>
        <span style={{ flex: 1, color: token.color.annotationAccent, fontSize: CHROME.fontSizeSmall * s, fontWeight: 600 }}>
          note 笔记
        </span>
        <button
          type="button"
          aria-label="关闭 note笔记"
          onClick={onClose}
          style={{ border: 'none', background: 'transparent', color: CHROME.textMuted, cursor: 'pointer', fontSize: 14 * s, padding: 0 }}
        >
          x
        </button>
      </div>
      <div data-note-growth-seq style={section}>
        {editing ? (
          <QaEditor items={seq} onChange={onChangeSeq} token={token} title="序列" placeholder="新增条目..." />
        ) : seq.length > 0 ? (
          <ol style={{ margin: 0, paddingLeft: 18 * s }}>
            {seq.map((item, index) => <li key={`${index}:${item}`} style={{ lineHeight: 1.5 }}>{item}</li>)}
          </ol>
        ) : <span style={{ color: CHROME.textMuted }}>无序列</span>}
      </div>
      <div data-note-growth-text style={section}>
        <div style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall * s, fontWeight: 600, marginBottom: 3 * s }}>正文</div>
        {editing ? (
          <textarea
            ref={textRef}
            defaultValue={text}
            placeholder="整段说明..."
            onBlur={commitText}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ width: '100%', minHeight: 42 * s, boxSizing: 'border-box', border: `1px solid ${CHROME.panelBorder}`, background: 'transparent', color: CHROME.text, borderRadius: CHROME.radiusSmall, padding: `${3 * s}px ${5 * s}px`, fontSize: CHROME.fontSizeSmall * s, fontFamily: CHROME.fontFamily, resize: 'none', outline: 'none' }}
          />
        ) : <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{text || <span style={{ color: CHROME.textMuted }}>无正文</span>}</div>}
      </div>
    </div>
  );
}
