import { describe, expect, it, vi } from 'vitest';
import { astToEditable, parseMm } from '@mindcanvas/kernel';
import { contextMenuItemsFor, getNodeLabel } from '../src/edit/contextMenuItems.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';

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

const PLAIN = '# 根\n\n- A\n- B\n';
const ENTITY = '# 根\n\n- @issue:1\n- B\n';

describe('节点右键菜单项（N2：实体专属动作）', () => {
  it('文本节点：仅既有项（无实体三项）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(c, id).map((i) => i.label);
    expect(labels).toContain('新建子节点');
    expect(labels).toContain('编辑');
    expect(labels).not.toContain('改引用…');
    expect(labels).not.toContain('转为纯文本');
  });

  it('缺省 entityActions（向后兼容）→ 不追加实体项', () => {
    const c = build(ENTITY);
    const id = c.root.children[0]!.id;
    expect(c.root.children[0]!.type).toBe('entity');
    const labels = contextMenuItemsFor(c, id).map((i) => i.label);
    expect(labels).not.toContain('改引用…');
  });

  it('传入 entityActions + 实体节点 → 追加三项且动作回调生效', () => {
    const c = build(ENTITY);
    const id = c.root.children[0]!.id;
    const onEditRef = vi.fn();
    const onShowInGraph = vi.fn();
    const items = contextMenuItemsFor(c, id, { onEditRef, onShowInGraph });
    const labels = items.map((i) => i.label);
    expect(labels).toContain('改引用…');
    expect(labels).toContain('在关系图中显示');
    expect(labels).toContain('转为纯文本');

    items.find((i) => i.label === '改引用…')!.onSelect();
    expect(onEditRef).toHaveBeenCalledWith(id);
    items.find((i) => i.label === '在关系图中显示')!.onSelect();
    expect(onShowInGraph).toHaveBeenCalledWith(id);
    // 转为纯文本：实体 → 文本（ref 清空）
    items.find((i) => i.label === '转为纯文本')!.onSelect();
    expect(c.root.children[0]!.type).toBe('text');
    expect(c.root.children[0]!.ref).toBeUndefined();
  });

  it('根节点：无「新建同级/缩进/删除」（既有语义回归）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(c, c.root.id).map((i) => i.label);
    expect(labels).not.toContain('新建同级节点');
    expect(labels).not.toContain('缩进');
    expect(labels).not.toContain('删除节点');
  });

  it('getNodeLabel：根/有文本/无文本', () => {
    const c = build(PLAIN);
    expect(getNodeLabel(c.root, c.root.id)).toBe('根');
    expect(getNodeLabel(c.root, c.root.children[0]!.id)).toBe('A');
    expect(getNodeLabel(c.root, '不存在')).toBe('节点');
  });
});

describe('节点右键菜单项（v1.3.0：幕布描述入口）', () => {
  it('缺省 descActions（向后兼容）→ 不追加描述项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(c, id).map((i) => i.label);
    expect(labels).not.toContain('编辑描述');
  });

  it('传入 descActions → 追加「编辑描述」项且 onStart 被调用', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const onStart = vi.fn();
    const items = contextMenuItemsFor(c, id, undefined, undefined, { onStart });
    const desc = items.find((i) => i.label === '编辑描述');
    expect(desc).toBeDefined();
    desc!.onSelect();
    expect(onStart).toHaveBeenCalledWith(id);
  });

  it('描述项位置：紧随「新建子节点」之后（在「新建同级节点」之前）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(c, id, undefined, undefined, {
      onStart: () => undefined,
    }).map((i) => i.label);
    const iNewChild = labels.indexOf('新建子节点');
    const iDesc = labels.indexOf('编辑描述');
    const iNewSibling = labels.indexOf('新建同级节点');
    expect(iNewChild).toBeGreaterThanOrEqual(0);
    expect(iDesc).toBe(iNewChild + 1);
    expect(iNewSibling).toBe(iDesc + 1);
  });

  it('根节点也提供「编辑描述」（幕布根节点同样可有描述）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(c, c.root.id, undefined, undefined, {
      onStart: () => undefined,
    }).map((i) => i.label);
    expect(labels).toContain('编辑描述');
  });
});
