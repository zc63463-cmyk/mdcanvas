/**
 * E5：画布级标注边编辑测试。
 * 覆盖：collectNodeChoices（id+anchor）/ edges 数组纯函数（含 mergeStyleAt 内层合并）/
 * 菜单「连线到…」/ LinkCreator 与 EdgeEditor 交互（含样式）/ controller.updateNote 全链路（undo 继承）。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, parseMm, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import {
  EdgeEditor,
  LinkCreator,
  collectNodeChoices,
  appendEdge,
  patchEdgeAt,
  mergeStyleAt,
  removeEdgeAt,
  edgesOf,
  findDuplicateEdge,
} from '../src/chrome/EdgeEditor.js';
import { contextMenuItemsFor } from '../src/edit/contextMenuItems.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { anchorOfNode, collectFreeEdges } from '../src/render/freeEdges.js';

function build(mm: string): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(astToEditable(parseMm(mm).root!)!, {}, frame);
}

function fixture(): EditableNode {
  return makeTextNode('根', [makeTextNode('任务A'), makeTextNode('里程碑', [makeTextNode('M2')])]);
}

describe('collectNodeChoices：目标候选（id + anchor）', () => {
  it('生成路径锚与 id（根除外）', () => {
    const choices = collectNodeChoices(fixture());
    const byAnchor = new Map(choices.map((c) => [c.anchor, c]));
    expect(byAnchor.get('node:根/任务A')!.id).toBeTruthy();
    expect(byAnchor.get('node:根/里程碑/M2')).toBeDefined();
    expect(byAnchor.has('node:根')).toBe(false);
  });
});

describe('edges 数组纯函数', () => {
  it('append / patch / remove 不可变', () => {
    const e0 = edgesOf(undefined);
    expect(e0).toEqual([]);
    const e1 = appendEdge(e0, { from: 'node:根/A', to: 'node:根/B', rel: 'blocks' });
    const e2 = patchEdgeAt(e1, 0, { dir: 'back', label: 'L' });
    expect(e2[0]).toEqual({
      from: 'node:根/A',
      to: 'node:根/B',
      rel: 'blocks',
      dir: 'back',
      label: 'L',
    });
    expect(e1[0]).toEqual({ from: 'node:根/A', to: 'node:根/B', rel: 'blocks' });
    expect(removeEdgeAt(e2, 0)).toEqual([]);
  });
  it('mergeStyleAt：style 内层合并；清空 → 移除 style 键', () => {
    const arr = [{ from: 'a', to: 'b', rel: 'blocks' }];
    const s1 = mergeStyleAt(arr, 0, { color: '#e24b4a' });
    expect(s1[0]!.style).toEqual({ color: '#e24b4a' });
    const s2 = mergeStyleAt(s1, 0, { color: '#10b981', dashed: true, width: 3 });
    expect(s2[0]!.style).toEqual({ color: '#10b981', dashed: true, width: 3 });
    const s3 = mergeStyleAt(s2, 0, { color: undefined, dashed: undefined, width: undefined });
    expect(s3[0]!.style).toBeUndefined();
  });
  it('mergeStyleAt：显式 undefined = 清除（治「默认按钮/取消虚线失效」bug）', () => {
    const arr = [{ from: 'a', to: 'b', rel: 'blocks', style: { color: '#e24b4a', dashed: true } }];
    // 选了色再点默认 → color 清除，dashed 保留
    const s1 = mergeStyleAt(arr, 0, { color: undefined });
    expect(s1[0]!.style).toEqual({ dashed: true });
    // 取消虚线 → dashed 清除，color 保留
    const s2 = mergeStyleAt(s1, 0, { dashed: undefined });
    expect(s2[0]!.style).toBeUndefined(); // 全空 → style 键整体移除
  });
  it('findDuplicateEdge：同 from+to+rel 命中，rel 不同不算', () => {
    const arr = [
      { from: 'a', to: 'b', rel: 'blocks' },
      { from: 'a', to: 'c', rel: 'blocks' },
    ];
    expect(findDuplicateEdge(arr, { from: 'a', to: 'b', rel: 'blocks' })).toBe(0);
    expect(findDuplicateEdge(arr, { from: 'a', to: 'b', rel: 'causes' })).toBe(-1);
  });
});

describe('菜单「连线到…」（E5）', () => {
  const MM = '# 根\n\n- A\n- B\n';
  it('缺省 edgeActions → 不追加（向后兼容）', () => {
    const c = build(MM);
    const labels = contextMenuItemsFor(c, c.root.children[0]!.id).map((i) => i.label);
    expect(labels).not.toContain('连线到…');
  });
  it('传入 edgeActions → 追加项且回调生效', () => {
    const c = build(MM);
    const onStartLink = vi.fn();
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, { onStartLink });
    const item = items.find((i) => i.label === '连线到…')!;
    expect(item).toBeDefined();
    item.onSelect();
    expect(onStartLink).toHaveBeenCalledWith(id);
  });
});

describe('LinkCreator 交互（含样式）', () => {
  it('搜索候选 → 选中 → 创建（dir/label/note/style 条件字段）', () => {
    const onCreate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <LinkCreator
          choices={collectNodeChoices(fixture())}
          x={10}
          y={10}
          onCreate={onCreate}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.change(container.querySelector('[data-link-query]')!, { target: { value: 'M2' } });
    fireEvent.click(container.querySelector('[data-link-choice]')!);
    fireEvent.change(container.querySelector('[data-link-rel]')!, { target: { value: 'blocks' } });
    fireEvent.click(container.querySelector('[data-dir-opt="both"]')!);
    fireEvent.click(container.querySelector('[data-style-color="#e24b4a"]')!);
    fireEvent.click(container.querySelector('[data-link-create]')!);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0]).toEqual({
      from: '',
      to: 'node:根/里程碑/M2',
      rel: 'blocks',
      dir: 'both',
      style: { color: '#e24b4a' },
    });
  });
});

describe('EdgeEditor 交互（含样式）', () => {
  const edge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };
  it('改 rel/dir/label → onChange；样式色 → onStyle', () => {
    const onChange = vi.fn();
    const onStyle = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={onStyle}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.change(container.querySelector('[data-edge-rel]')!, { target: { value: 'causes' } });
    expect(onChange).toHaveBeenLastCalledWith({ rel: 'causes' });
    fireEvent.click(container.querySelector('[data-dir-opt="back"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ dir: 'back' });
    fireEvent.change(container.querySelector('[data-edge-label]')!, {
      target: { value: '硬依赖' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ label: '硬依赖' });
    fireEvent.click(container.querySelector('[data-style-color="#10b981"]')!);
    expect(onStyle).toHaveBeenLastCalledWith({ color: '#10b981' });
    fireEvent.click(container.querySelector('[data-style-default]')!);
    expect(onStyle).toHaveBeenLastCalledWith({ color: undefined });
  });
  it('绕行侧三态：routingSide 写回（↰/↱）与回切自动（forceSide 可见化）', () => {
    const onChange = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.click(container.querySelector('[data-routing-side-opt="left"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: 'left' });
    fireEvent.click(container.querySelector('[data-routing-side-opt="right"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: 'right' });
    fireEvent.click(container.querySelector('[data-routing-side-opt="auto"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: undefined });
  });
  it('删除 → onDelete 回调', () => {
    const onDelete = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container, rerender } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={() => undefined}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={onDelete}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.click(container.querySelector('[data-edge-invalidate]')!);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    // 已失效态 → 恢复按钮出现 → 点击触发 onRestore
    rerender(
      <ThemeProvider>
        <EdgeEditor
          edge={{ ...edge, invalidAt: '2026-08-31T00:00:00Z' }}
          x={10}
          y={10}
          onChange={() => undefined}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={onDelete}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-edge-invalidated]')).not.toBeNull();
    expect(container.querySelector('[data-edge-restore]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-edge-restore]')!);
    expect(onRestore).toHaveBeenCalledTimes(1);
    // 彻底删除仍可用
    fireEvent.click(container.querySelector('[data-edge-delete]')!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('全链路：updateNote(root) 写入 → 画布边可见 → 编辑 → 删除（undo 继承）', () => {
  it('创建 → 样式覆盖 → 删除 → undo 恢复', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const rootId = c.root.id;
    // 创建（文档级）
    c.updateNote(rootId, {
      edges: appendEdge(edgesOf(c.root.note), {
        from: 'node:根/A',
        to: 'node:根/B',
        rel: 'blocks',
        label: '依赖',
      }),
    });
    let edges = collectFreeEdges(c.root);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceId).toBe(c.root.children[0]!.id);
    expect(edges[0]!.targetId).toBe(c.root.children[1]!.id);
    // 样式覆盖
    c.updateNote(rootId, {
      edges: mergeStyleAt(edgesOf(c.root.note), 0, { color: '#7f77dd', dashed: true }),
    });
    edges = collectFreeEdges(c.root);
    expect(edges[0]!.style).toEqual({ color: '#7f77dd', dashed: true });
    // 删除 + undo 恢复（含样式）
    c.updateNote(rootId, { edges: removeEdgeAt(edgesOf(c.root.note), 0) });
    expect(collectFreeEdges(c.root)).toHaveLength(0);
    expect(c.undo()).toBe(true);
    edges = collectFreeEdges(c.root);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.style).toEqual({ color: '#7f77dd', dashed: true });
  });
  it('E6.1：软失效 → 恢复；来源标记透传', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const rootId = c.root.id;
    c.updateNote(rootId, {
      edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'blocks', source: 'manual' }],
    });
    c.updateNote(rootId, {
      edges: patchEdgeAt(edgesOf(c.root.note), 0, { invalidAt: '2026-08-31T00:00:00Z' }),
    });
    const edges = collectFreeEdges(c.root);
    expect(edges[0]!.invalidAt).toBe('2026-08-31T00:00:00Z');
    expect(edges[0]!.source).toBe('manual');
    // 恢复 = 清空 invalidAt
    c.updateNote(rootId, { edges: patchEdgeAt(edgesOf(c.root.note), 0, { invalidAt: undefined }) });
    expect(collectFreeEdges(c.root)[0]!.invalidAt).toBeUndefined();
  });
  it('E8：持久化往返——含实体锚的边序列化后重解析仍命中同一对节点', () => {
    const c = build('# Agent Gateway\n\n## 任务\n\n- @issue:8\n\n## 想法\n\n- 先只读\n');
    const rootId = c.root.id;
    const all: EditableNode[] = [];
    {
      const walk = (n: EditableNode): void => {
        all.push(n);
        n.children.forEach(walk);
      };
      walk(c.root);
    }
    const issue8 = all.find((n) => n.type === 'entity')!;
    const think = all.find((n) => n.text === '先只读')!;
    const from = anchorOfNode(c.root, think.id)!;
    const to = anchorOfNode(c.root, issue8.id)!;
    expect(to).toBe('@issue:8');
    c.updateNote(rootId, {
      edges: appendEdge(edgesOf(c.root.note), {
        from,
        to,
        rel: 'blocks',
        label: '待验证',
        source: 'manual',
      }),
    });
    // 序列化 → 重解析（模拟保存/重开）
    const text = c.serialize();
    const c2 = build(text);
    const e2 = collectFreeEdges(c2.root);
    expect(e2).toHaveLength(1);
    expect(e2[0]!.rel).toBe('blocks');
    expect(e2[0]!.label).toBe('待验证');
    expect(e2[0]!.sourceId).not.toBeNull();
    expect(e2[0]!.targetId).not.toBeNull();
    // 目标仍是那个实体节点（按 ref 判定，而非会话内 id）
    const all2: EditableNode[] = [];
    {
      const walk = (n: EditableNode): void => {
        all2.push(n);
        n.children.forEach(walk);
      };
      walk(c2.root);
    }
    const t2 = all2.find((n) => n.id === e2[0]!.targetId)!;
    expect(t2.type).toBe('entity');
    expect(t2.ref).toEqual({ kind: 'issue', id: '8' });
    const s2 = all2.find((n) => n.id === e2[0]!.sourceId)!;
    expect(s2.text).toBe('先只读');
  });
});
