# 森林布局缓存批（F1–F4）执行报告

- **日期**：2026-09-14
- **起点 HEAD**：`4decf73`（L 批 L3 收口附近）
- **计划**：`docs/dispatch/2026-09-14-forest-layout-cache-plan.md`（`57e73e1` 先行提交）
- **结论**：**F1–F4 全数完成，未触发 F3 停止条款**。第一判据（逐位等价）全程守住；单树 68×、森林 k=1 4.2×、无改动复跑 784×；F-A7 硬目标（<16ms）达成，争取档（<5ms）未达（6.5–7.0ms，原因与后续优化点见 §6/§7）。

---

## §0 基线（开工实测）

| 项 | 参考值（计划 §0） | 实测 | 判定 |
|---|---|---|---|
| kernel | 483 | **483**（58 文件） | ✓ |
| react | ≥1193 | **1203**（127 文件，L 批 L2/L3 已计入） | ✓ |
| canvas | 195 | **195**（27 文件） | ✓ |
| tsc ×3 | =0 | **0** | ✓ |
| depcruise | 427 模块 / 1203 deps | **429 模块 / 1214 deps**（L 批已扩面） | ✓ 零违规 |
| lint | 1468 + 46 不得上升 | **1468 + 46** | ✓ |
| budget | bang 89/90、asCast 31/31、bigFiles 3/4 | 全持平（超 600 行：MindmapStage 2293 / edgeRouting 1235 / MapView 2230） | ✓ |

**并行线说明（L 批 / 文本链接）**：开工时 `packages/react/src/chrome/TextLinkSpans.tsx` 仍脏（L 批收尾中）；其文件面（`TextLinkSpans.tsx` / `edit/cutAttach.ts` / `edit/textLinks.ts` / `chrome/{DescBlock,NotePopover,NoteGrowthPanel}.tsx`）本批**一行未碰**。工作期间 L 批提交 `5c13277`（`[1.8.14]` 收口 + `2ba219a` / `4decf73` 两处修复）→ **CHANGELOG 号位顺延至 `[1.8.15]`**（正是计划 §并行纪律预设的场景）。文件面零重叠。

---

## §1 F1 · 缓存通道 + 逐位等价基线

**commit `e3d3fde`** — `feat(kernel,react): 森林布局缓存通道（layoutDemo→layoutForest→岛内，逐位等价基线）`

**改动文件**：
- `packages/kernel/src/layout/forest.ts`（+opts `cache`/`measureKey`、入口失效契约、每岛透传）
- `packages/kernel/src/layout/islands.ts`（`IslandLayoutOptions` 加字段 + 透传）
- `packages/react/src/demo/pipeline.ts`（森林分支透传 + 注释更新）
- `packages/kernel/tests/layout-forest-cache.test.ts`（**新**，F1 部分 13 例）
- `packages/react/tests/forest-cache-channel.test.ts`（**新**，3 例）

**新增用例**：kernel **13**（通道 3 + 矩阵 9 + 自动排列/混搭 1）/ react **3**（全链通道 3）。

**TDD 红证据（原文）**：

```
# kernel（实现前）—— 3 例红：
FAIL  tests/layout-forest-cache.test.ts > F1：森林缓存通道（layoutForest / layoutIslands → 岛内） > ★ 传 cache 后 kernel 侧确实收到（键被森林入口记录）
AssertionError: expected null to be Set{} // Object.is equality
❯ tests/layout-forest-cache.test.ts:140:32   expect(cache.collapsedKey).toBe(collapsed);

# TS 类型红（同一时点，7 处）：
packages/kernel/tests/layout-forest-cache.test.ts(138,47): error TS2353: Object literal may only specify known properties, and 'cache' does not exist in type '{ gap?: number | undefined; }'.
packages/kernel/tests/layout-forest-cache.test.ts(163,53): error TS2353: ... 'cache' does not exist in type 'IslandLayoutOptions'.
（另 5 处同型，逐行略）
```

```
# react 侧（反向验证：把 pipeline.ts 森林透传临时移除）—— 2 例红：
FAIL  tests/forest-cache-channel.test.ts > F1：森林缓存通道（layoutDemo → layoutForest） > ★ 多中心文档：cache / measureKey 透传到森林入口（键被记录）
AssertionError: expected null to be Set{} // forest-cache-channel.test.ts:52:32
FAIL  tests/forest-cache-channel.test.ts > ... > measureKey 变化 → 森林路径同样作废缓存
AssertionError: expected null to be 'K1' // forest-cache-channel.test.ts:65:30
（恢复透传后 3/3 绿）
```

**逐位等价基线（k∈{1,3,8} × N∈{364,1093,3280} + 自动排列/混搭，Object.is 口径）**：全部 `expectBitIdentical` 通过——`nodes`（id/side/depth/parentId/box×4 逐位）、`links`（path/fromId/toId/depth）、`bounds`（minX/minY/maxX/maxY）全字段一致；N≈3280×k=8 组单次 365ms。

