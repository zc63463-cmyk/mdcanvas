/**
 * 资产宿主契约（P0 资产来源宿主化）：图库清单/解析/上传/存在性判定全部走宿主注入。
 * 每导图一个资产空间：资产 id 为「导图相对路径」（如 demo-assets/x.svg），
 * 渲染层经 host.resolveAsset 拼成可加载 URL；上传持久化由宿主实现（真实 FS/HTTP 属宿主职责）。
 * 当前实现：DemoAssetHost（打包 demo 资产 + objectURL 会话级上传——浏览器沙箱无法落盘，持久化留给真实宿主）。
 */
import type { AssetItem } from './AssetPanel.js';

/** 文件扩展名 → 资产 kind（未知 → img） */
export function kindOfFileName(name: string): 'img' | 'draw' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'svg' ? 'draw' : 'img';
}

export interface AssetHost {
  /** 图库资产清单（宿主可异步：HTTP/FS 目录扫描） */
  listAssets(): Promise<AssetItem[]>;
  /** 资产 → 可加载 URL（相对导图根路径 → 平台 URL / objectURL） */
  resolveAsset(item: AssetItem): string;
  /** 上传资产（拖拽/粘贴文件 → 图库）；返回新资产项 */
  uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem>;
  /** 资产存在性（同步判定：demo host 查清单；HTTP 宿主可先返回 true 由渲染层兜底） */
  hasAsset(item: AssetItem): boolean;
  /** 资产 base URL（透传给渲染层 assetBaseUrl） */
  baseUrl: string;
}

/** 会话级 demo 宿主：打包清单 + objectURL 上传（不落盘；真实持久化 = 换宿主实现） */
export class DemoAssetHost implements AssetHost {
  readonly baseUrl: string;
  private items: AssetItem[];
  /** 上传资产 id → objectURL（会话有效；刷新即失效，文档标注） */
  private objectUrls = new Map<string, string>();

  constructor(items: AssetItem[], baseUrl = '/') {
    this.items = [...items];
    this.baseUrl = baseUrl;
  }

  async listAssets(): Promise<AssetItem[]> {
    return [...this.items];
  }

  resolveAsset(item: AssetItem): string {
    const blob = this.objectUrls.get(item.id);
    if (blob) return blob;
    return this.baseUrl + item.id;
  }

  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const item: AssetItem = {
      kind: kind ?? kindOfFileName(file.name),
      id: `assets/${file.name}`,
      name: file.name,
      type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
    };
    this.objectUrls.set(item.id, URL.createObjectURL(file));
    this.items = [...this.items, item];
    return item;
  }

  hasAsset(item: AssetItem): boolean {
    return this.items.some((a) => a.kind === item.kind && a.id === item.id);
  }
}
