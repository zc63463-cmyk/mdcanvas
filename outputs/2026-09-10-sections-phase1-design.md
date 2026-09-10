# Sections Phase 1：子树锚定空间分区（方案 A）设计文档

日期：2026-09-10 · 状态：**待批准（设计评审稿）** · 前置讨论：方案 A（树内生 Section）vs 方案 B（离散成员 Section）架构分析

> 本文所有结论均基于 2026-09-10 对当前源码的实地侦查（`文件:行号` 为证据锚点），不引用旧文档推断现状。

---

## 1. 定位与核心抽象

### 1.1 从架构分析到工程抽象

前置分析已论证：方案 B 在几何表现力上是 A 的超集，但 A 拥有「零引用同步成本 + 自动布局兼容」的系统性优势。落地策略为**自顶向下按 B 建模协议、自底向上先实现 A**。

源码侦查给出了一个比预期更优雅的落点：

> **Phase 1 的 Section ≈ 「带装饰的 Center Island」**——一个具名、着色、可折叠的中心岛。

理由（均为已核实事实）：

| 需求 | 现成管线 | 证据 |
| :--- | :--- | :--- |
| 子树 AABB 自动算框 | `layoutIslands` 返回 `islandBounds: Map<rootId, Bounds>`；通用 `boundsOf`/`layoutBounds` | `packages/kernel/src/layout/islands.ts:287-311`、`mindmap.ts:470-487, 252-272` |
| 拖拽移动整个布局岛 | center 拖拽：`centerPreview` 纯 state 预览（不写 note、不进 history）+ pointerup 单次 `onCenterMove` 提交（单条 undo），Esc 零调用 | `MapView.tsx:599-636`、`useMapGestures.ts:253-264`、`MindmapStage.tsx:775-792` |
| 折叠为小卡片 | 节点级 `collapsedIds` + `toggleCollapse` 菜单项已存在 | `controller.ts:39,203-221`、`contextMenuItems.ts:141` |
| 改名/移动不失效 | `cid:` 双轨锚 + `planReferenceMigration`（「根治改名/移动 dangling」注释原话） | `anchor-migrate.ts:261-298`、`note-anchor.ts:4-12` |
| 序列化承载 | 自研 YAML 已支持 sequence-of-mappings 往返（note v1.4、`groups`、`edges` 为先例） | `parser.ts:168-198`、`serializer.ts:62-68` |

**关键约束（决定设计形态）**：自由落位**仅 center 级**——`EditableNode` 无 `pos` 字段（`treeOps.ts:10-18`），节点级坐标覆盖未实现。因此「拖拽 Section 移动整组」只有复用 center 管线这一条低成本路径；这也正是方案 B（离散成员）必须等 G7 节点级 `pos` 的代码级证据。

### 1.2 Phase 分期

| 阶段 | 语义 | 范围 |
| :--- | :--- | :--- |
| **Phase 1（本文）** | `root` 子树锚定：Section = 装饰化 center 岛 | 协议 + 解析 + 渲染 + 菜单 + 拖拽 + 折叠，约 2~3 天 |
| Phase 2（仅预留，不实施） | `members` 离散自由成员 + 圈选成组 | 依赖 G7 节点级 pos、parser 嵌套列表或替代编码、凸包包围盒，约 1~2 周 |

---

## 2. 协议设计（`.mm.md`）

### 2.1 Phase 1 编码

挂在**文档根节点的 note** 中，与 `centers`/`center_pos`/`edges`/`links`/`groups` 同列：

```yaml
<!--
sections:
- id: sec_9f3a
  title: 摩擦分析
  color: blue
  root: cid:7c2e1a
- id: sec_b204
  title: 显示逻辑
  color: amber
  root: node:如何优化节点编辑逻辑/显示逻辑分析
-->
```

字段规约：

| 字段 | 必选 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | 是 | `sec_` + 4 位短随机 | 实体身份，供 `kind:id` 引用与未来 Phase 2 成员反向索引 |
| `title` | 否 | 标量 | 标题栏文本；缺省用 root 节点标题 |
| `color` | 否 | 枚举 token | `blue/amber/green/violet/rose/slate`，渲染层映射色值，默认 `slate` |
| `root` | 是 | 锚字符串 | **`cid:` 优先**（写入时一律落 cid），读取兼容 `node:` 文本路径；解析复用 `resolveNodeTextPath` 三态（`note-anchor.ts:139-159, 188-190`） |

**前向兼容免费获得**：`Note` 带 `[key:string]: unknown`（`types.ts:70`），未知键静默透传——旧版本读到 `sections` 不崩、不丢。

### 2.2 Phase 2 预留（仅类型层，不落编码）

