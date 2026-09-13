/**
 * useAutoSave 行为测试 —— 编辑流保全（批次 E）判别性守卫。
 *
 * 判别核心：保存成功的写回必须落在 `doc.savedSource`（最近一次成功保存的内容快照），
 * 且**不得改写** `doc.source`（= 本次会话打开/新建时的解析输入）。
 * 若实现回退写 `source`，本文件用例 1 转红 —— 两条阴性对照之一的判据。
 *
 * 不测什么：不测真实 FS 落盘（autosave 需真实 FileSystemFileHandle，无头环境无法 seed，
 * 见计划 §1.5-7：不做 verify 脚本）；`docHost` 为契约替身。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { DocumentHost, EditorController, FsFileHandle, MindDoc } from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave } from '../src/hooks/useAutoSave';

/** 最小可用 controller：只实现本 hook 触碰的成员（同 useDocumentActions.test 风格） */
function makeController(over: Partial<EditorController> = {}): EditorController {
  return {
    dirty: true,
    serialize: () => 'SRC',
    markSaved: vi.fn(),
    ...over,
  } as unknown as EditorController;
}

function makeDocHost(over: Partial<DocumentHost> = {}): DocumentHost {
  return {
    save: vi.fn(async () => ({ result: 'fs' as const })),
    ...over,
  } as unknown as DocumentHost;
}

const HANDLE = { name: 'a.mm.md' } as FsFileHandle;

function setup(
  over: {
    controller?: Partial<EditorController>;
    docHost?: Partial<DocumentHost>;
    doc?: Partial<MindDoc>;
  } = {},
) {
  const controller = makeController(over.controller);
  const docHost = makeDocHost(over.docHost);
  const doc: MindDoc = {
    id: 'a.mm.md',
    name: 'a.mm.md',
    source: 'OLD',
    handle: HANDLE,
    saved: true,
    ts: 0,
    ...over.doc,
  };
  const setDoc = vi.fn();
  const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  const onSavingChange = vi.fn();
  const view = renderHook(() =>
    useAutoSave({ controller, docHost, doc, setDoc, autoSaveTimer, onSavingChange }),
  );
  return { view, controller, docHost, doc, setDoc, autoSaveTimer, onSavingChange };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useAutoSave · 落盘与口径（E 批判别）', () => {
  it('dirty+saved+handle：300ms 后保存，写回 savedSource 且不改写 source', async () => {
    const { controller, docHost, doc, setDoc, autoSaveTimer, onSavingChange } = setup();
    expect(autoSaveTimer.current).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // 1) 落盘收到的是新内容（serialize 结果）
    expect(docHost.save).toHaveBeenCalledTimes(1);
    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'SRC' }));

    // 2) 写回只动 savedSource；source 保持旧值（解析输入不被保存路径击穿）
    expect(setDoc).toHaveBeenCalledTimes(1);
    const updater = setDoc.mock.calls[0][0] as (d: MindDoc) => MindDoc;
    const next = updater({ ...doc, source: 'OLD' });
    expect(next.savedSource).toBe('SRC');
    expect(next.source).toBe('OLD');

    // 3) 账目闭环
    expect(controller.markSaved).toHaveBeenCalledTimes(1);
    expect(onSavingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('dirty=false → 不排定时器（save 零调用）', async () => {
    const { docHost, autoSaveTimer } = setup({ controller: { dirty: false } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('无 handle → 不排（未落盘文档无自动保存）', async () => {
    const { docHost, autoSaveTimer } = setup({ doc: { handle: undefined } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('saved=false → 不排（新建未保存文档走手动保存）', async () => {
    const { docHost, autoSaveTimer } = setup({ doc: { saved: false } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('unmount → 清理 pending 定时器（回调不再触发）', async () => {
    const { view, docHost, autoSaveTimer } = setup();
    expect(autoSaveTimer.current).not.toBeNull();
    const id = autoSaveTimer.current;
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    view.unmount();

    expect(clearSpy).toHaveBeenCalledWith(id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });
});
