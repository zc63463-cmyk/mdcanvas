# S2F 执行报告：启动页文档切换同步（状态判据修复 · 方案 A）

- **日期**：2026-09-14
- **批次**：S2F-1 → S2F-3（逐任务提交；本报告为收口产物）
- **起点 HEAD**：`aca0af8`（P1 收尾小修；未推送状态按现状继续）→ 开工先提交计划 `a3eb620`
- **提交链（本批）**：`a3eb620`（计划）→ `d7ec9a6`（S2F-2 修复 + t0/t3/t4 + 三出口 e2e + 浏览器脚本）→ 本报告 + CHANGELOG `[1.8.19]` + `MindmapStage` 注释订正（收口 docs 提交）
- **一句话**：`useDocumentSwitch` 的「首挂跳过」从**时间点判据**改**状态判据**（`ctrl.root === editable`）——首挂**不同源**（启动页出口这类「`StageContent` 挂载前改 doc」路径）补做切换四动作；启动页三出口的画布树同步修复。
- **范围与纪律**：只改 `apps/canvas`（+`tools/` 浏览器脚本）→ **未重建 react/kernel dist**（§0）。四动作语义/顺序、`remember`、effect deps（`[doc.source]`）逐字未动；`t1/t2` 断言意图逐字保持（diff 实证见 §冻结实证）。

## §0 基线核对（开工实测）

| 项 | 计划参考 | 实测 | 判定 |
|---|---|---|---|
| HEAD | `aca0af8` | **`aca0af8`** ✓ | 一致（4 commit 未推，按现状继续） |
| 三包 | 523 / 1266 / 197 | 523 / 1266 / 197（P1 尾态）✓ | 一致 |
| depcruise | 438/1249 零违规 | 438/1249（hook 实测）✓ | 一致 |
| lint | 1468 + 46 | 1468 + 46 ✓ | 一致 |
| budget | 持平（bigFiles 3/4） | 持平 ✓ | 一致 |
| 未跟踪 | `_tmp_93540_*`、`tmp-v7-s1/s2.diff`（不动）/ `tmp-rev-t1/t2.diff`（可清）/ `tools/graph-engine/`（禁区） | 逐项对账一致 | — |

## §S2F-1 · 复现（红证据，先行）

### a. hook 单测扩展（`apps/canvas/tests/useDocumentSwitch.test.tsx`）

mock 补 `root` 字段（缺省与 `editable` 同引用）+ `setup(opts)` 参数化；新增 t0/t3/t4。**首次全跑红原文**（补 rAF 桩前）：

```
 ❯ tests/useDocumentSwitch.test.tsx (5 tests | 3 failed) 32ms
     ✓ t1：source 不变的 doc 新对象（仅 savedSource/ts/handle 变）→ 四个动作零调用 16ms
     ✓ t2：source 变化 → 四动作各恰一次（切换回归钉）+ 首挂只登记不动树 4ms
     × t0：判据实证 —— 真实 EditorController 的 root 引用 = 构造/reset 的落点 5ms
     × t3：首挂即不同源（root ≠ editable）→ 四动作各恰一次 + remember 照做 4ms
     × t4：controller 为 null → 不崩（落入四动作；reset 为 null 安全跳过） 3ms
```

- t0 首跑失败属**测试设施问题**（非判据问题）：canvas 套件 `pretendToBeVisual:false`（无 rAF）→ 真实 `EditorController` 构造即 `notify()` → `TypeError: requestAnimationFrame is not a function`（`scheduler.ts:92`）。按 `delete-key.test.tsx` 先例补 rAF 桩（`beforeEach` stub + `afterEach` unstub）后，t0 初跑即绿——**判据实证成立**。
- 桩后目标红态（原文）：

```
 × t3：首挂即不同源（root ≠ editable）→ 四动作各恰一次 + remember 照做
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 ❯ tests/useDocumentSwitch.test.tsx:111:19  (expect(reset)…)
 × t4：controller 为 null → 不崩（落入四动作；reset 为 null 安全跳过）
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 ❯ tests/useDocumentSwitch.test.tsx:135:25  (expect(setEntities)…)

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

### b. 三出口 e2e（新文件 `apps/canvas/tests/startup-doc-switch.test.tsx`）

断言口径（D5·双边）：目标文档独有节点**存在** 且 gateway 独有节点（`Agent Gateway`）**不存在**。三红原文（**三出口均「doc 名已切、画布树仍为 gateway」**）：

```
 FAIL 「继续上次」出口：切到最近文档（A），且无 gateway 节点
Error: 节点「S2F-A子」缺失；doc=s2f-a.mm.md；节点=["Agent Gateway","文档（Forgejo 真实）","任务（真实 Issue）","里程碑","@milestone门户显示优化里程碑","灵感联动","断裂引用（unresolved 演示）","我的想法","幕布描述（v1.3.0 · 节点下方纯文本 · Shift+Enter 编辑）","图库（资产实体化）"]

 FAIL 「最近列表」出口：切到较早文档（B），且无 gateway 节点
