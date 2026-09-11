/**
 * ContextMenu —— 节点右键菜单（批次 2）。
 * 绝对定位在 (x,y)；菜单项 { label, onSelect, danger?, disabled?, section?, hint? }。
 * 点击项 → onSelect + onClose；Esc / 点击遮罩（外部）→ onClose。
 * v1.8.1：支持分区标题（section 变化处渲染小标题 + 分隔线）与快捷键提示（hint，右对齐 kbd）。
 * 视觉值全部来自 CHROME（组件内零颜色字面量）。
 */
import { Fragment, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** 危险操作（删除）：红色语义 */
  danger?: boolean;
  /** 禁用态（置灰、不可点；如根节点不可切断） */
  disabled?: boolean;
  /** 分区标题（v1.8.1）：与上一项 section 不同 → 渲染标题与分隔线 */
  section?: string;
  /** 快捷键提示（如 Tab / F2 / Shift+Enter）：行内右侧 kbd 样式 */
  hint?: string;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** 快捷键提示样式（行内右侧 kbd；与 ShortcutHelpPanel 的 kbd 视觉同族） */
const HINT_STYLE: CSSProperties = {
  fontSize: CHROME.fontSizeSmall,
  color: CHROME.textMuted,
  border: `1px solid ${CHROME.panelBorderStrong}`,
  borderRadius: 4,
  padding: '0 5px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-menu-backdrop
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 30 }}
    >
      <div
        role="menu"
        aria-label="节点菜单"
        data-context-menu
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          minWidth: 168,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSize,
          padding: 4,
          zIndex: 31,
        }}
      >
        {items.map((item, i) => {
          const newSection = item.section !== undefined && item.section !== items[i - 1]?.section;
          return (
            <Fragment key={`${i}-${item.label}`}>
              {newSection && (
                <div
                  data-menu-section
                  style={{
                    padding: i === 0 ? '4px 10px 3px' : '9px 10px 3px',
                    marginTop: i === 0 ? 0 : 2,
                    borderTop: i === 0 ? undefined : `1px solid ${CHROME.panelBorder}`,
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.textMuted,
                    letterSpacing: '.4px',
                  }}
                >
                  {item.section}
                </div>
              )}
              <div
                role="menuitem"
                data-menu-item
                data-menu-disabled={item.disabled === true ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled === true) return;
                  item.onSelect();
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: item.disabled === true ? 'default' : 'pointer',
                  color: item.disabled === true
                    ? CHROME.textMuted
                    : item.danger
                      ? CHROME.warn
                      : CHROME.text,
                  opacity: item.disabled === true ? 0.55 : 1,
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (item.disabled === true) return;
                  e.currentTarget.style.background = 'rgba(255,255,255,.06)';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.hint !== undefined && <span style={HINT_STYLE}>{item.hint}</span>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
