// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js';

// vitest 未开 globals，@testing-library/react 不会自动清理 DOM；显式 afterEach(cleanup) 避免用例间泄漏
afterEach(cleanup);

const ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

describe('AssetPanel：图库侧栏', () => {
  it('渲染资产列表（名称 + 类型徽章）', () => {
    const { container } = render(
      <AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.textContent).toContain('demo-diagram.svg');
    expect(container.textContent).toContain('board.svg');
  });

  it('点击资产 → onInsert 回调该资产项', () => {
    const insert = vi.fn();
    const { getByText } = render(
      <AssetPanel assets={ASSETS} onInsert={insert} onClose={vi.fn()} />,
    );
    fireEvent.click(getByText('demo-diagram.svg'));
    expect(insert).toHaveBeenCalledWith(ASSETS[0]);
  });

  it('点击关闭 → onClose', () => {
    const close = vi.fn();
    const { container } = render(<AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={close} />);
    fireEvent.click(container.querySelector('[data-asset-close]')!);
    expect(close).toHaveBeenCalled();
  });

  it('空资产 → 空态引导', () => {
    const { container } = render(<AssetPanel assets={[]} onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(container.textContent).toContain('assets/');
  });
});
