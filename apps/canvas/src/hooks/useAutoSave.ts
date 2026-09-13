/**
 * 自动保存 hook —— GH-T3 逻辑从 `MindmapStage.tsx` 抽出（纯搬迁 + 口径修正）。
 *
 * - 仅对「已落盘且带句柄」的文档生效（saved + handle）；dirty 变化触发；
 * - debounce 300ms；再次触发时重置计时器；
 * - 保存成功后写回 `savedSource`（最近一次成功保存的内容快照）+ handle + ts 并
 *   markSaved()；失败静默（由手动保存兜底）。
 *
 * 口径修正（E 批）：保存路径不得改写 `doc.source` —— 它是「本次会话打开/新建时的
 * 内容（解析输入）」，改写会误触发文档重建 effect（reset 清掉选中/编辑中/Undo/折叠态，
 * 即「页面回正刷新」根因）。内容快照一律写 `savedSource`。
 * 详见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md。
 *
 * 与 `useDocumentActions` 的关系：手动保存会先取消本 hook 排定的 pending 定时器
 * （共享 `autoSaveTimer` ref）。抽 hook 前这段逻辑在 `StageContent` 的内联 effect 里
 * （原 MindmapStage.tsx:445-471）。
 */
import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, MindDoc } from '@mindcanvas/react';

export interface AutoSaveOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  /** debounce 定时器（与 useDocumentActions 共享：手动保存前需取消 pending） */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  /** 落盘中转瞬态通知（FA1-T1：驱动「保存中…」指示）；可选，缺省不通知 */
  onSavingChange?: (saving: boolean) => void;
}

export function useAutoSave({
  controller,
  docHost,
  doc,
  setDoc,
  autoSaveTimer,
  onSavingChange,
}: AutoSaveOptions): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保留自 MindmapStage（原 eslint-disable 注释），行为由 useAutoSave.test 判别
  useEffect(() => {
    if (!controller.dirty || !doc.saved || !doc.handle) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      const source = controller.serialize();
      onSavingChange?.(true);
      void docHost
        .save({ ...doc, source })
        .then((outcome) => {
          if (outcome.result !== 'cancelled') {
            setDoc((d) => ({
              ...d,
              // 保存路径不得改写 doc.source（E 批口径修正）：快照写入 savedSource
              savedSource: source,
              handle: outcome.handle ?? d.handle,
              ts: Date.now(),
            }));
            controller.markSaved();
          }
        })
        .finally(() => onSavingChange?.(false));
    }, 300);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.dirty, doc.saved, doc.id]);
}
