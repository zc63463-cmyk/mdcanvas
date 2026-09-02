/**
 * 导出 hook —— 全图 SVG / PNG 导出。
 *
 * 从 `MindmapStage.tsx` 的 `StageContent`（原 1,394 行单函数）中抽出，**纯搬迁，逻辑未改写**。
 *
 * PNG 的降级语义（保留原实现）：外链资产会污染画布导致 PNG 导出失败（tainted），
 * 此时降级为下载 SVG 并提示用户；环境不支持时同样降级。
 */
import { useCallback } from 'react';
import { exportPng, exportSvg, type layoutDemo } from '@mindcanvas/react';
import type { TokenSet } from '@mindcanvas/react';

/**
 * 注意不要写成 `ReturnType<typeof layoutDemo>` —— 那是 `DemoLayout` 包装
 * （`{ layout, measure }`）；实际布局是它的 `.layout` 字段，即 `LayoutResult`。
 */
type Layout = ReturnType<typeof layoutDemo>['layout'];

export interface ExportActionsOptions {
  layout: Layout | null;
  token: TokenSet;
  docName: string;
}

export interface ExportActions {
  handleExport: () => void;
  handleExportPng: () => Promise<void>;
}

export function useExportActions({ layout, token, docName }: ExportActionsOptions): ExportActions {
  const handleExport = useCallback((): void => {
    if (!layout) return;
    const svg = exportSvg(layout, token, { title: docName });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = docName.replace(/\.mm\.md$/i, '') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [layout, token, docName]);

  const handleExportPng = useCallback(async (): Promise<void> => {
    if (!layout) return;
    const svg = exportSvg(layout, token, { title: docName });
    const name = docName.replace(/\.mm\.md$/i, '');
    const download = (blob: Blob, ext: string): void => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name + ext;
      a.click();
      URL.revokeObjectURL(url);
    };
    const r = await exportPng(layout, token, { title: docName });
    if (r.ok) {
      download(r.blob, '.png');
      return;
    }
    download(new Blob([svg], { type: 'image/svg+xml' }), '.svg');
    if (r.reason === 'tainted') alert('画布含外部图片，无法导出 PNG，已改为导出 SVG。');
    else alert('当前环境不支持导出 PNG，已改为导出 SVG。');
  }, [layout, token, docName]);

  return { handleExport, handleExportPng };
}
