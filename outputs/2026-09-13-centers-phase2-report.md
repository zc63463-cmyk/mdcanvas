# 升中心 Phase 2（批次 C：C1–C6）执行报告

- **日期**：2026-09-13（开批）→ 2026-09-14（收口）
- **计划**：`docs/dispatch/2026-09-13-centers-phase2-plan.md`
- **起点 HEAD**：`6ed8482`（先单独提交两份文档）→ 实质起点 `0f46da6`；**终点 HEAD**：C6 提交（见文末）
- **一句话**：把升中心方向留下的五处未收口——写路径双轨 / 守卫空白 / 嵌套语义 / 视觉缺失 / 缓存无据——全部收口；过程中**发现并修复一处既有接线缺口**（A4 整岛预览的 `islandMembers` 从未接线）。

---

## 0 · 基线核对（开工实测 vs 计划 §0）

| 项 | 计划值 | 开工实测 | 结果 |
|---|---|---|---|
| 三包测试 | 480 / 1127 / 186 = 1793 全绿 | 同上（C1 起跑时 canvas 全套 191 含 C1 新 5 例） | 一致 |
| depcruise | 416 模块 / 1170 deps | `416 modules, 1170 dependencies cruised`（C1 后 417/1171） | 一致 |
| lint | 1468 warnings + 46 infos | `Found 1468 warnings. Found 46 infos.` | 一致 |
| budget | bang 89/90 · asCast 31/31 · bigFiles 3/4 | 同 | 一致 |

`git status` 开工态：两份文档未跟踪 + `tools/graph-engine/`（Python 残留，未动未提交）。先提交 `6ed8482 docs: 追加进度自评与升中心 Phase 2 派遣计划`。

---

## 1 · C1 升格写路径统一（commit `e5420ad`）

**改动**：`apps/canvas/src/nodeMenuBags.ts`（`onPromote` 双轨 → `planPromoteCenter + applyTransaction`）；新增 `apps/canvas/tests/center-actions-promote.test.tsx`（5 例）。

**红证据（原文，先写测试后实现）**：

```
 FAIL  tests/center-actions-promote.test.tsx > C1 升格写路径统一（菜单/环 onPromote → planPromoteCenter） > 无 cid 节点升格 → centers 条目与节点 note 同源 cid（next_cid bump）
AssertionError: expected { at: 'node:根/任务', dir: 'left' } to match object { at: 'node:根/任务', dir: 'left', …(1) }

- Expected
+ Received

  {
    "at": "node:根/任务",
-   "cid": "c1",
    "dir": "left",
  }

 FAIL  tests/center-actions-promote.test.tsx > C1 … > 已有 cid 节点再升格 → 沿用不 bump、不重写节点 note（ops 只含 root 一条）
AssertionError: expected { at: 'node:根/任务', dir: 'down' } to match object { cid: 'c3', dir: 'down' }

 FAIL  tests/center-actions-promote.test.tsx > C1 … > at 不可解析（空文本节点）→ cid: 兜底升格（口径变更：原不动作）
AssertionError: expected [] to have a length of 1 but got +0

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

**绿**：`Tests  5 passed (5)`；canvas 全套 `Tests  191 passed (191)`。

**① 升格前后原始对照（root.note.centers / 节点 note）**：

```
E1 BEFORE root.note = undefined
E1 BEFORE node.note = undefined
E1 AFTER  root.note = {"next_cid":2,"centers":[{"at":"node:根/任务","dir":"left","cid":"c1"}]}
E1 AFTER  node.note = {"cid":"c1"}
E1 UNDO   root.note = undefined
E1 UNDO   node.note = undefined
```

**② 已有 cid 不 bump（next_cid 未变）**：

```
E2 BEFORE root.note = {"next_cid":7}
E2 BEFORE node.note = {"cid":"c3"}
E2 AFTER  root.note = {"next_cid":7,"centers":[{"at":"node:根/任务","dir":"down","cid":"c3"}]}
E2 AFTER  node.note = {"cid":"c3"}
```

**③ `at` 兜底 `cid:`（口径变更）**：

```
E3 AFTER  root.note = {"next_cid":2,"centers":[{"at":"cid:c1","dir":"left","cid":"c1"}]}
E3 AFTER  node.note = {"cid":"c1"}
```

**④ 一次 undo 回滚证据**：E1 的 `UNDO root.note = undefined` + `UNDO node.note = undefined`（节点 note 与 root.note 同批提交、同批回滚；测试断言 `controller.undo()` 后 `centers` / `next_cid` / 节点 `cid` 全部 undefined）。

> 口径变更（commit message 已列）：`at` 不可解析（如空文本节点）时由 plan 兜底 `cid:` 锚继续升格，不再静默不动作。**只给被升格节点补 cid，不做全库迁移**（惰性补发）。

---

## 2 · C2 守卫补齐（commit `96445e2`）

**改动**：新增 `packages/react/tests/centers-promote.test.ts`（5 例）、`apps/canvas/tests/center-actions-writes.test.tsx`（4 例）；顺带修复 `apps/canvas/src/nodeMenuBags.ts` 的 `onDemote`。

**测试数**：react +5（1132）、canvas +4（195）。

**① `planPromoteCenter` 直测红证据？** —— 该组为「补测既有实现」：先写先跑，**直接绿**（5 passed）——实现语义与预期一致；判别力由阴性对照证明（见下）。

**② `onDemote` TDD 红证据（原文）**：

```
 FAIL  tests/center-actions-writes.test.tsx > C2 写动作直测：onDemote > 非中心节点降格 → no-op（root.note 原样）
