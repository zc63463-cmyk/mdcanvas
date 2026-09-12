# M5-T8 大规模性能基准与降级策略（perf-baseline）

> 日期：2026-08-29 · 阶段：M5（画布产品深度）· 数据实测：本机（Windows 11，Node 22）
> 结论先行：**布局引擎不是瓶颈，渲染侧连线构建 + DOM 规模才是**。与开工基线判断一致。

## 一、基准方法（可复现）

```bash
# 1. 构建全部包
pnpm -r build
# 2. 计算侧基准（布局/裁剪/连线构建/增量编辑，纯 node，无浏览器）
node scripts/bench-scale.mjs
# 3. DOM 首帧代理（jsdom；裁剪兜底 → 可见集小，度量「布局+派生+裁剪+DOM 提交」完整计算成本，为保守上界）
pnpm --filter @mindcanvas/react test -- --run tests/perf-scale.test.tsx
# 4. T6 增量布局对比测试（含 9841 节点性能门禁 < 30%）
pnpm --filter @mindcanvas/kernel test -- --run tests/layout-incremental.test.ts
```

测试树：4 叉树，深度 6/7/8 → **5461 / 21845 / 87381 节点**（与 K 阶段基线同构）。
度量口径（全部中位数，20 样本）：

| 项 | 定义 |
|---|---|
| 全量布局 | `layoutMindmap` 无缓存（布局 + 收集 + 包围盒） |
| 可见集过滤 | 全量节点 × 视口矩形（最坏情形 = 全图入视口） |
| 连线构建 | 可见连线 bezier path 字符串构建（渲染侧 `buildLinkPath` 同价） |
| 首帧计算 | 首次布局 + 可见集过滤 + 连线构建（DOM 时间浏览器相关，另见 jsdom 代理） |
| 平移重绘上限 | `1000 / (可见集过滤 + 连线构建)`——每帧计算成本模型（DOM 更新同量级，实际 ≤ 此值） |
| 增量编辑 | T6 `LayoutCache` 命中下单节点编辑 relayout |

## 二、实测数据（2026-08-29，本机）

### 计算侧（scripts/bench-scale.mjs）

| 节点 | 全量布局 | 可见集过滤 | 连线构建 | 首帧计算 | 平移重绘上限 | 增量编辑 | 增量占比 |
|---|---|---|---|---|---|---|---|
| **5,461** | 4.7 ms | 0.07 ms | 1.4 ms | **6.1 ms** | **679 fps** | 0.09 ms | 2.0% |
| **21,845** | 26.3 ms | 0.64 ms | 8.7 ms | **35.7 ms** | **107 fps** | 0.37 ms | 1.4% |
| **87,381** | 152.6 ms | 4.0 ms | 48.1 ms | **204.7 ms** | **19 fps** | 1.67 ms | 1.1% |

### DOM 首帧代理（jsdom，tests/perf-scale.test.tsx）

| 节点 | 首帧提交（jsdom，保守上界） | 说明 |
|---|---|---|
| 5,461 | 99.8 ms | jsdom DOM 创建远慢于真实浏览器（10–50×）；真实首帧以计算侧为准 |
| 21,845 | 75.2 ms | 同量级噪声（JIT 预热） |
| 87,381 | 279.9 ms | 计算侧 205 ms + DOM 提交 |

### 开工基线对照（K 阶段）

| 节点 | K 基线布局中位 | M5 布局中位 | 变化 |
|---|---|---|---|
| 5,461 | 31.0 ms | 4.7 ms | 更快（测量环境差异 + 结构共享） |
| 21,845 | 111.8 ms | 26.3 ms | 同上 |
| 87,381 | 377.9 ms | 152.6 ms | 同上 |

## 三、规模上限判定（<50fps 可感知卡顿门槛 = 单帧 >20ms）

| 档位 | 首帧（布局主导） | 平移重绘（连线构建主导） | 判定 |
|---|---|---|---|
| ≤ 5K | 6 ms ✅ | 679 fps ✅ | **全功能无限制** |
| 5K–20K | 26 ms ⚠️（折叠/编辑一次性顿挫可感知） | 107 fps ✅ | **正常可用**；编辑响应由 T6 增量兜底（0.37 ms） |
| 20K–50K | 35–150 ms ❌（首帧明显卡顿） | 107→19 fps ⚠️ | **需降级** |
| > 50K（87K 实测） | 153 ms ❌ | 19 fps ❌ | **必须降级** |

