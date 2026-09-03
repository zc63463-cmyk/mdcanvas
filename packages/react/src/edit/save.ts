/**
 * 保存与离开守卫（T2 · local-first，不接 Forgejo）。
 * - saveMarkdown：File System Access API 优先（支持则「保存到文件」），不支持/失败 → 下载 .mm.md
 * - installBeforeUnload：有未保存变更时拦截页面离开
 */
export type SaveResult = 'fs' | 'download' | 'cancelled';

/** FS 文件句柄（保存复用；B1 文档宿主导出供打开/写回） */
export interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  name?: string;
  createWritable(): Promise<FsWritable>;
  getFile?(): Promise<File>;
}
export interface FsFileSystemWindow {
  showSaveFilePicker?(options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<FsFileHandle>;
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<FsFileHandle[]>;
}

/**
 * 把 FS Access API 直接挂到全局 Window 上。
 *
 * 此前调用方一律写 `window as unknown as FsFileSystemWindow` —— 双重断言既
 * 绕过类型检查（写错方法名也不报错），又会在债务预算里记 2 个 asCast。
 * 声明到全局后，`window.showOpenFilePicker` 直接可查、可补全，零断言。
 */
declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FsFileHandle>;
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FsFileHandle[]>;
  }
}

/** .mm 文件类型描述（打开/保存共用） */
export const MM_FILE_TYPES = [
  { description: 'mindcanvas 画布', accept: { 'text/markdown': ['.mm.md', '.md'] } },
];

/**
 * 保存 .mm.md 文本：
 * - 浏览器支持 FS Access API → 弹出保存对话框写入文件（用户可指定路径）
 * - 不支持 / 非 fs 场景 → 触发下载兜底
 * - 用户在 FS 对话框取消 → 返回 'cancelled'（不视为错误）
 */
export async function saveMarkdown(text: string, defaultName: string): Promise<SaveResult> {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: MM_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return 'fs';
    } catch (e) {
      // AbortError = 用户取消对话框 → 静默；其他错误 → 兜底下载
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  // 下载兜底（FS Access 不可用/失败）
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return 'download';
}

/**
 * beforeunload 守卫：dirty() 为真 → 拦截离开（浏览器弹确认框）。
 * 返回卸载函数（组件清理用）。
 */
export function installBeforeUnload(dirty: () => boolean): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = ''; // 现代浏览器据此显示「离开将丢失未保存更改」确认框
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