AssertionError: expected {} to be undefined

- Expected:
undefined

+ Received:
{}
```

→ 复现真实副作用：未命中（非中心）时原实现把 `root.note` 从 undefined 写成 `{}`（进 history + 置脏）。修复：`removeCenter` 未命中时 `centers` 引用原样返回 → 引用相等即 no-op 提前返回。修复后 `Tests  4 passed (4)`。

**③ 阴性对照（自跑并恢复，`git diff` 空）**：把 `ensureNodeCid` 的「沿用不 bump」分支改坏（强制重分配）：

```
 FAIL  tests/centers-cid.test.ts > ensureNodeCid：沿用与分配 > 节点已有 cid → 沿用且不 bump next_cid
AssertionError: expected 'c5' to be 'c3' // Object.is equality

 FAIL  tests/centers-promote.test.ts > C2 planPromoteCenter 直测 > 有 cid：一 op（仅 root）、不 bump、不重写节点 note
AssertionError: expected 'c7' to be 'c3' // Object.is equality

 FAIL  tests/center-actions-promote.test.tsx > C1 … > 已有 cid 节点再升格 → 沿用不 bump、不重写节点 note（ops 只含 root 一条）
AssertionError: expected { at: 'node:根/任务', dir: 'down', …(1) } to match object { cid: 'c3', dir: 'down' }
-   "cid": "c3",
+   "cid": "c7",
```

（3 文件 3 用例全红 → 恢复后 14 passed。）该对照同时证明 canvas 测试走 react src（vite alias）。

---

## 3 · C3 嵌套跟随语义收口（commit `a7c7511`）

**改动**：新增 `packages/react/tests/mapview-center-nested-drag.test.tsx`（3 例）；`docs/specs/2026-09-02-mm-md-protocol.md` §6.3 补「嵌套岛移动语义」。**react +3（1135）**。

**钉住型测试**：走真实管线（`collectCenters → buildIslandView → layoutForest → MapView`）直接绿——现状与计划 §1.2 判断一致（子岛不跟随），**无需改代码、未改测试期望**。

**判别断言原文**（jsdom 盒 transform 对照，拖拽预览中）：

```
E-P before = {"P":"translate(-24 -17)","p1":"translate(88 -17)","C":"translate(96 -17)","c1":"translate(208 -17)"}
E-P during = {"P":"translate(6 3)","p1":"translate(118 3)","C":"translate(96 -17)","c1":"translate(208 -17)"}
E-C before = {"P":"translate(-24 -17)","p1":"translate(88 -17)","C":"translate(96 -17)","c1":"translate(208 -17)"}
E-C during = {"P":"translate(-24 -17)","p1":"translate(88 -17)","C":"translate(126 3)","c1":"translate(238 3)"}
```

拖 P：P/p1 位移 (+30,+20)，**C/c1 不动**；拖 C：C/c1 位移 (+30,+20)，**P/p1 不动**。投影层断言：`membersByRoot` 中 P 岛 = `[P, p1]`、C 岛 = `[C, c1]`（互不含对方成员）。

**过程记录（测试技术）**：首跑 2 例红——因 jsdom 视口 0×0 + `worldRect` 外扩与 `isBoxInView` margin **双重叠加** → 有效可见范围 ≈ ±256；c1 盒 (288..332) 被裁剪致 `null` 假绿（已按「防裁剪假绿」修正：两岛贴近原点 + 每成员断言 `not.toBeNull`）。此口径已写入测试注释。

---

## 4 · C4 中心可见性角标（commit `b082438`）

**改动**：`packages/react/src/render/MapView.tsx`（`centerTitles` prop + 左上角标）；`apps/canvas/src/MindmapStage.tsx`（`centerTitles` 构造 + **`islandMembers` 接线补漏**）；`apps/canvas/src/hooks/useCanvasDegradeNotice.ts`（文案）；新增 `packages/react/tests/mapview-center-badge.test.tsx`（5 例）；`packages/react/tests/canvas-degrade.test.tsx`（追加 1 项）；新增 `tools/verify-c4-center-badge.mjs`。

**react +5（1140）**；canvas 全套 195（未增用例）。

### 4.1 实现要点（两处计划外发现，均为修复）

1. **渲染条件不能用 `centerIds`**——它来自 layout specs，**含布局输出所需的「根岛根」**：真浏览器核对抓到「文档根被误标中心」（`centers: 2`，title 出现无 cid 的「中心」）。修法：渲染条件吃 `centerTitles`（collectCenters 的真实中心事实）。测试用例同步升级为「即便 root 因根岛进入 centerIds 也不被误标」。
2. **`islandMembers` 接线缺口（A4 补漏）**——`centerPreview`（中心拖动整岛预览）消费 `islandMembers`，但**全仓无任何调用方传入**：画布上拖中心落「浮空克隆 + 置灰」的改结构表现（A4 明确要排除的），C3「子岛不随父岛动」/C4「角标随拖动平移」在画布上均无从成立。提交层一直正常（`isCenter → onCenterMove` 写坐标）。一行接线修复。

### 4.2 判别测试（TDD/阴性对照）

**阴性对照（禁用角标渲染，跑完恢复）**：

```
 FAIL  tests/mapview-center-badge.test.tsx > C4 中心角标（左上 data-center） > 升格 → 出现：title 带 doc#cid、落点左上、pointerEvents none