`members` 在 Phase 2 的语义是「section 对象内的嵌套字符串列表」，但**当前 parser 不支持对象内再嵌套一层列表**（`parseNoteYaml` 只做「顶层 key + 一层扁平对象列表」，`note.ts:8-14` 记载了这一取舍史）。候选编码（Phase 2 评审时决策，本文不拍板）：

- **C-a**：`members: "cid:a|cid:b|cid:c"` 管道分隔标量——零 parser 改动，推荐默认；
- **C-b**：扩展 parser 支持对象内一层列表——改动集中但触碰序列化对称性，需全套 roundtrip 变异验证；
- **C-c**：平铺键 `sec_9f3a_members:`——污染命名空间，仅作兜底。

Phase 1 仅在 TS 类型中预留 `members?: string`（按 C-a 形态预留），不解析、不渲染。

### 2.3 协议文档同步

协议文档 `docs/specs/2026-09-02-mm-md-protocol.md` 停在 v1.3.1，已落后代码（types.ts 已有 v1.4 `note`/`note_text` 而文档 §5.2 未列）。本次借新增 `sections` 一并补记 v1.4 与 v1.5（sections），避免文档债继续累积。

---

## 3. kernel 层设计

### 3.1 类型（`packages/kernel/src/protocol/types.ts`）

```ts
export interface SectionSpec {
  id: string;              // sec_xxxx
  title?: string;
  color?: SectionColor;    // 枚举 token，缺省 slate
  root: string;            // 锚字符串：cid: 优先，node: 兼容
  members?: string;        // Phase 2 预留（C-a 形态），Phase 1 不解析
}
// Note 接口增加：sections?: SectionSpec[]（经 [key:string]:unknown 已可透传，此处仅加类型化访问器）
```

### 3.2 解析器改动：零

`parseNoteYaml` 的 sequence-of-mappings 能力（`parser.ts:168-198`）与 `noteToLines` 的对象数组序列化（`serializer.ts:62-68`）已对称覆盖该形态。**用 golden/roundtrip 测试锁死，而不是改代码**。

### 3.3 解析与诊断（新增 `registry/section-anchor.ts`，仿 `note-anchor.ts` 的 groups 部分）

- `resolveSections(root): ResolvedSection[]`，每项 `{ spec, rootId, status: 'well-formed' | 'dangling' | 'stale' }`——三态判定直接复用 `resolveNodeTextPath`。
- 新诊断码 **`W-SECTION-DANGLING`**：root 锚解析失败时产出，与 `W-ORPHAN-NOTE`（`parser.ts:421`）同哲学——保留数据、提示用户、不静默丢弃。
- `sections` 加入 **`ANCHOR_NOTE_KEYS`**（`packages/react/src/edit/cutAttach.ts:80`，现含 centers/center_pos/edges/links/groups），使重命名/剪切/移动走 `planReferenceMigration` 的 cid 双轨统一迁移。

### 3.4 布局：零改动

Section 框是纯渲染层投影，不进 `layout.nodes`，不改 `layout.bounds`——避免污染 `fitIntoView`（`fit.ts:32-52`）导致视图缩到极小。

---

## 4. 渲染设计（packages/react）

### 4.1 挂载点：SectionLayer

新增 `render/SectionLayer.tsx`，作为 `MapView.tsx:1071` 变换 `<g>` 的**第一个子元素**（在 `visibleLinkGeoms` 连线层之前）——背景永远位于节点与连线之下。

### 4.2 几何

- AABB 来源：root 是 center → `islandBounds.get(rootId)`；否则对子树 `boundsOf`。外扩 `SECTION_PADDING = 24`。
- 每个 Section 框独立做 `isBoxInView` 判定（`cull.ts:14-28`）：跨全图大框恒与视口相交 → 恒可见，**正确且不影响逐节点裁剪**（cull 按节点盒独立测试，`MapView.tsx:628-629`）。
- 圆角矩形：填充 `color` token × 8% alpha，描边 1.5px × 40% alpha；选中态描边实化 + 外发光。
- **Canvas 模式降级**：`useCanvas`（>50000 节点）分支不渲染自由边/跨岛线（`MapView.tsx:1149,1177`），Section 同列降级——Phase 1 在 Canvas 模式下不画 Section 框，仅保留数据，文档中标注为已知限制。

### 4.3 标题栏

框顶内侧横条（高 28px）：色块圆点 + 标题文本（缺省取 root 节点标题）+ 成员计数徽标 + 折叠/展开按钮。标题栏即拖拽热区。

### 4.4 LOD 与折叠

- LOD 三档（`geometry.ts:200-220`）下标题栏**始终渲染**——Section 恰恰是 skeleton 档的信息密度补救（用户缩到全局时仍能看到分区标题）。
- **折叠 = 复用现有节点折叠**：Section 折叠按钮直接调 `controller.toggleCollapse(rootId)`。子树坍缩为单节点后，AABB 自动收缩为包裹该节点的小卡片——框随布局自动跟随，零新增状态、零新增持久化字段（`collapsedIds` 现状为会话态，与 desc 展开状态同哲学）。
- 成员计数徽标显示子树节点数（折叠时显示 `+N`）。

