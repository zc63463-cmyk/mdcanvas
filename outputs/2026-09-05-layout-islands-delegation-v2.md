# 可直接复制的外派实现任务书 v2（基于真实代码基线重编）

> v1 的已知问题：基线引用过期（写作时 HEAD 6f3af86，实际主线已推进到 c0107c7）、
> 未区分「已实现 / 已修复 / 仅安全降级」、部分已存在能力（中心拖动链路）被当成待开发。
> v2 依据 2026-09-05 复审实测重写；v1 保留于同目录供对照，以本文为准。

## 使用方法

先由用户审查 design 中的 G1–G3，再发以下总任务书。若未批准，只派 A0 基线与契约评审，
不默认启动实现。两位实现者可分别领 A1、A2，集成人统一接管公共文件。
三个文件（design / plan / 本任务书）必须一起提供，不依赖原会话。

---

## 0. 真实代码基线（2026-09-05 复审实测，开工必须重新核实）

主线 HEAD：`c0107c7`（fix(centers): 一级中心约束 + 无效标注安全回退）。
复审修复在隔离 worktree `E:/Development/MyAwesomeApp/mindcanvas-g6-review`
（detached HEAD @ c0107c7），**尚未提交**，共 7 文件：

```
M apps/canvas/src/MindmapStage.tsx
M packages/react/src/demo/pipeline.ts
M packages/react/src/render/MapView.tsx
M packages/react/src/render/centers.ts
M packages/react/tests/centers-pipeline.test.ts
M packages/react/tests/centers.test.ts
M packages/react/tests/free-edges.test.tsx
```

集成人合并前必须逐文件复核真实 diff，不凭本回执直接合并。

### 状态分类（四档，不得混称）

**① 已实现且经复审确认（不要重复开发）**
- forest 四向布局 `packages/kernel/src/layout/forest.ts`（`layoutForest`，四向映射 + 自动横排）。
- 中心数据层：`root.note.centers` / `root.note.center_pos`，升格/降格菜单、中心拖拽
  `isCenter → onCenterMove → upsertCenter → updateNote` 坐标写回链路已接入 Stage。
- 无有效中心时 pipeline 返回 `null`，上层回退 `layoutMindmap` + `LayoutCache`。
- 视口裁剪 / LOD / Canvas 后端自动切换阈值（50000 仅是阈值，非实测容量）。

**② 本轮复审已修复（在上述 worktree，带回归测试，勿重做）**
- `upsertCenter` 只改方向时被历史坐标覆盖/丢当前坐标 → 显式成对坐标优先级修复
  （`centers.test.ts` 回归）。
- `buildCenterSpecs` 重复 `nodeId` 重复输出中心 → first-wins 去重
  （`centers-pipeline.test.ts` 回归）。
- **`MapView` 文档根/几何根混用**（本轮 P0）：`layout.nodes.find(n => n.depth === 0)`
  在森林布局下取到中心节点而非文档根，导致 `root.note.edges` 丢失、折叠路由错根。
  修复：新增 `MapViewProps.documentRoot?`（缺省回退首个几何根，兼容既有调用方），
  `MindmapStage` 显式传 `controller.root`（`free-edges.test.tsx` ★ 回归 + 变异验证）。
- **Stage `centerIds` 与 pipeline 资格过滤不一致**：Stage 原从 `collectCenters` 全量收集，
  深层中心「能拖但布局不认」。修复：`centerIds` 改从 `buildCenterSpecs` 结果派生（同源）。

**③ 仅安全降级（不是根治，属于后续工作包范围）**
- 标题改名后中心路径锚 `dangling`：当前安全忽略不崩溃，但**没有引用迁移**
  （旧路径→nodeId→新路径→验证唯一指向）。归 A2。
- 一级中心资格限制（`buildCenterSpecs` 只认根直接子节点）：`c0107c7` 的止损措施，
  深层升格当前被忽略而非报错。归 A1 递归投影，**不得裸删除守卫**。

**④ 未覆盖需求（全新开发，G1–G3 未批准前不得实现语义）**
- 任意深度布局岛（递归投影、唯一 owner、跨岛边界线）。
- 切断父子树边 / 断开子树独立坐标 / 显式接回。
- 引用迁移事务（改名/移动/切线的锚点一致性）。
- 中心拖动的实时整子树预览、Esc/pointercancel/blur/切文档取消路径、缩放竞态验收。
- 向上布局（org-up）不同父子高度的几何探针。
- Canvas 后端自由边渲染（当前 Canvas 模式不画自由边，文件头已注明）。

