/**
 * 边编辑浮窗 + 连线创建器（E7·紧凑化重设计）。
 * 设计原则（蒋指导反馈③）：264px 紧凑卡——placeholder 代替标签行、方向三态按钮、
 * 样式单行化、即时生效无保存按钮；from→to 一行弱化呈现。
 * - EdgeEditor：画布标注边（rel/dir/label/note/style/删除）
 * - TreeEdgeEditor：树自然线关系标注（note.edge 对象：rel 可选/label/note/style/清除）
 * - LinkCreator：新建连线（目标候选 + rel 模板 + dir + 样式）
 * 共享纯函数/样式/小组件已抽至 edgeEditorShared.tsx（A-D1）并在本文件显式 re-export；
 * collectNodeChoices / edge 数组纯函数：可测；写入统一经 updateNote（undo 继承）。
 */
import { useMemo, useState } from 'react';
import type { LinkDir } from '@mindcanvas/kernel';
import { useTheme } from '../theme/ThemeContext.js';
import type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
import { inferBowSide } from '../render/edgeRouting.js';
import {
  clampPos,
  closeBtn,
  DirToggle,
  headRow,
  inputStyle,
  POP_WIDTH,
  popStyle,
  REL_TEMPLATES,
  RoutingSideToggle,
  StyleRow,
  type NodeChoice,
  type TreeEdgeAnn,
} from './edgeEditorShared.js';
import { defaultRelationSchema } from './relationSchema.js';

export type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
export type { NodeChoice, TreeEdgeAnn } from './edgeEditorShared.js';
export {
  appendEdge,
  collectNodeChoices,
  EDGE_STYLE_PRESETS,
  edgesOf,
  findDuplicateEdge,
  mergeStyleAt,
  patchEdgeAt,
  REL_TEMPLATES,
  removeEdgeAt,
  RoutingSideToggle,
} from './edgeEditorShared.js';

