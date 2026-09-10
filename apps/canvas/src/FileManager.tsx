/**
 * 文件工作台（FA2-T2）—— 从「420px 居中玩具弹窗」升级为专业文档抽屉 / 宽幅工作台。
 *
 * 三种形态：
 *  - `variant='drawer'`：左侧滑出抽屉（320px），像 VS Code 资源管理器；
 *  - `variant='wide'`：沉浸式宽幅模态（680px），适合批量整理。
 *
 * 交互要点：
 *  - 顶部常驻搜索（文件名 / 路径实时过滤，保留目录层级）；
 *  - 真实树：展开折叠记忆、右键菜单（新建导图 / 新建文件夹 / 重命名 / 删除）、
 *    **拖拽文件到文件夹图标**即完成归位 —— 旧版「手动敲路径字符串」的交互已彻底移除；
 *  - 面包屑展示物理路径，状态指示区分 `🟢 本地磁盘已同步` / `📝 未保存`；
 *  - 未挂载工作区时降级为 `DocLibrary` 虚拟目录（同一套树，落点换成 localStorage）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHROME,
  type DocEntry,
  type DocLibrary,
  type WorkspaceDir,
  type WorkspaceFile,
  type WorkspaceNode,
} from '@mindcanvas/react';
import {
  allDirs,
  breadcrumbOf,
  canDropInto,
  filterTree,
  findNode,
  sortTree,
  treeFromLibrary,
  treeFromWorkspace,
  type TreeNode,
} from './fileTreeModel.js';
import { ContextMenu } from './FileManagerContextMenu.js';
import { FlatDocRow, StorageBar, ViewTabs, type FileManagerTab } from './FileManagerChrome.js';
import {
  NEW_DOC_TEMPLATE,
  SEP,
  btnBase,
  collectDocs,
  formatRelative,
  inputStyle,
  rowBtn,
  useStarredKeys,
  type MenuState,
} from './fileManagerShared.js';

/**
 * 工作区能力的最小面（结构化类型，`DirectoryWorkspaceHost` 天然满足）。
 * 收窄到 UI 真正用到的成员，测试可直接注入替身，无需浏览器 FS。
 */
export interface WorkspaceLike {
  mounted: boolean;
  name: string | null;
  scan(force?: boolean): Promise<WorkspaceNode[]>;
  createFile(dirPath: string, name: string, text: string): Promise<WorkspaceFile>;
  createDir(parentPath: string, name: string): Promise<WorkspaceDir>;
  renameFile(file: WorkspaceFile, name: string): Promise<WorkspaceFile>;
  removeFile(file: WorkspaceFile): Promise<void>;
  removeDir(dir: WorkspaceDir): Promise<void>;
  moveFile(file: WorkspaceFile, targetDirPath: string): Promise<WorkspaceFile>;
}

export interface FileManagerProps {
  library: DocLibrary;
  /** 工作区宿主；null = 兼容模式（走 DocLibrary 虚拟目录） */
  workspace: WorkspaceLike | null;
  /** 兼容模式：打开库条目 */
  onOpenEntry: (entry: DocEntry) => void;
  /** 工作区模式：打开真实文件 */
  onOpenFile: (file: WorkspaceFile) => void;
  onCreate: () => void;
  onClose: () => void;
  /** 「打开本地文件夹」→ 触发 showDirectoryPicker 挂载流程 */
  onPickWorkspace?: () => void;
  /** 断开工作区（回到兼容模式） */
  onDetachWorkspace?: () => void;
  /** 当前文档的相对路径（面包屑用） */
  currentPath?: string | null;
  /** 当前文档是否有未保存修改（📝 指示） */
  dirty?: boolean;
  /** 形态：抽屉 / 宽幅模态 */
  variant?: 'drawer' | 'wide';
}