### 4.5 dangling 幽灵态

`status === 'dangling'` 的 Section 不静默消失：渲染灰色虚线空框（仅标题栏 + `⚠ 锚已失效` + 「移除」按钮），并产出 `W-SECTION-DANGLING` 诊断。用户可一键清理，或重命名恢复后自动复活（cid 双轨保证改名场景不走这里，主要是删子树场景）。

---

## 5. 交互设计

### 5.1 菜单入口（`contextMenuItems.ts:81-261`，插入在「升为中心 › 方向」`:198-208` 邻近）

| 节点状态 | 菜单项 | 动作 |
| :--- | :--- | :--- |
| 已是 center，无 Section | **标记为 Section** | 仅写 `sections` 元数据（root=cid），单条 undo |
| 非 center | **设为 Section（升为中心）** | 升格管线 + 写元数据，**合并为一条 undo** |
| 已是某 Section root | **取消 Section** | 仅删元数据，不动树、不动 center |
| 非 root 普通节点 | （不出现 Section 项） | Phase 1 不支持「加入既有 Section」，那是 Phase 2 的 members 语义 |

动作注入仿 `CenterMenuActions`（`contextMenuItems.ts:49-68`）新增 `SectionMenuActions` 接口，`apps/canvas/src/NodeContextMenu.tsx:81-162` 装配。

### 5.2 拖拽

标题栏 pointerdown → 走**与 center 节点拖拽完全相同的管线**（`useMapGestures.ts:120-137` 起）：`centerPreview` 实时预览（子树后代同步跟随，`MapView.tsx:609-611`），pointerup 单次 `onCenterMove`（位移 `÷k` 换算世界坐标，`useMapGestures.ts:253-264`），`upsertCenter` 写回 `root.note.centers[].pos`，单条 undo；Esc/pointercancel 零调用。**不新增任何写回通道。**

### 5.3 选中与退出

点击 Section 背景/标题栏选中（描边实化）；Esc / 点击空白 / 点击其他节点退出——沿用附属区退出三件套惯例（见 MEMORY 既定约定）。

---

## 6. 一致性与迁移

1. **写入一律 `cid:`**：创建 Section 时把 root 的 cid 落入 `root` 字段，`at` 文本提示由迁移层维护——改名不 dangling（`anchor-migrate.ts:261-298`）。
2. **统一迁移清单**：`sections` 进 `ANCHOR_NOTE_KEYS`，剪切/移动/粘贴子树时随既有五键一起迁移。
3. **删除治理**：删除 root 子树 → dangling 幽灵态 + 诊断码，用户显式清理；不自动删元数据（与 W-ORPHAN-NOTE 哲学一致）。
4. **幂等**：parse → serialize → parse 对 `sections` 往返字节级稳定（golden 测试锁定，含未知字段透传场景）。

---

## 7. 测试计划

| 层 | 测试 | 断言要点 |
| :--- | :--- | :--- |
| kernel | `section-roundtrip.test.ts` | sequence-of-mappings golden 往返；缺省字段省略；未知字段透传不丢 |
| kernel | `section-anchor.test.ts` | `resolveSections` 三态；cid 改名后 well-formed；删子树后 dangling + `W-SECTION-DANGLING` |
| kernel | `anchor-migrate.test.ts` 扩例 | sections 随剪切/移动迁移（仿 groups 既有用例） |
| react | `section-layer.test.tsx` | AABB = islandBounds + padding；折叠后框收缩；dangling 幽灵态渲染 |
| react | `mapview-section-drag.test.tsx` | 仿 `mapview-center-drag.test.tsx:114-124`：pointerup 提交恰一次、Esc 零调用、预览不置 dirty |
| react | `context-menu-section.test.ts` | 四种节点状态下菜单项正确出现/隐藏 |
| gate | 全量 | typecheck + 两包 `pnpm test`（各包本地 vitest，`fileParallelism:false`，**禁 npx**）+ depcruise + lint + budget |
| 变异 | 手改验证 | 改 `SECTION_PADDING`/三态判定/拖拽提交条件，确认对应测试变红 |

---

## 8. 风险与前置依赖