**结论：规模上限 ≈ 20K 节点（全量视图下），50K 以上必须启用降级。**

- 布局侧扩展性良好（87K 仅 153 ms，非主瓶颈）——与开工判断一致
- 真正的瓶颈 = 可见连线构建 + DOM 元素量（87K 时 48 ms/帧）
- 增量布局把「编辑响应」压到全量的 ~1%，编辑本身在任何档位都无感

## 四、降级策略（按触发档位逐步启用）

| 降级级 | 触发条件 | 措施 | 落点 |
|---|---|---|---|
| L0 无降级 | ≤ 5K | 全功能（动画过渡/拖拽/LOD full/全量连线） | 现状 |
| L1 LOD 激进 | > 5K 或帧耗时 >16ms | `detail`/`skeleton` 阈值提前（叶文本省略、深度 ≥3 只画卡）；连线 LOD（远处只画直连） | `geometry.ts lodFor/lodSkipText`（常量可调，M5 未改默认值） |
| L2 动画降级 | > 3000 节点 | 节点位置过渡跳过动画直接落位（已实现：`NODE_ANIM_MAX_NODES=3000`） | `motion.ts`（T2 已落地） |
| L3 Canvas 后端 | > 50K 或帧耗时 >33ms | 切 `RenderBackend` Canvas 实现（T7 接口已就绪，场景原语可直译绘制调用）；DOM 元素量从 O(可见节点) 降到 O(1) | `backend.tsx`（T7 已落地抽象，Canvas 未实现） |
| L4 提示用户 | > 50K | 状态栏提示「图过大，已启用简化渲染」；建议折叠深层分支 | 应用层（待接入） |

**建议默认配置**（后续应用层接线）：
- 5K 内全量体验（当前默认）
- 超 5K：L1（激进 LOD）
- 超 20K：L2 已有 + L1 强制
- 超 50K：L3 Canvas 后端（下一迭代） + L4 提示

## 五、工程记录

- T6 增量布局把编辑 relayout 压到全量 1% 左右（87K 节点 1.67 ms）——大规模编辑的体验瓶颈已消除
- T7 后端抽象为 Canvas 切换提供接口与场景原语（节点卡/文本/连线/图片/分组）
- 既有计时抖动（非本次引入）：kernel `benchmark-layout.test.ts` 线性度检查、react `perf.test.ts viewMs<8ms` 在并行负载下偶发超时——建议后续放宽为双倍中位数而非绝对阈值

## 六、交互性能基线（批次 B · 2026-09-12）

> 命令：`node tools/bench-interaction.mjs http://localhost:5174`（真浏览器，需先起 canvas dev server）
> 场景：清 localStorage → 默认 demo 文档（25 节点）→ 20 步空白拖拽平移（+360px / −120px）

### 6.1 机制指标（pan 期节点 DOM 变更）

| 指标 | 口径 | 2026-09-12 基线（改动前） |
|---|---|---|
| `nodeMutations` | 落在节点 `g[data-node-id]`（自身或内部）的 DOM 变更次数 | **0** |
| `nodeMountChurn` | 裁剪引起的整节点挂载/卸载数 | 0（25 节点全部在视口内，无裁剪） |
| `childListTotal` / `attributesTotal` | 全文档变更数（参考项） | 0 / 161 |
| `frameGapMsP50` / `P95` | pan 窗口内 rAF 间隔 | **17 / 17 ms** |
| `nodesBefore` → `nodesAfter` | 可见节点数 | 25 → 25 |
| `panApplied` | 投影 `transform` 是否变化（平移生效证据） | **true**（x 783.1 → 1143.1） |

**口径修正（P0 实测证伪计划预期）**：计划 B-P0 预期基线 `nodeMutations > 0`（"现状会 > 0 → P2 先红"）。
实测在**平移确实生效**（投影 transform 已变）的前提下 `nodeMutations = 0` —— React 的结构复用已避免节点
DOM 重挂。pan 期的 DOM 变更只有两类：(a) 节点 g 内部重挂（实测 0）；(b) 裁剪引起的整节点挂/卸载
（单独计 `nodeMountChurn`，属**预期行为**，memo 也不应消除）。
因此 **P2 的判别性机制指标改用「节点组件渲染次数」**（jsdom 里对 `NodeG` 做模块级计数封装：
现状每次 pan × 每个可见节点各渲染一次 → 先红；memo + 稳定 props 后归零 → 绿），
本表 `nodeMutations` 转为**非回归守卫**（P1/P2/P3 后必须仍为 0）。