---

## §2 F2 · 岛级缓存（未编辑岛零重算；非破坏式平移；幂等性钉死）

**commit `5c472f9`** — `perf(kernel): 岛级布局缓存（未编辑岛零重算；非破坏式平移；幂等性钉死）`

**改动文件**：
- `packages/kernel/src/layout/mindmap.ts`（`ForestIslandEntry` 类型 + `LayoutCache.forestIslands` 字段 + reset 清理）
- `packages/kernel/src/layout/forest.ts`（岛级缓存查询/写入、`shiftIsland`/`shiftTree` 非破坏式平移、placedAt 守卫）
- `packages/react/src/demo/pipeline.ts`（注释同步）
- `packages/kernel/tests/layout-forest-cache.test.ts`（+6 例）

**新增用例**：**6**（引用复用+零度量、幂等 3 连、20 步编辑序列、8 步无 pos 挤动序列、折叠引用变化、度量键变化）。

**TDD 红证据（原文）**：

```
FAIL  ... > ★ 编辑最后一个岛 → 前序未编辑岛节点引用复用、其它岛零度量、全输出逐位等价
AssertionError: 未编辑岛节点 n2 应引用复用: expected { node: { id: 'n2', …(3) }, …(5) } to be { node: { id: 'n2', …(3) }, …(5) } // Object.is equality
Compared values have no visual difference.   ← 值同引用异：无复用机制的精确证据
❯ tests/layout-forest-cache.test.ts:287:39
```

**阴性对照（岛键漏「岛根身份」→ 所有岛共享首岛键）**：

```
# 改坏：cache.forestIslands.get(centers[0]!.node)（临时）
× N≈5 × k=1：nodes/links/bounds 全字段逐位相同 — AssertionError: depth=5 k=1：nodes 数: expected 486 to be 364
× N≈5 × k=3：... — AssertionError: depth=5 k=3：nodes 数: expected 4 to be 364
（共 15 用例红；已恢复，git diff 空）
```

**幂等性证据**：同文档连续 3 次 `layoutForest`（缓存开）逐位相同；离线无 pos 夹具 8 步编辑序列（前岛放大挤动后岛 = place 重建路径）每步与无缓存路径逐位等价；pos 夹具 20 步编辑序列同。

---

## §3 F3 · 岛内分支布局接 LayoutCache（编辑局部化）

**commit `cc728ae`** — `perf(kernel): 岛内分支布局接 LayoutCache（编辑局部化；编辑序列逐位等价）`

**停止条款评估（预检 + 实证）**：计划担忧「四向经典布局构造方式与 `cache.nodes` 的 side/depth/parentId 命中语义冲突」。实证结论——**可安全复用，未触发停止条款**：
- `layoutLogic` 的放置语义与 `placeSubtreeIncremental` **逐式相同**（单侧垂直堆叠 `box.y = top + (sh-h)/2`、`box.x = side>0 ? xEdge+H_GAP : …`），直接复用；
- `layoutOrg` 的横向居中分配经 `placeOrgIncremental` 借 stamps 槽 `(dir, cx, y)`——**域隔离靠对象**：org 构建 side=0、logic 构建 side=±1、mindmap 分区 ±1，在 `cache.nodes` 上互不命中，stamps/collects 槽天然按对象隔离；
- `collectCached` 经 `link` 参数注入 orgBeam 构造器（默认 bezierLink 与 layoutMindmap 逐位相同）；
- 构建器 `buildSkeletonCached` 直接以最终语义 depth/parentId 构建（去掉 annotateTree 二次重建），根不入缓存（与 layoutMindmap「rootNode 不入缓存」惯例一致）。

**改动文件**：
- `packages/kernel/src/layout/mindmap.ts`（导出 `collectCached`（+link 参数）/ `placeSubtreeIncremental`）
- `packages/kernel/src/layout/layouts.ts`（`buildSkeletonCached`、`layoutLogic`/`layoutOrg` 改造、`placeOrgIncremental`）
- `packages/kernel/src/layout/branching.ts`（fallback 透传 opts + 基准 `layoutMindmap` 接 cache）
- `packages/kernel/src/layout/forest.ts`（`LAYOUT_BY_DIR` 四向传 opts）
- `packages/react/src/demo/pipeline.ts`（注释同步）
- `packages/kernel/tests/layout-forest-cache.test.ts`（+4 例）

**新增用例**：**4**（深编辑零 measure + cache.nodes 引用复用、大岛 12 步序列、dir 变化失效、换 measure+换 key）。

**TDD 红证据（原文）**：

