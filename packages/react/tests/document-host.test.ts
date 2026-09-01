// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isMindDocFile, LocalDocHost } from '../src/edit/document.js';
import type { MindDoc } from '../src/edit/document.js';

function docOf(over: Partial<MindDoc> = {}): MindDoc {
  return { id: 'a.mm.md', name: 'a.mm.md', source: '# A', saved: true, ts: 1, ...over };
}

describe('文档宿主（B1：多文档 + 本地持久化）', () => {
  it('create：新建未保存文档（saved=false + new- 前缀 id）', () => {
    const host = new LocalDocHost();
    const d = host.create('新画布.mm.md', '# 新画布\n');
    expect(d.saved).toBe(false);
    expect(d.name).toBe('新画布.mm.md');
    expect(d.id.startsWith('new-')).toBe(true);
    expect(d.handle).toBeUndefined();
  });

  it('open：浏览器不支持 FS Access → null（调用方走 file input 兜底）', async () => {
    const host = new LocalDocHost();
    expect(await host.open()).toBeNull();
  });

  it('save：无句柄（新建/导入）→ 下载兜底（jsdom 无 FS Access）', async () => {
    const host = new LocalDocHost();
    const result = await host.save(docOf());
    expect(result).toBe('download');
  });

  it('save：有句柄 → 直接写回（不弹框）；写入内容 = 文档 source', async () => {
    let written = '';
    const handle = {
      createWritable: async () => ({
        write: async (s: string) => {
          written = s;
        },
        close: async () => undefined,
      }),
      getFile: async () => new File(['old'], 'a.mm.md'),
    };
    const host = new LocalDocHost();
    const result = await host.save(docOf({ handle: handle as never, source: '# 新内容' }));
    expect(result).toBe('fs');
    expect(written).toBe('# 新内容');
  });

  it('remember/recent：去重置顶 + 上限 8 + handle 不序列化', () => {
    localStorage.clear();
    const host = new LocalDocHost();
    for (let i = 0; i < 10; i++)
      host.remember(docOf({ id: `d${i}.mm.md`, name: `d${i}.mm.md`, handle: {} as never }));
    const list = host.recent();
    expect(list.length).toBe(8);
    expect(list[0]!.id).toBe('d9.mm.md'); // 最新在前
    expect(list[7]!.id).toBe('d2.mm.md'); // 最旧被挤出
    expect(list[0]!.handle).toBeUndefined(); // handle 不入库
    // 再次 remember 已有项 → 置顶去重
    host.remember(docOf({ id: 'd5.mm.md', name: 'd5.mm.md' }));
    expect(host.recent()[0]!.id).toBe('d5.mm.md');
    expect(host.recent().length).toBe(8);
  });
});

describe('文档文件判定（GH-T1：拖入/粘贴分流）', () => {
  it('isMindDocFile：.mm.md/.md 放行，图片/其他拒绝', () => {
    expect(isMindDocFile('gateway.mm.md')).toBe(true);
    expect(isMindDocFile('note.md')).toBe(true);
    expect(isMindDocFile('a.MM.MD')).toBe(true); // 大小写不敏感
    expect(isMindDocFile('photo.png')).toBe(false);
    expect(isMindDocFile('board.svg')).toBe(false);
    expect(isMindDocFile('readme.txt')).toBe(false);
  });
});
