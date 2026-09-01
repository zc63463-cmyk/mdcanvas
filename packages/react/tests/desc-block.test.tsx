// @vitest-environment jsdom
/**
 * DescBlock 幕布描述块单测（v1.3.0）：
 * - 渲染：引用竖线 + 缩进 + 弱化文字
 * - 自动收缩：默认一行（nowrap + ellipsis）/ 展开（pre-wrap 多行）
 * - 编辑态：textarea 聚焦、Shift+Enter 提交、Esc 取消、blur 提交
 * - 空文本不渲染（无描述时不占位）
 * - 高度估算：收缩固定一行，展开按行数（封顶 DESC_MAX_LINES）
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import {
  DescBlock,
  estimateDescHeight,
  DESC_LINE_H,
  DESC_PAD,
  DESC_MAX_LINES,
} from '../src/chrome/DescBlock.js';

const token = glassToken;

function renderDesc(props: Partial<React.ComponentProps<typeof DescBlock>> = {}) {
  return render(
    <DescBlock
      text="这是对主题的补充说明"
      token={token}
      x={0}
      y={0}
      width={200}
      height={estimateDescHeight(false, 'x')}
      {...props}
    />,
  );
}

describe('DescBlock：幕布描述块', () => {
  it('空文本且非编辑态 → 不渲染', () => {
    const { container } = renderDesc({ text: '' });
    expect(container.querySelector('[data-desc-block]')).toBeNull();
  });

  it('空文本但处于编辑态 → 渲染（新建描述占位）', () => {
    const { container } = renderDesc({ text: '', editing: true });
    expect(container.querySelector('[data-desc-block]')).not.toBeNull();
    expect(container.querySelector('[data-desc-input]')).not.toBeNull();
  });

  it('渲染描述文本 + data 标记（收缩态）', () => {
    const { container } = renderDesc();
    const root = container.querySelector('[data-desc-block]');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('data-desc-expanded')).toBe('false');
    expect(container.querySelector('[data-desc-text]')!.textContent).toBe('这是对主题的补充说明');
  });

  it('收缩态：nowrap + ellipsis（只显示一行）', () => {
    const { container } = renderDesc({ text: '第一行\n第二行' });
    const textEl = container.querySelector('[data-desc-text]')!;
    expect((textEl as HTMLElement).style.whiteSpace).toBe('nowrap');
    expect((textEl as HTMLElement).style.textOverflow).toBe('ellipsis');
  });

  it('展开态：pre-wrap 显示多行', () => {
    const { container } = renderDesc({ text: '第一行\n第二行', expanded: true });
    const textEl = container.querySelector('[data-desc-text]')!;
    expect((textEl as HTMLElement).style.whiteSpace).toBe('pre-wrap');
  });

  it('点击描述区 → onToggle 触发（切换展开/收缩）', () => {
    const onToggle = vi.fn();
    const { container } = renderDesc({ onToggle });
    fireEvent.click(container.querySelector('[data-desc-block]')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('编辑态：Shift+Enter 提交（幕布「切换主题与描述」语义）', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '新描述内容' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('新描述内容');
  });

  it('编辑态：单独 Enter 不提交（用于换行）', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('编辑态：Esc 取消', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCancel, onCommit });
    fireEvent.keyDown(container.querySelector('[data-desc-input]')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('编辑态：blur 提交', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '失焦提交' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith('失焦提交');
  });

  it('提交时 trim 首尾空白', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '  两侧有空格  ' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith('两侧有空格');
  });
});

describe('estimateDescHeight：描述区高度估算', () => {
  it('收缩态固定一行高度（与内容行数无关）', () => {
    const one = estimateDescHeight(false, '一行');
    const many = estimateDescHeight(false, 'a\nb\nc\nd\ne\nf\ng');
    expect(one).toBe(many);
    expect(one).toBe(DESC_LINE_H + DESC_PAD * 2);
  });

  it('展开态按行数增长', () => {
    const one = estimateDescHeight(true, '一行');
    const three = estimateDescHeight(true, 'a\nb\nc');
    expect(three).toBeGreaterThan(one);
    expect(three).toBe(3 * DESC_LINE_H + DESC_PAD * 2);
  });

  it('展开态行数封顶 DESC_MAX_LINES（防超长描述撑爆布局）', () => {
    const long = estimateDescHeight(
      true,
      Array.from({ length: 50 }, (_, i) => `行${i}`).join('\n'),
    );
    expect(long).toBe(DESC_MAX_LINES * DESC_LINE_H + DESC_PAD * 2);
  });

  it('空文本展开态至少一行高', () => {
    expect(estimateDescHeight(true, '')).toBe(DESC_LINE_H + DESC_PAD * 2);
  });
});
