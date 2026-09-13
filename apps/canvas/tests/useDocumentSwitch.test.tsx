/**
 * useDocumentSwitch 判别测试 —— 编辑流保全（批次 E）消费端守卫。
 *
 * 判别核心：重建 effect 的 deps 必须锁在 `doc.source` 上 ——
 * source 不变（仅 savedSource/ts/handle 变）→ 零动作；
 * source 变 → reset / setEntities / setExpandedQaId / fit 各恰一次。
 * 若实现误用对象身份（deps=[doc]）或把 savedSource 放进 deps，t1 转红 ——
 * 两条阴性对照之一的判据。
 *
 * 搬迁纪律另两条在本文件锁定：
 * 1) 首挂跳过其后 4 个动作（controller 首次创建 + MapView 初始 fit 已处理）；
 * 2) 首挂**仍要**执行 entityHost.remember（跨文档实体复用）。
 */
import { cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { EditableNode, Entity, EntityRef } from '@mindcanvas/kernel';
import type {
  EditorController,
  EntityHost,
  FsFileHandle,
  MapViewApi,
  MindDoc,
} from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentSwitch } from '../src/hooks/useDocumentSwitch';

const docA: MindDoc = { id: 'a.mm.md', name: 'a.mm.md', source: 'SRC-A', saved: true, ts: 0 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const reset = vi.fn();
  const controllerRef: RefObject<EditorController | null> = {
    current: { reset } as unknown as EditorController,
  };
  const fit = vi.fn();
  const apiRef: RefObject<MapViewApi | null> = { current: { fit } as unknown as MapViewApi };
  const entityHost = { remember: vi.fn() } as unknown as EntityHost;
  const setEntities = vi.fn();
  const setExpandedQaId = vi.fn();
  const refs: EntityRef[] = [];
  const entities = new Map<string, Entity>();
  const editable = { id: 'root', title: 'root', children: [] } as unknown as EditableNode;

  const view = renderHook(
    ({ doc }: { doc: MindDoc }) =>
      useDocumentSwitch({
        doc,
        editable,
        refs,
        entities,
        entityHost,
        gatewayTitles: {},
        controllerRef,
        setEntities,
        setExpandedQaId,
        apiRef,
      }),
    { initialProps: { doc: docA } },
  );
  return { view, reset, fit, entityHost, setEntities, setExpandedQaId };
}

describe('useDocumentSwitch · 文档切换语义（E 批判别）', () => {
  it('t1：source 不变的 doc 新对象（仅 savedSource/ts/handle 变）→ 四个动作零调用', () => {
    const { view, reset, fit, setEntities, setExpandedQaId } = setup();

    view.rerender({
      doc: { ...docA, savedSource: 'SRC-A-SAVED', ts: 123, handle: {} as FsFileHandle },
    });

    expect(reset).not.toHaveBeenCalled();
    expect(setEntities).not.toHaveBeenCalled();
    expect(setExpandedQaId).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });

  it('t2：source 变化 → 四动作各恰一次（切换回归钉）+ 首挂只登记不动树', () => {
    const { view, reset, fit, entityHost, setEntities, setExpandedQaId } = setup();

    // 首挂：已登记实体（跨文档复用），但四个动作未执行（避免重复初始化）
    expect(entityHost.remember).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();

    view.rerender({ doc: { ...docA, source: 'SRC-B' } });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(setEntities).toHaveBeenCalledTimes(1);
    expect(setExpandedQaId).toHaveBeenCalledWith(null);
    expect(fit).toHaveBeenCalledTimes(1);
    // 切换时重新登记（实体宿主按文档名归档）
    expect(entityHost.remember).toHaveBeenCalledTimes(2);
  });
});
