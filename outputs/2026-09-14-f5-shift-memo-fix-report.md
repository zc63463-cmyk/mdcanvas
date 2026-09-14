# F5 执行报告：shiftTree memo 陈旧几何修复（F 批复核阻塞项收口）

- **日期**：2026-09-14
- **起点 HEAD**：`0f722ef`（F4 收口后）
- **计划**：`docs/dispatch/2026-09-14-f5-shift-memo-fix-plan.md`（`777c667` 先行提交）
- **结论**：F5-1 → F5-3 全部完成。`shiftTree` delta memo 已移除（回归钉矩阵转正）；同族盘点**未发现第二个缺口**；bench 修复后 k=1 **6.36ms** / k=3 **6.71ms**（<16ms 达成）。**不 push，等复核授权。**

---

## §F5-1 · 移除 delta memo + 探针转正

**commit `cafa20f`** — `fix(kernel): 移除 shiftTree delta memo（陈旧几何；探针矩阵转正为回归钉）`

**改动文件**：
- `packages/kernel/src/layout/forest.ts`（−17/+13：删除 `shiftedMemo` 声明 / memo 查询 / memo 写入，`ShiftedMemoEntry` → `ShiftedEntry`，`shiftTree` 每次实算、返回形态不变）
- `packages/kernel/tests/layout-forest-shift-invariance.test.ts`（**新**，转正；8 场景 = 四方向 × 两种 measure；**断言口径原样保留**）
- （`tmp-probe-shiftmemo.test.ts` 为未跟踪探针文件，转正后删除——不进 git）

**红证据（转正后、修复前，原文）**：

```
× dir=right / h恒定：热缓存 → 深节点文本加长 → 与无缓存逐位等价 46ms
× dir=right / h随文本：热缓存 → 深节点文本加长 → 与无缓存逐位等价 15ms
× dir=left / h恒定：热缓存 → 深节点文本加长 → 与无缓存逐位等价 14ms
× dir=left / h随文本：热缓存 → 深节点文本加长 → 与无缓存逐位等价 11ms
✓ dir=down / h恒定 ✓ dir=down / h随文本 ✓ dir=up / h恒定 ✓ dir=up / h随文本
Tests  4 failed | 4 passed (8)

AssertionError: dir=right/h恒定：nodes[84](n5).box.x 陈旧/漂移（1022 vs 1058）: expected false to be true // Object.is equality
AssertionError: dir=right/h随文本：nodes[84](n5).box.x 陈旧/漂移（1022 vs 1058）: expected false to be true // Object.is equality
```

（差 36px = 被编辑节点宽度增量；与复核证据链 §1.1 一致。）

**绿证据（修复后，原文）**：`Tests 8 passed (8)`；内核套件 **516/516**（60 文件，`508 + 8` 转正用例）。

**修复前后代码对照（git diff 摘要）**：

```diff
 /**
- * 平移副本 memo（F4 优化）：local 子树 → 副本（+ 生成它的 delta + 子树前序）。
- *
- * 未变子树（对象身份）+ 同 delta（岛 origin 未变）→ 直接复用上次副本与前序段
- * （O(变更路径) 而非 O(岛大小)）；delta 变化（岛被挤动）→ miss → 重建。
- * 正确性：副本 = f(local, delta) 纯函数——同输入可复用（delta 用精确比较）。
+ * 平移副本（**每次实算——不可 memo**，F5 复核证据链）：
+ * 任何「身份 + 部分输入」的 memo 都不充分——条目有效性要求「整棵源子树的 box 均未变」，
+ * 而岛内放置重放会**原地改写复用 LayoutNode 的 box**（F3 机制），身份相等 ≠ 几何未变
+ * （实测：memo 只校验 (dx,dy) 时，深层 w-编辑可只改后代 box 而岛 dx/dy 不变 → 命中
+ * 返回陈旧副本，n5 差 36px 且持久）。「补 node 自身 box 校验」同样不充分：只覆盖祖先
+ * 自身、不覆盖后代被改写的情形。故放弃 memo；复核实测代价 ~2.1ms，远低于 16ms 预算。
+ * 回归钉：`tests/layout-forest-shift-invariance.test.ts`（四方向 × 两种 measure 矩阵）。
  */
-interface ShiftedMemoEntry {
-  dx: number;
-  dy: number;
+interface ShiftedEntry {
   shifted: LayoutNode;
   preorder: LayoutNode[];
 }
 
-const shiftedMemo = new WeakMap<LayoutNode, ShiftedMemoEntry>();
-
-/** 平移副本树 · memo 版（全新对象；对源树零写入） */
-function shiftTree(ln: LayoutNode, dx: number, dy: number): ShiftedMemoEntry {
-  const hit = shiftedMemo.get(ln);
-  if (hit && hit.dx === dx && hit.dy === dy) return hit;
+function shiftTree(ln: LayoutNode, dx: number, dy: number): ShiftedEntry {
   const children = ln.children.map((c) => shiftTree(c, dx, dy));
   const shifted: LayoutNode = { ...ln, box: { x: ln.box.x + dx, y: ln.box.y + dy, w: ln.box.w, h: ln.box.h }, children: children.map((c) => c.shifted) };
   const preorder: LayoutNode[] = [shifted];
   for (const c of children) { for (const n of c.preorder) preorder.push(n); }
-  const entry: ShiftedMemoEntry = { dx, dy, shifted, preorder };
-  shiftedMemo.set(ln, entry);
-  return entry;
+  return { shifted, preorder };
 }
```

