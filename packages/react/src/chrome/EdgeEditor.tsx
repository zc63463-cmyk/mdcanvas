/**
 * 边编辑浮窗 + 连线创建器（E7·紧凑化重设计）。
 * 设计原则（蒋指导反馈③）：264px 紧凑卡——placeholder 代替标签行、方向三态按钮、
 * 样式单行化、即时生效无保存按钮；from→to 一行弱化呈现。
 * - EdgeEditor：画布标注边（rel/dir/label/note/style/删除）
 * - TreeEdgeEditor：树自然线关系标注（note.edge 对象：rel 可选/label/note/style/清除）
 * - LinkCreator：新建连线（目标候选 + rel 模板 + dir + 样式）
 * - collectNodeChoices / edge 数组纯函数：可测；写入统一经 updateNote（undo 继承）
 */
import { useMemo, useState } from 'react';
import type { EditableNode, LinkDir } from '@mindcanvas/kernel';
import type { Note } from '@mindcanvas/kernel';
import { useTheme } from '../theme/ThemeContext.js';
import type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
import { collectEntityOccurrences } from '../render/freeEdges.js';
import { inferBowSide } from '../render/edgeRouting.js';
import { defaultRelationSchema } from './relationSchema.js';

export type { DocEdge, EdgeStyle } from '../render/freeEdges.js';

/** rel 快捷模板（开放字符串；语义默认色由 relVisualOf 提供） */
export const REL_TEMPLATES: readonly string[] = ['blocks', 'causes', 'relates-to', 'duplicates'];

/** 树自然线关系标注（子节点 note.edge 对象；树方向天然 parent→child，无 dir） */
export interface TreeEdgeAnn {
  rel?: string;
  label?: string;
  note?: string;
  style?: EdgeStyle;
}

/** 节点候选（连线目标）：带会话内 id + 稳定锚 */
export interface NodeChoice {
  id: string;
  label: string;
  anchor: string;
}

function anchorName(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

/** 遍历树生成目标候选（根除外）
 *  E8：与 anchorOfNode 保持同一套消歧规则——同一实体多次出现时，第 2 次起锚加 `#N`，
 *  否则下拉里两个同名实体产出相同锚 → 建边后错锚到首个出现处。 */
export function collectNodeChoices(root: EditableNode): NodeChoice[] {
  const out: NodeChoice[] = [];
  // 与 anchorOfNode 同一套规则：先统计同名实体出现数，多次出现则全部带 #N
  const occurrences = collectEntityOccurrences(root);
  const walk = (n: EditableNode, path: string[]): void => {
    const name = anchorName(n);
    // 空名节点不占路径段但【仍须下钻】——与 anchorOfNode / 内核 effectiveChildren 三方对齐，
    // 否则清空某节点文字后其整棵子树从候选里消失
    const nextPath = name === '' ? path : [...path, name];
    if (name !== '' && nextPath.length > 1) {
      if (n.type === 'entity') {
        const list = occurrences.get(name);
        const anchor = list && list.length > 1 ? `${name}#${list.indexOf(n.id) + 1}` : name;
        out.push({ id: n.id, label: nextPath.join(' / '), anchor });
      } else {
        out.push({ id: n.id, label: nextPath.join(' / '), anchor: `node:${nextPath.join('/')}` });
      }
    }
    for (const c of n.children) walk(c, nextPath);
  };
  walk(root, []);
  return out;
}

/** edges 数组操作（root note.edges 原始数组；不可变） */
export function appendEdge(edges: unknown, edge: DocEdge): DocEdge[] {
  return [...(Array.isArray(edges) ? (edges as DocEdge[]) : []), edge];
}

export function patchEdgeAt(edges: unknown, index: number, patch: Partial<DocEdge>): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

/** 样式补丁（style 内层合并；patch 中显式 undefined = 清除该属性，全空 → 移除 style 键） */
export function mergeStyleAt(edges: unknown, index: number, style: EdgeStyle): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.map((e, i) => {
    if (i !== index) return e;
    const nextStyle: EdgeStyle = { ...(e.style ?? {}) };
    // 遍历 patch 键：显式 undefined = 清除（区分「未提供」与「清除」——否则默认按钮/取消虚线失效）
    for (const [k, v] of Object.entries(style)) {
      if (v === undefined) delete (nextStyle as Record<string, unknown>)[k];
      else (nextStyle as Record<string, unknown>)[k] = v;
    }
    const rest: DocEdge = { ...e };
    if (Object.keys(nextStyle).length === 0) delete rest.style;
    else rest.style = nextStyle;
    return rest;
  });
}

/** 查重：同 from+to+rel 的边已存在 → 返回其 index（防重叠双线） */
export function findDuplicateEdge(
  edges: unknown,
  edge: Pick<DocEdge, 'from' | 'to' | 'rel'>,
): number {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.findIndex((e) => e.from === edge.from && e.to === edge.to && e.rel === edge.rel);
}

export function removeEdgeAt(edges: unknown, index: number): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.filter((_, i) => i !== index);
}

/** 从 note 中取 edges 原始数组 */
export function edgesOf(note: Note | undefined): DocEdge[] {
  const raw = note?.edges;
  return Array.isArray(raw) ? (raw as DocEdge[]) : [];
}