AssertionError: expected null not to be null
 ❯ tests/mapview-center-badge.test.tsx:65:23
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

（4 个依赖「角标出现」的用例全红；Canvas 用例保持绿——它断言「无角标」。）

**canvas-degrade 追加断言原文（既有 1/1 与 0/0 断言未动）**：

```ts
expect(svgView.container.querySelectorAll('[data-tree-edge-label]').length).toBe(1);
expect(svgView.container.querySelectorAll('[data-note-badge]').length).toBe(1);
expect(svgView.container.querySelectorAll('[data-center]').length).toBe(1);   // C4 追加
...
expect(canvasView.container.querySelectorAll('[data-tree-edge-label]').length).toBe(0);
expect(canvasView.container.querySelectorAll('[data-note-badge]').length).toBe(0);
expect(canvasView.container.querySelectorAll('[data-center]').length).toBe(0); // C4 追加
```

### 4.3 真浏览器四态验证（`tools/verify-c4-center-badge.mjs`，全通过 exit 0）

```
✔ 普通态：角标出现（data-center=1） — {"count":1,"id":"…","title":"中心（c4-center.mm.md#c1）","cx":213.5,"cy":-12,"pointerEvents":"none"}
✔ title =「中心（c4-center.mm.md#c1）」
✔ pointerEvents = 'none'（不抢命中）
✔ 选中态：角标仍在（count = 1）
[dragging] before = {"work":"translate(208.5 -17)","projA":"translate(335.5 -17)","root":"translate(-26 -17)","life":"translate(90 -17)"}
[dragging] during = {"work":"translate(316.086 23.344)","projA":"translate(443.086 23.344)","root":"translate(-26 -17)","life":"translate(90 -17)"}
✔ 拖拽中：整岛成员跟随（工作+项目A 盒平移）      ← 同位移 +107.6 / +40.3 世界 px
✔ 拖拽中：非成员不动（根/生活）
✔ 拖拽中：无浮空克隆（中心拖拽=整岛预览，非改结构）
✔ 拖拽中：角标随节点盒平移（cx 变化） — {"cx":321.086125,"was":213.5}
✔ Esc 取消：角标复原（cx 回原位）
✔ 降级态：canvas 出现 / SVG 节点层让位（g[data-node-id] = 0）/ 无中心角标（data-center = 0）
✔ 降级提示含「中心标记」（C4 文案）
✅ C4 四态视觉验证全部通过
```

