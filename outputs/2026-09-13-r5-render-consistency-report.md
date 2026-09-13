# R5 渲染一致性批次报告（跳线折线化 / 边标签层上提 / Canvas 降级提示）

- **日期**：2026-09-13
- **批次**：R5-1 → R5-4（计划 `docs/dispatch/2026-09-13-r5-render-consistency-plan.md`）
- **起点 HEAD**：`bb04a19`（计划文档提交）→ **收口 HEAD**：`2fdfc1d`
- **提交列表**（均未 push）：
  | # | commit | 内容 |
  |---|---|---|
  | 0 | `bb04a19` | docs: 追加 R5 渲染一致性派遣计划 |
  | 1 | `d05a043` | refactor(react): 跳线折线化——pathWithJumps 去贝塞尔弧，边路径统一 M/L |
  | 2 | `859a930` | fix(react): 边标签层上提到节点之上（修遮挡）+ 层序契约与判别测试 |
  | 3 | `a4d9cc4` | feat(react,canvas): Canvas 降级提示（MapStats.backend + 命令告警条 + PerfPanel 后端行） |
  | 4 | `0767992` | test(react): 新测试夹具去非空断言——lint 水位回 1468 基线 |
  | 5 | `2fdfc1d` | docs(changelog): [1.8.11] 渲染一致性 R5 |

---

## 基线复核（开工前实测，§0 校对）

- 测试：kernel **480** / react **1110** / canvas **179** = **1769** 全绿 —— 与计划一致。
- 门禁：tsc ×3 = 0；react dist 重建 = 0；depcruise = 0（409 模块 / 1152 deps）；lint = **1468 warnings + 46 infos**；budget —— bang 89/90、asCast 31/31、console 4/4、todo 1/1、defaultExport 2/2、bigFiles 3/4；超 600 行 = MindmapStage 2249 / edgeRouting 1213 / MapView 2112。
- 工作树：仅计划文档未提交（已先单独提交）+ `tools/graph-engine/`（Python 残留，未动未提交）。

---

## R5-1 · 跳线折线化（`d05a043`）

**改动文件**：`packages/react/src/render/edgeRouting.ts`、`packages/react/tests/edge-routing.test.ts`、`packages/react/tests/edge-routing-fast.test.ts`、`tools/verify-r5-jump.mjs`（新）。

**实现**：`pathWithJumps` 梯形桥四折点（enter → 法向抬起 r → 沿路径跨 2r → 落回 exit），产出只含 M/L；跳线点位置 / 上下判定 / 前后各留 r / 忽略规则 / 无交叉零拷贝 / `fastRouting` 门控 / R4-3② 失效边剔除不动；`inferBowSide`/`onPathPointsOf` 的 C 处理保留（manualBezier 仍产纯 C 径），注释改准。

**测试数（实测）**：react 1110 → **1112**（+2 新增：radius 生效 / 斜线段法向抬起）；目标文件 49 passed。

**红→绿**（目标文件，旧实现 4 failed | 45 passed → 新实现 49 passed）：
- 红证据原文：
  - `AssertionError: expected 'M 0 0 L 45 0 C 45 6.5, 55 6.5, 55 0 L…' not to contain 'C'`（旧拱弧形态）
  - `Expected: "M 0 0 L 42 0 L 42 8 L 58 8 L 58 0 L 100 0" / Received: "M 0 0 L 42 0 C 42 10.4, 58 10.4, 58 0 L 100 0"`（radius=8）
  - `expected 'M 0 0 L 46.46…' not to contain 'C'`（斜线）
  - `assertion error: expected 'M 0 0 L 150 150 L 167.89… C …' not to contain 'C'`（fast 对角线用例）

**三处断言口径变更对照表（非放宽——逐条）**：

| # | 位置 | 旧判据 | 新判据 | 为什么不是放宽 |
|---|---|---|---|---|
| ① | `edge-routing.test.ts` pathWithJumps 用例 | `toContain('C')`（有拱弧） | 不含 C + **全串写死** `M 0 0 L 45 0 L 45 5 L 55 5 L 55 0 L 100 0`（顶点 2+4=6、抬升=radius=5） | 旧判据折线化后恒假；新判据把顶点数 / 抬升高度 / 全串都写死，判别力更强（原断言只断"存在 C"） |
| ② | `edge-routing.test.ts` R3-2 夹具前置 | `toContain('C')` | `M/L/C 指令数 ≥ 4`（确有多段折线） | 同义谓词（该夹具的**真实断言**是 `inferBowSide` 期望 left/right，原样不变——回归钉仍在） |
| ③ | `edge-routing-fast.test.ts` 对角线用例 | d0 `toMatch(/C /)`；d1 `not.toMatch(/C /)` | d0：不含 C + M/L 指令数写死 7（3+4）；d1：**与输入点直出折线逐字相等**（`toBe(pathWithJumps(antiDiagPts, []))`） | d1 旧负例折线化后**恒真**（守卫静默失效）——新判据"未注入任何跳线顶点"保留判别力的等价负例；d0 换成更强形态判据 |