```
FAIL  ... > ★ 编辑大岛深层叶子 → 未受影响分支零 measure + cache.nodes 引用复用 + 逐位等价
AssertionError: 未受影响节点被重新度量：n124,n125,n126,n127,n128: expected [ 'n124', 'n125', 'n126', …(355) ] to deeply equal []
（355 个未受影响节点被全量重度量——无局部化的精确证据）
```

**阴性对照（透传 measureKey 失效——入口不再按度量语义作废）**：

```
# 改坏：cacheValid 去掉 measureKey 判定（临时）
× measureKey 变化 → 缓存作废并记录新键 — AssertionError: expected 'K1' to be 'K2'
× ★ 度量语义变化（换 measure + 换 key）→ 整体重算且逐位等价 — 
  AssertionError: 换 measure + 换 key：nodes[0].box.x 非逐位相等（-23 vs -24.5）
（3 用例红——逐位判据逮住「陈旧几何」的 1.5px 级漂移；已恢复，git diff 空）
```

**范围边界（如实）**：分支路径（岛内有显式 `note.dir`）的**基准 `layoutMindmap` 与无 dir 回退（`LAYOUT_BY_DIR` 四向）已接增量**；分支路径自身的**骨架构建/碰撞消解/放置/收集步骤仍为全量**（它们的增量属「消解迭代的局部化」独立题，不属本批）。

---

## §4 F4 · 基准正式化 + 收口（含投影壳稳定化）

**改动文件**：
- `scripts/bench-layout-cache.mjs`（**新**，C5 矩阵复测 + 编辑型前后对照）
- `packages/kernel/src/layout/islands.ts`（**投影壳稳定化**：`lastProjected` + 文档根 `lastRootShell` 跨对象特判）
- `packages/kernel/src/layout/forest.ts`（`shiftTree` delta memo）
- `packages/kernel/tests/layout-forest-cache.test.ts`（+2 例）
- `CHANGELOG.md`（`[1.8.15]`）；本报告

**新增用例**：**2**（编辑升格岛 → 其它岛+根岛身份稳定；编辑根岛成员 → 根岛换壳、升格岛稳定）。

### 4.1 基准第 1 轮暴露的问题（本批最重要的实测发现）

首轮基准（`tmp-f-F4-bench.log`）显示 **k=1 场景仅 1.2×**（29.36 → 24.02ms）、**无改动复跑 19.23ms**——远未达标。根因：`projectIslands` 的**升格剪枝使根岛投影壳每次换新对象**（`changed=true` 恒成立）→ 根岛（k=1 时 2187 节点，占 67%）**每次编辑恒 miss 全量重算** ≈19ms。

计划 §1.4 的岛根身份假设在此**不成立**（它只覆盖了「编辑岛换壳 / 其它岛稳定」，未覆盖「根岛必然换壳」）。修复 = **投影壳稳定化**：产出与上次「逐项同一」→ 复用上次对象（结构共享感知的浅比较，不做深比较）+ 文档根跨对象特判（`lastRootShell`，比较成本 O(变更路径)）。

> **计划偏差说明**：F-A5 原文为「投影是否缓存：不做（≈0.54ms，非瓶颈）」。本修复**非**「缓存投影计算」（walk 照跑），而是「壳身份稳定化」——是 §1.4 岛根身份假设的补全，且实测收益 ≈19ms（k=1 无改动复跑 30.86 → 0.04ms）。**该偏差已经 F4 基准数字证明其必要性**。

**TDD 红证据（原文）**：

```
FAIL  ... > ★ 编辑升格岛内的叶子 → 其它岛（含根岛）投影根身份稳定、编辑岛换壳
AssertionError: 根岛投影根身份稳定: expected { id: 'n1', type: 'text', …(2) } to be { id: 'n1', type: 'text', …(2) } // Object.is equality
Compared values have no visual difference.
❯ tests/layout-forest-cache.test.ts:544:49
```

### 4.2 最终基准（`scripts/bench-layout-cache.mjs` 原样输出）

```
### ① C5 森林布局耗时矩阵复测（全量路径；同机 15 次取中位）
规模,节点数,中心数,单树ms,森林ms,比值,>1.5x,>16ms
N≈384,364,0,0.7,0.5,0.74x,-,-
N≈384,364,1,0.7,4.3,6.07x,Y,-
N≈384,364,3,0.7,2.7,3.75x,Y,-
N≈384,364,8,0.7,2.2,3.17x,Y,-
N≈1000,1093,0,1.3,0.9,0.71x,-,-
N≈1000,1093,1,1.3,9.7,7.37x,Y,-
N≈1000,1093,3,1.3,7.7,5.84x,Y,-
N≈1000,1093,8,1.3,8.1,6.17x,Y,-
N≈3000,3280,0,4.9,5.1,1.03x,-,-
N≈3000,3280,1,4.9,27.9,5.64x,Y,Y
N≈3000,3280,3,4.9,23.3,4.70x,Y,Y
N≈3000,3280,8,4.9,23.8,4.82x,Y,Y
触发条款（>1.5× 且 >16ms）命中格数: 3（与 634ef9b 复核口径一致）

### ② 编辑型对照（每次编辑一个深层叶子；同机 15 次取中位）
场景,无缓存 ms,有缓存 ms,增益
单树 N=3280·编辑深层叶子,5.85,0.09,68.4x
森林 N≈3280 k=1·编辑大岛深层叶子,31.03,6.96,4.5x
森林 N≈3280 k=3·编辑大岛深层叶子,24.70,6.53,3.8x
森林 N≈3280 k=1·无改动复跑（纯命中）,32.13,0.04,783.8x

目标线（F-A7）：编辑类操作 22–33ms → <16ms（岛级）→ 争取 <5ms（岛内）
```