// ---------- 紧凑样式系统（E7：264px、placeholder 代替标签行、单行化） ----------

const POP_WIDTH = 264;

const popStyle = () => ({
  position: 'fixed' as const,
  width: POP_WIDTH,
  background: 'rgba(22,24,29,0.92)',
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  backdropFilter: 'blur(14px) saturate(1.3)',
  padding: 10,
  zIndex: 40,
  fontFamily: 'inherit',
});

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '4px 7px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
} as const;

const headRow = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } as const;
const closeBtn = { cursor: 'pointer', opacity: 0.6, fontSize: 14, lineHeight: 1 } as const;

/** 方向三态按钮（→ ← ↔；替代 select——一眼可读） */
function DirToggle({ value, onChange }: { value: LinkDir; onChange: (d: LinkDir) => void }) {
  const { token } = useTheme();
  const opts: Array<{ v: LinkDir; t: string; title: string }> = [
    { v: 'fwd', t: '→', title: '源 → 目标' },
    { v: 'back', t: '←', title: '目标 → 源' },
    { v: 'both', t: '↔', title: '双向' },
  ];
  return (
    <div data-dir-toggle style={{ display: 'flex', gap: 2, flex: 'none' }}>
      {opts.map((o) => (
        <button
          key={o.v}
          data-dir-opt={o.v}
          title={o.title}
          onClick={() => onChange(o.v)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border:
              '1px solid ' + (value === o.v ? token.color.selection : 'rgba(128,128,128,0.3)'),
            background: 'transparent',
            color: value === o.v ? token.color.selection : 'inherit',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

/**
 * 绕行侧三态切换：自动 / 绕左 / 绕右（对标 markvault-js routingSide）。
 *
 * 与 manual（精确几何锁定）的区别：routingSide 只定**方向**，曲率仍由算法在该侧内择优。
 * 未指定（auto）时由美学评分自动决定。
 */
export function RoutingSideToggle({
  value,
  onChange,
}: {
  value?: 'left' | 'right';
  onChange: (v: 'left' | 'right' | undefined) => void;
}) {
  const { token } = useTheme();
  const opts: Array<{ v: 'left' | 'right' | undefined; t: string; title: string }> = [
    { v: undefined, t: 'A', title: '自动（由美学评分决定绕行侧）' },
    { v: 'left', t: '↰', title: '绕左' },
    { v: 'right', t: '↱', title: '绕右' },
  ];
  return (
    <div data-routing-side-toggle style={{ display: 'flex', gap: 2, flex: 'none' }}>
      {opts.map((o) => (
        <button
          key={o.v ?? 'auto'}
          data-routing-side-opt={o.v ?? 'auto'}
          title={o.title}
          onClick={() => onChange(o.v)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border:
              '1px solid ' + (value === o.v ? token.color.selection : 'rgba(128,128,128,0.3)'),
            background: 'transparent',
            color: value === o.v ? token.color.selection : 'inherit',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

/** 样式单行：默认 + 色板 + 虚线 + 粗细（E7 单行化） */
function StyleRow({ style, onStyle }: { style: EdgeStyle; onStyle: (patch: EdgeStyle) => void }) {
  const presets = EDGE_STYLE_PRESETS;
  return (
    <div data-edge-style style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        data-style-default
        title="默认（跟随关系类型语义色）"
        onClick={() => onStyle({ color: undefined })}
        style={{
          ...inputStyle,
          width: 'auto',
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: 11,
          opacity: style.color ? 0.6 : 1,
        }}
      >
        默认
      </button>
      {presets.map((p) => (
        <button
          key={p.color}
          data-style-color={p.color}
          title={p.label}
          onClick={() => onStyle({ color: p.color })}
          style={{
            width: 15,
            height: 15,
            borderRadius: '50%',
            border: style.color === p.color ? '2px solid #fff' : '1px solid rgba(128,128,128,0.4)',
            background: p.color,
            cursor: 'pointer',
            padding: 0,
            flex: 'none',
          }}
        />
      ))}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          cursor: 'pointer',
          marginLeft: 2,
        }}
      >
        <input
          type="checkbox"
          data-style-dashed
          checked={style.dashed ?? false}
          onChange={(e) => onStyle({ dashed: e.target.checked || undefined })}
        />
        虚线
      </label>
      <select
        data-style-width
        value={style.width ?? ''}
        onChange={(e) =>
          onStyle({ width: e.target.value === '' ? undefined : Number(e.target.value) })
        }
        style={{ ...inputStyle, width: 58, cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
      >
        <option value="">粗细</option>
        <option value={1}>细</option>
        <option value={2}>中</option>
        <option value={3}>粗</option>
      </select>
    </div>
  );
}

/** 预设样式色板（跨主题醒目色） */
export const EDGE_STYLE_PRESETS: readonly { label: string; color: string }[] = [
  { label: '红', color: '#e24b4a' },
  { label: '琥珀', color: '#ef9f27' },
  { label: '绿', color: '#10b981' },
  { label: '青', color: '#0891b2' },
  { label: '蓝', color: '#378add' },
  { label: '紫', color: '#7f77dd' },
];

function clampPos(x: number, y: number, w: number, h: number): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
  };
}

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