**第 4 处 C 判据核查**（计划未列，实测排查）：`edge-invalid-routing.test.tsx:90` 的 `match(/C /g) > 0` —— 探针实证其 C 计数来自短边**自身贝塞尔形态**（e1.d 含自身 C，与跳线无关），R5-1 不影响 → **未改**。

**真浏览器（before/after）**：`tools/verify-r5-jump.mjs` 两态硬断言 PASS，截图 `verify-shots/r5-jump-{before,after}-{full,zoom}.png`。两态 e0 边 d 原样（节选）：
- before：`… L -81.01496607829642 -4.649033065356386 C -87.05870906325968 -7.041347996904346, -90.73919357333348 2.2567181338083704, -84.69545058837022 4.649033065356329 L -90 18.05…`
- after：`… L -81.01496607829642 -4.649033065356386 L -85.66399914365279 -6.489275320393277 L -89.34448365372658 2.808790810319438 L -84.69545058837022 4.649033065356329 L -90 18.05…`
- 视觉判定：梯形桥清晰可辨、不像断点、与折线主体风格一致（放大 4x 对照）。

---

## R5-2 · 层序契约 + 边标签层上提（`859a930`）

**改动文件**：`packages/react/src/render/EdgeLabelLayer.tsx`（新）、`FreeEdgeLayer.tsx`、`MapView.tsx`、`SectionLayer.tsx`、`render/index.ts`、`src/index.ts`、`tests/mapview-layer-order.test.tsx`（新）、`tests/edge-label-guard.test.tsx`（改走 MapView 组合）、`tools/verify-r5-labels.mjs`（新）。

**测试数（实测）**：react 1112 → **1116**（+4）；新契约文件红→绿闭环：**红 2 failed | 4 passed**（`expected [] to include 'edge-labels'`；`expected null not to be null`）→ **绿 6 passed**；还原 3 文件复跑后 `sha1sum -c` 全部 OK。

**data-layer 序列（契约）**：`sections → tree-links → free-edges → nodes → edge-labels → ghosts → drag`；判别口径 = "序列为契约投影（缺层跳过、相对顺序不变）"，显式钉 `edge-labels > nodes`、`free-edges < nodes`。

**标签数量前后一致证明**：夹具（树线标注 1 + 自由边标签 1）——标签层 `[data-edge-label]` 数 = **2**（= 1 + 1）；`[data-layer="free-edges"] [data-edge-label]` = **null**（已移出原层）。

**命中区反例钉**：`[data-layer="free-edges"] [data-free-edge-hit]` 存在且 `stroke-width=12`；`[data-layer="edge-labels"] [data-free-edge-hit]` = null —— 命中区仍在节点层之下。

**真浏览器**：`tools/verify-r5-labels.mjs` + `verify-shots/r5-labels-{before,after}-{full,zoom}.png`。**偏差（如实）**：最小文档上标签-节点最近约 1 世界 px 贴边**不交叠**（布局/路由把标签天然保持在净空走廊——实测最近 28px 屏幕 / 4px 缝），两态截图**逐字节一致**（zoom 图 sha1 相同）；可见遮挡差异无法在可构造文档中复现 → 层序主验收 = jsdom 契约（data-layer 序列 + 计数 + 反例钉），脚本留作邻接态证据与调参工具。

---

## R5-3 · Canvas 降级提示（`a4d9cc4`）

**改动文件**：`packages/react/src/render/MapView.tsx`（MapStats.backend + differs + 触发 dep）、`tests/canvas-degrade.test.tsx`（新）、`apps/canvas/src/hooks/useCanvasDegradeNotice.ts`（新）、`MindmapStage.tsx`、`PerfPanel.tsx`、`apps/canvas/tests/useCanvasDegradeNotice.test.tsx`（新）。

**测试数（实测）**：react 1116 → **1120**（+4）；canvas 179 → **182**（+3）。

**红→绿**：红 = `expected undefined to be 'canvas'|'svg'`（backend 三处）+ `Failed to resolve import "../src/hooks/useCanvasDegradeNotice"`（hook 文件缺失）；绿 = 4 passed / 3 passed。中途一次红：单独切后端不补报（主 effect 未含后端触发）→ 修复 = deps 显式带 `useCanvas`（biome 中性已对照：带/不带同为 30 warnings）→ 复跑 4 passed。

**损失清单实测（DoD，占位跑原样捕获）**：同夹具 `forceBackend='svg'` vs `'canvas'`：
```
AssertionError: expected 1 to be 9   ← svg 侧 data-tree-edge-label
AssertionError: expected 1 to be 9   ← svg 侧 data-note-badge
AssertionError: expected +0 to be 9  ← canvas 侧 data-tree-edge-label
AssertionError: expected +0 to be 9  ← canvas 侧 data-note-badge
```
→ 实测 = **svg 1 / 1；canvas 0 / 0**，与计划 §1.3 清单一致（树线标注 chip + note 角标丢失）；落为回归钉（`canvas-degrade.test.tsx` 内写死 1/1 与 0/0）。

