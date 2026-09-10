# Sections Phase 1（方案 A：子树锚定空间分区）· 交付报告

> 日期：2026-09-10 ｜ 状态：T1–T6 全部完成并提交 ｜ 唯一遗留：pre-push code budget（非本次引入）

---

## 一、交付清单

| 任务 | 内容 | 状态 | 提交 |
|---|---|---|---|
| T1 | 协议与类型：`SectionSpec` / `sectionsOf` / `sectionColorOf` / `makeSectionId` / `upsertSection` / `removeSection` | ✅ | `aa244d2` |
| T2 | 锚解析与迁移：`resolveSections` 三态 / `W-SECTION-DANGLING` / `sections` 引用锚登记 | ✅ | `aa244d2` |
| T3 | 渲染层：`buildSectionViews` 纯几何 / `SectionLayer` 背景层 / MapView `sectionViews` memo | ✅ | `12278ce` |
| T4 | 菜单与拖拽：三态菜单 / 标题栏接管 center 管线 / D1 守卫 | ✅ | `e5cc2b8` |
| T5 | 折叠钮 + 选中态退出三件套 | ✅ | `bdcda03` |
| T6 | 协议文档 v1.4/v1.5 补记 | ✅ | `e1c6450` |

**测试基线**：kernel 54 文件 / **427 用例**；react 94 文件 / **907 用例** —— 全绿。
**静态检查**：三包 `tsc -b` 零错；depcruise 零违规（322 模块）；biome lint **0 error**。

---

## 二、核心设计决策（已按 D1–D5 裁决落实）

### D1：Section ⇒ center（不变量）

Phase 1 的 Section **必然是**升格节点。理由：自由落位能力仅 center 级
（`EditableNode` 无 `pos`，见 `treeOps.ts:10-18`），拖拽移动整组只能复用中心管线。
三条写入路径统一落实该不变量：

| 入口 | 条件 | 行为 | undo |
|---|---|---|---|
| `onMark` | 已是 center | 复用 center 条目既有 cid → 只写 `sections` | 单条 |
| `onMark`（退化） | center 无 cid（手写 YAML） | 补分配 cid + 同批写回节点 note | 单条 |
| `onPromoteAndMark` | 非 center | `planPromoteCenter` + sections 并入**同一批 ops** | 单条 |
| `onUnmark` | 已是 Section | 只删 `sections` 条目，不动树、不动 center | 单条 |

### D2：折叠复用会话态

Section 折叠走既有的节点级 `collapsedIds`（`localStorage` 会话态，**不落盘**）；
`SectionSpec.collapsed` 字段保留为 Phase 2 预留，当前不读。

### D3：dangling 幽灵态 + 数据无损

锚失效（子树被删 / cid 不存在）→ 渲染灰色虚线 chip + `W-SECTION-DANGLING` 诊断，
**元数据绝不静默删除**，由用户显式点 ✕ 清理（与 `W-ORPHAN-NOTE` 同一哲学）。

### D4：members 暂按 C-a 管道串预留

`SectionSpec.members?: string`（`"cid:c2|cid:c3"` 形态）已入协议但**不参与语义**
（自研 micro-YAML 不支持对象项内嵌套列表，扩 parser 成本高）。

### D5：升格入口全量开放

T0 核验确认三个历史升格 bug 均已有修复与回归测试（`islands.ts:192` / `MapView.tsx:494-498`
`documentRoot` 显式传入 / `anchor-migrate.test.ts` T17），故「设为 Section（升为中心）」
入口**全量开放**，不做首版降级。

---

## 三、技术要点

### 3.1 零 parser 改动

`fog` 自研 micro-YAML 已支持 sequence-of-mappings（`parser.ts:168-198` 对象项三条件判定 +
续行字段），`serializer.ts:62-68` 对称输出。因此 `sections` 复用既有 note YAML 通道，
**parser/serializer 零改动** —— 由 `section-roundtrip.test.ts` 13 条用例锁定
（含幂等、与 centers/edges 共存、缺省省略、未知色透传、畸形容错、写读闭环）。

### 3.2 cid 双轨迁移

`sections[].root` 写入**一律** `cid:`（稳定身份，根治改名 dangling），读取兼容 `node:` 路径。
已登记进 `ANCHOR_NOTE_KEYS`（`cutAttach.ts`）+ `collectReferenceAnchors`（收集
`sections[i].root` 为可迁移引用锚）→ `planReferenceMigration` 对 cid 锚「原样保留」
即正确迁移，`node:` 锚按 nodeId 重建。

### 3.3 标题栏拖拽 = 按住中心节点本体

