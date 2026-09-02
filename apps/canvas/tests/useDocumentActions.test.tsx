/**
 * useDocumentActions 行为测试
 *
 * 为什么测它：`StageContent` 有 1,343 行、管着 10 个面板，是全项目最大的组件，
 * 且 apps 层此前零测试。抽出 hook 后，这部分逻辑终于可测。
 * 本文件锁住的行为，就是后续继续拆分 StageContent 时的回归基线。
 *
 * 不测什么：不测导出（见 useExportActions，依赖 Blob/URL/alert）；
 * 不测自动保存（那是 StageContent 内的 effect）。
 */
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { DocumentHost, EditorController, MindDoc } from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentActions } from '../src/hooks/useDocumentActions';

/** 最小可用的 controller：只实现本 hook 触碰的成员 */
function makeController(over: Partial<EditorController> = {}): EditorController {
  return {
    dirty: false,
    serialize: () => 'SRC',
    markSaved: vi.fn(),
    ...over,
  } as unknown as EditorController;
}

function makeDocHost(over: Partial<DocumentHost> = {}): DocumentHost {
  return {
    remember: vi.fn(),
    open: vi.fn(async () => null),
    create: vi.fn((name: string) => ({ name, source: '', saved: false })),
    save: vi.fn(async () => 'saved'),
    ...over,
  } as unknown as DocumentHost;
}

const baseDoc: MindDoc = { name: 'a.mm.md', source: 'X', saved: true, handle: {} };

function setup(over: {
  controller?: Partial<EditorController>;
  docHost?: Partial<DocumentHost>;
  doc?: Partial<MindDoc>;
} = {}) {
  const controller = makeController(over.controller);
  const docHost = makeDocHost(over.docHost);
  const doc = { ...baseDoc, ...over.doc };
  const setDoc = vi.fn();
  const fileInputRef = { current: null } as RefObject<HTMLInputElement | null>;
  const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  const { result } = renderHook(() =>
    useDocumentActions({ controller, docHost, doc, setDoc, fileInputRef, autoSaveTimer }),
  );
  return { result, controller, docHost, doc, setDoc, fileInputRef, autoSaveTimer };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDocumentActions · applyDoc', () => {
  it('无未保存修改时直接切换并记住文档', async () => {
    const { result, docHost, setDoc } = setup({ controller: { dirty: false } });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
    expect(docHost.remember).toHaveBeenCalledWith(next);
  });

  it('有未保存修改且用户取消 → 不切换、不记住', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result, docHost, setDoc } = setup({ controller: { dirty: true } });

    await act(async () => {
      await result.current.applyDoc({ ...baseDoc, name: 'b.mm.md' });
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
  });

  it('有未保存修改但用户确认 → 正常切换', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result, setDoc } = setup({ controller: { dirty: true } });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
  });
});

describe('useDocumentActions · handleSave', () => {
  it('保存前取消 pending 的自动保存定时器', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, autoSaveTimer } = setup();
    autoSaveTimer.current = setTimeout(() => {}, 10_000);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(clearSpy).toHaveBeenCalled();
    expect(autoSaveTimer.current).toBeNull();
  });

  it('保存成功 → 写入 source/saved/ts 并 markSaved + remember', async () => {
    const { result, controller, docHost, setDoc } = setup({
      controller: { serialize: () => 'NEW-SRC' },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'NEW-SRC' }));
    expect(controller.markSaved).toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalled();
    expect(docHost.remember).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'NEW-SRC', saved: true }),
    );
  });

  it('用户取消保存对话框 → 不动（不 markSaved、不 setDoc）', async () => {
    const { result, controller, setDoc, docHost } = setup({
      docHost: { save: vi.fn(async () => 'cancelled') },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
  });
});

describe('useDocumentActions · handleNew / handleOpen', () => {
  it('handleNew 以内置模板创建文档', async () => {
    const { result, docHost } = setup();

    await act(async () => {
      result.current.handleNew();
    });

    expect(docHost.create).toHaveBeenCalledWith('未命名.mm.md', '# 未命名\n');
    expect(docHost.remember).toHaveBeenCalled();
  });

  it('handleOpen 打开成功 → 走 applyDoc 切换', async () => {
    const opened = { ...baseDoc, name: 'opened.mm.md' };
    const { result, docHost, setDoc } = setup({
      docHost: { open: vi.fn(async () => opened) },
    });

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(setDoc).toHaveBeenCalledWith(opened);
    expect(docHost.remember).toHaveBeenCalledWith(opened);
  });

  it('handleOpen 打开失败且浏览器无 FS API → 兜底点击隐藏 file input', async () => {
    const click = vi.fn();
    const { result, fileInputRef } = setup({
      docHost: { open: vi.fn(async () => null) },
    });
    fileInputRef.current = { click } as unknown as HTMLInputElement;

    await act(async () => {
      await result.current.handleOpen();
    });

    // jsdom 没有 showOpenFilePicker → 应走兜底
    expect(click).toHaveBeenCalled();
  });
});

describe('useDocumentActions · handleSaveAs', () => {
  it('另存为时清掉 handle（触发重新选择位置）', async () => {
    const { result, docHost } = setup();

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ handle: undefined }));
  });
});
