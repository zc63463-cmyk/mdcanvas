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
    expect(labels.some((l) => l.startsWith('编辑描述'))).toBe(false);
  });

  it('传入 descActions → 追加「编辑描述（盒内）」项且 onStart 被调用', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const onStart = vi.fn();
    const items = contextMenuItemsFor(c, id, undefined, undefined, { onStart });
    const desc = items.find((i) => i.label === '编辑描述（盒内）');
    expect(desc).toBeDefined();
    desc!.onSelect();
    expect(onStart).toHaveBeenCalledWith(id);
  });

  it('v1.8.1 分区：描述项归入「内容」分区（位于「常用」四件之后）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, {
      onStart: () => undefined,
    });
    const labels = items.map((i) => i.label);
    const iDesc = labels.indexOf('编辑描述（盒内）');
    expect(iDesc).toBeGreaterThan(labels.indexOf('删除节点'));
    expect(items[iDesc]!.section).toBe('内容');
  });

  it('根节点也提供「编辑描述」（幕布根节点同样可有描述）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(c, c.root.id, undefined, undefined, {
      onStart: () => undefined,
    }).map((i) => i.label);
    expect(labels).toContain('编辑描述（盒内）');
  });
});

describe('C3：复制中心编号菜单', () => {
  const centerActionsBase = (id: string, cid: string | undefined) => ({
    isCenter: () => true,
    isDetached: () => false,
    parentLinkOf: () => 'hide' as const,
    onToggleParentLink: () => undefined,
    onPromote: () => undefined,
    onDemote: () => undefined,
    onAttach: () => undefined,
    cidOf: () => cid,
    onCopyCid: vi.fn(),
  });

  it('中心有 cid → 提供「复制中心编号（cid）」且回调生效', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = centerActionsBase(id, 'c7');
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, undefined, actions);
    const item = items.find((i) => i.label === '复制中心编号（c7）');
    expect(item).toBeDefined();
    item!.onSelect();
    expect(actions.onCopyCid).toHaveBeenCalledWith(id);
  });

  it('中心无 cid（旧数据）→ 隐藏复制入口', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined,
      centerActionsBase(id, undefined),
    );
    expect(items.some((i) => i.label.startsWith('复制中心编号'))).toBe(false);
  });

  it('非中心节点 → 不出现复制入口', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, undefined, {
      ...centerActionsBase(id, 'c7'),
      isCenter: () => false,
    });
    expect(items.some((i) => i.label.startsWith('复制中心编号'))).toBe(false);
  });
});

describe('D3′：生长方向菜单（思想分叉）', () => {
  const growDirFixture = (cur: 'right' | 'left' | 'down' | 'up' | null) => ({
    explicitDirOf: () => cur,
    onSetGrowDir: vi.fn(),
  });

  it('非根节点 → 四向项全出现；当前显式方向带 ✓', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = growDirFixture('left');
    const labels = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, actions,
    ).map((i) => i.label);
    expect(labels).toContain('生长方向（子树往哪边长） › 向右');
    expect(labels).toContain('生长方向（子树往哪边长） › 向左 ✓');
    expect(labels).toContain('生长方向（子树往哪边长） › 向下');
    expect(labels).toContain('生长方向（子树往哪边长） › 向上');
    // 显式状态下提供「继承」出口
    expect(labels).toContain('生长方向（子树往哪边长） › 继承（跟随父级）');
  });

  it('继承状态（无显式 dir）→ 无 ✓、无「继承」项（已在继承）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, growDirFixture(null),
    ).map((i) => i.label);
    expect(labels).toContain('生长方向（子树往哪边长） › 向右');
    expect(labels.some((l) => l.includes('✓'))).toBe(false);
    expect(labels).not.toContain('生长方向（子树往哪边长） › 继承（跟随父级）');
  });

  it('点选方向 → onSetGrowDir 回调携带目标 dir；继承 → null', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = growDirFixture('down');
    const items = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, actions,
    );
    items.find((i) => i.label === '生长方向（子树往哪边长） › 向上')!.onSelect();
    expect(actions.onSetGrowDir).toHaveBeenCalledWith(id, 'up');
    items.find((i) => i.label === '生长方向（子树往哪边长） › 继承（跟随父级）')!.onSelect();
    expect(actions.onSetGrowDir).toHaveBeenCalledWith(id, null);
  });

  it('根节点 → 不出现生长方向项（根的方向由岛/布局决定）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(
      c, c.root.id, undefined, undefined, undefined, undefined, undefined, growDirFixture(null),
    ).map((i) => i.label);
    expect(labels.some((l) => l.startsWith('生长方向'))).toBe(false);
  });
});

