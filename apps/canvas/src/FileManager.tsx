/**
 * 文件管理器（文档库 UI）—— 历史文件列表 / 新建 / 分类（标签）管理。
 *
 * 数据来自 `DocLibrary`（localStorage 元数据索引）。
 *
 * 设计取舍：
 * - 分类用**标签**而非文件夹：一个文档可属多个分类，且不引入目录层级，
 *   与「.mm.md 是纯文本事实源」的定位一致（文件名即 id，不依赖路径）。
 * - 本组件只管**索引条目**（重命名/改标签/删除索引），
 *   **不删除磁盘文件** —— 删除是移除库内条目，源文件不受影响（UI 上已说明）。
 *
 * 不是什么：不做文件移动、不做云端同步、不改文件内容。
 */
import type { DocEntry } from '@mindcanvas/react';
import { CHROME, type DocLibrary, UNTAGGED } from '@mindcanvas/react';
import { type CSSProperties, useState } from 'react';

export interface FileManagerProps {
  library: DocLibrary;
  /** 打开某条（有源码快照可直接恢复；否则由调用方走重新选文件） */
  onOpen: (entry: DocEntry) => void;
  onCreate: () => void;
  onClose: () => void;
}

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
  const [filter, setFilter] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  // DocLibrary 是命令式的（localStorage 读写），改完手动触发一次重渲染
  const refresh = (): void => forceRender((n) => n + 1);

  const allTags = library.allTags();
  const entries = library.byTag(filter);

  const startRename = (id: string): void => {
    setEditingId(id);
    setEditingTags(null);
  };
  const startTagEdit = (id: string): void => {
    setEditingTags(id);
    setEditingId(null);
  };

  return (
    <div
      style={{
        width: 380,
        maxHeight: '70vh',
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
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CHROME.panelBorder}`,
        }}
      >
        <span style={{ fontWeight: 600, flex: 1 }}>文件管理</span>
        <button type="button" style={btnBase} onClick={onCreate}>
          新建
        </button>
        <button type="button" style={btnBase} onClick={onClose}>
          关闭
        </button>
      </div>

      {/* 分类筛选 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '10px 14px',
          borderBottom: `1px solid ${CHROME.panelBorder}`,
        }}
      >
        <FilterChip active={filter === null} onClick={() => setFilter(null)} label="全部" />
        {allTags.map((t) => (
          <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)} label={t} />
        ))}
        {allTags.length > 0 && (
          <FilterChip
            active={filter === UNTAGGED}
            onClick={() => setFilter(UNTAGGED)}
            label="未分类"
          />
        )}
      </div>

      {/* 列表 */}
      <div style={{ overflow: 'auto', padding: '6px 8px' }}>
        {entries.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: CHROME.textMuted }}>
            {filter === null ? '还没有文档，点「新建」开始' : '该分类下没有文档'}
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              style={{
                padding: '9px 8px',
                borderRadius: CHROME.radiusSmall,
                borderBottom: `1px solid ${CHROME.panelBorder}`,
              }}
            >
              {editingId === e.id ? (
                <input
                  autoFocus
                  defaultValue={e.name}
                  onBlur={(ev) => {
                    const v = ev.target.value.trim();
                    if (v) library.rename(e.id, v);
                    setEditingId(null);
                    refresh();
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') ev.currentTarget.blur();
                    if (ev.key === 'Escape') setEditingId(null);
                  }}
                  style={{
                    width: '100%',
                    background: CHROME.panelBg,
                    border: `1px solid ${CHROME.panelBorderStrong}`,
                    borderRadius: 6,
                    color: CHROME.text,
                    padding: '5px 8px',
                    fontFamily: CHROME.fontFamily,
                    fontSize: CHROME.fontSize,
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  style={{
                    display: 'block',
                    width: '100%',
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
                      （需重新选文件）
                    </span>
                  )}
                </button>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 5,
                  fontSize: CHROME.fontSizeSmall,
                  color: CHROME.textMuted,
                }}
              >
                <span>{formatRelative(e.ts)}</span>
                {editingTags === e.id ? (
                  <input
                    autoFocus
                    defaultValue={e.tags.join(', ')}
                    placeholder="标签，逗号分隔"
                    onBlur={(ev) => {
                      library.setTags(e.id, ev.target.value.split(/[,，]/));
                      setEditingTags(null);
                      refresh();
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') ev.currentTarget.blur();
                      if (ev.key === 'Escape') setEditingTags(null);
                    }}
                    style={{
                      flex: 1,
                      background: CHROME.panelBg,
                      border: `1px solid ${CHROME.panelBorderStrong}`,
                      borderRadius: 6,
                      color: CHROME.text,
                      padding: '3px 7px',
                      fontFamily: CHROME.fontFamily,
                      fontSize: CHROME.fontSizeSmall,
                    }}
                  />
                ) : (
                  <>
                    {e.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          padding: '1px 7px',
                          borderRadius: 9,
                          background: CHROME.neonSoft,
                          color: CHROME.neon,
                        }}
                      >
                        {t}
                      </span>
                    ))}
                    <span style={{ flex: 1 }} />
                    <button type="button" style={iconBtn} onClick={() => startRename(e.id)}>
                      重命名
                    </button>
                    <button type="button" style={iconBtn} onClick={() => startTagEdit(e.id)}>
                      分类
                    </button>
                    <button
                      type="button"
                      style={iconBtn}
                      onClick={() => {
                        // 只移除库内索引，不碰磁盘文件——二次确认避免误删
                        if (
                          window.confirm(`从列表中移除「${e.name}」？\n（不会删除磁盘上的文件）`)
                        ) {
                          library.remove(e.id);
                          refresh();
                        }
                      }}
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const iconBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: CHROME.textMuted,
  cursor: 'pointer',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  padding: '1px 3px',
};

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...btnBase,
        padding: '3px 10px',
        borderColor: active ? CHROME.panelBorderStrong : CHROME.panelBorder,
        background: active ? CHROME.neonSoft : CHROME.panelBg,
        color: active ? CHROME.neon : CHROME.text,
      }}
    >
      {label}
    </button>
  );
}