**四态截图**：`verify-shots/c4-badge-plain.png` / `c4-badge-selected.png` / `c4-badge-dragging.png` / `c4-badge-canvas.png`（canvas 态可见后端行 `canvas`、节点 35/50011、提示条含「…与中心标记暂不渲染…」、零角标）。

**快照守卫记录**：首跑前守卫报「产物比 HEAD 旧 105s」——来源为**并行提交** `3312a63`（"文本链接 Phase 1 派遣计划"，仅 docs/，他人/他线工作）；源码新鲜度检查通过 → 按官方出口 `--allow-stale` 继续（守卫行为符合设计，非缺陷；脚本已支持 flag 与 baseUrl 共存）。

---

## 5 · C5 森林布局缓存取证（commit `634ef9b`，只测不实现）

**A6 原样基线（`scripts/bench-islands-a6.mjs` 原文照贴）**：

```
A6 layout-islands 性能采样（同机同文档，15 次取中位，ms）
文档节点数: 1097 （候选含 detached 岛同源）
中心数: 4  边界边（parent_link:show）: 1

指标,baseline,candidate
布局 layoutMs,3.3,12.3
投影+路由 projectionMs,-,0.54
边界边 path boundaryPathMs,-,0.01（×1 条）
切断事务 commitCutMs,-,0.64
绘制 cull drawCullMs,- 0.09
绘制 links drawLinksMs,-,0.88

candidate/baseline 布局比: 3.74x
```

**矩阵扩展（`scripts/bench-islands-matrix.mjs`，新增；15 次中位）**：

```
规模,节点数,中心数,单树ms,森林ms,比值,>1.5x,>16ms
N≈384,364,0,1.1,0.8,0.75x,-,-
N≈384,364,1,1.1,5.6,5.14x,Y,-
N≈384,364,3,1.1,3.1,2.79x,Y,-
N≈384,364,8,1.1,2.9,2.65x,Y,-
N≈1000,1093,0,2.1,1.3,0.62x,-,-
N≈1000,1093,1,2.1,11.8,5.55x,Y,-
N≈1000,1093,3,2.1,9.3,4.39x,Y,-
N≈1000,1093,8,2.1,9.2,4.30x,Y,-
N≈3000,3280,0,6.1,6.3,1.03x,-,-
N≈3000,3280,1,6.1,33.3,5.47x,Y,Y
N≈3000,3280,3,6.1,26.9,4.42x,Y,Y
N≈3000,3280,8,6.1,28.1,4.62x,Y,Y

触发条款（>1.5× 且 >16ms）命中格数: 3
  → N≈3000 × 1 中心: 33.3ms = 单树 6.1ms 的 5.47x
  → N≈3000 × 3 中心: 26.9ms = 单树 6.1ms 的 4.42x
  → N≈3000 × 8 中心: 28.1ms = 单树 6.1ms 的 4.62x
判定：立项缓存批（数据支持）。
```

**复跑一致性**：第二跑同结论（33.2 / 27.8 / 31.0ms = 4.87-5.82x，命中 3 格）。

**立项判定结论**：**触发条款命中**——N≈3280（可见节点量级）下，多中心布局 26.9–33.3ms **同时越过 1.5× 比值与 16ms 帧预算**（复跑一致）→ **数据支持立项「中心局部布局缓存」批**（实现另批；本批只测）。N≤1093 各格比值虽 2.4–5.8x 但绝对值 <16ms；N=0 对照 ≈ 单树（封装开销 ≤0.2ms）。口径说明：单树基线 = `layoutMindmap` **无缓存全量**（比生产（带 LayoutCache）更保守，方向对判定不变）。

---

## 6 · 门禁与预算（终检，工具原样输出）

