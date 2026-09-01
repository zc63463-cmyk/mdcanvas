// @vitest-environment jsdom
/**
 * ContextMenu：节点右键菜单——定位 (x,y)，点击项回调 + 关闭；Esc/点击外部关闭。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ContextMenu } from '../src/chrome/ContextMenu.js';

describe('ContextMenu：右键菜单', () => {
  it('渲染菜单项并定位在 (x,y)', () => {
    const { container } = render(
      <ContextMenu
        x={120}
        y={80}
        items={[{ label: '新建子节点', onSelect: vi.fn() }]}
        onClose={() => {}}
      />,
    );
    const menu = container.querySelector('[data-context-menu]') as HTMLElement;
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('80px');
    expect(container.textContent).toContain('新建子节点');
  });

  it('点击菜单项 → 触发该 onSelect 并 onClose', () => {
    const onClose = vi.fn();
    const onSel = vi.fn();
    const { container } = render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: onSel }]} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement);
    expect(onSel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc → onClose', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: vi.fn() }]} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩（外部）→ onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: vi.fn() }]} onClose={onClose} />,
    );
    fireEvent.pointerDown(container.querySelector('[data-menu-backdrop]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