（`shiftIsland` 调用面未改：仍 `const entry = shiftTree(root, dx, dy); … entry.preorder / entry.shifted`。）

**新增用例**：**8**（转正，非新增新场景——与复核探针一一对应；内核计 508 → 516）。

---

## §F5-2 · 同族风险盘点（只出结论，无改动）

判据：键（key）→ 键了哪些输入 → 充分性依据 → 缺口结论。核心抽查法：**「条目有效性所依赖的输入，是否全部在键比较的覆盖内」**——特别区分**「可变字段」（box.x/y，会被放置重放原地改写）与「不可变构造字段」（box.w/h、children，构造后无写入面）**。

| # | 机制 | 键（key） | 键了哪些输入 | 充分性依据 | 缺口结论 |
|---|---|---|---|---|---|
| 1 | `cache.nodes` | EditableNode 身份 | `side` / `depth` / `parentId`（+ 全局 `collapsedKey`/`measureKey` 作 reset 闸） | 复用条件覆盖「树结构 + 位置」全部构件；box.x/y 由 **stamps 独立守卫**、box.w/h 不可变 | ✓ 充分 |
| 2 | `cache.heights` | EditableNode 身份 | （同上，全局键控） | 子树高 = f(结构, measure, collapsed)——三类输入全在键内 | ✓ |
| 3 | `cache.stamps` | LayoutNode 身份 | `(side, top, xEdge)`；org 域借位 `(dir, cx, y)` | 盒 = f(放置参数)（确定性）+ 归纳不变量「盒恒为最近一次 f(参数)」；域隔离防跨族混读 | ✓（**本族安全样板**） |
| 4 | `cache.collects` | LayoutNode 身份 | 内容 = f(盒, 线型构造器)；盒变化由「place 重放路径逐节点 `delete`」覆盖 | 未重放子树盒未变 → 缓存有效；线型域以对象隔离（logic/mindmap 同 bezier，org 独立对象槽） | ✓ |
| 5 | `cache.bounds` | LayoutNode 身份 | 同上（盒） | 同 collects 的 delete 机制；生产消费仅 layoutMindmap（logic/org 出口用 `layoutBounds` 重算） | ✓ |
| 6 | `cache.forestIslands` | 岛根身份 + `dir` | 岛树内容由身份保证；measure/collapsed 全局键控 | 不可变树 ⇒ 同对象 ⇒ 内容不变（投影壳稳定化保障身份可靠） | ✓（方向性：可能过度 miss，不会错命中） |
| 7 | `entry.placed`（placedAt 守卫） | `at`（origin x/y 全等） | `local`（由 entry 命中保证未变）+ `at` | placed.result = f(local, at) 纯函数；local 变化 ⇒ entry 必 miss ⇒ placed 不参与 | ✓ |
| 8 | `lastProjected` | EditableNode 身份 | `sameShell` 字段完备比较（id/type/text/url/ref/note 引用 + children 逐项 ===） | 逐字段 + 逐子比较；不全等即拒绝（保守方向，宁 miss 不错命中） | ✓ |
| 9 | `lastRootShell` | 单槽 + `sameShell`（跨对象） | 同 #8（文档根） | 同 #8；跨对象以 sameShell 兜底（根换壳场景） | ✓ |
| 10 | `__subtreeHeightCache`（模块级，HP1） | LayoutNode 身份 | `box.h` + children 集合 | **box.w/h 与 children 构造后无写入面**（grep 全仓确认）⇒ 条目永真、无需失效 | ✓（**与 shiftTree 的关键差异**：依赖不可变字段 vs 可变字段） |
| 11 | ~~`shiftedMemo`~~ | ~~LayoutNode 身份~~ | **只键 `(dx,dy)`**，未覆盖「源子树 box 未变」 | ✗ 依赖的 box.x/y **会被 place 原地改写**（身份相等 ≠ 几何未变） | **真缺口 → 已修复（F5-1 移除）** |

**观察项（非缺口，如实上报，未夹带改动）**：
1. **`placeSubtree`（非增量版）**：全仓已无生产调用方（唯一引用为自身递归）；其盒写入无 stamps 守卫，但因无调用方不构成活性风险。属 ADR-0004 冻结导出面，未清理。
2. **`__subtreeHeightCache` 无失效机制**：分析后安全（仅依赖不可变字段，见 #10）；如需防御性注释可在未来批次补充。