- **三包测试**：kernel `Tests 480 passed (480)` / react `Tests 1140 passed (1140)` / canvas `Tests 195 passed (195)` = **1815 全绿**。
- **tsc ×3**：`react dist 重建 exit=0`（`tsc -b packages/react/tsconfig.build.json`）/ `canvas tsc=0` / `kernel tsc=0`；canvas 套件另跑 `vite build`（dist 产物 `main-*` 随 C4 更新）。
- **depcruise**：`✔ no dependency violations found (421 modules, 1181 dependencies cruised)`（起点 416/1170 → +5 模块 +11 deps，均为本批新测试/脚本文件，零违规）。
- **biome lint**：`Found 1468 warnings. Found 46 infos.`（**持平原水位**；本批新代码零告警，中途曾修复新测试一个未使用 import）。
- **budget**：`✅ 全部指标在预算内（债务未增长）`——bang `89/90 ↓1`、asCast `31/31`、console `4/4`、todo `1/1`、defaultExport `2/2`、bigFiles `3/4 ↓1`；超 600 行：MapView 2193→**2218**、MindmapStage 2254、edgeRouting 1235（个数 3/4 不变）。
- **阈值/契约测试**：零放宽（C4 对 `canvas-degrade` 仅追加 `data-center` 一项，既有断言原文未动）；`CULL_MARGIN` 未动；新文件均 <600 行（最大新文件 `tools/verify-c4-center-badge.mjs` 219 行 / `scripts/bench-islands-matrix.mjs` 141 行）。

---

## 7 · 偏差与原因（如实记录）

1. **测试数净增 +22（1793 → 1815）**，超出计划预期（1804±2）+11：C1 +5（计划未估）、C2 +9（估 +6~8）、C3 +3（估 +2）、C4 +5（估 +3~4）。原因：每任务按「判别 + 回归 + 兼容」多写了用例（如 C2 的 `onDemote` no-op、C4 的「root 不被误标」）；**无一条既有测试被删除或放宽**。
2. **C4 两处计划外发现**（均已修复并留证据）：`centerIds` 含根岛根（真浏览器核对抓到误标）；`islandMembers` 接线缺口（A4 既有）。后者改动触及拖拽视觉行为——已由真浏览器四态 verify 全量复核（整岛跟随 / 非成员不动 / 无克隆 / Esc 复原）。
3. **C5 结论为「立项命中」**（计划写的是「未达则记录不立项」的备选）：数据（复跑一致）明确越过双阈值，按 C-A6 条款应立项；本批按「只测不实现」停线，实现归后续批次。
4. **快照守卫误报一次**：并行 docs 提交（`3312a63`）使「产物新于 HEAD」判定不过；源码判定通过 → `--allow-stale` 继续（并修复脚本参数解析使其与 flag 共存）。
5. **沙箱事实**：个别 vitest 跑完不退出（exit 124）但输出完整（既知现象）；`nodeMenuBags.test.tsx` 首版夹具自身有解构 bug（已修正，非实现问题）。

---

## 8 · 明确不做（沿计划 §6）

`members` 管道串 / `collapsed` 落盘（C-A7）；升格预览与快捷键；detached 收件箱；Canvas 侧中心渲染；**森林布局缓存实现**（C5 只取证，数据支持立项 → 建议立新批）。

---

## 9 · 提交台账

| # | commit | 摘要 |
|---|---|---|
| 0 | `6ed8482` | docs: 追加进度自评与升中心 Phase 2 派遣计划 |
| C1 | `e5420ad` | fix(canvas): 升格写路径统一到 planPromoteCenter（菜单/环升格补 cid 身份） |
| C2 | `96445e2` | test(canvas,react): 升格链守卫——planPromoteCenter 直测 + 三个写动作直测 |
| C3 | `a7c7511` | docs(specs)+test(react): 嵌套中心移动语义收口——子岛不随父岛拖动（判别测试钉死） |
| C4 | `b082438` | feat(react,canvas): 中心可见性角标（左上 data-center + Canvas 损失清单补一项） |
| C5 | `634ef9b` | perf(kernel): 森林布局耗时取证（多中心 × 规模矩阵；N≈3000 命中 1.5×+16ms 双门槛） |
| C6 | （本报告 + CHANGELOG 提交） | docs: 收口 1.8.13（升中心 Phase 2 执行报告与 CHANGELOG） |

（并行线：`3312a63` docs: 追加文本链接 Phase 1 派遣计划——非本批产出。）

**停止点**：C6 提交后停下等放行。
