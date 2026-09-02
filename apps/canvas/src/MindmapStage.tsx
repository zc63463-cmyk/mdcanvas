/**
 * MindmapStage：apps/canvas 组合入口（= kernel 数据管线 + react 渲染器 + chrome 壳 + 编辑器闭环）。
 * - 编辑器：EditorController（全部编辑经 TreeOp + OpHistory），useEditor 驱动重渲
 * - 快捷键：6 个必做 + 保存（Ctrl+S）+ 折叠（Space）——经 matchEditorKey 分发
 * - 玻璃 chrome 恒定（K3 决策 3）；性能面板消费 MapView stats
 */

import type { EditableNode, Entity } from '@mindcanvas/kernel';
import { LayoutCache, REGISTERED_KINDS, refKey } from '@mindcanvas/kernel';
import type {
  AssetHost,
  AssetItem,
  DocEdge,
  DocumentHost,
  EdgeManual,
  EdgeRouteEntry,
  EdgeStyle,
  FreeEdge,
  FsFileSystemWindow,
  MapStats,
  MindDoc,
  TreeEdgeAnn,
} from '@mindcanvas/react';
import {
  AssetPanel,
  anchorOfNode,
  appendEdge,
  assetDiagnostics,
  buildEditable,
  buildEntities,
  CHROME,
  ContextMenu,
  collapsedAncestors,
  collectEntityRelations,
  collectFreeEdges,
  collectNodeChoices,
  contextMenuItemsFor,
  createCharMeasure,
  createReactRegistries,
  DemoAssetHost,
  DemoPlugin,
  EdgeEditor,
  EditorController,
  EntityGraphPanel,
  EntityPicker,
  edgesOf,
  exportPng,
  exportSvg,
  FlipCard,
  findDuplicateEdge,
  formatNote,
  getNodeLabel,
  installBeforeUnload,
  isEscapedEntityInput,
  isMindDocFile,
  LinkCreator,
  LocalDocHost,
  LocalEntityStore,
  layoutDemo,
  MapView,
  matchEditorKey,
  mergeStyleAt,
  OutlinePanel,
  PluginHost,
  patchEdgeAt,
  QaEditor,
  removeEdgeAt,
  SearchPanel,
  ShortcutHelpPanel,
  scaleNoticeFor,
  searchMind,
  ThemeProvider,
  ThemeSwitcher,
  TreeEdgeEditor,
  unescapeEntityInput,
  useEditor,
  useTheme,
} from '@mindcanvas/react';
import {
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import gatewaySource from './demo/gateway.mm.md?raw';
import { useDocumentActions } from './hooks/useDocumentActions.js';
import { useExportActions } from './hooks/useExportActions.js';
import { PerfPanel } from './PerfPanel.js';
import { SidePanels } from './SidePanels.js';
import { StartupScreen } from './StartupScreen.js';

/** gateway 实体标题表（缺口 → unresolved 演示；同 gateway.mm.md refs） */
const GATEWAY_TITLES: Record<string, { title: string; status?: string }> = {
  'doc:docs/01-architecture.md': { title: '01 · 架构设计', status: 'published' },
  'doc:docs/07-entity-ref-protocol.md': { title: '07 · 实体引用协议', status: 'published' },
  'doc:docs/09-knowledge-canvas-and-conventions.md': {
    title: '09 · 知识画布与约定',
    status: 'published',
  },
  'issue:1': { title: '门户显示优化', status: 'open' },
  'issue:6': { title: '解析链路验证', status: 'open' },
  'issue:8': { title: 'K3 渲染层', status: 'open' },
  'milestone:门户显示优化': { title: '门户显示优化里程碑', status: 'open' },
  'idea:forge-inbox:2': { title: '灵感：只读先行', status: 'open' },
  'img:demo-assets/demo-diagram.svg': { title: '演示架构图', status: 'ready' },
  'draw:demo-assets/board.svg': { title: '白板草稿', status: 'ready' },
};

/** 图库资产清单（P0 起由资产宿主注入：首期 = 打包 demo 资产；真实 FS/HTTP 宿主属宿主实现） */
const DEMO_ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

/** 折叠状态持久化 key（localStorage；v2 = 路径制，v1 为 id 制已弃用） */
const COLLAPSE_KEY = 'mindcanvas.collapsed.v2';

function StageInner() {
  const { token } = useTheme();
  const [stats, setStats] = useState<MapStats | null>(null);
  const [pluginActive, setPluginActive] = useState(false);
  const apiRef = useRef<MapViewApi | null>(null);

  // 六注册表（T3 实装）+ 插件宿主：组合点 = kernel + [plugins]
  const regs = useMemo(() => createReactRegistries(), []);
  const hostRef = useRef<PluginHost | null>(null);
  if (hostRef.current === null) hostRef.current = new PluginHost();
  const host = hostRef.current;

  // 挂载样例插件（T5 演示组合能力）；卸载时自注销 + 清理 DOM
  useEffect(() => {
    const demo = new DemoPlugin(regs);
    void host.load(demo).then(() => setPluginActive(true));
    return () => {
      void host.unload(demo).then(() => setPluginActive(false));
    };
  }, [regs, host]);

  // ---------- B1 多文档：文档宿主 + 当前文档（初始 = 内置 gateway 快照） ----------
  const docHostRef = useRef<DocumentHost | null>(null);
  if (docHostRef.current === null) docHostRef.current = new LocalDocHost();
  const docHost = docHostRef.current;
  const [doc, setDoc] = useState<MindDoc>(() => ({
    ...docHost.create('gateway.mm.md', gatewaySource),
    saved: true,
  }));
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 数据管线：parseMm → astToEditable → entities（T3；B1：随当前文档 source 重解析）
  // entities 为 state：图库插入 @img/@draw 引用后动态扩展（key = `${kind}:${id}`）
  const data = useMemo(() => buildEditable(doc.source), [doc.source]);
  const { editable, refs } = data;
  const [entities, setEntities] = useState<Map<string, Entity>>(() =>
    buildEntities(refs, GATEWAY_TITLES),
  );

  // 编辑器：controller 随初始树创建一次；所有编辑经 controller（TreeOp）
  // 折叠持久化：localStorage（key 按 demo 文件定名；打开新文件时 controller.reset 清空写回）
  const controllerRef = useRef<EditorController | null>(null);
  if (controllerRef.current === null && editable) {
    controllerRef.current = new EditorController(editable, {
      storage: {
        load: () => {
          try {
            return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as number[][];
          } catch {
            return [];
          }
        },
        save: (paths) => localStorage.setItem(COLLAPSE_KEY, JSON.stringify(paths)),
      },
    });
  }
  const controller = useEditor(controllerRef.current ?? (null as unknown as EditorController));
  // ⚠️ 已知违反 React Hooks 规则（早退位于 Hook 之前）—— biome useHookAtTopLevel 已降级为 warn。
  //
  // 为什么保留早退：controller **确实可能为 null** —— 见上方 151 行
  // `if (controllerRef.current === null && editable)`，当数据管线解析失败（editable 为 null）时
  // controller 即为 null。此时若继续往下执行，后续 31 处 Hook（如 481 行 useMemo 读
  // `controller.root`、647 行 `controller.dirty`）会直接 TypeError → 白屏崩溃。
  // 早退在此处可让页面降级为空白，而非抛错。
  //
  // 正确修复（P2，需重构）：把 StageInner 拆成「数据加载层」+「渲染层」两个组件——
  // 外层在 editable/controller 为 null 时直接返回错误提示，内层接收**非 null** 的
  // controller 后，所有 Hook 无条件调用。这是 React 官方推荐的解法。

  // ---------- S2 启动页：有最近文档时先进入口，而非直接打开内置示例 ----------
  // 初值只算一次：有最近文档 → 显示启动页；没有（全新用户）→ 沿用内置示例。
  const [showStartup, setShowStartup] = useState(() => docHost.recent().length > 0);

  // 启动页优先于其它分支：它不读画布状态，controller 是否就绪都无关。
  // 放在全部 Hook 之后（useState 是最后一个 Hook），Hook 调用数恒定。
  if (showStartup) {
    return (
      <StartupScreen
        recent={docHost.recent()}
        onOpenRecent={(d) => {
          setDoc(d);
          docHost.remember(d); // 刷新 ts，下次启动仍是它排第一
          setShowStartup(false);
        }}
        onNew={() => {
          setDoc(docHost.create('未命名.mm.md', '# 未命名\n'));
          setShowStartup(false);
        }}
        onUseSample={() => setShowStartup(false)}
      />
    );
  }

  // 解析失败降级：controller 为 null 说明数据管线解析失败（editable 为 null）。
  // 此早退位于本组件全部 Hook 之后，Hook 调用数恒定 —— 符合 React Hooks 规则（ADR-0007）。
  // 渲染层 StageContent 接收非 null 的 controller，其内 21 个 Hook 得以无条件调用。
  if (!controller) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, marginBottom: 8 }}>文档解析失败</div>
          <div style={{ fontSize: 12, color: CHROME.textMuted }}>
            {doc.name} 无法解析为可编辑树，请检查 .mm.md 语法。
          </div>
        </div>
      </div>
    );
  }

  return (
    <StageContent
      token={token}
      stats={stats}
      setStats={setStats}
      pluginActive={pluginActive}
      apiRef={apiRef}
      docHost={docHost}
      doc={doc}
      setDoc={setDoc}
      docMenuOpen={docMenuOpen}
      setDocMenuOpen={setDocMenuOpen}
      fileInputRef={fileInputRef}
      data={data}
      editable={editable}
      refs={refs}
      entities={entities}
      setEntities={setEntities}
      controllerRef={controllerRef}
      controller={controller}
    />
  );
}