> 侦察记录（避免后人重复踩坑）：①「打开即有大图」不可达 → 按计划在 25 节点 demo 上测机制指标；
> ②节点 g 的 DOM 命中不可靠（`elementFromPoint` 落在 `svg` 上，节点盒几何须用 `getBoundingClientRect`
> 自行排除），起点选择已改为「网格扫描 + 距节点盒 ≥28px + topmost=svg」；
> ③起点落在节点盒上会静默变成**节点拖拽**（投影 g 的 children 多一层、transform 不变）——`panApplied`
> 字段就是为此设的证据位。

### 6.2 规模指标（`node scripts/bench-scale.mjs`，2026-09-12 复跑）

| 节点 | 全量布局 | 可见集过滤 `cullMs` | 连线构建 | 首帧计算 | 平移重绘上限 | 增量编辑 |
|---|---|---|---|---|---|---|
| 5,461 | 9.0 ms | **0.15 ms** | 1.7 ms | 10.8 ms | 536 fps | 0.12 ms |
| 21,845 | 48.9 ms | **2.08 ms** | 12.6 ms | 63.6 ms | 68 fps | 0.46 ms |
| 87,381 | 178.7 ms | **8.06 ms** | 53.0 ms | 239.7 ms | 16 fps | 4.80 ms |

> 与 2026-08-29 记录（0.07 / 0.64 / 4.0 ms）相比偏高，属本机环境抖动（同日多次复跑亦有 ±30% 波动）；
> P1 的 `cullMs ↓≥50%` 判定以**同日复跑**为对照基准。

## 七、性能地基复测（批次 B · 2026-09-12 · P0→P3 四列对照）

> 命令：`node tools/bench-interaction.mjs http://localhost:5174`（真浏览器）+ `node scripts/bench-scale.mjs`（纯计算）
> 场景与口径见 §6；P0 列为改动前基线，P1/P2/P3 为各任务落地后实测。

| 指标 | P0 基线 | P1（网格索引） | P2（memo 稳定化） | P3（节流 + LOD 冻结） |
|---|---|---|---|---|
| 真浏览器 `nodeMutations`（pan 期节点 DOM 变更） | 0 | 0 | 0 | 0 |
| 真浏览器 `nodeMountChurn`（裁剪挂/卸节点数） | 0 | 0 | 0 | 0 |
| 真浏览器 `attributesTotal`（全文档属性写入数） | 161 | — | — | **101** |
| 真浏览器 `frameGapMsP50/P95`（pan 帧间隔） | 17 / 17 ms | 17 / 17 | 17 / 17 | 17 / 17 |
| jsdom `NodeG` 渲染次数（2 次纯平移） | **10**（P2 红灯证据） | 10 | **0** | 0 |
| jsdom `onStats` 回调次数（10 次 epoch · 窗口内） | — | — | 逐次（10） | **1** |
| `cullMs` 最坏情形（全图入视口）@5K/20K/87K | 0.15 / 2.08 / 8.06 ms | 0.13 / 0.70 / 4.25 | 同 P1 | 同 P1 |
| 典型视口裁剪 · 线性 @5K/20K/87K（P1 同跑） | — | 0.34 / 3.54 / 12.33 ms | — | — |
| 典型视口裁剪 · **索引** @5K/20K/87K | — | **0.06 / 0.10 / 0.12 ms** | — | 0.05 / 0.05 / 0.08 ms |
| 加速比（线性 ÷ 索引） | — | 6.0× / 35.4× / 105.9× | — | 6.7× / 17.1× / 40.0× |

> 典型视口 = 1280×800 @ k≈0.74（≈1730×1080 世界单位）居中 + 128 外扩，与 MapView 的双重 margin 用法一致；
> 线性列跑次间波动大（3.54 vs 0.91 ms @20K），索引列稳定在 0.05–0.12 ms —— 这本身就是「与节点总数解耦」的证据。

**性能门禁对照（一条都不许放宽；实测全部通过且多数优于基线）**