`handleSectionTitlePointerDown(rootId, e)` 注入既有 `nodeDrag`，后续
`pointermove`/`pointerup` 由手势层接管：
- `centerPreview`（纯 state）实时预览整岛偏移 —— **不置 dirty**
- `pointerup` 单次 `onCenterMove` 提交（走 `handleCenterMove` → `upsertCenter` → `updateNote`）
- `Esc` / `pointercancel` → 预览复原、**零回调**

**零新写回通道** —— 这是「A 是 B 子集」在工程上的兑现：Section 拖拽完全复用中心管线。

### 3.4 纯渲染投影，不污染布局

`sectionViews` 是 `useMemo` 派生的**纯渲染投影**：不进 `layout.nodes`（不参与节点裁剪）、
不污染 `layout.bounds`（fit 零回归）。逐框 `isBoxInView` 自裁剪；Canvas 模式不经 SVG
分支 → 自动降级不渲染（已知限制，见协议 v1.5）。

---

## 四、测试覆盖明细

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `kernel/tests/section-roundtrip.test.ts` | 13 | 往返幂等 / 共存 / 缺省省略 / 未知色 / 畸形容错 / 预留字段 / 写入路径 / 写读闭环 / id 不碰撞 |
| `kernel/tests/section-anchor.test.ts` | 8 | 三态解析 / 改名 cid 存活 / 诊断措辞区分 |
| `kernel/tests/anchor-migrate.test.ts`（T17-s 追加） | — | `sections[].root` 锚迁移（cid 保留 / node: 重建） |
| `react/tests/section-frames.test.ts` | 6 | AABB 外扩 / 缺盒跳过 / 全缺不产出 / 折叠徽标 / ghost 三态 |
| `react/tests/mapview-section-drag.test.tsx` | 6 | 整岛同步偏移 / `onCenterMove` 恰一次 / Esc 与 pointercancel 零副作用 / D1 守卫 |
| `react/tests/mapview-section-collapse.test.tsx` | 5 | 折叠回调 / AABB 收缩 + 徽标 / Esc / 空白点击 / toggle 退出 |

**测试坑记录**：`makeTextNode` 每次生成新 id → 折叠集合必须取自**同一 fixture** 的 id，
跨 fixture 取 id 会静默失效造成假失败（已写进测试注释）。jsdom 无布局引擎 → viewport 恒
1×1，Section 帧的 `isBoxInView` 自裁剪要求成员落在 `|x|,|y| ≲ 128`（CULL_MARGIN）内。

---

## 五、遗留与后续

### 5.1 唯一阻塞：pre-push code budget（**非本次引入**）

```
bang       91 / 90   ↑1
asCast     38 / 31   ↑7
bigFiles    6 /  4   ↑2
```

**经核验全部来自会话开始前既有的未提交改动**（`layout/*`、`render/geometry.ts`、
`chrome/AssetPanel.tsx`、`FileManager.tsx` 等，mtime 均为 9/6–9/9）。
本次 T1–T5 全量生产代码 diff **仅新增 1 个 `as` 断言、0 个 `!` 断言**。

→ 需要用户裁决：① 先单独提交这批既有 WIP；② 由我修这笔债；③ 暂缓 push。

### 5.2 Phase 2 待办（协议已预留）

- `members: string` 管道串 → 离散成员选择（逼近方案 B 的几何表现力）
- `collapsed: boolean` 落盘（当前为会话态）
- Section 内跨岛嵌套独立中心是否跟随移动（设计确认中）

### 5.3 事故记录（重要）

本次实施期间发生**第二次 `.git` 损毁**：`git stash push -u` 被 SIGTERM 中断，
导致 `refs/` 被删、两个 pack 文件与 T1–T3 松散对象全部丢失。
**工作树源码零丢失**，已从 reflog 恢复 refs 并重新提交。

**新增纪律（已写入 `MEMORY.md`）**：
1. **禁止 `git stash`** —— 中断即毁 refs
2. 每完成一步**立即 commit**，commit 后**立即 push**
3. 新增关键文件先 `cp` 到仓外备份
4. 分支 refs 不可靠，一律在 main 上小步快提交

---

## 六、验收对照（A1–A8）

| # | 验收项 | 结果 |
|---|---|---|
| A1 | 标记为 Section 后渲染出背景框 | ✅ T3 |
| A2 | 框随子树增删改自动跟随（AABB 重算） | ✅ T3（`buildSectionViews` 纯函数） |
| A3 | 标题栏拖拽移动整岛（实时预览 + 单次提交） | ✅ T4 |
| A4 | Esc 取消拖拽零副作用 | ✅ T4 测试 |
| A5 | 折叠钮收起子树、框收缩、徽标 +N | ✅ T5 |
| A6 | 锚失效 → 幽灵态 + 诊断、数据保留 | ✅ T2 + T3 |
| A7 | 改名不失效（cid 锚） | ✅ T2 测试 |
| A8 | `sections` 往返无损、与既有键共存 | ✅ T1 测试 |