/** 数据管线的返回形态（避免引入新导入） */
type EditableData = ReturnType<typeof buildEditable>;

interface StageContentProps {
  token: ReturnType<typeof useTheme>['token'];
  stats: MapStats | null;
  setStats: Dispatch<SetStateAction<MapStats | null>>;
  pluginActive: boolean;
  apiRef: RefObject<MapViewApi | null>;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  docMenuOpen: boolean;
  setDocMenuOpen: Dispatch<SetStateAction<boolean>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  data: EditableData;
  editable: EditableData['editable'];
  refs: EditableData['refs'];
  entities: Map<string, Entity>;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  controllerRef: RefObject<EditorController | null>;
  /** 非 null —— 由 StageInner 早退保证 */
  controller: EditorController;
}

/**
 * StageContent —— 渲染层（ADR-0007）。
 *
 * 从 StageInner 拆出：接收**非 null** 的 controller，其后所有 Hook 无条件调用，
 * 消除原先「早退位于 Hook 中间」导致的 21 处 useHookAtTopLevel 违规。
 * 本组件内仍保留 `if (!layout) return null`，但它位于全部 Hook 之后（合规）。
 */
function StageContent({
  token,
  stats,
  setStats,
  pluginActive,
  apiRef,
  docHost,
  doc,
  setDoc,
  docMenuOpen,
  setDocMenuOpen,
  fileInputRef,
  data,
  editable,
  refs,
  entities,
  setEntities,
  controllerRef,
  controller,
}: StageContentProps) {
  // B1 文档切换：新 source → controller.reset（清 history/折叠/选中）+ 实体表重建 + 展开收起 + 适配视图
  // 首挂跳过（controller 首次创建 + MapView 初始 fit 已处理；避免重复动画）
  const firstDocEffectRef = useRef(true);
  useEffect(() => {
    if (!editable) return;
    const isFirst = firstDocEffectRef.current;
    firstDocEffectRef.current = false;
    // N1：文档内实体引用登记进候选宿主（首挂与切换都登记 → 跨文档可复用）
    entityHost.remember(
      refs
        .filter((r) => r.kind !== 'img' && r.kind !== 'draw')
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          title: entities.get(`${r.kind}:${r.id}`)?.title ?? null,
        })),
      doc.name,
    );
    if (isFirst) return;
    controllerRef.current?.reset(editable);
    setEntities(buildEntities(refs, GATEWAY_TITLES));
    setExpandedQaId(null);
    apiRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.source]);

  // GH-T2：折叠定位自动展开（F1 边界）——定位前展开目标祖先折叠，避免 focusNode no-op
  const focusNode = (id: string): void => {
    for (const a of collapsedAncestors(controller.root, controller.collapsed, id))
      controller.setCollapsed(a, false);
    controller.select(id);
    apiRef.current?.focusNode(id);
  };

  // 文档操作（打开/新建/保存/另存为）与导出已抽至 hooks/：
  //   useDocumentActions —— 依赖 autoSaveTimer，在其定义之后调用（见下）
  //   useExportActions   —— 依赖 layout，在 layout 之后调用（见下）
  // GH-T4：全图 SVG 导出（下载 .svg；主题令牌保持）

  // GH-T3：自动保存（debounce 300ms；仅已落盘文档；手动 Ctrl+S 取消 pending；失败静默由手动保存兜底）
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 文档操作（打开/新建/保存/另存为）—— 依赖 autoSaveTimer，故在其定义之后调用
  const { applyDoc, handleOpen, handleNew, handleSave, handleSaveAs } = useDocumentActions({
    controller,
    docHost,
    doc,
    setDoc,
    fileInputRef,
    autoSaveTimer,
  });

  useEffect(() => {
    if (!controller.dirty || !doc.saved || !doc.handle) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      const source = controller.serialize();
      void docHost.save({ ...doc, source }).then((r) => {
        if (r !== 'cancelled') {
          setDoc((d) => ({ ...d, source, ts: Date.now() }));
          controller.markSaved();
        }
      });
    }, 300);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.dirty, doc.saved, doc.id]);

  // 选中节点：单一来源 = controller.selectedId + 从当前树取节点（编辑后引用自动刷新，
  // 避免点选时的快照引用陈旧导致 QaEditor/QuickCommentPanel 读不到新 note）
  const selected =
    controller.selectedId !== null ? nodeById(controller.root, controller.selectedId) : null;

  // F1：实体关系数据（随树/实体表自动刷新）+ 画布选中实体 → 面板高亮联动
  const relations = useMemo(
    () => collectEntityRelations(controller.root, entities),
    [controller.root, entities],
  );
  const activeRefKey = selected?.type === 'entity' && selected.ref ? refKey(selected.ref) : null;

  // M1 实体 picker：{ 目标节点, 查询串, 当前引用（编辑既有实体） }；null = 关闭
  const [picker, setPicker] = useState<{
    nodeId: string;
    query: string;
    current: { kind: string; id: string } | null;
  } | null>(null);
  // 候选：当前文档实体（优先，文档内最新为准）+ 历史候选（N1 store，跨文档复用）；
  // 资产类走图库，不进 picker
  const entityHostRef = useRef<LocalEntityStore | null>(null);
  if (entityHostRef.current === null) entityHostRef.current = new LocalEntityStore();
  const entityHost = entityHostRef.current;
  const entityCandidates = useMemo(() => {
    const merged = new Map<string, { kind: string; id: string; title: string }>();
    for (const e of entities.values()) {
      if (e.kind === 'img' || e.kind === 'draw') continue;
      merged.set(`${e.kind}:${e.id}`, { kind: e.kind, id: e.id, title: e.title ?? e.id });
    }
    for (const r of entityHost.list()) {
      const key = `${r.kind}:${r.id}`;
      if (!merged.has(key)) merged.set(key, { kind: r.kind, id: r.id, title: r.title });
    }
    return [...merged.values()];
  }, [entities, entityHost]);
  const pickKinds = useMemo(() => REGISTERED_KINDS.filter((k) => k !== 'img' && k !== 'draw'), []);

  // 展开态节点 id（快速注释"生长"：单一展开；点击有 qa 节点展开，再点/×/其他节点收起）
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);

  // 批次 2：? 快捷键帮助面板 + 节点右键菜单（{ 节点, 屏幕坐标 }；null = 关闭）
  const [helpOpen, setHelpOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  // v1.3.0 幕布描述（note.desc）：正在编辑描述的节点 id + 已展开全文的节点集合
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  const [descExpandedIds, setDescExpandedIds] = useState<Set<string>>(new Set());

  // E8：关系模式（模式隔离）——浏览态只呈现关系，关系态才暴露连线入口
  // （连接手柄 / Shift+点两节点 / 树边右键编辑 / 边点击编辑 / 右键「连线到…」）
  const [relationMode, setRelationMode] = useState(false);

  // E5：画布级标注边——连线创建器（右键「连线到…」）+ 边编辑浮窗（点击边弹出）
  // 边存 root note.edges（文档级，非节点属性）；锚存路径，会话内解析
  const [linkDraft, setLinkDraft] = useState<{ sourceId: string; x: number; y: number } | null>(
    null,
  );
  const [edgeSel, setEdgeSel] = useState<{ key: string; x: number; y: number } | null>(null);
  // E6：树自然线关系内容编辑（note.via）+ 拖拽连接由 MapView 回调直驱
  const [treeEdgeEdit, setTreeEdgeEdit] = useState<{
    childId: string;
    x: number;
    y: number;
  } | null>(null);
  const nodeChoices = useMemo(() => collectNodeChoices(controller.root), [controller.root]);
  const anchorById = useMemo(() => {
    const m = new Map<string, string>();
    nodeChoices.forEach((c) => m.set(c.id, c.anchor));
    return m;
  }, [nodeChoices]);
  const freeEdges: FreeEdge[] = useMemo(() => collectFreeEdges(controller.root), [controller.root]);
  const selEdgeIndex = edgeSel ? Number(edgeSel.key.slice(1)) : -1;
  const selEdge: (FreeEdge & { index: number }) | null = useMemo(() => {
    if (!edgeSel) return null;
    const e = freeEdges.find((x) => x.key === edgeSel.key);
    return e ? { ...e, index: selEdgeIndex } : null;
  }, [edgeSel, freeEdges, selEdgeIndex]);

  // Opp 精确翻转：接收 FreeEdgeLayer 的实际路由结果（经 MapView 透传）。
  //
  // 只留「选中边当前的 d」而非整个 routes Map —— 这是**值比较**短路的关键：
  // 存 Map 的话对象是引用、路由一重算就变，无法判断"内容是否真的变了"；
  // 存 d（字符串）可以值比较，内容不变就不 setState，从源头掐断
  // 「回调 → setState → 重渲染 → 回调」的自我触发（死循环）。
  // 上游（MapView/FreeEdgeLayer）已保证依赖稳定，这里再兜一层，防将来改坏上游。
  const [selEdgeD, setSelEdgeD] = useState<string | undefined>(undefined);
  const selEdgeKeyRef = useRef<string | null>(null);
  selEdgeKeyRef.current = selEdge?.key ?? null;
  const handleEdgeRoutes = useCallback((routes: ReadonlyMap<string, EdgeRouteEntry>) => {
    const key = selEdgeKeyRef.current;
    const d = key ? routes.get(key)?.route.d : undefined;
    setSelEdgeD((prev) => (prev === d ? prev : d));
  }, []);
  /** 选中边当前实际渲染的路径 d —— 供 EdgeEditor 的 Opp 推断 auto 模式下的鼓向 */
  const selEdgeCurrentD = selEdge ? selEdgeD : undefined;

  /** root note.edges 写入（文档级边标注；undo/自动保存经 updateNote 免费继承） */
  const writeEdges = (edges: DocEdge[]): void => {
    controller.updateNote(controller.root.id, edges.length > 0 ? { edges } : { edges: undefined });
  };
  /**
   * Issue #3：写入边的「人工锁定」几何（拖端点 / bend 控制点结果）。
   * manual = null → 清空锁定（恢复自动优化）。写入 undefined 键在序列化时会被忽略，
   * 等价于删除该字段，无需额外清理逻辑。
   */
  const writeEdgeManual = (index: number, manual: EdgeManual | null): void => {
    const cur = edgesOf(controller.root.note);
    writeEdges(patchEdgeAt(cur, index, { manual: manual ?? undefined }));
  };
  /** 建边（E7 审查：同 from+to+rel 去重——已存在直接选中打开编辑器，防重叠双线） */
  const connectEdge = (from: string, to: string, rel: string, sx: number, sy: number): void => {
    const cur = edgesOf(controller.root.note);
    const dup = findDuplicateEdge(cur, { from, to, rel });
    if (dup >= 0) {
      setEdgeSel({ key: `e${dup}`, x: sx, y: sy });
      return;
    }
    const arr = appendEdge(cur, { from, to, rel, source: 'manual' });
    writeEdges(arr);
    setEdgeSel({ key: `e${arr.length - 1}`, x: sx, y: sy });
  };

  // E4：语义边行（面板哑渲染；文本 = 节点文本 / 实体锚名 / 原始锚文本兜底）
  const edgeItems = useMemo(() => {
    const textOf = (id: string): string => {
      const n = nodeById(controller.root, id);
      if (!n) return '';
      if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
      return n.text ?? '';
    };
    return freeEdges.map((e) => ({
      key: e.key,
      rel: e.rel,
      dir: e.dir,
      sourceId: e.sourceId ?? '',
      sourceText: e.sourceId ? textOf(e.sourceId) || e.from : e.from,
      targetId: e.targetId,
      targetText: e.targetId ? textOf(e.targetId) : e.to,
      ...(e.invalidAt !== undefined ? { invalidAt: e.invalidAt } : {}),
      ...(e.source !== undefined ? { source: e.source } : {}),
    }));
  }, [freeEdges, controller.root]);

  // 批次 3：Ctrl+F 搜索面板 / Ctrl+D 大纲面板
  // S1：侧面板互斥收口——单态管理（search/outline/assets/relation），移动端不再浮层堆叠
  const [panel, setPanel] = useState<null | 'search' | 'outline' | 'assets' | 'relation'>(null);
  const togglePanel = (p: NonNullable<typeof panel>): void =>
    setPanel((cur) => (cur === p ? null : p));
  const searchOpen = panel === 'search';
  const outlineOpen = panel === 'outline';

  // 批次 4：Ctrl+Shift+A 图库面板（资产实体化；点资产 → 插入 @img/@draw 引用到选中节点下）
  // 图库资产宿主（P0）：清单/解析/上传全部经宿主注入；demo 宿主 = 打包资产 + objectURL 会话上传
  const assetHostRef = useRef<AssetHost | null>(null);
  if (assetHostRef.current === null) assetHostRef.current = new DemoAssetHost(DEMO_ASSETS, '/');
  const assetHost = assetHostRef.current;
  // 异步清单（宿主可换 HTTP/FS 实现）；插入/上传后由 Stage 更新本地副本
  const [assetList, setAssetList] = useState<AssetItem[]>([]);

  // B3：失效诊断入解析层——parse 诊断 + 资产缺失诊断（清单更新后自动重算）
  const allDiags = useMemo(
    () => [...data.diagnostics, ...assetDiagnostics(refs, assetList)],
    [data, refs, assetList],
  );

  useEffect(() => {
    let alive = true;
    void assetHost.listAssets().then((list) => {
      if (alive) setAssetList(list);
    });
    return () => {
      alive = false;
    };
  }, [assetHost]);

  const assetOpen = panel === 'assets';
  // F1：实体关系图谱面板（Ctrl+Shift+R）
  const relationOpen = panel === 'relation';

  // 主题字体度量 → 布局（树 / 折叠 / 展开 / 主题字体任一变化重排）
  // 关键：依赖 controller.root（不可变引用）而非 controller（引用稳定）——编辑后布局必须重算
  const char = useMemo(() => createCharMeasure(token.font), [token.font]);
  // M5-T6 增量布局：缓存实例跨编辑复用（折叠/度量键变化时内核自动作废重算，结果恒等于全量）
  const layoutCacheRef = useRef<LayoutCache | null>(null);
  if (layoutCacheRef.current === null) layoutCacheRef.current = new LayoutCache();
  const layout = useMemo(
    () =>
      layoutDemo(
        controller.root,
        entities,
        char,
        controller.collapsed,
        expandedQaId,
        layoutCacheRef.current!,
        // 度量语义键：字体/实体规模/展开态任一变化 → 键变 → 内核自动作废缓存（结果恒等于全量）
        // 性能关键（v1.3.0 编辑性能深度优化）：**descEditingId 不入键**。
        // measure 只依赖 desc 内容（见 createDescMeasure），进入/退出编辑不改变任何节点高度，
        // 因此无需作废缓存 → 增量布局命中 → 进入/退出编辑零全树重排（10K 图也不卡）。
        `${token.font.family}|${token.font.size}|${entities.size}|${expandedQaId ?? ''}|${descExpandedIds.size}`,
        // v1.3.0 幕布描述：展开全文的节点加高，其余有描述的节点按收缩一行计高
        descExpandedIds,
      ).layout,
    [
      controller.root,
      entities,
      char,
      controller.collapsed,
      expandedQaId,
      token.font,
      descExpandedIds,
    ],
  );

  // 导出（SVG / PNG）—— 依赖 layout，故在其定义之后调用
  const { handleExport, handleExportPng } = useExportActions({
    layout,
    token,
    docName: doc.name,
  });

  // 全局快捷键（editing 时输入框自行拦截；此处只处理画布层）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (controller.editingId !== null) return; // 输入框内：stopPropagation 已在 OverlayEditor
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // 搜索/批注输入框内不触发画布快捷键
      const act = matchEditorKey(e);
      if (!act) return;
      const sel = controller.selectedId;
      switch (act.type) {
        case 'add-child':
          if (!sel) return;
          e.preventDefault();
          {
            const id = controller.addChild(sel);
            controller.select(id);
            controller.startEdit(id);
          }
          return;
        case 'add-sibling': {
          if (!sel) return;
          e.preventDefault();
          const id = controller.addSibling(sel);
          if (id !== null) {
            controller.select(id);
            controller.startEdit(id);
          }
          return;
        }
        case 'delete':
          if (!sel) return;
          e.preventDefault();
          if (confirm(`删除节点「${getNodeLabel(controller.root, sel)}」及其全部子节点？`)) {
            controller.removeNode(sel);
            controller.select(null);
          }
          return;
        case 'edit':
          if (!sel) return;
          e.preventDefault();
          controller.startEdit(sel);
          return;
        case 'desc': {
          // Shift+Enter：切换「主题 ↔ 描述」编辑（幕布 Shift+Enter 语义）
          if (!sel) return;
          e.preventDefault();
          if (descEditingId === sel) {
            // 已在描述编辑 → 回到主题文本编辑
            setDescEditingId(null);
            controller.startEdit(sel);
          } else {
            // 进入描述编辑（无描述 = 新建；有描述 = 编辑）
            controller.cancelEdit();
            setDescEditingId(sel);
          }
          return;
        }
        case 'collapse':
          if (!sel) return;
          e.preventDefault();
          controller.toggleCollapse(sel);
          return;
        case 'undo':
          e.preventDefault();
          controller.undo();
          return;
        case 'redo':
          e.preventDefault();
          controller.redo();
          return;
        case 'save':
          e.preventDefault();
          void handleSave();
          return;
        case 'open':
          e.preventDefault();
          void handleOpen();
          return;
        case 'new':
          e.preventDefault();
          handleNew();
          return;
        case 'indent':
          if (!sel) return;
          e.preventDefault();
          controller.indent(sel);
          return;
        case 'outdent':
          if (!sel) return;
          e.preventDefault();
          controller.outdent(sel);
          return;
        case 'navigate':
          if (!sel) return;
          e.preventDefault();
          controller.navigate(act.dir);
          return;
        case 'fold':
          if (!sel) return;
          e.preventDefault();
          controller.setCollapsed(sel, true);
          return;
        case 'unfold':
          if (!sel) return;
          e.preventDefault();
          controller.setCollapsed(sel, false);
          return;
        case 'reset-zoom':
          e.preventDefault();
          apiRef.current?.resetZoom();
          return;
        case 'help':
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        case 'search':
          e.preventDefault();
          togglePanel('search');
          return;
        case 'outline':
          e.preventDefault();
          togglePanel('outline');
          return;
        case 'assets':
          e.preventDefault();
          togglePanel('assets');
          return;
        case 'relation':
          e.preventDefault();
          togglePanel('relation');
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  // beforeunload 守卫：未保存变更时拦截离开（T2）
  useEffect(() => installBeforeUnload(() => controller.dirty), [controller]);

  // E3：边编辑/连线创建浮窗 Esc 关闭
  useEffect(() => {
    if (!linkDraft && !edgeSel && !treeEdgeEdit) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setLinkDraft(null);
        setEdgeSel(null);
        setTreeEdgeEdit(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkDraft, edgeSel, treeEdgeEdit]);

  if (!layout) return null;

  const selectedTitle =
    selected?.type === 'entity' ? (selected.ref?.id ?? '') : (selected?.text ?? '');
  const noteSections = selected?.note ? formatNote(selected.note) : [];

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* 工具条：玻璃 chrome（恒定）+ 保存/dirty 指示 */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderRadius: CHROME.radius,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSize,
          zIndex: 2,
        }}
      >
        <span style={{ color: CHROME.neon, fontWeight: 600, letterSpacing: 0.5 }}>mindcanvas</span>
        <span style={{ color: CHROME.textMuted }}>·</span>
        <ThemeSwitcher />
        <span
          title="插件运行时（T5 样例：DemoPlugin 已注册 session kind / ai_role 语义键 / qa-badge 渲染器）"
          style={{
            color: pluginActive ? CHROME.neon : CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
          }}
        >
          {pluginActive ? '◆ 插件已载' : '◆ 纯文本版'}
        </span>
        <span
          style={{
            color: controller.dirty ? CHROME.warn : CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
            minWidth: 34,
          }}
          title={controller.dirty ? '有未保存变更' : '已保存'}
        >
          {controller.dirty ? '● 未保存' : '已保存'}
        </span>
        <button
          onClick={() => apiRef.current?.fit()}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          适配视图
        </button>
        <button
          onClick={() => togglePanel('assets')}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: assetOpen ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          图库
        </button>
        <button
          onClick={() => togglePanel('relation')}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: relationOpen ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          关系
        </button>
        {/* E8：模式隔离——浏览 / 关系编辑 二分态（连线入口仅在关系态暴露） */}
        <button
          data-relation-mode
          onClick={() => {
            const next = !relationMode;
            setRelationMode(next);
            // 退出关系态 → 收起所有关系编辑浮窗（避免浮窗悬空在浏览态）
            if (!next) {
              setLinkDraft(null);
              setEdgeSel(null);
              setTreeEdgeEdit(null);
            }
          }}
          title={
            relationMode
              ? '关系模式（编辑中）：拖手柄连线 · Shift+点两节点连线 · 右键树边编辑 · 点击连线编辑。点击切回浏览模式'
              : '浏览模式：画布只呈现已有关系。点击切到关系模式后可添加/编辑连线'
          }
          style={{
            border: `1px solid ${relationMode ? CHROME.neon : CHROME.panelBorderStrong}`,
            background: relationMode ? CHROME.neonSoft : 'transparent',
            color: relationMode ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          {relationMode ? '✦ 关系模式' : '○ 浏览模式'}
        </button>
        <button
          onClick={() => {
            controller.undo();
          }}
          disabled={!controller.canUndo}
          style={btnStyle(controller.canUndo)}
        >
          ↶
        </button>
        <button
          onClick={() => {
            controller.redo();
          }}
          disabled={!controller.canRedo}
          style={btnStyle(controller.canRedo)}
        >
          ↷
        </button>
        <button
          onClick={() => {
            void handleSave();
          }}
          style={{
            border: 'none',
            background: CHROME.neonSoft,
            color: CHROME.neon,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 14px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          保存
        </button>
      </div>

      <MapView
        layout={layout}
        entities={entities}
        char={char}
        // assetBaseUrl = 导图根 URL（demo 资产 id 已含「demo-assets/」相对导图前缀）
        assetBaseUrl="/"
        apiRef={apiRef}
        onStats={setStats}
        relationMode={relationMode}
        onNodeClick={(ln, mods) => {
          // E7：Shift+点击两节点连线——已选中 A 时 Shift+点 B → 建边并开编辑器
          // E8：仅关系模式下生效（浏览态 Shift+点不建边）
          if (
            mods?.shift &&
            relationMode &&
            controller.selectedId &&
            controller.selectedId !== ln.node.id
          ) {
            const fromId = controller.selectedId;
            const from = anchorById.get(fromId) ?? anchorOfNode(controller.root, fromId) ?? '';
            const to =
              anchorById.get(ln.node.id) ?? anchorOfNode(controller.root, ln.node.id) ?? '';
            if (from && to) {
              connectEdge(from, to, 'relates-to', mods.sx, mods.sy);
              controller.select(ln.node.id);
              return;
            }
          }
          // 点击：选中；有 qa 的节点展开（再点同一节点 → 收起）
          if (controller.selectedId === ln.node.id) {
            controller.select(null);
            setExpandedQaId(null);
            return;
          }
          controller.select(ln.node.id);
          const qa = ln.node.note?.qa;
          setExpandedQaId(Array.isArray(qa) && (qa as string[]).length > 0 ? ln.node.id : null);
        }}
        onNodeContext={(node, sx, sy) => {
          // 右键：命中节点 → 选中并弹菜单；空白 → 关菜单
          if (node === null) {
            setCtxMenu(null);
            return;
          }
          controller.select(node.node.id);
          setCtxMenu({ nodeId: node.node.id, x: sx, y: sy });
        }}
        selectedId={controller.selectedId}
        editingId={controller.editingId}
        onEditCommit={(id, text) => {
          const t = text.trim();
          // N4：转义输入（@@ / \@）→ 落为纯文本 @ 内容（不触发 picker）
          if (isEscapedEntityInput(t)) {
            controller.commitEdit(id, unescapeEntityInput(t));
            return;
          }
          // M1：以 @ 开头 → 不落文本，转实体 picker（查询串 = @ 后内容）
          if (t.startsWith('@')) {
            controller.cancelEdit();
            setPicker({ nodeId: id, query: t.slice(1).trim(), current: null });
            return;
          }
          controller.commitEdit(id, text);
        }}
        onEditCancel={() => controller.cancelEdit()}
        onEditStart={(id) => {
          controller.select(id);
          // M1：实体节点 → 直接开 picker 改引用（而非文本编辑）
          const n = nodeById(controller.root, id);
          if (n?.type === 'entity' && n.ref) {
            setPicker({
              nodeId: id,
              query: n.text ?? '',
              current: { kind: n.ref.kind, id: n.ref.id },
            });
            return;
          }
          controller.startEdit(id);
        }}
        collapsedIds={controller.collapsed}
        onToggleCollapse={(id) => controller.toggleCollapse(id)}
        expandedId={expandedQaId}
        onToggleExpand={(id) => {
          // × 关闭 / 收起：把该节点从展开态摘除
          setExpandedQaId((prev) => (prev === id ? null : prev));
          controller.select(null);
        }}
        onQaChange={(id, qa) => controller.updateNote(id, { qa })}
        selectedEdgeKey={edgeSel?.key ?? null}
        onEdgeClick={(edge, sx, sy) => setEdgeSel({ key: edge.key, x: sx, y: sy })}
        // Issue #3：手动覆盖 —— 拖拽端点 / bend 后写入 manual，恢复自动优化传 null
        onEdgeManualChange={(edge, manual) => writeEdgeManual(edge.index, manual)}
        onEdgeRoutes={handleEdgeRoutes}
        onTreeEdgeEdit={(childId, sx, sy) => setTreeEdgeEdit({ childId, x: sx, y: sy })}
        onEdgeConnect={(fromId, toId, sx, sy) => {
          // E6 拖拽连接：命中目标 → 以默认 rel 建边并立即开编辑器（图操作体验）；未命中 → 开创建器选目标
          if (!toId) {
            setLinkDraft({ sourceId: fromId, x: sx, y: sy });
            return;
          }
          const from = anchorById.get(fromId) ?? anchorOfNode(controller.root, fromId) ?? '';
          const to = anchorById.get(toId) ?? anchorOfNode(controller.root, toId) ?? '';
          if (!from || !to) return;
          connectEdge(from, to, 'relates-to', sx, sy);
        }}
        onNodeMove={(op) => {
          // 节点拖拽重排（M5-T5）：全部经 move-node TreeOp + OpHistory → undo/redo 正确
          controller.apply(op);
        }}
        onAssetFiles={(files) => {
          // GH-T1：.mm.md/.md 拖入/粘贴 → 打开文档；图片 → 上传图库并插入 @img 引用（P1）
          const docFiles = files.filter((f) => isMindDocFile(f.name));
          if (docFiles.length > 0) {
            const f = docFiles[0]!;
            void (async () => {
              await applyDoc(docHost.create(f.name, await f.text()));
            })();
            return;
          }
          // 文件拖入/粘贴 → 上传图库并插入 @img 引用（P1）：宿主上传 → 清单并集 → 选中节点下插入（无选中 = 根）
          const images = files.filter((f) => f.type.startsWith('image/') || /\.svg$/i.test(f.name));
          if (images.length === 0) return;
          void (async () => {
            for (const file of images) {
              const item = await assetHost.uploadAsset(file);
              setAssetList((prev) => (prev.some((a) => a.id === item.id) ? prev : [...prev, item]));
              const parentId = controller.selectedId ?? controller.root.id;
              const id = controller.addEntityChild(parentId, { kind: item.kind, id: item.id });
              setEntities((prev) => {
                const next = new Map(prev);
                next.set(`${item.kind}:${item.id}`, {
                  kind: item.kind,
                  id: item.id,
                  title: item.name,
                  status: 'ready',
                  ref: null,
                });
                return next;
              });
              controller.select(id);
            }
          })();
        }}
        // v1.3.0 幕布描述（note.desc）
        descEditingId={descEditingId}
        descExpandedIds={descExpandedIds}
        onDescEditRequest={(id) => {
          // 主题文本编辑态按 Shift+Enter → 切到描述编辑（幕布「切换主题与描述」）
          controller.cancelEdit();
          setDescEditingId(id);
        }}
        onDescToggle={(id) =>
          setDescExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onDescCommit={(id, text) => {
          // 空串 = 删除描述（note.desc 键置 undefined）
          controller.updateNote(id, text === '' ? { desc: undefined } : { desc: text });
          setDescEditingId(null);
        }}
        onDescCancel={() => setDescEditingId(null)}
      />

      <PerfPanel stats={stats} />

      {/* B1 文档栏：名称 + 未保存标记 + 新建/打开/最近/保存/另存为（左上角玻璃条） */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(12px)',
          padding: '4px 8px',
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.text,
        }}
      >
        <span
          data-doc-name
          title={doc.name}
          style={{
            maxWidth: 150,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 600,
            color: CHROME.neon,
          }}
        >
          {doc.name}
        </span>
        {controller.dirty && (
          <span data-doc-dirty style={{ color: CHROME.warn }} title="未保存修改">
            ●
          </span>
        )}
        <DocBtn label="新建" onClick={handleNew} />
        <DocBtn label="打开" onClick={() => void handleOpen()} />
        <DocBtn label="最近" onClick={() => setDocMenuOpen((v) => !v)} />
        <DocBtn label="保存" onClick={() => void handleSave()} />
        <DocBtn label="另存为" onClick={() => void handleSaveAs()} />
        <DocBtn label="导出" onClick={handleExport} />
        <DocBtn label="导出 PNG" onClick={() => void handleExportPng()} />
      </div>
      {/* 最近文档下拉（B1：localStorage 列表，点击切换；未保存守卫生效） */}
      {docMenuOpen && (
        <div
          data-recent-menu
          style={{
            position: 'absolute',
            left: 12,
            top: 44,
            zIndex: 3,
            minWidth: 200,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.panelBorder}`,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(12px)',
            padding: 6,
          }}
        >
          {docHost.recent().length === 0 ? (
            <div
              style={{
                color: CHROME.textMuted,
                fontSize: CHROME.fontSizeSmall,
                padding: '4px 6px',
              }}
            >
              暂无最近文档
            </div>
          ) : (
            docHost.recent().map((d) => (
              <div
                key={d.id}
                data-recent-doc
                onClick={() => {
                  setDocMenuOpen(false);
                  void applyDoc(d);
                }}
                style={{
                  padding: '4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: CHROME.fontSizeSmall,
                  color: CHROME.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.name}
              </div>
            ))
          )}
        </div>
      )}
      {/* FS Access 不支持的浏览器：打开兜底（隐藏 file input） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mm.md,.md,text/markdown"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          await applyDoc(docHost.create(f.name, await f.text()));
        }}
      />

      {/* T8 降级策略 L4：规模提示（>20K 激进简化 / >50K 建议折叠） */}
      {scaleNoticeFor(layout.nodes.length) !== null && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 10,
            transform: 'translateX(-50%)',
            zIndex: 3,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '6px 14px',
            pointerEvents: 'none',
          }}
        >
          {scaleNoticeFor(layout.nodes.length)}
        </div>
      )}

      {/* E8：关系模式操作提示（非阻塞；浏览态不出现） */}
      {relationMode && (
        <div
          data-relation-hint
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            zIndex: 3,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.panelBorder}`,
            color: CHROME.textMuted,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '5px 12px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          关系模式：选中节点后拖右侧手柄连线 · Shift+点两节点连线 · 右键树边/连线编辑
        </div>
      )}

      {/* B3 诊断条：parse 诊断 + W-ASSET-MISSING（左下角，非阻塞） */}
      {allDiags.length > 0 && (
        <div
          data-diagnostics
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 3,
            maxWidth: 320,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '6px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            pointerEvents: 'none',
          }}
        >
          {allDiags.map((d, i) => (
            <div key={`${d.code}-${i}`}>
              {d.code}：{d.message}
            </div>
          ))}
        </div>
      )}

      {/* 玻璃翻卡：点选节点 → 翻转查看 note + qa 编辑（R15）；侧面板打开时让位（同区域互斥） */}
      <div
        style={{
          position: 'absolute',
          right: 18,
          top: 76,
          width: 244,
          height: 260,
          zIndex: 2,
          visibility: panel !== null ? 'hidden' : undefined,
        }}
      >
        <FlipCard
          key={selected?.id ?? 'empty'}
          width={244}
          height={260}
          title={selected ? selectedTitle || '节点' : '节点笔记'}
          front={
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
                {selected ? 'NODE' : 'FLIPCARD'}
              </span>
              <span
                style={{
                  color: CHROME.text,
                  fontWeight: 600,
                  fontSize: 13,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                }}
              >
                {selected ? selectedTitle || '（实体）' : '点击画布节点查看笔记'}
              </span>
              <span
                style={{
                  color: CHROME.textMuted,
                  fontSize: CHROME.fontSizeSmall,
                  marginTop: 'auto',
                }}
              >
                {selected
                  ? selected.note
                    ? '点击翻转查看详情'
                    : '该节点无笔记'
                  : '正面：节点摘要'}
              </span>
            </div>
          }
          back={
            <div
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                overflow: 'hidden',
              }}
            >
              {/* R1/M2a：实体节点翻卡背面 = 引用详情（kind/id/标题；与关系面板同源） */}
              {selected?.type === 'entity' && selected.ref && (
                <div
                  data-flip-entity
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: `1px solid ${CHROME.panelBorder}`,
                    fontSize: CHROME.fontSizeSmall,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: CHROME.neon, fontWeight: 600 }}>@{selected.ref.kind}</span>
                  <span style={{ color: CHROME.text, marginLeft: 6 }}>
                    {entities.get(refKey(selected.ref))?.title ?? selected.ref.id}
                  </span>
                  <span style={{ color: CHROME.textMuted, marginLeft: 6 }}>
                    （右键节点可改引用 / 在关系图中显示）
                  </span>
                </div>
              )}
              <span style={{ color: CHROME.neon, fontSize: CHROME.fontSizeSmall, fontWeight: 600 }}>
                NOTE
              </span>
              {noteSections.length === 0 ? (
                <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
                  （该节点无笔记）
                </span>
              ) : (
                noteSections.map((s) => (
                  <div key={s.key} style={{ fontSize: CHROME.fontSizeSmall, lineHeight: 1.5 }}>
                    <span style={{ color: CHROME.neon, marginRight: 6 }}>{s.label}</span>
                    <span style={{ color: CHROME.text }}>{s.value}</span>
                  </div>
                ))
              )}
              {selected && (
                <QaEditor
                  items={qaItemsOf(selected)}
                  token={token}
                  onChange={(qa) => controller.updateNote(selected.id, { qa })}
                />
              )}
            </div>
          }
        />
      </div>

      {/* 批次 2：节点右键菜单（命中节点弹出；空白右键已在上层关闭） */}
      {ctxMenu !== null && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={contextMenuItemsFor(
            controller,
            ctxMenu.nodeId,
            {
              // N2：实体节点专属动作（改引用 → 开 picker；在关系图中显示 → 开面板）
              onEditRef: (id) => {
                const n = nodeById(controller.root, id);
                setPicker({
                  nodeId: id,
                  query: n?.text ?? '',
                  current: n?.ref ? { kind: n.ref.kind, id: n.ref.id } : null,
                });
              },
              onShowInGraph: () => setPanel('relation'),
            },
            relationMode
              ? {
                  // E3：连线到…（以该节点为源新建自由边）；E8：仅关系模式提供该入口
                  onStartLink: (id) => setLinkDraft({ sourceId: id, x: ctxMenu.x, y: ctxMenu.y }),
                }
              : undefined,
            // v1.3.0 幕布描述入口：右键「编辑描述」= 与 Shift+Enter 同一动作
            { onStart: (id) => setDescEditingId(id) },
          )}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* E7：树自然线关系标注（note.edge 结构化对象；仅右键树边弹出） */}
      {treeEdgeEdit && (
        <TreeEdgeEditor
          childId={treeEdgeEdit.childId}
          ann={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            const e = n?.note?.edge;
            return e && typeof e === 'object' ? (e as TreeEdgeAnn) : null;
          })()}
          viaLabel={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            return typeof n?.note?.via === 'string' ? (n.note.via as string) : '';
          })()}
          x={treeEdgeEdit.x}
          y={treeEdgeEdit.y}
          onChange={(ann) =>
            controller.updateNote(treeEdgeEdit.childId, ann ? { edge: ann } : { edge: undefined })
          }
          onClose={() => setTreeEdgeEdit(null)}
        />
      )}

      {/* E5：连线创建器（目标候选 + rel 模板 + dir + 样式；确认 → root note.edges 追加，经 update-node 可撤销） */}
      {linkDraft && (
        <LinkCreator
          choices={nodeChoices}
          x={linkDraft.x}
          y={linkDraft.y}
          onCreate={(edge: DocEdge) => {
            const from =
              anchorById.get(linkDraft.sourceId) ??
              anchorOfNode(controller.root, linkDraft.sourceId) ??
              '';
            setLinkDraft(null);
            if (!from) return;
            connectEdge(from, edge.to, edge.rel, linkDraft.x, linkDraft.y);
            // 创建器携带的 dir/label/note/style 需落到（可能已存在的）边上
            const cur = edgesOf(controller.root.note);
            const idx = findDuplicateEdge(cur, { from, to: edge.to, rel: edge.rel });
            const extras: Partial<DocEdge> = {};
            if (edge.dir) extras.dir = edge.dir;
            if (edge.label) extras.label = edge.label;
            if (edge.note) extras.note = edge.note;
            if (edge.style) extras.style = edge.style;
            if (Object.keys(extras).length > 0 && idx >= 0) {
              writeEdges(patchEdgeAt(cur, idx, extras));
            }
          }}
          onClose={() => setLinkDraft(null)}
        />
      )}

      {/* E5：边编辑浮窗（rel/dir/label/note + 样式即时落 root.note.edges；删除可撤销） */}
      {edgeSel && selEdge && (
        <EdgeEditor
          edge={{
            key: selEdge.key,
            index: selEdge.index,
            rel: selEdge.rel,
            dir: selEdge.dir,
            from: selEdge.from,
            to: selEdge.to,
            ...(selEdge.label !== undefined ? { label: selEdge.label } : {}),
            ...(selEdge.note !== undefined ? { note: selEdge.note } : {}),
            ...(selEdge.style !== undefined ? { style: selEdge.style } : {}),
            ...(selEdge.invalidAt !== undefined ? { invalidAt: selEdge.invalidAt } : {}),
            ...(selEdge.routingSide !== undefined ? { routingSide: selEdge.routingSide } : {}),
          }}
          x={edgeSel.x}
          y={edgeSel.y}
          currentD={selEdgeCurrentD}
          // Issue #3 / forceSide：routingSide 经 patch 写回（含 undefined = 恢复自动）
          onChange={(patch: Partial<DocEdge>) => {
            writeEdges(patchEdgeAt(edgesOf(controller.root.note), selEdge.index, patch));
          }}
          onStyle={(patch: EdgeStyle) => {
            writeEdges(mergeStyleAt(edgesOf(controller.root.note), selEdge.index, patch));
          }}
          onInvalidate={() => {
            writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdge.index, {
                invalidAt: new Date().toISOString(),
              }),
            );
          }}
          onRestore={() => {
            writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdge.index, { invalidAt: undefined }),
            );
          }}
          onDelete={() => {
            writeEdges(removeEdgeAt(edgesOf(controller.root.note), selEdge.index));
            setEdgeSel(null);
          }}
          onClose={() => setEdgeSel(null)}
        />
      )}

      {/* 批次 2：? 快捷键帮助面板 */}
      {helpOpen && <ShortcutHelpPanel onClose={() => setHelpOpen(false)} />}

      {/* 批次 3：Ctrl+F 富文本搜索面板（选中 + 定位） */}
      {/* S1：侧面板簇（搜索 / 大纲 / 图库 / 关系图谱，互斥单态）——已抽到 SidePanels */}
      <SidePanels
        panel={panel}
        controller={controller}
        assetList={assetList}
        assetHost={assetHost}
        setEntities={setEntities}
        relations={relations}
        activeRefKey={activeRefKey}
        edgeItems={edgeItems}
        onSelectNode={(id) => {
          setExpandedQaId(null);
          focusNode(id);
        }}
        onClose={() => setPanel(null)}
      />

      {/* M1 实体 picker：@ 触发插入 / 实体节点编辑改引用（选中回传经 controller.setEntityRef） */}
      {picker && (
        <EntityPicker
          kinds={pickKinds}
          candidates={entityCandidates}
          initialQuery={picker.query}
          initialKind={picker.current?.kind}
          currentId={picker.current?.id ?? null}
          onPick={(ref) => {
            if (ref === null) {
              controller.setEntityRef(picker.nodeId, null);
            } else {
              controller.setEntityRef(picker.nodeId, ref);
              const key = `${ref.kind}:${ref.id}`;
              setEntities((prev) =>
                prev.has(key)
                  ? prev
                  : new Map(prev).set(key, {
                      kind: ref.kind,
                      id: ref.id,
                      title: ref.id,
                      status: 'ready',
                      ref: null,
                    }),
              );
              // N1：选中即登记（候选跨文档复用）
              entityHost.remember([{ kind: ref.kind, id: ref.id, title: ref.id }], doc.name);
            }
            setPicker(null);
            controller.select(picker.nodeId);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** 读 note.qa（YAML 数组；非数组/缺失 → 空） */
/** 文档栏按钮（B1：玻璃条内的小按钮；hover 高亮） */
function DocBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        padding: '2px 6px',
        borderRadius: 5,
        cursor: 'pointer',
        color: CHROME.textMuted,
        fontWeight: 500,
        fontSize: CHROME.fontSizeSmall,
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = CHROME.neon;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = CHROME.textMuted;
      }}
    >
      {label}
    </span>
  );
}

