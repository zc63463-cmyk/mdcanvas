# 后续开发指导

> 日期：2026-09-02 · 基于当前实测状态编写
> 门禁基线：**764 全绿**（kernel 297 + react 443 + canvas 15）
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
| ~~**P0**~~ | ~~建 git 远端并推送~~ | 风险 | ✅ **已完成** | — |
| **P1** | S2 启动页（recent 数据已有，只差 UI） | 产品 | 无 | 0.5–1 天 |
| **P1** | F 自用周（7 天零开发，只记摩擦） | 验证 | 依赖 S2 | 7 天 |
| P2 | S1 布局收口（浮层 → 侧栏/抽屉） | 产品 | 无 | 1–2 天 |
| P2 | MapView 主函数拆分（1,093 行） | 结构 | 无 | 1–1.5 天 |
| P2 | StageContent 面板区拆分（~600 行） | 结构 | 无 | 1 天 |
| P3 | S4 崩溃恢复引导（ErrorBoundary 已有，缺 UX） | 产品 | 无 | 0.5 天 |
| P3 | ~~S3 PWA~~ | — | **已完成** | — |
| P3 | 清理遗留文件 | 卫生 | 需你确认 | 5 分钟 |
| P3 | B 线 AI 回归（B1 插件骨架 → B4 闭环） | 产品 | 依赖 F 周结论 | 待定 |

### ~~P0 · 建 git 远端~~ ✅ 已完成（2026-09-02）

已推送至 <https://github.com/zc63463-cmyk/mdcanvas>（18 个提交，938 KiB）。

⚠️ **两点待确认**：

1. **该仓库当前是公开的**。提交前确认不含私密内容；若需私有，
   在 GitHub 仓库 Settings → Danger Zone 改可见性（或重新建为私有仓库再改 remote）。
2. **仓库名是 `mdcanvas`，项目名是 `mindcanvas`** —— 若是有意缩写则忽略；
   若是笔误，用 `git remote set-url origin <新地址>` 即可改，无需动历史。

**仍遗留**：8 月历史（157 commits）尚未进远端——它只存在于 bundle，
且与当前历史不连续、无法自动拼接。若想归档，可单独建分支推上去（见下）。

**这里要的只是一个 git 远端，不是 Forgejo。** 之所以一直提 Forgejo，
仅因为本机已跑着 `localhost:3001` 实例，是个现成选择——
换成 GitHub / Gitee / GitLab / 甚至本地裸仓库（`git init --bare`）都一样。
**它纯粹是代码备份，与项目功能无关**，别把它理解成要接入 Forgejo 集成。

> 关于 Forgejo 在本项目的真实角色，见 §五「范围澄清」。

建好后建议**两份 bundle 都推上去留档**（它们历史不连续，无法自动拼接）。

### P1 · S 产品壳

现状：`apps/canvas` 仍是 demo 形态（**入口硬编码 gateway 单文档** + 面板仍是浮层堆叠），
不具备「打开就用」的应用形态。但**基础能力比预想的多**（2026-09-02 复核）：

| 子项 | 实际状态 | 依据 |
|---|---|---|
| S1 布局收口 | ❌ 未做 | 面板仍是 `position: absolute` 浮层（SearchPanel / OutlinePanel） |
| S2 启动页 | ⚠️ **数据层已有，缺 UI** | `DocumentHost.recent()` 已实现（localStorage，上限 8，新在前）；但入口硬编码 `gateway.mm.md` |
| S3 PWA | ✅ **已完成** | `public/manifest.webmanifest` + `public/sw.js` + `main.tsx` 注册 |
| S4 崩溃恢复 | ⚠️ **部分完成** | `App.tsx` 已有 `ErrorBoundary`；缺「崩溃后重开的引导」UX |

**所以 S2 是真正的阻塞点**：`recent()` 已经把最近文档存好了，
只差一个启动页把它用起来——这是投入产出比最高的一项。

> ⚠️ 早期文档曾写「S 产品壳一步未启」——**那是错的**，PWA 早已落地。
> 做任何规划前先 grep 源码确认，别信文档里的状态描述（本项目 README 就曾严重过时）。

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
pnpm gate        # 推送前：+ 764 测试（2-3 分钟）
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

---

## 五、范围澄清：什么是核心，什么是周边

这一节回答「为什么要用到 Forgejo？项目到底是不是纯文本思维导图？」

### 项目确实是**纯文本导向**的思维导图

| 层 | 定位 | 依据 |
|---|---|---|
| 数据层 | **纯文本** | `.mm.md` 是事实源（`README`）；`document.ts` 注释「local-first 不接 Forgejo」 |
| 渲染层 | 轻度行内富文本 | `kernel/src/layout/inline.ts` 支持 `**加粗**` / `` `code` `` / `[label](url)`，仅影响展示 |

所以：**存的是纯文本，显示时支持行内富文本**。富文本不是数据格式，只是渲染效果。

### Forgejo 在项目中是**周边，不是依赖**

实测（2026-09-02）：

- `packages/*` 与 `apps/*` 的 `package.json` **没有任何 forgejo 依赖**
- 源码里提到 forgejo 的地方**全是注释**，且都在说「可换实现」：
  - `entityStore.ts`：宿主可换（Forgejo / 远端实体源）实现同一接口
  - `document.ts`：文档宿主契约（可换实现：Forgejo / Tauri / 云端）
  - `save.ts`：local-first，不接 Forgejo

Forgejo 的真实身份是**三面镜子之一**（`docs/mirrors/README.md`）：

| 镜子 | 性质 |
|---|---|
| 1. Forgejo 联动（forgejo-bridge） | **未来首个插件**，当前未实现 |
| 2. MarkVault-JS MindFlow 标注 | 设计约束 |
| 3. PomodoroXI 接入设想 | 设计约束 |

「三面镜子」的用途是**验收内核扩展点够不够用**——每设计一个扩展点，
问「这三个消费者要挂进来，插口够不够」。它们是**设计标尺，不是当前功能**。

### 结论

- **不要**为了 Forgejo 改变核心：`.mm.md` 解析 / 序列化 / 布局 / 渲染才是主战场
- Forgejo 相关分两种，别再混淆：
  1. **作为 git 远端** —— 纯备份，任选服务商，与功能无关
  2. **作为 forgejo-bridge 插件** —— 三面镜子之一，当前零代码，等 F 自用周的
     真实需求出现后再评估是否值得做
- 实体 kind 里的 `issue` / `pr` / `milestone` 只是**开放的引用类型**，
  解析不了就是 unresolved，不依赖任何 Forgejo 连接

---

## 六、需要你拍板的三件事

1. **P0 建一个 git 远端**（任选服务商，Forgejo 只是本机现成选项之一）。
   在此之前，所有新产出都只有一份。
2. **方向选择**：继续结构治理（拆 MapView / 面板区），还是转向 S 产品壳 + F 自用周？
   我的建议是后者（见 §二）。
3. **两个遗留文件**：`split-stage.mjs`（一次性脚本，自述"执行后删除"）、
   `MindmapStage.pre-split.bak`（拆分前备份）。
   二者**均未进任何备份**，删了不可恢复。拆分已验证通过，留着只是让 `git status` 一直脏。
