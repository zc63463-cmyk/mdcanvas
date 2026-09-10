# Sections Phase 1 实施计划（方案 A 落地）

日期：2026-09-10 · 配套设计：`2026-09-10-sections-phase1-design.md` · 状态：待 D1–D5 裁决后启动

预估：T0 半天（验证性），T1–T6 合计 **2~3 天**。全程遵守 gate：typecheck + 两包本地 vitest + depcruise + lint + budget；每个 T 完成后增量 typecheck，禁止绕过 git hooks。

---

## T0 · 前置清障（半天，验证性，不写功能代码）

| 项 | 内容 |
| :--- | :--- |
| 目标 | 确认实施环境干净、升格管线可信 |
| 动作 | 1) FA2 在途的 20+ 未提交变更先提交或 stash 隔离，Section 工作从干净基线起新分支；2) 跑升格回归，核实 2026-09-05 探针三 bug（深层升格重复 ID、MapView 从几何根取 edges、改名中心锚 dangling）现状；3) 跑一次全量 gate 记录基线 |
| 产出 | 三 bug 状态结论 → 回填设计文档 D5；gate 基线数据 |
| 验收 | `pnpm -r typecheck`、`pnpm --filter @mindcanvas/kernel test`、`pnpm --filter @mindcanvas/react test` 基线全绿（或既有红清单记录在案，不归入本任务） |

**裁决门**：D5 若判定升格管线不可信 → Phase 1 菜单仅开放「已是 center → 标记为 Section」，T4 砍掉升格入口，工期 -0.5 天。

---

## T1 · 协议与类型（0.5 天）

| 项 | 内容 |
| :--- | :--- |
| 改动 | `packages/kernel/src/protocol/types.ts`：+`SectionSpec`、`SectionColor`；`Note` 类型化访问器 `sectionsOf()`（仿 `noteOf` 的读取回退风格，`note.ts:37-45` 先例） |
| 测试 | 新增 `packages/kernel/tests/section-roundtrip.test.ts`：含缺省字段省略、未知字段透传、`color` 枚举容错（未知色 → slate 并透传原值不丢）、与 `centers`/`edges`/`groups` 共存同一 note 的往返 |
| 验收 | parse → serialize → parse 字节级幂等；golden 样例进测试目录 |

**不做**：parser/serializer 任何代码改动（能力已够，用测试锁死）。

## T2 · 锚解析与迁移（0.5 天）

| 项 | 内容 |
| :--- | :--- |
| 改动 | 新增 `packages/kernel/src/registry/section-anchor.ts`：`resolveSections(root)` 三态解析（复用 `resolveNodeTextPath`）；诊断码 `W-SECTION-DANGLING`；`packages/react/src/edit/cutAttach.ts:80` 的 `ANCHOR_NOTE_KEYS` +`sections`；`anchors-migrate` 迁移清单接入 |
| 测试 | `section-anchor.test.ts`（三态/改名 cid 存活/删子树 dangling）；`anchor-migrate.test.ts` 扩例（剪切移动后 sections.root 随迁） |
| 验收 | 改名 root 不 dangling（cid 双轨）；dangling 可检出且元数据保留 |

## T3 · 渲染层 SectionLayer（1 天）

| 项 | 内容 |
| :--- | :--- |
| 改动 | 新增 `packages/react/src/render/SectionLayer.tsx`；挂载于 `MapView.tsx:1071` 变换 `<g>` 首位（连线层之前）；AABB = `islandBounds`/子树 `boundsOf` + `SECTION_PADDING=24`；六色 token 调色板；标题栏（色点+标题+计数徽标+折叠钮）；dangling 幽灵态灰框；逐框 `isBoxInView`；Canvas 模式跳过渲染 |
| 测试 | `section-layer.test.tsx`：几何（AABB=岛界+padding）、折叠后框收缩、幽灵态、配色映射 |
| 验收 | 视觉走查三档 LOD：标题栏恒渲染；`fitIntoView` 不被 Section 框撑大（`layout.bounds` 无污染回归测试） |

## T4 · 菜单与拖拽（0.5~1 天，受 D5 裁决影响）

| 项 | 内容 |
| :--- | :--- |
| 改动 | `contextMenuItems.ts:81-261` 插入三态菜单项（标记为 Section / 设为 Section（升为中心）/ 取消 Section），新增 `SectionMenuActions` 接口（仿 `CenterMenuActions`）；`apps/canvas/src/NodeContextMenu.tsx:81-162` 装配；标题栏拖拽接管到现有 center 拖拽管线（`useMapGestures.ts` 的 preview/commit 模式，零新写回通道） |
| 测试 | `context-menu-section.test.ts` 四态菜单可见性；`mapview-section-drag.test.tsx` 仿 `mapview-center-drag.test.tsx:114-124`：`onCenterMove` 恰一次、Esc 零调用、预览不置 dirty |
| 验收 | 拖拽整岛实时预览 + 单条 undo；升格+标记合并单条 undo（若 D5 通过） |

## T5 · 折叠与退出（0.5 天）

| 项 | 内容 |
| :--- | :--- |
| 改动 | Section 折叠钮 → `controller.toggleCollapse(rootId)`（复用，不改 controller）；选中态管理 + Esc/空白点击/再点击退出（沿用附属区三件套） |
| 测试 | 折叠后 AABB 收缩为单节点小卡；展开还原；退出三路径 |
| 验收 | 会话态折叠不污染 `.mm.md`（serialize 无 collapsed 字段，对应 D2 默认） |

## T6 · 文档与收口（0.5 天）

| 项 | 内容 |
| :--- | :--- |
| 改动 | `docs/specs/2026-09-02-mm-md-protocol.md` 补记 v1.4（note/note_text）+ v1.5（sections，含 color 枚举、cid 优先规则、Canvas 模式降级限制、Phase 2 members 预留声明）；全量 gate + 变异验证（改 `SECTION_PADDING`/三态判定/提交条件确认测试变红） |
| 产出 | 交付报告（本目录 `2026-09-10-sections-phase1-report.md`） |
| 验收 | gate 全绿；协议文档与代码互证无矛盾 |

---

## 验收总清单（对照 T0–T6）

- [ ] A1：`.mm.md` 中 `sections` 注释往返幂等，与既有五键共存无损
- [ ] A2：root 改名 Section 不失效；删子树出幽灵态 + `W-SECTION-DANGLING`，可手动清理
- [ ] A3：剪切/移动子树，sections 锚随统一迁移清单更新
- [ ] A4：Section 背景在连线与节点之下；三档 LOD 标题栏恒在；`fitIntoView` 无回归
- [ ] A5：标题栏拖拽 = center 拖拽语义（实时预览、单次提交、Esc 取消、单条 undo）
- [ ] A6：四态菜单正确出现；升格+标记单条 undo（若 D5 通过）
- [ ] A7：折叠为小卡片复用节点折叠，会话态不落盘
- [ ] A8：协议文档 v1.4+v1.5 补记完成；gate 全绿；变异验证通过

## Phase 2 触发条件（不在本计划内，仅备忘）

1. G7 节点级 `pos` 落地；2) D4 编码裁决（默认 C-a）；3) 合并 Section（一键拆散/多选移动）；4) 方案 B 圈选（套索/框选 + 上下文菜单）；5) 大画布性能。任一未满足，不启动 Phase 2 排期。