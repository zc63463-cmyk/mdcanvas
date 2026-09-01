# mindcanvas Changelog

本文件记录已冻结的公开接口面（K0-K5 阶段演进）。自 **1.0.0** 起，`@mindcanvas/kernel` 与 `@mindcanvas/react` 的公开导出遵循 semver 管理（见 `docs/adr/ADR-0004-interface-freeze-v1.md`）。

## [1.2.0] — 2026-08-31 · 边一等公民交互与编辑闭环（E2-E7/E6.1 · react 侧 minor 加法）

**触发**：E 批执行 + 蒋指导交互反馈五轮 + markvault-js 采纳批。kernel 仅 1.1.0 的协议增量的延续（本轮 kernel 0 改动）。

| 项 | 内容 | 说明 |
|---|---|---|
| **MapView 加法 props** | `selectedEdgeKey / onEdgeClick / onTreeEdgeEdit / onEdgeConnect / onNodeClick(mods)` | 自由边叠加层（collectFreeEdges/FreeEdgeLayer）、连接手柄拖拽、树边右键编辑 |
| **文档级边标注** | root note.edges 透传键（DocEdge：from/to 锚 + rel/dir/label/note/style/invalidAt/source） | 边=画布级标注对象非节点属性；锚存路径跨会话稳定；updateNote 写入 undo 继承 |
| **树自然线关系标注** | 子节点 note.edge 对象（TreeEdgeAnn）+ note.via 字符串兼容 | 仅右键触发；chip 显示 label→rel→via 兜底；协议层对象标量（1.1.0 延续） |
| **RelationSchema** | 关系类型注册表（14 主动×5 分组+12 被动反向+构造三查+reverseOf） | relVisualOf 接 schema 语义色 |
| **软失效/来源** | DocEdge.invalidAt（失效/恢复二段）+ source（manual/inferred/imported） | B 线 AI 提议边识别前置 |

**性能**：树边 cubicMid 正则热路径消除、自由边视口裁剪、低 LOD 交互层门控、mapview 测试轮询化。

## [1.1.0] — 2026-08-31 · 边一等公民 schema（E1 · minor 加法扩展）

**触发**：E 批「边一等公民」规划（`docs/roadmap/2026-08-31-edge-first-relations.md`）——关系在连线上：连线需要属性/笔记/方向，支持树形之外的自主连线。

| 项 | 内容 | 说明 |
|---|---|---|
| **ResolvedLink 加法字段** | `dir?: LinkDir` / `label?` / `note?` / `attrs?` / `warnings?` | 全部可选，既有签名零变更；`dir: fwd(默认)/back/both` 仅是渲染端箭头语义（links 永远声明在源节点，无镜像写入） |
| **resolveLinks 透传** | 新字段逐条透传；非法 dir 回落 `fwd` + `warnings: ['invalid-dir-defaulted-fwd']`（W 级，不影响锚定三态） | |
| **协议层扁平对象列表** | parser/serializer 支持 note 块 YAML 的对象列表项（`- rel: blocks` + 缩进续行字段）——修复 spec §5.5 `links` 在文本协议无法表达的缺口（此前对象列表直接 E-INVALID-NOTE-YAML 丢弃整块笔记） | 对象项判别保守：未引号 + `key: value` 形态 + 存在续行字段，三者同时满足；qa/decisions 等冒号字符串列表行为不变。`attrs` 支持内联 JSON；嵌套对象/数组序列化为内联 JSON 字符串 |
| **yamlScalar 收紧** | 形如 `key:value` 的标量写端强制加引号 | 防字符串项与对象项在重新解析时歧义 |

**冻结合规**：仅增可选字段与新类型 `LinkDir`（ADR-0004「minor 可加不可改」）；既有 golden（T01-T30）与透传铁律测试全绿。

## [1.0.1] — 2026-08-29 · 资产节点渲染修复（patch · 非破坏性）

**触发**：资产节点（`@img` / `@draw`）显示异常（审查记录见 `docs/review/2026-08-29-asset-render-review.md`）。

| 项 | 修复 | 说明 |
|---|---|---|
| **P0 布局未给资产预留空间** | 内核 `displayMetrics` 对 `img`/`draw` kind 追加可选 `assetH`（96px），高度公式纳入资产区；`NodeG` 改为卡片式布局——图片占顶部独立区、文本区下移 | 修复前图片被压进约 26px 高的条带并与文字重叠（布局层与渲染层对节点高度认知不一致） |
| **P0 glass 连线对比度不足** | `linkStroke` `#3a3f4d` → `#646b7d` | 旧值对底色 `#16181d` 仅 2.3:1，低于 WCAG 非文本 3:1 |
| **P1 展开态注释区几何** | 注释区由全圆角 `rect` 改为 `path`（上半直角连体、下半圆角），去掉冗余分隔线 | 修复前连体处有圆角缺口，且顶边 stroke 与分隔线三线叠加成粗横线 |
| **P2 资产加载失败** | `<image>` 加 `onError` 降级 | 加载失败时隐藏图片区，纯文本呈现 |

