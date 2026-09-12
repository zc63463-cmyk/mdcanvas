/**
 * useExportActions 行为测试（A-D2：PNG 降级提示 alert → 宿主通知 onNotice·白名单 −1）。
 *
 * 为什么测它：IDE 内嵌 webview 会**静默吞掉** alert——PNG 降级发生了，用户却毫无感知。
 * 规则面见 tests/no-native-dialogs.test.ts（ALLOW 注释：修一处删一处）。
 *
 * 覆盖：tainted / unsupported 两条降级文案经 onNotice 上报；未注入 onNotice 时静默降级；
 * 三例都断言不触碰 window.alert（spy 化并在被调用时抛错——红测试的驱动源）。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPng } from '@mindcanvas/react';
import { useExportActions } from '../src/hooks/useExportActions';

vi.mock('@mindcanvas/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindcanvas/react')>();
  // 隔离导出实现：本测试只关心「PNG 失败后如何提示」这一行为
  return {
    ...actual,
    exportPng: vi.fn(),
    exportSvg: vi.fn(() => '<svg data-stub />'),
  };
});

type Deps = Parameters<typeof useExportActions>[0];

function setup(opts: { withNotice?: boolean } = {}) {
  const onNotice = vi.fn<(m: string) => void>();
  const { result } = renderHook(() =>
    useExportActions({
      layout: {} as NonNullable<Deps['layout']>,
      token: {} as Deps['token'],
      docName: '画布.mm.md',
      ...(opts.withNotice === false ? {} : { onNotice }),
    }),
  );
  return { result, onNotice };
}

beforeEach(() => {
  vi.mocked(exportPng).mockReset();
  // jsdom 缺 createObjectURL/revokeObjectURL —— 给降级下载路径打桩
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
  // anchor.click 在 jsdom 会触发 navigation 告警 —— 静音
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  // 原生 alert：被调用即抛错（等价于 webview 下的「静默假死」信号）
  vi.spyOn(window, 'alert').mockImplementation(() => {
    throw new Error('native alert() 被调用');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useExportActions · handleExportPng 降级提示（A-D2）', () => {
  it('tainted：onNotice 收到「含外部图片」文案，且不触碰 window.alert', async () => {
    vi.mocked(exportPng).mockResolvedValue({ ok: false, reason: 'tainted' });
    const { result, onNotice } = setup();

    await act(async () => {
      await result.current.handleExportPng();
    });

    expect(onNotice).toHaveBeenCalledWith('画布含外部图片，无法导出 PNG，已改为导出 SVG。');
    expect(window.alert).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled(); // 降级下载仍发生
  });

  it('unsupported：onNotice 收到「当前环境不支持」文案，且不触碰 window.alert', async () => {
    vi.mocked(exportPng).mockResolvedValue({ ok: false, reason: 'unsupported' });
    const { result, onNotice } = setup();

    await act(async () => {
      await result.current.handleExportPng();
    });

    expect(onNotice).toHaveBeenCalledWith('当前环境不支持导出 PNG，已改为导出 SVG。');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('未注入 onNotice → 静默降级（不抛错、不触碰 window.alert）', async () => {
    vi.mocked(exportPng).mockResolvedValue({ ok: false, reason: 'tainted' });
    const { result } = setup({ withNotice: false });

    await act(async () => {
      await result.current.handleExportPng();
    });

    expect(window.alert).not.toHaveBeenCalled();
  });
});