Error: 节点「S2F-B子」缺失；doc=s2f-b.mm.md；节点=["Agent Gateway","文档（Forgejo 真实）","任务（真实 Issue）","里程碑","@milestone门户显示优化里程碑","灵感联动","断裂引用（unresolved 演示）","我的想法","幕布描述（v1.3.0 · 节点下方纯文本 · Shift+Enter 编辑）","图库（资产实体化）"]

 FAIL 「新建」出口：新文档「未命名」渲染，且无 gateway 节点
Error: 节点「未命名」缺失；doc=未命名.mm.md；节点=["Agent Gateway","文档（Forgejo 真实）", …（同为 gateway 树）]

 Test Files  2 failed (2)   ← 与 hook 单测合并首跑
      Tests  6 failed | 2 passed (8)
```

（首跑合并统计：`Tests 6 failed | 2 passed (8)` = e2e×3 + t0(TypeError) + t3 + t4；2 passed = t1/t2。）

### c. 真浏览器复现（**构建产物**，D3）

- 构建：`cd apps/canvas && node ../../node_modules/.pnpm/vite@8.2.2/node_modules/vite/bin/vite.js build` → `✓ built in 1.22s`，入口 `main-DexXrh3i.js`（`BUILD_EXIT=0`）
- 服务：`…/vite/bin/vite.js preview --port 5178 --strictPort`；**baseUrl = `http://localhost:5178`**
- 跑法：`node tools/verify-startup-doc-switch.mjs http://localhost:5178`
- **复现输出（原文，RC=1）**：

```
[verify] baseUrl = http://localhost:5178
[snapshot] 产物构建于 2026-09-14 22:19:26 · 引用的入口 = main-DexXrh3i.js
[snapshot] 最新源码 2026-09-14 21:49:39 · HEAD 提交 2026-09-14 22:14:39
[snapshot] 页面实际加载 = main-DexXrh3i.js
✘ [继续上次] 画布含目标节点「S2F-A子」 — ["Agent Gateway","文档（Forgejo 真实）","@doc01 · 架构设计", …（25 项，全为 gateway 树）]
✘ [继续上次] 画布不含 gateway 节点「Agent Gateway」 — 同上
✘ [最近列表] 画布含目标节点「S2F-B子」 — ["Agent Gateway", …（全为 gateway 树）]
✘ [最近列表] 画布不含 gateway 节点「Agent Gateway」 — 同上
✘ [新建] 画布含目标节点「未命名」 — ["Agent Gateway", …（全为 gateway 树）]
✘ [新建] 画布不含 gateway 节点「Agent Gateway」 — 同上

❌ 存在失败项（复现/回归未过）
```

- **截图（复现态）**：`verify-shots/s2f-resume-repro.png` / `s2f-recent-repro.png` / `s2f-new-repro.png`（复现后保全改名；`verify-shots/` 为 gitignore 本地佐证）
- **D3 说明**：dev server 复现为**假阴性**（StrictMode 双调用 effect：第二次 `isFirst=false` → 四动作照做）→ 本步全程构建产物。**§4 STOP 未触发（构建产物下成功复现）**。

## §S2F-2 · 修复（方案 A：时间点判据 → 状态判据）

### hook diff（原文，唯一改点 + 注释同步）

```diff
@@ 头注释（语义段）
- * - 首挂跳过其后 4 个动作（controller 首次创建 + MapView 初始 fit 已处理，避免重复动画），
- *   但**首挂仍要**把文档内实体引用登记进候选宿主（跨文档复用）。
+ * - 首挂**同源**（controller 已按当前树创建）跳过其后 4 个动作（MapView 初始 fit 已处理，
+ *   避免重复动画）；首挂**不同源**（启动页出口这类「StageContent 挂载前改 `doc`」的路径）
+ *   → 补做切换动作（S2F 修复）。但**首挂仍要**把文档内实体引用登记进候选宿主（跨文档复用）。
@@ 条件处注释
-  // 首挂跳过（controller 首次创建 + MapView 初始 fit 已处理；避免重复动画）
+  // 首挂**同源**跳过（controller 已按当前树创建 + MapView 初始 fit 已处理；避免重复动画）；
+  // 首挂不同源（启动页出口：StageContent 挂载前 doc 已换）→ 补做切换（S2F）
@@ 唯一逻辑改点（:66）
-    if (isFirst) return;
+    if (isFirst && controllerRef.current?.root === editable) return; // 首挂且同源才跳过（状态判据）；不同源补做切换
```