**冻结合规**：`DisplayMetrics` 新增 `assetH?: number` 为**可选字段**（ADR-0004「minor 可加不可改」）；高度变化仅作用于 `img`/`draw` kind 节点，既有节点行为不变（有回归测试锁定 `issue.assetH === 0`）。属 bug fix 而非破坏性变更，故按 patch 发布。

## [1.0.0] — 2026-08-28 · 接口冻结（K5）

**里程碑**：三面镜子（Forgejo 联动 / MindFlow 标注 / PomodoroXI 任务项）压力测试六注册表与实体三件套全部通过；K5 期间按缺口修订的接口（resolveAll、note-anchor）已合入并记录于 ADR-0004 附录；自此公开签名变更视为 major。

### 冻结的公开接口面

**@mindcanvas/kernel（headless，零 DOM）**

- 协议层：`parseMm` / `serializeMm` / `astToEditable` / `editableToAst` / `validateId` / `stripOrgPrefix` / `refKey` / `unresolvedEntity` / `isUnresolved` / `REGISTERED_KINDS` / `KIND_META` / `KIND_FALLBACK_COLOR`；类型 `EntityRef` / `Entity` / `Note` / `MindNode` / `UnresolvedReason` / `Diagnostic` / `ParseResult`
- Entity 三件套：`EntityRef` / `Entity` / `Resolver`（`resolve`）+ 批量原语 `resolveAll`（K5 新增，部分失败语义）
- 六注册表：`KindRegistry` / `NoteKeyRegistry` / `RendererRegistry` / `LayoutRegistry` / `SemanticsRegistry` / `ChannelRegistry` + `Registry` 底座（`register/get/has/list` + `UnregisterHandle`）+ `createKernelRegistries` + `registerBuiltinKinds`
- links/groups 锚定契约（K5 新增）：`parseLinkAnchor` / `resolveLinkAnchor` / `resolveLinks` / `resolveGroups` + 类型 `AnchorResolutionState` / `LinkAnchor` / `ResolvedLink` / `ResolvedGroup`
- 插件基类与生命周期：`Plugin` / `PluginHost`（自注销）
- 编辑树与 TreeOp：`applyOp` / `invertOp` / `OpHistory` / `TreeOp` 判别联合（add-child / remove-node / move-node / update-node）+ `pathOf` / `nodeByPath` / `searchNodes` 等 treeOps 助手
- 布局引擎：`layoutMindmap` 等布局算法 + `MeasureFn` / `CharMeasure` 抽象 + 视口裁剪 `isBoxInView` / `filterVisibleLinks`

**@mindcanvas/react（渲染器）**

- 主题令牌系统：`ThemeProvider` / `useTheme` / `TokenSet`（classic / sticker / glass 三主题）
- 渲染核心：`MapView`（公开 props：layout/entities/char/apiRef/onStats/onNodeClick/onNodeContext/selectedId/editingId/collapsedIds/expandedId 等 + api：fit/zoomBy/resetZoom/focusNode）
- chrome 组件：`GlassCard` / `FlipCard` / `ThemeSwitcher` / `QaEditor` / `GrowthCommentPanel` / `ShortcutHelpPanel` / `ContextMenu` / `SearchPanel` / `OutlinePanel` / `formatNote`
- 编辑控制器：`EditorController` / `useEditor` / `matchEditorKey` / `EDITOR_KEY_BINDINGS`
- demo 数据管线：`buildEditable` / `buildEntities` / `layoutDemo` / `createCharMeasure`
- 搜索：`searchMind`（标题/笔记字段富文本匹配）

**apps/canvas（应用组合入口）**：v1.0.0 对齐；组合 = kernel + react 渲染器 + 内置 demo 插件。

### 测试基线（冻结门槛）

- kernel：266 测试（协议 225 基线 + 三面镜子 harness 25 + resolveAll 5 + note-anchor 11）
- react：126 测试
- kernel 依赖图零 react / 零 DOM（`pnpm why react --filter @mindcanvas/kernel` 无匹配）

### K5 接口修订（冻结前最后窗口，记录于 ADR-0004 附录）

- 新增 `resolveAll`（批量解析，镜子一对账场景缺口）
- 新增 note-anchor 模块（links/groups 锚定三态判定，镜子一/二缺口）