export function FileManager({
  library,
  workspace,
  onOpenEntry,
  onOpenFile,
  onCreate,
  onClose,
  onPickWorkspace,
  onDetachWorkspace,
  currentPath = null,
  dirty = false,
  variant = 'wide',
}: FileManagerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [tab, setTab] = useState<FileManagerTab>('tree');
  const { starredKeys, toggleStar } = useStarredKeys();

  const [, forceRender] = useState(0);
  const refresh = useCallback((): void => forceRender((n) => n + 1), []);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const useWorkspace = workspace !== null && workspace.mounted;

  /** 载入树：工作区走真实扫描，兼容模式走 DocLibrary */
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = useWorkspace && workspace
        ? treeFromWorkspace(await workspace.scan(true))
        : treeFromLibrary(library);
      if (aliveRef.current) setTree(sortTree(next));
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '扫描工作区失败');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [useWorkspace, workspace, library]);

  // 首次挂载 + 工作区挂载状态变化时重新载入
  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const closeMenu = useCallback((): void => setMenu(null), []);

  // ---------------------------------------------------------------- 操作

  /** 新建导图：工作区落到目标目录；兼容模式走上层 onCreate */
  const createDocIn = async (dirPath: string): Promise<void> => {
    if (useWorkspace && workspace) {
      await workspace.createFile(dirPath, '未命名.mm.md', NEW_DOC_TEMPLATE);
      await reload();
      return;
    }
    onCreate();
  };

  const createDirIn = async (parentPath: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (useWorkspace && workspace) {
      await workspace.createDir(parentPath, trimmed);
      await reload();
      return;
    }
    // 兼容模式：直接维护本地自定义目录集合
    const full = parentPath === '' ? trimmed : `${parentPath}/${trimmed}`;
    library.addFolder(full);
    await reload();
  };

  const removeNode = async (node: TreeNode): Promise<void> => {
    const label = node.type === 'dir' ? `文件夹「${node.name}」及其全部内容` : `文件「${node.name}」`;
    if (!window.confirm(`确定删除${label}？\n（${useWorkspace ? '工作区模式下会真实删除磁盘文件' : '删除后所含文档将退回根目录'}）`)) return;
    if (useWorkspace && workspace) {
      if (node.type === 'dir' && node.wsDir) await workspace.removeDir(node.wsDir);
      if (node.type === 'doc' && node.wsFile) await workspace.removeFile(node.wsFile);
      await reload();
      return;
    }
    if (node.type === 'dir') {
      library.removeFolder(node.fullPath);
      await reload();
      return;
    }
    if (node.entry) library.remove(node.entry.id);
    await reload();
  };

  const commitRename = async (node: TreeNode, nextName: string): Promise<void> => {
    const name = nextName.trim();
    setRenamingKey(null);
    if (name === '' || name === node.name) return;
    if (useWorkspace && workspace) {
      if (node.type === 'doc' && node.wsFile) await workspace.renameFile(node.wsFile, name);
      await reload();
      return;
    }
    if (node.entry) library.rename(node.entry.id, name);
    refresh();
  };

  /** 拖拽归位：落到目标目录（取代旧版「手敲路径字符串」） */
  const dropInto = async (node: TreeNode, target: TreeNode): Promise<void> => {
    setDropTarget(null);
    if (!canDropInto(node.key, target.fullPath, tree)) return;
    if (useWorkspace && workspace) {
      if (node.type === 'doc' && node.wsFile) await workspace.moveFile(node.wsFile, target.fullPath);
      await reload();
      return;
    }
    if (node.entry) library.move(node.entry.id, target.fullPath);
    refresh();
  };

  // ---------------------------------------------------------------- 渲染

  const renderRows = (nodes: readonly TreeNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const pad = 8 + depth * 14;
      const open = expanded.has(n.key) || query.trim() !== '';
      if (n.type === 'dir') {
        const isDrop = dropTarget === n.key;
        return (
          <div key={n.key}>
            <div
              data-dir-row
              data-dir-path={n.fullPath}
              data-drop-active={isDrop || undefined}
              onDragOver={(e) => {
                if (!dragKey || !canDropInto(dragKey, n.fullPath, tree)) return;
                e.preventDefault();
                setDropTarget(n.key);
              }}
              onDragLeave={() => setDropTarget((p) => (p === n.key ? null : p))}
              onDrop={(e) => {
                e.preventDefault();
                const key = dragKey;
                setDragKey(null);
                if (!key) return;
                const dragged = findNode(tree, key);
                if (dragged) void dropInto(dragged, n);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ key: n.key, x: e.clientX, y: e.clientY });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: `5px 8px 5px ${pad}px`,
                borderRadius: 6,
                background: isDrop ? CHROME.neonSoft : undefined,
                outline: isDrop ? `1px dashed ${CHROME.neon}` : undefined,
              }}
            >
              <button
                type="button"
                onClick={() => toggle(n.key)}
                style={{ ...rowBtn, flex: 1 }}
                title={n.fullPath}
              >
                <span style={{ color: CHROME.textMuted }}>{open ? '▾' : '▸'}</span>
                <span>{isDrop ? '📂' : '📁'}</span>
                <span>{n.name}</span>
              </button>
            </div>
            {open && renderRows(n.children, depth + 1)}
          </div>
        );
      }

      const renaming = renamingKey === n.key;
      return (
        <div
          key={n.key}
          data-doc-row
          data-doc-name={n.name}
          draggable={!renaming}
          onDragStart={() => setDragKey(n.key)}
          onDragEnd={() => {
            setDragKey(null);
            setDropTarget(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ key: n.key, x: e.clientX, y: e.clientY });
          }}
          style={{ paddingLeft: pad + 14 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
            {renaming ? (
              <input
                autoFocus
                data-rename-input
                defaultValue={n.name}
                onBlur={(ev) => void commitRename(n, ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') ev.currentTarget.blur();
                  if (ev.key === 'Escape') setRenamingKey(null);
                }}
                style={inputStyle()}
              />
            ) : (
              <>
                <button
                  type="button"
                  data-doc-star
                  onClick={(e) => toggleStar(n.fullPath || n.key, e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: starredKeys.has(n.fullPath) || starredKeys.has(n.key) ? '#eab308' : CHROME.textMuted,
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: 13,
                  }}
                  title={starredKeys.has(n.fullPath) || starredKeys.has(n.key) ? '取消收藏' : '加为星标'}
                >
                  {starredKeys.has(n.fullPath) || starredKeys.has(n.key) ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  onClick={() => (n.wsFile ? onOpenFile(n.wsFile) : n.entry ? onOpenEntry(n.entry) : undefined)}
                  title={n.stale ? '源码快照已过期，打开时需重新选文件' : n.fullPath}
                  style={{ ...rowBtn, flex: 1 }}
                >
                  <span>📄</span>
                  <span>{n.name}</span>
                  {n.stale && <span style={{ color: CHROME.textMuted }}> ↻</span>}
                </button>
                <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                  {formatRelative(n.ts)}
                </span>
              </>
            )}
          </div>
        </div>
      );
    });

  const menuNode = menu ? findNode(tree, menu.key) : null;
  const widths = variant === 'drawer' ? 320 : 680;

  const allDocs = useMemo(() => collectDocs(tree), [tree]);

  const recentDocs = useMemo(() => {
    const list = [...allDocs].sort((a, b) => b.ts - a.ts);
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((d) => d.name.toLowerCase().includes(q) || d.fullPath.toLowerCase().includes(q));
  }, [allDocs, query]);

  const starredDocs = useMemo(() => {
    const list = allDocs
      .filter((d) => starredKeys.has(d.fullPath) || starredKeys.has(d.key))
      .sort((a, b) => b.ts - a.ts);
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((d) => d.name.toLowerCase().includes(q) || d.fullPath.toLowerCase().includes(q));
  }, [allDocs, starredKeys, query]);

  return (
    <div
      data-file-manager
      data-variant={variant}
      style={{
        width: widths,
        maxHeight: variant === 'drawer' ? '100%' : '76vh',
        display: 'flex',
        flexDirection: 'column',
        background: CHROME.bg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        fontSize: CHROME.fontSize,
        overflow: 'hidden',
      }}
    >
      {/* 头部：标题 + 操作 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CHROME.panelBorder}`,
        }}
      >
        <span style={{ fontWeight: 600 }}>文件工作台</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-fm-new-folder
          style={btnBase}
          onClick={() => {
            const name = window.prompt('新建文件夹名称:', '新文件夹');
            if (name && name.trim()) void createDirIn('', name.trim());
          }}
        >
          📁 新建文件夹
        </button>
        <button
          type="button"
          data-fm-new-doc
          style={{
            ...btnBase,
            borderColor: CHROME.neon,
            color: CHROME.neon,
          }}
          onClick={() => {
            setMenu(null);
            void createDocIn('');
          }}
        >
          ＋ 新建导图
        </button>
        <button
          type="button"
          data-fm-close
          style={btnBase}
          onClick={onClose}
        >
          关闭
        </button>
      </div>

      <StorageBar
        mounted={useWorkspace}
        name={workspace?.name ?? null}
        onPick={onPickWorkspace}
        onDetach={onDetachWorkspace}
      />

      <ViewTabs tab={tab} starredCount={starredKeys.size} onChange={setTab} />

      {/* 搜索：文件名 / 路径实时过滤 */}
      <div style={{ padding: '8px 12px' }}>
        <input
          data-fm-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文件名或路径…"
          style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* 面包屑 + 当前文档状态 */}
      <div
        data-fm-breadcrumb
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 12px 8px',
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.textMuted,
          flexWrap: 'wrap',
        }}
      >
        {useWorkspace && <span>📁 {workspace?.name}</span>}
        {breadcrumbOf(currentPath).map((seg, i) => (
          <span key={`${i}-${seg}`}>
            <span style={{ opacity: 0.6 }}> › </span>
            <span style={{ color: CHROME.text }}>{seg}</span>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span data-doc-status style={{ color: dirty ? CHROME.warn : CHROME.neon }}>
          {dirty ? '📝 未保存' : currentPath ? '🟢 本地磁盘已同步' : ''}
        </span>
      </div>

      {error && (
        <div
          style={{
            margin: '0 12px 8px',
            padding: '6px 8px',
            borderRadius: 6,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            fontSize: CHROME.fontSizeSmall,
          }}
        >
          {error}
        </div>
      )}

      {/* 树状 / 平铺内容区域 */}
      <div data-fm-tree style={{ overflow: 'auto', flex: 1, padding: '2px 0 8px' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: CHROME.textMuted }}>扫描中…</div>
        ) : tab === 'tree' ? (
          filtered.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
              {query !== '' ? `没有匹配「${query}」的文件。` : '还没有文档。点「＋ 新建导图」开始。'}
            </div>
          ) : (
            renderRows(filtered, 0)
          )
        ) : tab === 'recent' ? (
          recentDocs.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
              {query !== '' ? `没有匹配「${query}」的文件。` : '暂无最近打开的文档。'}
            </div>
          ) : (
            recentDocs.map((d) => (
              <FlatDocRow
                key={d.key}
                name={d.name}
                path={d.path}
                ts={d.ts}
                starred={starredKeys.has(d.fullPath) || starredKeys.has(d.key)}
                onToggleStar={(e) => toggleStar(d.fullPath || d.key, e)}
                onOpen={() =>
                  d.wsFile ? onOpenFile(d.wsFile) : d.entry ? onOpenEntry(d.entry) : undefined
                }
              />
            ))
          )
        ) : starredDocs.length === 0 ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
            {query !== '' ? `没有匹配「${query}」的收藏。` : '暂无收藏导图。在文档条目上点击 ☆ 即可加入收藏。'}
          </div>
        ) : (
          starredDocs.map((d) => (
            <FlatDocRow
              key={d.key}
              name={d.name}
              path={d.path}
              ts={d.ts}
              starred
              onToggleStar={(e) => toggleStar(d.fullPath || d.key, e)}
              onOpen={() =>
                d.wsFile ? onOpenFile(d.wsFile) : d.entry ? onOpenEntry(d.entry) : undefined
              }
            />
          ))
        )}
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderTop: `1px solid ${CHROME.panelBorder}`,
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.textMuted,
        }}
      >
        拖拽文件到 📁 文件夹即可归位 · 右键文件/文件夹可新建、重命名、删除
      </div>

      {/* 右键菜单 */}
      {menu && menuNode && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          isDir={menuNode.type === 'dir'}
          onClose={closeMenu}
          onNewDoc={() => void createDocIn(menuNode.type === 'dir' ? menuNode.fullPath : menuNode.path)}
          onNewDir={() => {
            closeMenu();
            const name = window.prompt('新文件夹名称', '新文件夹');
            if (name) void createDirIn(menuNode.type === 'dir' ? menuNode.fullPath : menuNode.path, name);
          }}
          onRename={() => {
            closeMenu();
            setRenamingKey(menu.key);
          }}
          onDelete={() => {
            closeMenu();
            void removeNode(menuNode);
          }}
        />
      )}
    </div>
  );
}

/** 供外部（MindmapStage）计算「移动到」候选目录 */
export { allDirs };
export { SEP };
export { NEW_DOC_TEMPLATE, formatRelative };
