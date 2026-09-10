# 进度深度定位 + 单文件·升格id（cid）开发规划

日期：2026-09-05 晚 · 方法：Git 元数据 + 源码核查 + 实跑验证三路交叉 · 基线：`a3-integration @ ed3cd93`

---

## Part 1 · 当前开发进度深度定位（实测，非文档转述）

### 1.1 坐标：哪条线是活的

| 线 | 位置 | 状态 |
|---|---|---|
| **a3-integration（活线）** | `ed3cd93` | 布局岛 A1–A6 全部落地于此 |
| main | 落后 **5 个提交**（a453a98…ed3cd93） | ⚠️ A3–A6 尚未合回 main |
| a1-layout-islands / a2-history-tx / fix/centers-review | 全部 behind=10 | 已完全合并，可清理 |
| worktree：mindcanvas-g6-review | fix/centers-review，干净 | 使命完成，可移除 |
| worktree：a1-islands / a2-history | 各自分支顶点 | 已合并，可移除 |

### 1.2 已合入基线（逐提交核实）

| 提交 | 内容 | 关键文件 | 测试 |
|---|---|---|---|
| 06bccd2 | 复审四项修复（documentRoot / centerIds 同源 / upsertCenter / 去重） | MapView、MindmapStage、centers、pipeline | 随包验证 |
| acfa4bb | **A1 递归布局岛投影** | kernel/layout/islands.ts（299 行） | layout-islands.test.ts（268 行） |
| 247b86d | **A2 applyTransaction + planReferenceMigration** | kernel/tree/tree-op.ts、registry/anchor-migrate.ts（338 行） | tree-transaction + anchor-migrate（474 行） |
| a453a98 | A3-1 pipeline 接入递归投影（一级限制已退役） | react/demo/pipeline.ts | centers-pipeline 扩 |
| 2ff0f33 | 浏览器验收修复：任意深度升格入口 + 实体锚中心 | contextMenuItems、centers.ts | +25 |
| a1fcc64 | A3-2 跨岛父子连接渲染 + 中心诊断 UI（G3） | MapView、MindmapStage | +68 |
| 163b647 | **A4 中心岛拖动实时整岛预览 + 取消路径** | MapView、useMapGestures | mapview-center-drag（163 行） |
| ed3cd93 | **A5 切断树边/接回子树（G2）+ A6 验收** | edit/cutAttach.ts（364 行）、导出/Canvas 门禁 | cut-attach（278 行）+ bench-islands-a6.mjs |

质量抽查结论（读源码，非凭提交信息）：
- `islands.ts`：单次 DFS、唯一 owner、first-wins、结构化诊断、detached 不产生容器边——与设计 §4 一致
- `anchor-migrate.ts`：nodeId 语义迁移（before 解析 → after 重建 → 回解析验证），冲突整批拒绝，**非字符串替换**——与 design §5 一致
- `cutAttach.ts`：切断=子树移为文档根直接分支+detached 标记+引用迁移+applyTransaction 原子提交；深度上限 5（H1–H6）结构化拒绝——与 G2 推荐方案一致

### 1.3 实测健康度（主工作树，2026-09-05 22:50）

| 项 | 结果 |
|---|---|
| kernel 测试 | **45 文件 / 364 用例全绿**（EXIT=0） |
| react 测试 | **77 文件 / 641 用例全绿**（EXIT=0） |
| typecheck（kernel+react+canvas tsc -b） | **EXIT=0** |
| 浏览器验收 | verify-shots/ 15+ 张截图（深度升格/实体升格/拖动/undo/重开持久化） |
| pnpm gate 全链 | 未复跑（depcruise/budget 未在本轮验证，合并 main 前需补） |

### 1.4 未入库产出

- `outputs/`：架构决策报告、布局岛 design/plan/delegation v1+v2、多文件聚合探索（均不依赖合入）
- `verify-shots/`：A6 浏览器验收截图
- `docs/2026-09-05-project-graph-调研与减法设计.md` 有未提交修改；`edge-natural-preview.png` 未跟踪

### 1.5 风险与注意（P 级）

- **P1-① G1/G2/G3 语义已在代码中按推荐方案落地**（islands.ts 头注「G1 已批准语义」；detached=G2 文档根承载；parent_link=G3 缺省 hide）。若你未正式批准，现在是**追认或调整的最后低成本窗口**——cid 规划将建立在这些语义之上。
- **P1-② main 落后 5 提交**：A3–A6 在 a3-integration 上未合回；且历史存在 --no-verify 先例，合回前必须跑完整 gate（depcruise/lint/budget 未在本轮验证）。
- **P2-①** 三个已合并分支与两个完成使命的 worktree 可清理（先确认 main 同步后）。
- **P2-②** bench-islands-a6.mjs 已存在但其性能数据未纳入本轮核查。

---

## Part 2 · 单文件 + 升格id（cid）开发规划

### 2.1 路线选型（五个候选的诚实对比）

| 候选 | 判断 | 理由 |
|---|---|---|
| **A. 节点级 cid + cid 锚方案（推荐）** | ✅ 主路线 | 身份在节点上人/agent 可见；`cid:c7` 升级为内核锚方案后 edges/links/groups 全部受益 |
| B. 仅 root 注册表 cid | ❌ | agent 需两次跳转（注册表→at 路径），而 at 恰是会过期的——自相矛盾 |
| C. 全节点稳定 id | ❌ | 文件噪音、违背纯文本极简；只有升格子树需要身份 |
| D. heading 内嵌 slug | ❌ | 污染内容、破坏改名自由——正是现状缺陷 |
| E. sidecar 身份文件 | ❌ | 破坏单文件事实源；同步双写风险（sidecar 原则只用于资产） |