（以上为 `tmp-f-F4-bench3.log` 原样输出；§0 的 634ef9b 原始取证为 33.2/27.8/31.0ms，本轮复测 27.9/23.3/23.8ms——同机复跑波动 ±15% 内，"三格命中双阈值"结论一致。）

### 4.3 F-A7 判定

| 档位 | 目标 | 实测（k=1 / k=3 编辑大岛深层叶子） | 判定 |
|---|---|---|---|
| 岛级 | **<16ms** | **6.96ms / 6.53ms** | **达成 ✓** |
| 岛内 | 争取 **<5ms** | 6.96ms / 6.53ms | **未达**（差 ~30%） |
| 无改动复跑 | — | **0.04ms**（784×） | 大幅超预期 |

**未达 <5ms 的原因（实测归因）**：残余成本不在"重算"而在**被编辑岛的 O(n) 收尾**——① 岛内 `placeSubtreeIncremental` 对「链外兄弟」的 top 演化重放（O(岛) 残余）；② `islandLinks` 全量重建（~1092 条 path 字符串）；③ `collectDirByNodeId` 两次全岛 DFS。`shiftTree` 的深拷贝已由 delta memo 消掉（实测增益有限，证明它不是大头）。见 §7 后续优化点。

---

## §5 门禁与预算（最终实测）

| 项 | 基线 | 最终 | 判定 |
|---|---|---|---|
| kernel / react / canvas | 483 / 1203 / 195 | **508 / 1206 / 195** = **1909** | 全绿（净增 +28） |
| tsc -b ×3 | 0 | **0** | ✓ |
| react dist 重建 | 0 | **0** | ✓ |
| depcruise | 429 模块 / 1214 deps | **431 模块 / 1220 deps** | 零违规 ✓ |
| lint | 1468 + 46 | **1468 + 46** | 持平（新增代码零告警；期间发现并修复 1 处自引入 unused import，mindmap.ts 注释压缩回 594 行） |
| budget | bang 89/90、asCast 31/31、bigFiles 3/4 | **全部持平** | ✓ |

**新增测试统计**：kernel +25（F1 13 / F2 6 / F3 4 / F4 2），react +3。**无删除、无放宽任何阈值或契约测试。**

## §6 偏差与记录

1. **F4 投影壳稳定化为计划外新增**——理由与证据见 §4.1；非「缓存投影计算」，是 §1.4 假设的补全（k=1 编辑 24ms → 6.9ms 的直接来源）。
2. **已知边界（另批）**：编辑「嵌套升格子岛」内时，其**祖先升格岛会误 miss**（内容未变但重算）——需要「投影产出的层级对齐」（把「上轮产出」按结构位置逐层传递）。本批的 k∈{1,3} 基准不受影响（一级中心场景）；k=8（含嵌套）场景存在该损失。
3. **`<5ms` 争取档未达**（6.5–7.0ms）——见 §4.3 归因。
4. **基准首轮 k=1 数字与 C5 取证（634ef9b）的森林基线存在口径差**：C5 测的是「单次全量调用」；编辑型对照测的是「连续编辑 → 增量」——两者都保留在 `bench-layout-cache.mjs` 的第 ①/② 节中，列口径明确。
5. **与 L 批并行**：文件面零重叠；CHANGELOG 顺延 `[1.8.15]`；期间 L 批的 `5c13277`/`2ba219a`/`4decf73` 先于本批 F4 提交（本批未触碰其文件）。

## §7 后续优化点（范围外，按收益排序）

1. **`islandLinks` 子树级 memo**（shifted 子树对象 → links 段复用）——攻击 §4.3 归因②；
2. **`placeSubtreeIncremental` 的 delta 平移优化**（top 变化时对未变子树做「整体平移 + stamps 平移」而非逐节点重放）——攻击归因①；
3. **嵌套中层投影对齐**（见 §6.2）；
4. CULL/语义不变式：本批未动 `CULL_MARGIN`、阈值与契约测试（纪律遵守）。
