# 后续开发指导

> 日期：2026-09-02 · 基于当前实测状态编写
> 门禁基线：**755 全绿**（kernel 297 + react 443 + canvas 15）
> 相关：`CONTRIBUTING.md`（规范）· `docs/2026-09-02-code-structure-plan.md`（结构规划）
> · `docs/specs/2026-09-02-mm-md-protocol.md`（协议规格）

---

## 一、当前状态快照

| 层 | 文件 | 行数 | 最大文件 |
|---|---|---|---|
| `packages/react` | 70 | 11,437 | MapView.tsx (1,293) |
| `packages/kernel` | 37 | 4,194 | goldenCases.ts (557) |
| `apps/canvas` | 8 | 1,993 | MindmapStage.tsx (1,691) |

质量指标（生产代码口径）：`any` 0 · `@ts-ignore` 0 · 非空断言 94（冻结）· 超 600 行文件 4 个。
**债务预算门禁全部在预算内**。

---

## 二、一个诚实的战略判断

**代码结构治理的边际收益已经明显下降，建议转向产品价值。**

理由：

1. 今天 8 个提交解决了结构上的主要欠账——导出面显式化、债务预算门禁、
   协议规格书、序列化格式保真、两个大组件的第一轮拆分。
2. 剩下两个拆分靶点（MapView 主函数 1,093 行、StageContent 面板区 ~600 行）
   都是**高风险、长耗时、但不直接产生用户价值**的工作。
3. 对照 `docs/roadmap/2026-08-30-next-phase-roadmap.md`，项目自定的下一阶段是
   **S 产品壳 → F 自用周 → B 线 AI 回归**，而这三步**一步都没开始**。
   其中「F 自用周」的核心产出是**真实缺陷清单**——它是下一轮功能规划的**唯一事实源**。

> 换句话说：继续把 MapView 拆到 700 行，不会告诉你用户真正需要什么；
> 拿 mindcanvas 管理自己的真实工作一周，会。

**建议的投入分配**：结构治理 ≤ 20%，产品壳与自用验证 ≥ 80%。

---

## 三、待办优先级矩阵

| 优先级 | 事项 | 类型 | 阻塞方 | 预估 |
|---|---|---|---|---|
| **P0** | 建 git 远端（I1）并推送 | 风险 | **需你的凭证** | 30 分钟 |
| **P1** | S 产品壳（S1 布局 / S2 启动页 / S3 PWA / S4 崩溃恢复） | 产品 | 无 | 2–3 天 |
| **P1** | F 自用周（7 天零开发，只记摩擦） | 验证 | 无 | 7 天 |
| P2 | MapView 主函数拆分（1,093 行） | 结构 | 无 | 1–1.5 天 |
| P2 | StageContent 面板区拆分（~600 行） | 结构 | 无 | 1 天 |
| P3 | 清理遗留文件 | 卫生 | 需你确认 | 5 分钟 |
| P3 | B 线 AI 回归（B1 插件骨架 → B4 闭环） | 产品 | 依赖 F 周结论 | 待定 |

### P0 · git 远端 —— 唯一「做错会归零」的事

当前**无 remote**，全部 13 个提交与 9 月迄今的成果仅存本机磁盘。
更麻烦的是仓库历史**已断裂**：只有 2026-09-01 之后的提交，8 月历史在
`E:\Development\MyAwesomeApp\mindcanvas-backup-20260831.bundle`（157 commits）。

建好远端后建议**两份 bundle 都推上去留档**（它们历史不连续，无法自动拼接）。

步骤见 `docs/setup/forgejo-remote-push.md`。

### P1 · S 产品壳

现状：`apps/canvas` 仍是 demo 形态（gateway 单文档硬编码入口 + 浮层堆叠），
不具备「打开就用」的应用形态。这直接导致 B4 的「自用 1 周」无法真正发生。