**核心架构决策：把 `cid:<编号>` 做成内核一等锚方案**（与 `node:路径`、`@kind:id` 并列，进 parseLinkAnchor/resolveLinkAnchor），而不是 centers 私有字段。这样：
- centers.at、edges.from/to、links、groups.members 全部可以 cid 寻址
- at 路径统一降级为「人类可读的位置提示」，A2 迁移从路径匹配变身份匹配（根治 dangling）
- agent 寻址与内部引用共用同一套身份——不会演化成两套体系

### 2.2 协议形态（基于现有 DocCenter 扩展，向后兼容）

```yaml
# 根 note（H1 之前）——注册表
centers:
  - cid: c7                 # 新增：稳定身份（可缺省=旧数据）
    at: node:主文件/分支一/项目Alpha   # 降级为位置提示（可过期）
    dir: right
    x: 400
    y: 120
next_cid: 8                 # 新增：单调计数器，永不复用
```

```markdown
<!-- cid: c7 -->
### 项目Alpha规划
```

- 节点笔记 `cid` 标量：序列化既有机制覆盖（探针已验证扁平标量/数组 round-trip）
- 旧文件无 cid：读侧照常（at 解析），**惰性补发**——下次对该中心的事务写入时补 cid 并 bump next_cid；不做一次性全库迁移工具（自用规模，避免迁移债）

### 2.3 工作包（C0–C4，总计约 4–7 人日）

**C0 契约冻结 + 探针（0.5–1 人日）**
- 冻结 §10.2 契约：永不复用 / 随节点存续（降格不回收）/ dup→first-wins+诊断 / 跨文档粘贴重新分配（paste-as-new-identity）/ 仅升格子树持有
- 探针：DocCenter+cid 字段 round-trip（upsertCenter 写回不丢未知键——现有透传语义需定向验证）；`cid:c7` 锚方案解析草样
- 开 Issue、分支 `feat/cid-identity`（从 a3-integration 切，不从落后的 main 切）
- 用户拍板项：cid 格式（`c7` 短码 vs `c-20260905-7`）、是否允许手写 cid（建议允许+dup 诊断）

**C1 数据层与身份分配（1–2 人日）** — react/render/centers.ts + react/edit
- `DocCenter.cid?: string`、`note.next_cid`；`assignCid(note): {cid, note'}` 纯函数
- 分配埋点：promoteToCenter、planCutTreeEdge、planAttachIsland 在事务内自动分配
- `collectCenters` 读侧：dup cid → first-wins + IslandDiagnostic；无 cid 条目兼容
- 测试：分配/永不复用/降格保留/再升格沿用/序列化往返/dup 诊断/惰性补发

**C2 cid 锚方案 + 引用迁移升级（1–2 人日）** — kernel/registry
- note-anchor：`cid:` scheme 解析与 resolve（按 note.cid 建索引；kernel 需读节点 note——确认层级归属，必要时索引由调用方注入保持 kernel 纯协议）
- anchor-migrate：cid 存在的锚 → 迁移后按 cid 重建 at 提示（身份匹配）；无 cid 走现有 nodeId 路径匹配（双轨，旧数据行为不变）
- 测试：T17 类改名/移动场景的 cid 版；迁移后 at 提示刷新；edges/groups 的 cid 锚

**C3 agent 寻址 + UI（1 人日）** — react/canvas
- 右键菜单「复制中心编号」（格式 `主.mm.md#c7`，跨文件时代天然兼容 doc+cid）
- 中心诊断 UI / 节点徽标显示 cid（复用 a1fcc64 的诊断位）
- AI 编写守则增补：cid 寻址约定（grep `cid: c7` → 下一 heading → 读至同级/更浅 heading 止）
- 导出 SVG/PNG 叠加 cid 标签（可后置，先不做）

**C4 验收（0.5–1 人日）**
- 保存重开 / 改名迁移不 dangling / 粘贴冲突重分配 / 外部编辑 dup cid / 旧文件惰性升级
- 变异测试 ≥2 条（摘掉 cid 优先解析 → dangling 回归红；next_cid 复用 → dup 诊断红）
- 完整 gate + 合回 main（与 P1-② 一并处理）

### 2.4 为什么是现在做（时机论证）

1. **A5 刚落地**：真实文件里的 centers 还都是纯 path 锚，此刻引入 cid 无迁移成本；再等用户积累一批切线/升格文件，就要写迁移工具
2. **A2 迁移地基已就位**：planReferenceMigration 的 before/after nodeId 框架正是 cid 身份匹配的挂载点，C2 是增强不是重写
3. **中心诊断 UI 已就位**（a1fcc64）：cid 展示有现成的家
4. 晚做的结构性代价：cid 改变 centers 元数据结构，A1/A2 已合入后这是**最后一个低成本窗口**

### 2.5 与多文件聚合的关系

cid 路线不关闭多文件大门：`主.mm.md#c7` 的寻址格式天然扩展为 doc+cid；attach 条目届时携带 cid 而非仅靠路径。多文件聚合仍按既定纪律等待 ≥2 条真实「一树多视图/独立分享」摩擦。

---

## Part 3 · 立即行动建议（按序）

1. **追认或调整 G1/G2/G3**（P1-①）——cid 规划建立其上
2. a3-integration 跑完整 gate → 合回 main（P1-②），清理 3 分支 + 2 worktree
3. 拍板 C0 的两个开放项（cid 格式、手写 cid 政策）→ 开 Issue → C1 开工