---

## 1. 总任务书（复制本节）

你要在 mindcanvas 实现「布局岛：多中心+自由摆位+树形子树生长」，不是迁移 Godot。

必须先读：
1. `outputs/2026-09-05-layout-islands-design.md`
2. `outputs/2026-09-05-layout-islands-plan.md`
3. 项目 CONTRIBUTING.md、当前 .mm.md 协议、ADR-0004 和现有 tests。
4. 本文件第 0 节「真实代码基线」——四档状态分类，禁止把①②档当需求重做。

用户已批准产品核心：升格是能力增强；任意深度节点可升格；切断父子线后的子树根可携带
子树移动；保留 Tab/Enter 生长、折叠、四向。不要把它改成仅一级中心，也不要让所有普通
节点都必须存坐标。

G1–G3 若没有明确批准记录，你的首个交付仅为基线/契约评审与待确认清单，不能实施这些
产品语义。不得把任务书中的「推荐」说成用户拍板。

### 已知现状补充（相对 v1 的增量）
- `MapView` 已有 `documentRoot?` prop（复审修复②）：你的布局岛投影接入时**必须**传完整
  文档树，禁止从布局投影推断文档根；`FreeEdgeLayer.root` 语义同此。
- Stage 的 `centerIds` 已与 `buildCenterSpecs` 同源：A1 替换一级过滤为递归投影时，
  手势资格应继续从「同一份校验结果」派生（design A3 边界），不得再造第二份判定。
- 活跃历史为 `OpHistory`（单步 TreeOp），不是快照式 History<T>。

### 工作边界与纪律

先 Issue，再隔离分支/worktree。不直接推 main，不绕过 hooks（历史提交 8420813/6f3af86/
c0107c7 均用了 --no-verify，这是违规先例，不得延续），不覆盖他人的 diff，不删除
.workbuddy。不存在 Issue 号时要求分配/授权创建，不编造。
你只实施明确领取的工作包。触及他人文件先协调；公共入口、pipeline、MapView/Stage 接线
由集成人合并。不修改无关资产系统、不引入 Godot/DI/CRDT，不用新增依赖逃避业务不变量。

### 实现顺序

A0 确认 → A1 投影与 A2 事务并行 → A3 接入 → A4 拖动与 A5 切线按接口协同 → A6 集成验收。
每包先失败用例、再最小实现、再类型检查和回归。测试具体行为，不用 assert(true) 或
只检查常量存在冒充回归。

### 强制正确性

1. 每节点唯一 owner，布局 ID 不重复；布局投影不写回源树。
2. complete documentRoot 用于文档元数据与锚解析，不读投影 children
   （`MapView.documentRoot` 已立，遵守其语义）。
3. 中心本体坐标稳定，展开 note/编辑 desc 不漂移；旧坐标样例兼容；0 是合法坐标。
4. 拖动实时显示整岛；pointermove 不写文档，pointerup 一次 undo；
   Esc/cancel/blur/切文档无副作用。
5. 切线是领域事务，保留子树内容；与自由边删除分开。
6. 应用内改名/移动引用按节点身份迁移，不做字符串替换；新歧义阻止提交。
7. 初次无 note → 加中心 → undo 恢复字段缺失；事务中任一步失败完全回滚。
8. 保存重新解析产生新 id 后仍能操作；后端/导出不静默丢线。

### 验收与报告

逐条填写 plan 的 T01–T24，未完成写未完成。分别报告单测、类型、全 gate、真实浏览器
操作、性能，不能互相替代。至少三条指定变异回归证明测试会红（本轮复审已示范一条：
`documentRoot` 回退几何根 → ★ 回归变红）。记录命令/退出码/用例数/日志位置。

不要把生成代码当成完成。最终回执：基线 SHA、分支、Issue、改动文件、实现和未实现清单、
测试结果、截图/录屏、性能、接口变化、风险与回滚范围。若碰到协议不能表达、身份歧义或
平台限制，停下受影响工作包，提交具体证据与选项，不擅自降级用户需求。

---

## 2. 外派 A1：布局纯函数专项（复制本节并附总任务书）