**结论：无第二个真缺口**（与 shiftTree 同构的「身份 + 部分输入 + 可变字段依赖」模式仅此一例，已修复）。

---

## §F5-3 · 收口

### bench（`node scripts/bench-layout-cache.mjs` 原样输出）

```
### ① C5 森林布局耗时矩阵复测（全量路径；同机 15 次取中位）
规模,节点数,中心数,单树ms,森林ms,比值,>1.5x,>16ms
N≈384,364,0,0.7,0.5,0.78x,-,-
N≈384,364,1,0.7,4.8,6.91x,Y,-
N≈384,364,3,0.7,3.1,4.48x,Y,-
N≈384,364,8,0.7,2.4,3.40x,Y,-
N≈1000,1093,0,1.4,0.9,0.64x,-,-
N≈1000,1093,1,1.4,10.3,7.46x,Y,-
N≈1000,1093,3,1.4,7.2,5.21x,Y,-
N≈1000,1093,8,1.4,7.2,5.21x,Y,-
N≈3000,3280,0,4.2,4.0,0.96x,-,-
N≈3000,3280,1,4.2,28.2,6.74x,Y,Y
N≈3000,3280,3,4.2,23.5,5.62x,Y,Y
N≈3000,3280,8,4.2,24.8,5.93x,Y,Y
触发条款（>1.5× 且 >16ms）命中格数: 3（与 634ef9b 复核口径一致）

### ② 编辑型对照（每次编辑一个深层叶子；同机 15 次取中位）
场景,无缓存 ms,有缓存 ms,增益
单树 N=3280·编辑深层叶子,4.68,0.09,52.1x
森林 N≈3280 k=1·编辑大岛深层叶子,30.80,6.36,4.8x
森林 N≈3280 k=3·编辑大岛深层叶子,24.49,6.71,3.6x
森林 N≈3280 k=1·无改动复跑（纯命中）,28.73,0.03,951.2x

目标线（F-A7）：编辑类操作 22–33ms → <16ms（岛级）→ 争取 <5ms（岛内）
```

**核对**：k=1 **6.36ms** / k=3 **6.71ms**——均 **<16ms ✓**（未触发"中位 >16ms 停下"条款；参考值 8.37/7.86ms 为复核时点数字，本机复跑更优）；单树 52.1×、无改动复跑 951× **未回退**。

### 门禁（复跑，原样输出）

| 项 | 实测 | 判定 |
|---|---|---|
| tsc -b ×3 | **0** | ✓ |
| depcruise | **432 模块 / 1224 deps**（+1 模块/+4 deps = 新测试文件的自然增量），零违规 | ✓ |
| biome lint | **1468 warnings + 46 infos**（431 files，持平） | ✓ |
| budget | bang **89/90**、asCast **31/31**、bigFiles **3/4**（持平） | ✓ |
| kernel | **516/516**（60 文件） | ✓ |
| react | **1206/1206**（128 文件） | ✓ |
| canvas | **195/195**（27 文件） | ✓ |

三包合计 **1917**。

### 清理（定向执行结果）

`git status --short` 原文（清理后）：

```
?? tools/graph-engine/
```

- 已清：`tmp-f-src.diff`、`tmp-f-src2.diff`、`tmp-l-wire.diff`、`tmp-l2.diff`、`tmp-l4.stat`；本批过程日志 `tmp-f5-*.log`（含 red/green/bench/tsc/depcruise/biome/budget/三包 full）——**全部清理完毕**。
- **本次清理清单中未出现（复核后不复存在，如实记录）**：`tmp-f-suite-{k,k2,r,c}.log`、`tmp-f-probe{,.2,.3}.log`、`tmp-f-bench-{on,off}.log`——开工时工作树即无这些文件。
- **保留并提交**：`packages/kernel/tests/layout-forest-shift-invariance.test.ts`（唯一例外，转正回归钉）。

---

## 偏差与原因

1. **修复后 bench 快于复核参考值**（k=1 6.36ms vs 参考 8.37ms；k=3 6.71 vs 7.86）：机器状态/噪声波动范围内，且移除 memo 后省去了每节点的 WeakMap 查询开销；两者均远低于 16ms 硬目标，判定不受影响。
2. **depcruise 计数上升**（431/1220 → 432/1224）：转正测试文件的模块与依赖边自然增量，零违规不变。
3. **转正文件行数** 153 行（探针 143 行 + 回归钉头部注释扩写）：8 场景与断言口径逐字保留，仅注释与文件头改写（计划 §F5-1 要求）。
4. 其余无偏差：`CULL_MARGIN` 与一切阈值/契约测试未动；未 push；未动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`。

**然后停——等复核与 push 授权。**
