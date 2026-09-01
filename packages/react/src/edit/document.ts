/**
 * 文档宿主层（B1 多文档 + 本地持久化，local-first 不接 Forgejo）：
 * - MindDoc：文档模型（id/name/source/handle/saved）
 * - DocumentHost：打开 / 保存（已打开句柄直接写回，不重复弹框）/ 新建 / 最近文档（localStorage）
 * - LocalDocHost：File System Access API 优先；不支持 → open 返回 null（调用方用 <input type=file> 兜底读取）、
 *   save 走 saveMarkdown 下载兜底
 * 资产持久化说明：资产 id 仍为「导图相对路径」；物理落盘依赖宿主写能力（FS 目录句柄 / Forgejo），本期保持宿主契约不变。
 */
import {
  MM_FILE_TYPES,
  saveMarkdown,
  type FsFileHandle,
  type FsFileSystemWindow,
  type SaveResult,
} from './save.js';

/** 文档模型 */
export interface MindDoc {
  /** 稳定 id（文件名；新建未保存 = new-<ts>） */
  id: string;
  /** 文件名（显示用） */
  name: string;
  /** mm 源码 */
  source: string;
  /** FS 句柄（打开文档复用写回；新建/导入为 null → 保存时弹框或下载） */
  handle?: FsFileHandle;
  /** 是否已持久化（新建未保存 = false → 显示 ● 未保存标记） */
  saved: boolean;
  /** 最近访问时间戳 */
  ts: number;
}

/** 文档宿主契约（可换实现：Forgejo / Tauri / 云端） */
export interface DocumentHost {
  /** 打开本地文档（FS Access；不支持/取消 → null） */
  open(): Promise<MindDoc | null>;
  /** 保存（有 handle 直接写回；无 → 弹框/下载兜底） */
  save(doc: MindDoc): Promise<SaveResult>;
  /** 新建（未保存） */
  create(name: string, source: string): MindDoc;
  /** 最近文档（localStorage；上限 8，新在前） */
  recent(): MindDoc[];
  /** 记入最近列表 */
  remember(doc: MindDoc): void;
}

const RECENT_KEY = 'mindcanvas.docs.v1';
const RECENT_MAX = 8;

/** 是否为导图文档文件（GH-T1：拖入/粘贴分流用） */
export function isMindDocFile(name: string): boolean {
  return /\.(mm\.md|md)$/i.test(name);
}

/** 本地文档宿主：FS Access + localStorage 最近列表 */
export class LocalDocHost implements DocumentHost {
  async open(): Promise<MindDoc | null> {
    const w = window as unknown as FsFileSystemWindow;
    if (typeof w.showOpenFilePicker !== 'function') return null;
    try {
      const [handle] = await w.showOpenFilePicker({ multiple: false, types: MM_FILE_TYPES });
      if (!handle) return null;
      const file = (await handle.getFile?.()) ?? new File([], handle.name ?? 'untitled.mm.md');
      const source = await file.text();
      return { id: file.name, name: file.name, source, handle, saved: true, ts: Date.now() };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null; // 用户取消
      return null;
    }
  }

  async save(doc: MindDoc): Promise<SaveResult> {
    if (doc.handle) {
      try {
        const writable = await doc.handle.createWritable();
        await writable.write(doc.source);
        await writable.close();
        return 'fs';
      } catch {
        // 句柄失效（文件被移走等）→ 兜底弹框/下载
      }
    }
    return saveMarkdown(doc.source, doc.name);
  }

  create(name: string, source: string): MindDoc {
    return { id: `new-${Date.now()}`, name, source, saved: false, ts: Date.now() };
  }

  recent(): MindDoc[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? (JSON.parse(raw) as MindDoc[]) : [];
    } catch {
      return [];
    }
  }

  remember(doc: MindDoc): void {
    try {
      const list = this.recent().filter((d) => d.id !== doc.id);
      list.unshift({ ...doc, handle: undefined, ts: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
      // localStorage 满/禁用 → 静默（不影响主流程）
    }
  }
}