| # | 风险 | 缓解 |
| :--- | :--- | :--- |
| R1 | **升格管线三个已知 bug**（2026-09-05 探针：深层升格重复 ID、MapView 从几何根取 edges 错误、标题改名中心锚 dangling）——「设为 Section（升为中心）」直接踩在这条管线上 | **T0 前置任务**：先跑升格回归测试核实三 bug 修复状态；未修复则 Phase 1 菜单仅开放「已是 center → 标记为 Section」，升格入口挂起 |
| R2 | 仓库现有 20+ 个未提交变更（FA2 资产工作区在途） | 实施前先提交或 stash 隔离，Section 改动独立分支/commit 序列，不混入 |
| R3 | 协议文档落后（v1.3.1 vs v1.4 代码） | 借本次补记 v1.4 + v1.5，T6 完成 |
| R4 | 非 center 子树设 Section 后期待可拖拽（自由落位仅 center 级） | 设计上统一为「Section ⇒ center」：设 Section 即升格，不存在不可拖的 Section |
| R5 | 跨全图大 Section 框被担心会导致裁剪失效 | 已核实不成立：cull 逐节点独立测试（`MapView.tsx:628-629`），Section 框不入 `layout.nodes`、不进 `layout.bounds`，仅自身做 `isBoxInView` 判定 |
| R6 | Canvas 模式（>50000 节点）无 Section 渲染 | 已知限制写入协议文档与菜单 tooltip；节点数回落后自动恢复 |

---

## 9. Phase 2 预留接口清单（只定义、不实现）

| 预留点 | 位置 | Phase 2 用途 |
| :--- | :--- | :--- |
| `SectionSpec.members?: string` | types.ts | 离散成员（C-a 管道串形态） |
| `ResolvedSection.memberIds?: string[]` | section-anchor.ts | 解析后的成员节点集合（凸包输入） |
| SectionLayer 的「多 AABB 合并」分支 | 渲染 | members 模式下的凸包/聚类包围盒 |
| `MarqueeSelect → Ctrl+G` | 交互 | 圈选成组，依赖 G7 节点级 pos 落地 |

Phase 2 的真正前置是 **G7 节点级坐标覆盖**——没有它，离散成员的自动布局撕裂无解。此依赖关系已与 G6′ 系列规划对齐。

---

## 10. 待拍板决策点

请评审时对以下五点给出裁决，裁决后进入实施（计划见 `2026-09-10-sections-phase1-plan.md`）：

- **D1（核心抽象）**：接受「Phase 1 Section = 带装饰的 Center Island」？即：设 Section 必然升格为 center（合并单条 undo），不存在非 center 的 Section。代价是「纯视觉分组、保持树连线不切岛」的语义 Phase 1 不提供。
- **D2（折叠语义）**：折叠复用节点级 `collapsedIds`（会话态，不写文档）是否够用？还是要求 `collapsed` 持久化进 `sections` 字段（多写一个字段，跨会话恢复）？本会话设计按前者。
- **D3（dangling 处理）**：幽灵态灰框 + `W-SECTION-DANGLING` 诊断码 + 手动清理，是否认可？（替代案：静默隐藏，仅诊断。）
- **D4（Phase 2 members 编码）**：暂按 C-a（管道分隔标量）预留类型，正式编码 Phase 2 评审再定——是否认可？
- **D5（R1 前置）**：「设为 Section（升为中心）」入口以升格管线三 bug 回归通过为前置；若未通过，接受 Phase 1 首版仅支持「已是 center → 标记为 Section」？

---

## 附：本设计的证据索引（侦查结论 → 设计决策）

| 侦查结论 | 去向决策 |
| :--- | :--- |
| parser 支持 sequence-of-mappings（`parser.ts:168-198`），序列化对称（`serializer.ts:62-68`） | §2.1 编码零改动；§3.2 kernel 解析零改动 |
| 不支持对象内嵌套列表（`note.ts:8-14`） | §2.2 members 候选 C-a/b/c |
| `Note[key:string]:unknown` 未知键透传（`types.ts:70`） | §2.1 前向兼容 |
| cid 双轨迁移（`anchor-migrate.ts:261-298`）+ `ANCHOR_NOTE_KEYS`（`cutAttach.ts:80`） | §3.3、§6 一致性设计 |
| `islandBounds`/`boundsOf` 现成（`islands.ts:287-311`、`mindmap.ts:252-272`） | §4.2 几何 |
| 变换 `<g>` 首位即背景层插入点（`MapView.tsx:1060-1072`） | §4.1 挂载点 |
| center 拖拽预览/提交分离（`MapView.tsx:599-636`、`useMapGestures.ts:253-264`） | §5.2 拖拽零新通道 |
| 节点级折叠已有（`controller.ts:39,203-221`） | §4.4 折叠复用 |
| 自由落位仅 center 级（`treeOps.ts:10-18`） | §1.1 核心抽象、§9 Phase 2 前置 |
| 菜单注册点唯一（`contextMenuItems.ts:81-261`） | §5.1 入口 |
| 测试基建：各包本地 vitest、`fileParallelism:false`、禁 npx | §7 gate 命令 |