/** EdgeEditor：画布标注边编辑（紧凑卡，即时生效） */
export function EdgeEditor({
  edge,
  x,
  y,
  currentD,
  onChange,
  onStyle,
  onInvalidate,
  onRestore,
  onDelete,
  onClose,
}: {
  edge: {
    key: string;
    index: number;
    rel: string;
    dir: LinkDir;
    from: string;
    to: string;
    label?: string;
    note?: string;
    style?: EdgeStyle;
    invalidAt?: string;
    /** 绕行侧（对标 markvault routingSide）；undefined = 自动 */
    routingSide?: 'left' | 'right';
  };
  x: number;
  y: number;
  /**
   * 当前这条边**实际渲染**的路径 d（由 FreeEdgeLayer 经 MapView 透传）。
   * Opp 按钮用它推断 auto 模式下算法实际选了哪一侧，才能精确翻到另一侧。
   */
  currentD?: string;
  onChange: (patch: Partial<DocEdge>) => void;
  onStyle: (patch: EdgeStyle) => void;
  onDelete: () => void;
  onInvalidate: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const { token } = useTheme();
  const invalidated = edge.invalidAt !== undefined;
  // Opp 一键反向：
  //   · routingSide 已设 → 翻转到另一侧（'left'↔'right'）
  //   · auto（未设）→ 用 inferBowSide 从当前实际渲染路径推断鼓向，再翻到另一侧。
  //     currentD 由上层把 FreeEdgeLayer 的真实路由结果透传而来（含跨边协调与 Line jumps），
  //     比"照抄一份路由逻辑重算"可靠 —— 后者会漏掉这些影响而与实际渲染不一致。
  //   · 极端兜底：拿不到 currentD 或路径是直线（推断为 auto）→ 落到 'right'，
  //     之后再点即正常 toggle（与既有行为一致，不会卡死）。
  const flipSide = () => {
    const inferred = edge.routingSide ?? (currentD ? inferBowSide(currentD) : 'auto');
    const opp: 'left' | 'right' = inferred === 'right' ? 'left' : 'right';
    onChange({ routingSide: opp });
  };
  return (
    <div
      data-edge-editor
      style={{ ...popStyle(), ...clampPos(x, y, POP_WIDTH, 250), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>
          编辑连线
        </span>
        {invalidated && (
          <span data-edge-invalidated style={{ fontSize: 10.5, color: token.color.textMuted }}>
            已失效 {edge.invalidAt!.slice(0, 10)}
          </span>
        )}
        <span
          style={{
            fontSize: 10.5,
            opacity: 0.55,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            direction: 'rtl',
          }}
        >
          {edge.from} → {edge.to}
        </span>
        <span data-edge-editor-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input
          data-edge-rel
          list="rel-templates"
          placeholder="关系类型"
          title="关系类型"
          value={edge.rel}
          onChange={(e) => onChange({ rel: e.target.value })}
          style={inputStyle}
        />
        <DirToggle value={edge.dir} onChange={(d) => onChange({ dir: d })} />
        <RoutingSideToggle
          value={edge.routingSide}
          onChange={(v) => onChange({ routingSide: v })}
        />
        <button
          data-edge-opp
          onClick={flipSide}
          title="Opp 一键反向：routingSide 已设则翻转，未设则从当前鼓向推断后翻到另一边"
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: token.color.textMuted,
            padding: '0 8px',
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          ⇆ Opp
        </button>
      </div>
      <datalist id="rel-templates">
        {REL_TEMPLATES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-edge-label
          placeholder="标签"
          value={edge.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          style={inputStyle}
        />
        <input
          data-edge-note
          placeholder="备注"
          value={edge.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={edge.style ?? {}} onStyle={onStyle} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {invalidated ? (
          <button
            data-edge-restore
            onClick={onRestore}
            style={{
              ...inputStyle,
              cursor: 'pointer',
              color: token.color.selection,
              borderColor: token.color.selection,
              flex: 1,
              fontSize: 11,
            }}
          >
            ↻ 恢复关系
          </button>
        ) : (
          <button
            data-edge-invalidate
            onClick={onInvalidate}
            style={{ ...inputStyle, cursor: 'pointer', fontSize: 11, opacity: 0.85, flex: 1 }}
          >
            失效（可恢复）
          </button>
        )}
        <button
          data-edge-delete
          onClick={onDelete}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: token.color.warn,
            borderColor: 'transparent',
            fontSize: 11,
            opacity: 0.85,
            flex: 1,
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}

/** TreeEdgeEditor：树自然线关系标注（note.edge 对象；rel 可选=无类型树边注脚） */
export function TreeEdgeEditor({
  childId,
  ann,
  viaLabel,
  x,
  y,
  onChange,
  onClose,
  onCut,
}: {
  childId: string;
  /** 结构化标注（note.edge）；null = 尚未标注（label 空白起步） */
  ann: TreeEdgeAnn | null;
  /** 旧版 via 字符串标签（兼容显示） */
  viaLabel: string;
  x: number;
  y: number;
  onChange: (ann: TreeEdgeAnn | undefined) => void;
  onClose: () => void;
  /** A5（G2）：切断并独立——B 子树移为文档根直接分支 + detached；缺省不显示（外部命令未接入时） */
  onCut?: (childId: string) => void;
}) {
  const { token } = useTheme();
  const [rel, setRel] = useState(ann?.rel ?? '');
  const [label, setLabel] = useState(ann?.label ?? viaLabel);
  const [note, setNote] = useState(ann?.note ?? '');
  const [style, setStyle] = useState<EdgeStyle>(ann?.style ?? {});
  const commit = (next: TreeEdgeAnn | undefined): void => {
    onChange(next);
    onClose();
  };
  const buildAnn = (): TreeEdgeAnn | undefined => {
    const out: TreeEdgeAnn = {};
    if (rel.trim()) out.rel = rel.trim();
    if (label.trim()) out.label = label.trim();
    if (note.trim()) out.note = note.trim();
    if (style.color) out.style = { ...out.style, color: style.color };
    if (style.dashed !== undefined) out.style = { ...out.style, dashed: style.dashed };
    if (style.width !== undefined) out.style = { ...out.style, width: style.width };
    if (out.style && Object.keys(out.style).length === 0) delete out.style;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  return (
    <div
      data-tree-edge-editor
      data-tree-edge-child={childId}
      style={{ ...popStyle(), ...clampPos(x, y, POP_WIDTH, 230), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>
          编辑连线内容
        </span>
        <span style={{ flex: 1 }} />
        <span data-tree-edge-editor-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-tree-edge-rel
          list="rel-templates-tree"
          placeholder="关系类型（可选）"
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          style={inputStyle}
        />
        <datalist id="rel-templates-tree">
          {REL_TEMPLATES.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-tree-edge-label
          placeholder="标签"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
        <input
          data-tree-edge-note
          placeholder="备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={style} onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          data-tree-edge-save
          onClick={() => commit(buildAnn())}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: token.color.selection,
            borderColor: token.color.selection,
            flex: 1,
          }}
        >
          保存
        </button>
        <button
          data-tree-edge-clear
          onClick={() => commit(undefined)}
          style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
        >
          清除
        </button>
      </div>
      {onCut && (
        <div style={{ marginTop: 6 }}>
          <button
            data-tree-edge-cut
            onClick={() => {
              onCut(childId);
              onClose();
            }}
            style={{
              ...inputStyle,
              width: '100%',
              cursor: 'pointer',
              color: '#e24b4a',
              borderColor: '#e24b4a',
            }}
            title="切断该父子树边：子分支移为文档根直接分支并独立摆放（可撤销）"
          >
            ✂ 切断并独立
          </button>
        </div>
      )}
    </div>
  );
}

/** LinkCreator：新建连线（源 = 右键节点；目标从候选选，rel 模板 + dir + 可选 label/note/样式） */
export function LinkCreator({
  choices,
  x,
  y,
  onCreate,
  onClose,
}: {
  choices: readonly NodeChoice[];
  x: number;
  y: number;
  onCreate: (edge: DocEdge) => void;
  onClose: () => void;
}) {
  const { token } = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<NodeChoice | null>(null);
  const [rel, setRel] = useState('relates-to');
  const [dir, setDir] = useState<LinkDir>('fwd');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [style, setStyle] = useState<EdgeStyle>({});
  const filtered = useMemo(
    () =>
      (query.trim() === '' ? choices : choices.filter((c) => c.label.includes(query.trim()))).slice(
        0,
        40,
      ),
    [choices, query],
  );
  const canCreate = picked !== null && rel.trim() !== '';
  return (
    <div
      data-link-creator
      style={{ ...popStyle(), width: 300, ...clampPos(x, y, 300, 400), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>连线到…</span>
        <span style={{ flex: 1 }} />
        <span data-link-creator-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      {!picked && (
        <>
          <input
            autoFocus
            data-link-query
            value={query}
            placeholder="搜索节点 / 实体…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <div data-link-choices style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
            {filtered.map((c) => (
              <div
                key={c.anchor}
                data-link-choice
                onClick={() => setPicked(c)}
                style={{
                  padding: '4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 11, opacity: 0.6, padding: 4 }}>无候选</div>
            )}
          </div>
        </>
      )}
      {picked && (
        <div
          data-link-target
          style={{
            marginBottom: 6,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.3)',
            fontSize: 12,
          }}
        >
          {picked.label}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input
          data-link-rel
          list="rel-templates-creator"
          placeholder="关系类型"
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          style={inputStyle}
        />
        <datalist id="rel-templates-creator">
          {defaultRelationSchema.activeOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </datalist>
        <DirToggle value={dir} onChange={setDir} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-link-label
          placeholder="标签"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
        <input
          data-link-note
          placeholder="备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={style} onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
      </div>
      <button
        data-link-create
        disabled={!canCreate}
        onClick={() => {
          if (!picked) return;
          onCreate({
            from: '',
            to: picked.anchor,
            rel: rel.trim(),
            ...(dir !== 'fwd' ? { dir } : {}),
            ...(label.trim() !== '' ? { label: label.trim() } : {}),
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
            ...(style.color || style.dashed || style.width !== undefined ? { style } : {}),
          });
        }}
        style={{
          ...inputStyle,
          cursor: canCreate ? 'pointer' : 'not-allowed',
          opacity: canCreate ? 1 : 0.45,
          color: token.color.selection,
          borderColor: token.color.selection,
        }}
      >
        创建连线
      </button>
    </div>
  );
}
