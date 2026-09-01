// @vitest-environment jsdom
/**
 * ShortcutHelpPanel：? 快捷键帮助面板——列出 EDITOR_KEY_BINDINGS，Esc/×/点击遮罩关闭。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ShortcutHelpPanel } from '../src/chrome/ShortcutHelpPanel.js';
import { EDITOR_KEY_BINDINGS } from '../src/edit/keys.js';

describe('ShortcutHelpPanel：快捷键帮助面板', () => {
  it('渲染全部快捷键绑定（key + label）', () => {
    const { container } = render(<ShortcutHelpPanel onClose={() => {}} />);
    const rows = container.querySelectorAll('[data-shortcut-row]');
    expect(rows.length).toBe(EDITOR_KEY_BINDINGS.length);
    expect(container.textContent).toContain('新建子节点');
    expect(container.textContent).toContain('Ctrl+S');
    expect(container.textContent).toContain('重置缩放');
  });

  it('Esc → onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpPanel onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('× 关闭按钮 → onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutHelpPanel onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-help-close]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩 → onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutHelpPanel onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-help-backdrop]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