| 门禁 | 阈值 | 本批实测 |
|---|---|---|
| `perf.test.ts` layoutMedianMs（681 节点） | < 250 | **2.22**（P2 前同机 1.92，属噪声） |
| `perf.test.ts` viewMs | < 12 | **0.292**（P2 前 0.493 → ↓41%） |
| `acceptance-10k.test.tsx` firstCommitMs（9841 节点） | 硬门禁 | **87.8**（P2 前 123.3 → ↓29%） |
| `perf-scale.test.tsx` 首帧 jsdom 代理 @5K/20K/87K | 记录对照 | **96.9 / 72.1 / 256.9 ms**（§二 记录 99.8 / 75.2 / 279.9 → ↓3% / ↓4% / ↓8%） |
| `edit-perf.test.ts`（681 节点编辑） | < 100 ms | 通过（套件内断言） |
| `mapview-nodebox` / `mapview-section-drag` / `hit-node-index` 契约 | 全绿 | 全绿（P1 等价性 7 例含 pad 边界与 skip） |

### 决策 B4：**P5（transform-only DOM 路径）不做**

判定规则（计划 §B-P4）：① 机制指标 == 0 且 ② `cullMs` ↓≥50% 且 ③ 既有门禁无劣化 → 不做 P5。

- ① ✅ **机制指标归零**：jsdom `NodeG` 渲染次数 10 → **0**（纯平移期间零重渲染）；
  真浏览器 `nodeMutations` 恒 0、帧间隔 17/17 ms 无劣化（`attributesTotal` 161 → 101，节流后父壳写入亦降）。
- ② ✅ **规模指标**：典型视口裁剪 0.33→0.05 / 0.91→0.05 / 3.25→0.08 ms（↓85% / ↓95% / ↓98%），
  索引路径跨 5K→87K 近似恒定。⚠️ 口径：**最坏情形列（全图入视口）不因索引改善**（全部可见时索引退化为
  线性 + 排序开销），计划原文的 ↓≥50% 指交互中的典型视口 —— 故本表两口径分列，避免误读。
- ③ ✅ **门禁无劣化**：上表全部通过，多数优于基线。

**结论：transform-only 经实测不必要（P5 不做）** —— pan 期节点 DOM 重建已被 P2 归零，
P5 的收益面已不存在，而其视觉回归风险（计划 §B-P5 自述）仍在；按「开关 + 回滚」要求不予实施。

**本批记录但未修（计划 §3 风险 3）**：`visibleFreeEdges` 每帧重算（O(E×N)，`MapView.tsx` 的
`view.x/y/w/h` 依赖击穿 `FreeEdgeLayer` 的 routes memo）—— 属自由边避障批次；P4 复测显示 pan 帧间隔
仍为 17 ms（本机 demo 规模下不可观测），故不在本批处理。

### P6 / P8 / P9 追加（收口轮 · 2026-09-12）

| 项 | 内容 | 机制指标 |
|---|---|---|
| **P6 SearchPanel 检索 memo** | `results` 改 `useMemo([query, search])`（原先渲染体内直算 `search(query)` 全树 walk —— 父组件每帧重渲、甚至 ↑/↓ 的 `setActive` 都重跑）；注入方 `SidePanels` 的 search 闭包 `useCallback([controller])` 稳定（调用时实时读 `controller.root`） | jsdom 判别（`tests/search-panel-memo.test.tsx` ×2）：同 props 重渲染 / setActive 各 **+1 → 0** 次 walk；改 query 恰 +1；换 search 引用重算（deps 契约）。**OutlinePanel 记录**：递归渲染整树（`OutlinePanel.tsx:84` 的 `children.map`）= 每次面板渲染一次全树 walk —— 按计划不虚拟化，另立批次 |
| **P8 NodeG memo 守卫** | 新增 `tests/nodeg-memo-guard.test.ts`（无 vi.mock，直接断言生产导出 `$$typeof === Symbol.for('react.memo')`） | 阴性对照：临时摘掉 `NodeG.tsx` 的 `memo()` → 守卫**精确变红**（`expected 'function' to be 'object'`）→ 恢复复绿。补上复核发现的缺口：pan-memo 用例的 mock 自带 memo，守护不到生产侧 memo 存在性 |
| **P9 导出 deps** | `useExportActions` 两个 `useCallback` deps 补 `boundaryLinks`（lint `useExhaustiveDependencies` ×2 → **0**）；连带修「PNG 失败降级 SVG 不带 boundaryLinks」的既有不一致（与直出 SVG 同口径） | hook 级判别测试（`useExportActions.test.tsx` +1）：同 layout 只换 boundaryLinks → `exportSvg`/`exportPng` 收到新值（修复前收到旧闭包值，红） |



