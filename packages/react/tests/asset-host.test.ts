// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DemoAssetHost, kindOfFileName } from '../src/chrome/assetHost.js';

const ASSETS = [
  {
    kind: 'img' as const,
    id: 'demo-assets/demo-diagram.svg',
    name: 'demo-diagram.svg',
    type: 'svg',
  },
  { kind: 'draw' as const, id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

describe('资产宿主（P0：每导图一个资产空间，宿主注入清单/解析/上传）', () => {
  it('listAssets：返回打包清单副本（异步契约）', async () => {
    const host = new DemoAssetHost(ASSETS, '/');
    expect(await host.listAssets()).toEqual(ASSETS);
    // 副本：外部改不了宿主内部清单
    const list = await host.listAssets();
    list.pop();
    expect((await host.listAssets()).length).toBe(2);
  });

  it('resolveAsset：baseUrl + 导图相对 id', () => {
    const host = new DemoAssetHost(ASSETS, '/demo-assets/');
    expect(host.resolveAsset(ASSETS[0]!)).toBe('/demo-assets/demo-assets/demo-diagram.svg');
    expect(host.resolveAsset({ kind: 'img', id: 'assets/x.png', name: 'x.png', type: 'png' })).toBe(
      '/demo-assets/assets/x.png',
    );
  });

  it('uploadAsset：加入清单 + objectURL 解析（会话级）', async () => {
    const host = new DemoAssetHost(ASSETS);
    const file = new File(['<svg/>'], 'arch.svg', { type: 'image/svg+xml' });
    const item = await host.uploadAsset(file);
    expect(item).toMatchObject({ kind: 'draw', id: 'assets/arch.svg', name: 'arch.svg' });
    expect(host.hasAsset(item)).toBe(true);
    expect(host.resolveAsset(item)).toMatch(/^blob:/); // objectURL 可加载
    expect((await host.listAssets()).length).toBe(3);
  });

  it('hasAsset：未知 id → false；kindOfFileName 按扩展名归类', () => {
    const host = new DemoAssetHost(ASSETS);
    expect(host.hasAsset(ASSETS[0]!)).toBe(true);
    expect(
      host.hasAsset({ kind: 'img', id: 'missing.png', name: 'missing.png', type: 'png' }),
    ).toBe(false);
    expect(kindOfFileName('a.svg')).toBe('draw');
    expect(kindOfFileName('b.png')).toBe('img');
    expect(kindOfFileName('c.jpeg')).toBe('img');
  });
});