你只负责 plan A1，不负责 UI/历史/协议改写。依据 design 第 4 节设计 `projectIslands`，
递归划分内容树，升格节点从父岛投影剔除；遇独立后代再划新岛。输出唯一 owner、边界线、
诊断，保留不可变源树。

现状：`pipeline.ts` 的 `buildCenterSpecs` 一级过滤（`firstLevelIds`）是 c0107c7 止损，
**不能作为最终算法**；深层中心当前被静默忽略（③档）。复用 `kernel/layout/forest.ts`
四向布局（`LAYOUT_BY_DIR`/`LINK_BY_DIR` 映射已含 up）。核心测试：深层与嵌套、重复中心、
坏锚、根中心、折叠覆盖、无中心回退（回退路径经 LayoutCache 的行为必须保持）。
不得修改 pipeline、MapView、Stage 和公共 index，导出需求写回执交集成人。
新增纯函数放 kernel/layout 合理文件，保持零 DOM/React 依赖。
G1 未定只提交候选契约和测试规格。

## 3. 外派 A2：历史与引用专项（复制本节并附总任务书）

你只负责 plan A2。当前 `kernel/src/tree/tree-op.ts` 有单步 TreeOp 与 OpHistory，需原子
批次而不引入第二个历史栈。阅读 invertOp/updateNode 对 undefined 和字段删除的语义，
先验证初次写 note 再 undo 的恢复行为。

按 design 第 5/6 节实现/提出 `applyTransaction`，暂存全批验证、逆操作按逆序、失败零
副作用、成功一次通知。引用按前后树同一会话 nodeId 迁移，盘点 centers、center_pos、
edges、links、groups，不碰未知字符串。新路径歧义拒绝提交。保留原 apply(op) 兼容，
不改 UI/布局；公共 index 与 Stage 由集成人接。报告所有新增 API 与失败结果形状。
注意：标题改名后的 dangling 锚目前仅被安全忽略（③档），你的引用迁移是它的根治路径。

## 4. 集成人提示

先批准接口再接代码。对 A1/A2 及复审 worktree（g6-review，7 文件未提交）的真实 diff
逐文件复核，不凭代理回执合并。A3/A4/A5 需要的共享 MapView/Stage 修改由你统一持有；
复审修复（documentRoot / centerIds 同源 / upsertCenter / 去重）合并后才能开始 A3 接线。
每日重新核查工作区，不拿旧 SHA 覆盖新实现。没有批准 G2 时先完成已批准的升格路径，
不自行实现一种切线存储方案。

---

## 5. 已验证可用的命令与环境限制（2026-09-05 实测）

可用（隔离 worktree 实测，日志落盘读取——沙箱 stdout 管道不可靠）：

```bash
# react 包定向/全量测试
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
  "packages/react/node_modules/vitest/vitest.mjs" run --root "packages/react" [文件名过滤]
# react 类型检查（本次 EXIT=0）
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
  "packages/react/node_modules/typescript/bin/tsc" -b "packages/react/tsconfig.json" --pretty false
# react 构建（dist 供自引用测试 demo-plugin.test.ts；不构建则该文件解析失败——环境问题非代码问题）
cd packages/react && "E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
  node_modules/typescript/bin/tsc -p tsconfig.build.json
# biome lint（单文件 EXIT=0；仓库既有 warning 不是失败）
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
  node_modules/@biomejs/biome/bin/biome lint <files>
```

阻塞（如实标注，不得把「没跑成」写成「通过」）：
- `pnpm`（含 corepack 形式）：Windows/Bash 递归调用报「不是内部或外部命令」，完整
  `pnpm gate` 未跑成——typecheck/test/depcruise/lint/budget 各阶段未在 gate 内验证。
- `wmic.exe` 被安全策略拦截，禁止绕过重试。
- 隔离 worktree `apps/canvas` 无 node_modules，`tsc -b apps/canvas` 报 TS2688
  （vite/client 缺失）——MindmapStage.tsx 的改动仅经 react 包类型与 lint 间接覆盖，
  集成人合并前须在完整环境跑 apps/canvas typecheck。
- 本轮 react 全量结果：74 文件 / 609 用例全绿（构建 dist 后）；kernel 包定向测试此前
  已全绿；depcruise / budget 未跑。
