/**
 * ContextMenu —— 节点右键菜单（批次 2）。
 * 绝对定位在 (x,y)；菜单项 { label, onSelect, danger? }。
 * 点击项 → onSelect + onClose；Esc / 点击遮罩（外部）→ onClose。
 * 视觉值全部来自 CHROME（组件内零颜色字面量）。
 */
import { useEffect } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** 危险操作（删除）：红色语义 */
  danger?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

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
        {items.map((item) => (
          <div
            key={item.label}
            role="menuitem"
            data-menu-item
            onClick={(e) => {
              e.stopPropagation();
              item.onSelect();
              onClose();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              color: item.danger ? CHROME.warn : CHROME.text,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
