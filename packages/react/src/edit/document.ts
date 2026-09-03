/**
 * 文档宿主层（B1 多文档 + 本地持久化，local-first 不接 Forgejo）：
 * - MindDoc：文档模型（id/name/source/handle/saved）
 * - DocumentHost：打开 / 保存（已打开句柄直接写回，不重复弹框）/ 新建 / 最近文档（localStorage）
 * - LocalDocHost：File System Access API 优先；不支持 → open 返回 null（调用方用 <input type=file> 兜底读取）、
 *   save 走 saveMarkdown 下载兜底
 * 资产持久化说明：资产 id 仍为「导图相对路径」；物理落盘依赖宿主写能力（FS 目录句柄 / Forgejo），本期保持宿主契约不变。
 */
import { DocLibrary } from './docLibrary.js';
import {
  MM_FILE_TYPES,
  saveMarkdown,
  type FsFileHandle,
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

/** 最近列表的显示上限 */
const RECENT_MAX = 8;
/**
 * 旧版最近列表的独立存储 key（2026-09-03 起已并入 DocLibrary）。
 *
 * 此前「元数据索引」（mindcanvas.library.v1）与「最近列表」（本 key）是两堆
 * 独立的 localStorage：schema 各写各的、互不通知，同一份文档两处都有记录，
 * 重命名/删除只影响其一 → 两份状态漂移。
 * 现在统一以 DocLibrary 为单一事实源，本 key 仅用于**一次性迁移**。
 */
const LEGACY_RECENT_KEY = 'mindcanvas.docs.v1';

/** 是否为导图文档文件（GH-T1：拖入/粘贴分流用） */
export function isMindDocFile(name: string): boolean {
  return /\.(mm\.md|md)$/i.test(name);
}

/** 本地文档宿主：FS Access + DocLibrary（单一事实源） */
export class LocalDocHost implements DocumentHost {
  /** 元数据索引与最近列表共用的唯一持久化入口（注入便于测试；缺省自建） */
  private readonly library: DocLibrary;

  constructor(library?: DocLibrary) {
    this.library = library ?? new DocLibrary();
    this.migrateLegacyRecent();
  }

  async open(): Promise<MindDoc | null> {
    // window.showOpenFilePicker 已声明到全局（见 save.ts 的 declare global），无需断言
    if (typeof window.showOpenFilePicker !== 'function') return null;
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: MM_FILE_TYPES });
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
    // 派生自 DocLibrary（单一事实源），不再读独立的 localStorage。
    // 只取**有源码快照**的条目：source 被配额剥掉的旧条目恢复了也打不开，
    // 只能重新选文件，放进最近列表会点出一个空壳。
    return this.library
      .list()
      .flatMap((e) =>
        typeof e.source === 'string'
          ? [{ id: e.id, name: e.name, source: e.source, saved: true, ts: e.ts }]
          : [],
      )
      .slice(0, RECENT_MAX);
  }

  remember(doc: MindDoc): void {
    // 写单一事实源。handle 不可序列化，DocLibrary 不存（保存时需重新选文件，
    // 这与 recent() 恢复出的文档行为一致）。
    this.library.upsert({ id: doc.id, name: doc.name, source: doc.source });
  }

  /**
   * 一次性迁移：把旧版独立的最近列表并入 DocLibrary。
   *
   * 安全口径 —— **确认全部导入成功才清理旧 key**：
   * 若中途写失败就把旧 key 删了，用户会同时丢掉两份数据的唯一副本。
   * 迁移失败什么都不做（异常已吞），下次启动会再试一次。
   */
  private migrateLegacyRecent(): void {
    try {
      const raw = localStorage.getItem(LEGACY_RECENT_KEY);
      if (raw === null) return;
      // JSON 解析结果是不可信数据：逐字段提取校验，而不是一句 as 断言糊过去
      // （断言既不安全，又会在债务预算里 +1 asCast）
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(LEGACY_RECENT_KEY);
        return;
      }
      const usable = parsed.flatMap((d) => {
        const holder = Object(d); // null/undefined → {}，Reflect.get 不会抛
        const id = Reflect.get(holder, 'id');
        const name = Reflect.get(holder, 'name');
        const source = Reflect.get(holder, 'source');
        const ts = Reflect.get(holder, 'ts');
        if (typeof id !== 'string' || typeof source !== 'string') return [];
        return [
          {
            id,
            name: typeof name === 'string' ? name : id,
            source,
            // 透传原始访问时间：否则所有条目都盖上迁移时刻，顺序会被打乱
            ts: typeof ts === 'number' ? ts : undefined,
          },
        ];
      });
      for (const d of usable) {
        this.library.upsert(d);
      }
      // 校验：每条都已在库里，才允许删掉旧副本
      const allImported = usable.every((d) => this.library.get(d.id) !== undefined);
      if (allImported) localStorage.removeItem(LEGACY_RECENT_KEY);
    } catch {
      // 迁移失败不阻断主流程；旧 key 保留，下次启动重试
    }
  }
}