四动作（`reset` / `setEntities` / `setExpandedQaId(null)` / `fit`）与 `remember` 逐字保持；deps 仍锁 `[doc.source]`；非首挂路径零新增判断。

### 绿原文

**hook + e2e（jsdom）**：

```
 ✓ tests/startup-doc-switch.test.tsx (3 tests) 821ms
     ✓ 「继续上次」出口：切到最近文档（A），且无 gateway 节点  529ms
 ✓ tests/useDocumentSwitch.test.tsx (5 tests) 23ms

 Test Files  2 passed (2)
      Tests  8 passed (8)
```

**真浏览器（构建产物，RC=0）**——重建后入口 `main-DzuA5EoJ.js`：

```
✔ [继续上次] 画布含目标节点「S2F-A子」 — ["S2F-A根","S2F-A子"]
✔ [继续上次] 画布不含 gateway 节点「Agent Gateway」 — ["S2F-A根","S2F-A子"]
[继续上次] 过渡 ghost 组残留 = 0
✔ [最近列表] 画布含目标节点「S2F-B子」 — ["S2F-B根","S2F-B子"]
✔ [最近列表] 画布不含 gateway 节点「Agent Gateway」 — ["S2F-B根","S2F-B子"]
[最近列表] 过渡 ghost 组残留 = 0
✔ [新建] 画布含目标节点「未命名」 — ["未命名"]
✔ [新建] 画布不含 gateway 节点「Agent Gateway」 — ["未命名"]
[新建] 过渡 ghost 组残留 = 0

✅ S2F 启动页文档切换同步验证全部通过
```

- **截图（终态）**：`verify-shots/s2f-resume.png` / `s2f-recent.png` / `s2f-new.png`

### 冻结实证（t1/t2 + mock 约束）

`git show d7ec9a6 -- apps/canvas/tests/useDocumentSwitch.test.tsx`：**t1/t2 用例体零 `-` 行**（diff 仅：import 重排 + `beforeEach` 桩 + mock 增 `root` 字段/参数化 + 返回值增 `editable` + 新增 describe）；「首挂四动作未执行」通过「mock 与 editable 同源」满足——**修订后语义**（同源即跳过）与原断言意图一致，非放宽。

## §S2F-3 · 收口

### `MindmapStage.tsx:250-255` 注释订正（diff 原文）

```diff
           // 这里**不需要** applyDoc 的未保存守卫，理由（2026-09-03 复核）：
-          // 启动页只在冷启动出现一次（初值 = 有最近文档），此时用户尚未编辑任何内容，
-          // controller 也还没建立（本组件不持有它）—— 不存在"可丢失的未保存修改"。
-          // 关闭后 showStartup=false，编辑过程中不会再回到这里。
-          // 反过来，applyDoc 定义在 StageContent 里（本分支早退，根本渲染不到它），
-          // 想用也拿不到；强行上提反而要把 controller 拖进启动页，得不偿失。
+          // 启动页只在冷启动出现一次（初值 = 有最近文档），此时用户尚未编辑任何内容
+          // —— 不存在"可丢失的未保存修改"；applyDoc 在 StageContent 里（本分支早退拿不到）。
+          // ⚠️ 「不需要守卫」≠「不需要同步」：controller 已在本组件随初始树建立（见上方
+          // controllerRef 段），三条出口 setDoc 直通 = 「StageContent 挂载前 doc 已换」——
+          // 树同步由 useDocumentSwitch 的状态判据兜住（首挂不同源 → 补做 reset；S2F [1.8.19]）。
```

### `setDoc(` 全仓扫描结论表（7 点）

| # | 位置 | 形态 | 改 `source`? | 可能发生在 `StageContent` 挂载前? | 判定 |
|---|---|---|---|---|---|
| 1 | `MindmapStage.tsx:256`（`onOpenRecent`：继续上次/最近） | `setDoc(d)` | **是** | **是**（启动页出口） | ⚠️ 原缺陷路径 → **已修**（状态判据补 reset） |
| 2 | `MindmapStage.tsx:261`（`onNew`：新建） | `setDoc(create(...))` | **是** | **是**（启动页出口） | ⚠️ 同上 → **已修** |
| 3 | `useDocumentActions.ts:85`（`applyDoc`） | `setDoc(next)` | **是** | 否（`applyDoc` 定义于 `StageContent` 内，调用者必已挂载） | 安全（非首挂路径照常 reset） |
| 4 | `useDocumentActions.ts:92`（`restoreHandle` 回填） | `setDoc(d => 同 id ? {...d, handle} : d)` | 否（同 id 补句柄） | 否 | 安全（不动 source，不触发切换） |
| 5 | `useDocumentActions.ts:143`（保存成功写回） | `setDoc(d => {...d, savedSource, handle, ts})` | 否（E 批口径：快照写 `savedSource`） | 否（保存动作在挂载后） | 安全 |
| 6 | `useDocumentActions.ts:156`（另存为写回） | 同上形态 | 否 | 否 | 安全 |
| 7 | `useAutoSave.ts:53`（自动保存写回） | `setDoc(d => {...d, savedSource, handle, ts})` | 否 | 否（`dirty` 需编辑，已挂载） | 安全 |