| 子项 | 内容 | 验收 |
|---|---|---|
| S1 | 浮层堆叠 → 固定侧栏/抽屉统一入口 | 手机/平板可操作 |
| S2 | 最近文档启动页 + 新建向导 | 打开即见「继续上次/新建/最近」 |
| S3 | PWA 最小壳（manifest + SW） | 断网可用 |
| S4 | 错误边界 + 崩溃恢复引导 | 崩溃后重开有引导 |

> 提示：S1 会动 `StageContent` 的面板组织方式。**建议先拆面板区再做 S1**，
> 否则会在 1,343 行的函数里改布局，回归风险陡增。

### P1 · F 自用周

把 PomodoroXI 迁移、MySkill-Hub 技能路线、mindcanvas 自身 roadmap 画成 `.mm.md`，
每日使用，**只记录摩擦与缺陷，不修功能**。

产出按「阻碍我完成任务」排序的缺陷清单 —— 这是下一轮功能规划的唯一事实源。

### P2 · 两个拆分靶点（若要继续做）

**MapView 主函数（1,093 行）**
- 体量来自 43 个 Hooks 与交织的指针手势，交互区在 `L609+`
- 建议拆 `render/interactions/`：`usePan` / `useZoom` / `usePointerSelect` / `useContextMenu`
- 风险：渲染核心，43 个 Hooks 依赖顺序，改动直接影响全部交互
- **前置**：先确认 `packages/react` 现有测试对交互的覆盖程度，不足则先补

**StageContent 面板区（~600 行）**
- 10 个面板需传 20+ props
- ⚠️ **已实测：jsdom 下整体渲染 MindmapStage 会挂起（SIGTERM）**，
  所以无法用整体渲染建立回归保护
- 两条路：① 接受 typecheck 保护谨慎搬迁 ② 先在 react 侧给单个面板补组件测试

---

## 四、纪律速查（改代码前先看）

### 门禁

```bash
pnpm gate:fast   # 提交前：typecheck + depcruise + lint + budget（~1 分钟）
pnpm gate        # 推送前：+ 755 测试（2-3 分钟）
pnpm budget      # 债务预算（只减不增）
pnpm analyze     # 结构实测
```

### 三条最容易犯的错

1. **按「本仓库内是否被消费」删导出符号** —— 会删掉 ADR-0004 冻结的 53 个对外扩展点
   （`KindRegistry` / `LayoutRegistry` / `MindNode` / `ParseResult` …）。
   它们不被本仓库消费，恰恰因为是给外部三项目用的。**删前先跑**
   `node scripts/analyze-export-classification.mjs`。
2. **块注释里写 `*/`** —— 会提前终止注释导致解析失败。要表述时写「星号紧跟斜杠」。
3. **新增导出忘了加进 `packages/*/src/index.ts`** —— 入口已是显式具名清单，
   不加就不会被导出。这个摩擦是有意的。

### 环境坑

| 现象 | 解法 |
|---|---|
| `pnpm -r test` SIGTERM | 分包单独跑（kernel / react / canvas） |
| vitest 改源码后冷启动挂起 | 先单独跑一个小测试预热缓存，再跑全量 |
| vitest 整体挂起时的替代验证 | 用 vite-node 跑纯函数诊断脚本，稳定得多 |
| 根 `npx tsc` 装到废弃假包 | 用 `packages/*/node_modules/.bin/tsc` |
| 根 `tsx` 破损 | 用 `cd apps/canvas && npx vite-node scripts/*.mts` |
| 跑 TS 脚本提示模块找不到 | 含 JSX 的模块 import 必须带 `.tsx` 扩展名 |

---

## 五、需要你拍板的三件事

1. **P0 远端**：给 Forgejo 凭证或自己执行 `docs/setup/forgejo-remote-push.md`。
   在此之前，所有新产出都只有一份。
2. **方向选择**：继续结构治理（拆 MapView / 面板区），还是转向 S 产品壳 + F 自用周？
   我的建议是后者（见 §二）。
3. **两个遗留文件**：`split-stage.mjs`（一次性脚本，自述"执行后删除"）、
   `MindmapStage.pre-split.bak`（拆分前备份）。
   二者**均未进任何备份**，删了不可恢复。拆分已验证通过，留着只是让 `git status` 一直脏。
