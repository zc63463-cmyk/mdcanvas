/**
 * QaEditor —— 快速注释编辑区（R15：查看 / 新增 / 编辑 / 删除）。
 * 归属翻转卡面板；写回经 controller.updateNote({ qa })（TreeOp update-node patch.note）。
 * 玻璃 chrome 风格（CHROME）+ annotationAccent 强调（令牌，K3 纪律）。
 */
import { useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

export interface QaEditorProps {
  /** 当前 qa 条目（note.qa，YAML 数组） */
  items: readonly string[];
  /** 写回（整组替换；空数组 = 清空） */
  onChange: (qa: string[]) => void;
  token: TokenSet;
}

export function QaEditor({ items, onChange, token }: QaEditorProps) {
  const [value, setValue] = useState('');
  const add = (): void => {
    const text = value.trim();
    if (text === '') return;
    onChange([...items, text]);
    setValue('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            color: token.color.annotationAccent,
            fontSize: CHROME.fontSizeSmall,
            fontWeight: 600,
          }}
        >
          快速注释
        </span>
        <span
          style={{
            background: token.color.annotationBadge,
            color: token.color.annotationAccent,
            borderRadius: 8,
            padding: '0 6px',
            fontSize: 10,
            lineHeight: '14px',
          }}
        >
          {items.length}
        </span>
      </div>
      {items.map((q, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            background: token.color.annotationBadge,
            borderLeft: `2px solid ${token.color.annotationAccent}`,
            borderRadius: 4,
            padding: '4px 6px',
            fontSize: CHROME.fontSizeSmall,
            lineHeight: 1.5,
            color: CHROME.text,
          }}
        >
          <span style={{ flex: 1 }}>{q}</span>
          <button
            aria-label="删除注释"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{
              border: 'none',
              background: 'transparent',
              color: token.color.annotationAccent,
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <input
        value={value}
        placeholder="新增注释…（回车提交）"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // 关键：输入框内不触发画布全局快捷键（Tab/Enter 等）
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          } else if (e.key === 'Escape') {
            setValue('');
          }
        }}
        style={{
          border: `1px solid ${CHROME.panelBorder}`,
          background: 'transparent',
          color: CHROME.text,
          borderRadius: CHROME.radiusSmall,
          padding: '4px 8px',
          fontSize: CHROME.fontSizeSmall,
          fontFamily: CHROME.fontFamily,
          outline: 'none',
        }}
      />
    </div>
  );
}