（「看内置示例」不调用 `setDoc`；仅启动页两出口可能「挂载前换 source」——新判据已兜住，且对未来同类路径通用。）

### 门禁原样输出（收口终态）

```
-- kernel --
 Test Files  61 passed (61)
      Tests  523 passed (523)
（KERNEL_EXIT=124：用例跑完、进程挂起（已知现象），以摘要块为准）

-- react --
 Test Files  131 passed (131)
      Tests  1266 passed (1266)
REACT2_EXIT=0
（注：首轮 react 门禁被 300s 超时截断（仅 63/131 文件、零失败）；700s 预算重跑全绿——本机单轮异常，见偏差 #3）

-- canvas --
 Test Files  29 passed (29)
      Tests  203 passed (203)
CANVAS_EXIT=124
（197 + 6 = 203：hook t0/t3/t4 + 三出口 e2e）

-- tsc x3 --
TSC_K=0
TSC_R=0
TSC_C=0

-- depcruise --
✔ no dependency violations found (439 modules, 1250 dependencies cruised)
（438/1249 → +1 模块 = 新测试文件 startup-doc-switch.test.tsx）

-- lint --
Checked 438 files in 543ms. No fixes applied.
Found 1468 warnings.
Found 46 infos.

-- budget --
  any                0      0   持平
  tsIgnore           0      0   持平
  bang              89     90   ↓1 优于
  asCast            31     31   持平
  console            4      4   持平
  todo               1      1   持平
  defaultExport      2      2   持平
  bigFiles           3      4   ↓1 优于

  超 600 行文件（3）：
    apps/canvas/src/MindmapStage.tsx (2315)
    packages/react/src/render/edgeRouting.ts (1235)
    packages/react/src/render/MapView.tsx (2244)

✅ 全部指标在预算内（债务未增长）
```

### `git status --short` 原文（清理后、收口提交前）

```
 M CHANGELOG.md
 M apps/canvas/src/MindmapStage.tsx
?? _tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f
?? outputs/2026-09-14-s2f-doc-switch-sync-report.md
?? tmp-v7-s1.diff
?? tmp-v7-s2.diff
?? tools/graph-engine/
```

### 清理结果

- **执行（本批自产 `tmp-*` 17 个）**：`tmp-s2f-*.log` ×15 + `tmp-rev-t1.diff` + `tmp-rev-t2.diff`，分 4 批（单条 `rm`、≤5 个/批）。
- **保留**：`_tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f`、`tmp-v7-s1.diff`、`tmp-v7-s2.diff`（来源未识别）；`tools/graph-engine/`（禁区）——逐项未动。

## 偏差与原因（汇总）

| # | 偏差 | 原因 | 处置 |
|---|---|---|---|
| 1 | t0 首跑 `TypeError: requestAnimationFrame is not a function` | canvas 套件 `pretendToBeVisual:false`（无 rAF），真 Controller 构造即 notify | 按 delete-key 先例补 rAF 桩（`beforeEach`/`afterEach`）；t0 转绿（判据实证成立）；非判据问题 |
| 2 | e2e/浏览器首轮曾误报「gateway 残留」（稳态前） | 文档切换伴随 M5-T2 过渡：被删节点在 **ghosts 层**淡出（动画期间仍带 `data-node-id`） | 脚本改为「等 `[data-ghost-group]` 清空（≤2.5s）再双边断言」的稳态口径 + ghost 残留计数打印；复现红结论不受影响（目标节点确实缺失） |
| 3 | react 首轮门禁被 300s 超时截断（63/131，零失败，无摘要） | 本机该轮运行速率异常（≈3× 慢） | 700s 预算重跑全绿（131/131、1266、EXIT=0）；报告注明 |
| 4 | 复现截图与终态截图并存 | 终态跑会覆盖同名截图 | 复现态保全为 `s2f-*-repro.png`（两套均留，verify-shots/ gitignored） |

## 待复核 / 下一步（停，等指令）

1. 复核 S2F 三项（判据改动 / 判别钉 / 收口）与「四动作逐字、deps 锁定、t1/t2 意图保持」口径。
2. §范围外（本批未扩展）：`useAutoSave` 的「错位窗口写错文档」链路已随根因修复消失；如需保存侧防御性守卫，另批再议（计划 §1.7 已注明）。
3. push 授权（本批 **未 push**；提交链 `a3eb620 → d7ec9a6 → 收口 docs`）。
