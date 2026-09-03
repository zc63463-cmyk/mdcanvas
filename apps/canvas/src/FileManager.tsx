/**
 * 文件管理器（目录树）—— 按目录层级列出思维导图入口，点击即切换。
 *
 * 与「标签筛选」的区别：这是**树**，不是扁平列表。
 * 每个文档归属于一个目录路径（`folder`，`/` 分隔层级），
 * 树按路径逐级展开，文档作为叶子节点，点一下就切过去。
 *
 * 数据来自 `DocLibrary`（localStorage 元数据索引）。
 *
 * 不是什么：不移动/删除磁盘文件——「移除」只删库内索引条目。
 */
import { CHROME, DocLibrary, type DocEntry } from '@mindcanvas/react';
import { useState, type CSSProperties } from 'react';

export interface FileManagerProps {
  library: DocLibrary;
  /** 点击某个导图入口 → 切换到它 */
  onOpen: (entry: DocEntry) => void;
  onCreate: () => void;
  onClose: () => void;
}

const SEP = '/';

const btnBase: CSSProperties = {
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  background: CHROME.panelBg,
  color: CHROME.text,
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  padding: '5px 10px',
  cursor: 'pointer',
};

const iconBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: CHROME.textMuted,
  cursor: 'pointer',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  padding: '1px 4px',
};

const inputStyle: CSSProperties = {
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorderStrong}`,
  borderRadius: 6,
  color: CHROME.text,
  padding: '4px 8px',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function FileManager({ library, onOpen, onCreate, onClose }: FileManagerProps) {
  // 默认展开根目录，其余按需展开
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  // DocLibrary 是命令式的（localStorage 读写），改完手动触发重渲染
  const refresh = (): void => forceRender((n) => n + 1);

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const total = library.list().length;

  /** 递归渲染一层：先子目录，再直属文档 */
  const renderLevel = (path: string, depth: number) => {
    const { dirs, docs } = library.childrenOf(path);
    const pad = 8 + depth * 14;

    return (
      <>
        {dirs.map((d) => {
          const childPath = path === '' ? d : `${path}${SEP}${d}`;
          const open = expanded.has(childPath);
          return (
            <div key={`dir-${childPath}`}>
              <button
                type="button"
                onClick={() => toggle(childPath)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: CHROME.text,
                  cursor: 'pointer',
                  fontFamily: CHROME.fontFamily,
                  fontSize: CHROME.fontSize,
                  padding: `5px 8px 5px ${pad}px`,
                }}
              >
                <span style={{ color: CHROME.textMuted }}>{open ? '▾' : '▸'}</span>
                <span>{d}</span>
              </button>
              {open && renderLevel(childPath, depth + 1)}
            </div>
          );
        })}

        {docs.map((e) => {
          const busy = renamingId === e.id || movingId === e.id;
          return (
            <div key={`doc-${e.id}`} style={{ paddingLeft: pad + 14 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                }}
              >
                {renamingId === e.id ? (
                  <input
                    autoFocus
                    defaultValue={e.name}
                    onBlur={(ev) => {
                      const v = ev.target.value.trim();
                      if (v) library.rename(e.id, v);
                      setRenamingId(null);
                      refresh();
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') ev.currentTarget.blur();
                      if (ev.key === 'Escape') setRenamingId(null);
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      title={
                        e.source === undefined
                          ? '源码快照已过期，打开时需重新选文件'
                          : '切换到这个导图'
                      }
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        color: CHROME.text,
                        cursor: 'pointer',
                        fontFamily: CHROME.fontFamily,
                        fontSize: CHROME.fontSize,
                        padding: 0,
                      }}
                    >
                      {e.name}
                      {e.source === undefined && (
                        <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
                          {' '}
                          ↻
                        </span>
                      )}
                    </button>
                    <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                      {formatRelative(e.ts)}
                    </span>
                  </>
                )}
              </div>

              {movingId === e.id && (
                <div style={{ padding: '2px 8px 4px' }}>
                  <input
                    autoFocus
                    defaultValue={e.folder}
                    placeholder="目录路径，如 工作/项目A"
                    onBlur={(ev) => {
                      library.move(e.id, ev.target.value);
                      setMovingId(null);
                      refresh();
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') ev.currentTarget.blur();
                      if (ev.key === 'Escape') setMovingId(null);
                    }}
                    style={{ ...inputStyle, width: '100%' }}
                  />
                </div>
              )}

              {!busy && (
                <div style={{ display: 'flex', gap: 2, paddingLeft: 8 }}>
                  <button type="button" style={iconBtn} onClick={() => setRenamingId(e.id)}>
                    重命名
                  </button>
                  <button type="button" style={iconBtn} onClick={() => setMovingId(e.id)}>
                    移到…
                  </button>
                  <button
                    type="button"
                    style={iconBtn}
                    onClick={() => {
                      if (window.confirm(`从列表中移除「${e.name}」？\n（不会删除磁盘上的文件）`)) {
                        library.remove(e.id);
                        refresh();
                      }
                    }}
                  >
                    移除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div
      style={{
        width: 420,
        maxHeight: '72vh',
        display: 'flex',
        flexDirection: 'column',
        background: CHROME.bg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        fontSize: CHROME.fontSize,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CHROME.panelBorder}`,
        }}
      >
        <span style={{ fontWeight: 600, flex: 1 }}>思维导图目录</span>
        <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>{total} 个</span>
        <button type="button" style={btnBase} onClick={onCreate}>
          新建
        </button>
        <button type="button" style={btnBase} onClick={onClose}>
          关闭
        </button>
      </div>

      <div style={{ overflow: 'auto', padding: '6px 0' }}>
        {total === 0 ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
            还没有文档。点「新建」，或先保存一个文档它就会出现在这里。
          </div>
        ) : (
          renderLevel('', 0)
        )}
      </div>

      <div
        style={{
          padding: '8px 14px',
          borderTop: `1px solid ${CHROME.panelBorder}`,
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.textMuted,
        }}
      >
        点击文档名切换导图 · 「移到…」填目录路径（如 工作/项目A）即可归组
      </div>
    </div>
  );
}