function qaItemsOf(node: EditableNode): string[] {
  const qa = node.note?.qa;
  return Array.isArray(qa) ? (qa as string[]) : [];
}

/** 右键菜单项（新建/编辑/层级/折叠/删除；根节点禁用新建同级/反缩进/删除） */

/** 按 id 从树中取节点（undefined = 未选中/已删除） */
function nodeById(root: EditableNode, id: string): EditableNode | undefined {
  if (root.id === id) return root;
  const walk = (n: EditableNode): EditableNode | undefined => {
    for (const c of n.children) {
      if (c.id === id) return c;
      const r = walk(c);
      if (r) return r;
    }
    return undefined;
  };
  return walk(root);
}

function btnStyle(enabled: boolean): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color: enabled ? CHROME.text : CHROME.panelBorder,
    fontSize: CHROME.fontSize,
    cursor: enabled ? 'pointer' : 'default',
    padding: '0 4px',
  };
}

export default function MindmapStage() {
  return (
    <ThemeProvider>
      <StageInner />
    </ThemeProvider>
  );
}

/** MapView api 结构（避免 import 链；与 react MapViewApi 对齐） */
type MapViewApi = {
  fit(): void;
  zoomBy(f: number): void;
  resetZoom(): void;
  focusNode(id: string): void;
};