**去重行为测试**（hook，3 passed）：t1 svg→canvas 提示恰 1 次、同文档重复上报不再提示；t2 切文档后再进 canvas 再提示 1 次（去重键 = 文档）；t3 svg 态静默 + docId null 防御。

**文案终稿**：
> 已进入大图模式（Canvas）：为保住帧率，边标签与注释角标暂不渲染（可见节点超过 5 万自动切换）。折叠部分分支可回到完整渲染。

（"折叠可恢复"判据 = `resolveBackend` 吃折叠裁剪后的可见节点数；PerfPanel 增「后端」行。）

---

## 门禁与预算（终态全量实测）

- 测试：kernel **480** / react **1120** / canvas **182** = **1782 全绿**（R5 批 +10）。react 终态复跑（含 lint 修复后）= `Test Files 119 passed / Tests 1120 passed`。
- tsc：kernel / react / canvas `tsc -b` 全 0；react dist 重建 = 0。
- depcruise：`✔ no dependency violations found (414 modules, 1167 dependencies cruised)`（+5 文件为新模块与新测试；零违规）。
- lint：`Found 1468 warnings. Found 46 infos.`（持平原水位；过程记录：终检曾 1473（+5，两个新测试夹具的非空断言）→ 提交 `0767992` 修复 → 复跑回 1468）。
- budget（原样）：
  ```
  bang 89/90 ↓1 · asCast 31/31 · console 4/4 · todo 1/1 · defaultExport 2/2 · bigFiles 3/4 ↓1
  超 600 行：MindmapStage.tsx (2254) / edgeRouting.ts (1221) / MapView.tsx (2182)
  ✅ 全部指标在预算内（债务未增长）
  ```
- 冻结纪律：阈值 / 契约测试零放宽（R5-1 的三处口径变更均为**判别式加强**并逐条列明）；`CULL_MARGIN` 未动；新文件均 <600 行；`git add` 全程显式路径；未 push；未动 `.codebuddy/` 与 `tools/graph-engine/`。

## 与计划的偏差

1. **R5-2 真浏览器层序截图无可见差异**（见上）——层序主验收落 jsdom 契约；脚本保留为邻接态证据。（计划 §4 风险 3 的"标签压节点文字"对照未能构造；层级修复本身已由契约测试全覆盖。）
2. **第 4 处 C 判据**（`edge-invalid-routing:90`）经探针实证与跳线无关 → 未改（计划只列 3 处；此为核查记录）。
3. **lint 终检 +5 → 修复**：新增测试夹具的 `!` 断言（`noNonNullAssertion`）——补提交 `0767992` 归零；属"新增代码零告警"纪律补正。
4. **行数**：MapView 2112 → 2182（+70，略超计划预估的 +30~60；层序契约注释 + 标签层 + stats 字段的注释面）；edgeRouting 1213 → 1221；MindmapStage 2249 → 2254。均无新增超限文件。
5. **R5-3 触发路径补强**：计划只写"并入材料字段"，实测发现主 stats effect 的 deps 不含后端 → 显式加 `useCanvas` 触发 dep（区别于计划原文的最少改动路径，但为"后端变化必然触发上报"的必要条件）。

## 发现（范围外，未修，建议后续批次）

**`stableByKeys` 跨文档误复用**（G-P1 内容键稳定化）：
- 机制：`stableByKeys` 仅按「长度一致 && 逐项 key 一致」复用旧数组——文档切换后新边集 key 相同（如 e0/e1）而内容全新时，返回**旧解析树**的边。
- 后果：边的 `sourceId/targetId` 指向已丢弃的树 → `boxOf` 全落空 → 自由边**整层不渲染**（viable user-visible 缺陷）。
- 实测证据：React fiber 探针读到 FreeEdgeLayer props：`feEdges id = ndmtzprrmd…` vs `documentRoot/layout id = ndmtzprs111…`（不同 id 空间）；`boxOf(sourceId)` / `boxOf(targetId)` 全部 `undefined`。
- 触发条件：切换前后自由边**数量相同**且 key 序列相同（gateway 2 条 → 任意 2 条边文档）。
- 本批绕开：verify 脚本改用 3 边演示文档（脚本注释有指向）。
- 建议修复方向：稳定化带**来源换代检查**（如记录产出时的 rootNode / layout 身份，换代即弃 prev）或加内容判据。

---

## 停止点

R5-1 → R5-4 全部完成并收口（CHANGELOG `[1.8.11]` 已提交）。**停下等放行 R6**（`attrs` / `cid:` 锚对齐）。
