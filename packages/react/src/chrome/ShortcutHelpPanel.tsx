/**
 * ShortcutHelpPanel —— 快捷键帮助面板（`?` 打开）。
 * 玻璃卡片居中遮罩；列出 EDITOR_KEY_BINDINGS（key + label）。
 * Esc / × / 点击遮罩 → onClose。视觉值全部来自 CHROME（组件内零颜色字面量）。
 */
import { useEffect } from 'react';
import { CHROME } from '../theme/tokens.js';
import { EDITOR_KEY_BINDINGS } from '../edit/keys.js';

export interface ShortcutHelpPanelProps {
  onClose: () => void;
}

export function ShortcutHelpPanel({ onClose }: ShortcutHelpPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-help-backdrop
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,.45)',
        zIndex: 20,
      }}
    >
      <div
        role="dialog"
        aria-label="快捷键帮助"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 340,
          maxHeight: '70vh',
          overflowY: 'auto',
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSizeSmall,
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>
            快捷键
          </span>
          <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
            {EDITOR_KEY_BINDINGS.length} 项
          </span>
          <span style={{ flex: 1 }} />
          <button
            aria-label="关闭快捷键帮助"
            data-help-close
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: CHROME.textMuted,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
              width: 18,
              height: 18,
            }}
          >
            ×
          </button>
        </div>
        {EDITOR_KEY_BINDINGS.map((b) => (
          <div
            key={b.action}
            data-shortcut-row
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 2px',
              borderBottom: `1px solid ${CHROME.panelBorder}`,
            }}
          >
            <kbd
              style={{
                background: 'rgba(255,255,255,.06)',
                border: `1px solid ${CHROME.panelBorderStrong}`,
                borderRadius: 4,
                padding: '1px 7px',
                fontSize: CHROME.fontSizeSmall,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                minWidth: 64,
                textAlign: 'center',
                color: CHROME.text,
              }}
            >
              {b.key}
            </kbd>
            <span style={{ color: CHROME.text, flex: 1 }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