describe('v1.6.0：出线长度菜单（note.len 软约束）', () => {
  const lenFixture = (cur: number | null) => ({
    explicitDirOf: () => 'right' as const,
    onSetGrowDir: vi.fn(),
    lenOf: () => cur,
    onSetLen: vi.fn(),
    onRequestLenCustom: vi.fn(),
  });

  it('未设置 → 预设全出现、「缺省」带 ✓；点选回调携带数值 / null', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = lenFixture(null);
    const items = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, actions,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('出线长度 › 14');
    expect(labels).toContain('出线长度 › 32');
    expect(labels).toContain('出线长度 › 60');
    expect(labels).toContain('出线长度 › 100');
    expect(labels).toContain('出线长度 › 缺省 ✓');
    expect(labels).toContain('出线长度 › 自定义…');
    items.find((i) => i.label === '出线长度 › 60')!.onSelect();
    expect(actions.onSetLen).toHaveBeenCalledWith(id, 60);
    items.find((i) => i.label === '出线长度 › 缺省 ✓')!.onSelect();
    expect(actions.onSetLen).toHaveBeenCalledWith(id, null);
  });

  it('已设置 60 → 60 带 ✓、缺省无 ✓；文件手改的预设外值在自定义上打 ✓', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, lenFixture(60),
    ).map((i) => i.label);
    expect(labels).toContain('出线长度 › 60 ✓');
    expect(labels).toContain('出线长度 › 缺省');
    const labels2 = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, lenFixture(45),
    ).map((i) => i.label);
    expect(labels2).toContain('出线长度 › 自定义… ✓');
  });

  it('自定义…：走宿主 onRequestLenCustom 回调（原生 prompt 已退役，裁决 M3）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = lenFixture(null);
    const items = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined, actions,
    );
    const custom = items.find((i) => i.label === '出线长度 › 自定义…')!;
    custom.onSelect();
    expect(actions.onRequestLenCustom).toHaveBeenCalledWith(id);
    expect(actions.onSetLen).not.toHaveBeenCalled();
  });

  it('缺省 onRequestLenCustom（向后兼容）→ 不出现「自定义…」项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined,
      { explicitDirOf: () => null, onSetGrowDir: vi.fn(), lenOf: () => null, onSetLen: vi.fn() },
    ).map((i) => i.label);
    expect(labels).toContain('出线长度 › 缺省 ✓');
    expect(labels.some((l) => l.startsWith('出线长度 › 自定义'))).toBe(false);
  });

  it('lenOf/onSetLen 缺省（向后兼容）→ 不追加出线长度项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(
      c, id, undefined, undefined, undefined, undefined, undefined,
      { explicitDirOf: () => null, onSetGrowDir: vi.fn() },
    ).map((i) => i.label);
    expect(labels.some((l) => l.startsWith('出线长度'))).toBe(false);
  });
});

describe('v1.8.1 菜单梳理（分区 / 提示 / 直删）', () => {
  it('「常用」置顶且与环一级对齐；关键项带快捷键提示', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id);
    const labels = items.map((i) => i.label);
    expect(labels.slice(0, 4)).toEqual(['新建子节点', '新建同级节点', '编辑', '删除节点']);
    expect(items[0]!.hint).toBe('Tab');
    expect(items[1]!.hint).toBe('Enter');
    expect(items[2]!.hint).toBe('F2');
    expect(items[3]!.hint).toBe('Del');
    expect(items[3]!.section).toBe('常用');
    expect(items[3]!.danger).toBe(true);
  });

  it('删除为直删（撤销兜底）：onSelect 不再走阻塞确认', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id);
    // node 环境无 window.confirm —— 直删路径不得调用它（调用即抛错）
    const g = globalThis as { confirm?: (m?: string) => boolean };
    const prev = g.confirm;
    g.confirm = () => {
      throw new Error('直删路径不应调用 confirm');
    };
    try {
      items.find((i) => i.label === '删除节点')!.onSelect();
      expect(c.root.children.some((n) => n.id === id)).toBe(false);
    } finally {
      g.confirm = prev;
    }
  });
});
