/**
 * 文档操作 hook —— 打开 / 新建 / 保存 / 另存为 / 切换（含未保存守卫）。
 *
 * 从 `MindmapStage.tsx` 的 `StageContent`（原 1,394 行单函数）中抽出，
 * 属代码结构规范化 T1 的一部分。**纯搬迁，逻辑未改写**。
 *
 * 不是什么：不含自动保存（那是 `StageContent` 内的 effect，依赖 dirty/saved/handle 联动）；
 * 不含导出（见 `useExportActions`）。
 */
import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, MindDoc } from '@mindcanvas/react';

export interface DocumentActionsOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 自动保存 debounce 定时器；手动保存需先取消 pending */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
}

export interface DocumentActions {
  /**
   * 切换文档；有未保存修改时弹确认，用户取消则不动。
   *
   * @returns 是否真的切换了。调用方据此决定是否收起自己的浮层/启动页 ——
   *          否则用户在确认框点「取消」后界面已关闭、文档却没换，观感像卡住。
   */
  applyDoc: (next: MindDoc) => Promise<boolean>;
  handleOpen: () => Promise<void>;
  handleNew: () => void;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
}

export function useDocumentActions({
  controller,
  docHost,
  doc,
  setDoc,
  fileInputRef,
  autoSaveTimer,
}: DocumentActionsOptions): DocumentActions {
  const applyDoc = useCallback(
    async (next: MindDoc): Promise<boolean> => {
      if (controller.dirty && !window.confirm('当前文档有未保存的修改，确定放弃并切换？')) {
        return false;
      }
      setDoc(next);
      docHost.remember(next);
      return true;
    },
    [controller, setDoc, docHost],
  );

  const handleOpen = useCallback(async (): Promise<void> => {
    const opened = await docHost.open();
    if (opened) {
      await applyDoc(opened);
      return;
    }
    // FS 取消 → 不动；浏览器不支持 → 隐藏 file input 兜底读取
    if (typeof window.showOpenFilePicker !== 'function') fileInputRef.current?.click();
  }, [docHost, applyDoc, fileInputRef]);

  const handleNew = useCallback((): void => {
    void applyDoc(docHost.create('未命名.mm.md', '# 未命名\n'));
  }, [docHost, applyDoc]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const source = controller.serialize();
    const result = await docHost.save({ ...doc, source });
    if (result === 'cancelled') return;
    setDoc((d) => ({ ...d, source, saved: true, ts: Date.now() }));
    controller.markSaved();
    docHost.remember({ ...doc, source, saved: true, ts: Date.now() });
  }, [autoSaveTimer, controller, docHost, doc, setDoc]);

  const handleSaveAs = useCallback(async (): Promise<void> => {
    const source = controller.serialize();
    const result = await docHost.save({ ...doc, source, handle: undefined });
    if (result === 'cancelled') return;
    setDoc((d) => ({ ...d, source, saved: true, ts: Date.now() }));
    controller.markSaved();
  }, [controller, docHost, doc, setDoc]);

  return { applyDoc, handleOpen, handleNew, handleSave, handleSaveAs };
}
