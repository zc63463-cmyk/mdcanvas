// @vitest-environment jsdom
/**
 * OverlayEditor：节点文本内联编辑（v1.3.0 Shift+Enter 切换描述）。
 *
 * 关键回归点：原实现 onKeyDown 只判 `e.key === 'Enter'`，**不区分 Shift**——
 * Shift+Enter 被当作普通提交，导致幕布核心语义「Shift+Enter 切换主题 ↔ 描述」
 * 在编辑态完全失效。本测试锁定修复后的行为。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { OverlayEditor } from '../src/edit/OverlayEditor.js';

const token = glassToken;

function renderEditor(props: Partial<React.ComponentProps<typeof OverlayEditor>> = {}) {
  return render(
    <OverlayEditor
      x={0}
      y={0}
      w={200}
      h={36}
      initial="初始文本"
      token={token}
      depth={1}
      root={false}
      scale={1}
      onCommit={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
}

describe('OverlayEditor：节点文本内联编辑', () => {
  it('Enter 提交（既有行为不变）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '改后的文本' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('改后的文本');
  });

  it('Esc 取消（既有行为不变）', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCancel, onCommit });
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('v1.3.0：Shift+Enter → 触发 onRequestDesc（主题 → 描述切换）', () => {
    const onRequestDesc = vi.fn();
    const { container } = renderEditor({ onRequestDesc });
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Enter', shiftKey: true });
    expect(onRequestDesc).toHaveBeenCalledTimes(1);
  });

  it('v1.3.0：Shift+Enter 先落盘主题文本再切描述（防输入丢失）', () => {
    const onCommit = vi.fn();
    const onRequestDesc = vi.fn();
    const { container } = renderEditor({ onCommit, onRequestDesc });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '主题文本' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('主题文本');
    expect(onRequestDesc).toHaveBeenCalledTimes(1);
  });

  it('v1.3.0：未注入 onRequestDesc 时 Shift+Enter 退化为提交（向后兼容）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '兼容路径' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('兼容路径');
  });

  it('提交幂等：重复 Enter 只提交一次（committedRef 守卫）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('键盘事件 stopPropagation（不冒泡到全局快捷键）', () => {
    const { container } = renderEditor();
    const input = container.querySelector('input')!;
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(input, { key: 'Enter' });
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
