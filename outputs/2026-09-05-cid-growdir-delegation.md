# 外派执行手册：cid 身份层（C）× 节点生长方向（D）

日期：2026-09-05 晚 · 基线：`a3-integration @ ed3cd93`（合回 main 后以 main 为准）· 原则：**两包文件零交叉，可并行；公共文件由集成人持有**

---

## 第 0 步 · 外派前你自己/主会话要做完的事（约 0.5 人日，不做完不外派）

| # | 动作 | 验收 |
|---|---|---|
| 0.1 | **追认 G1/G2/G3**（islands.ts 已按推荐语义入码：G1 独立后代不随动 / G2 文档根承载 detached / G3 parent_link 缺省 hide） | 一句话确认即可，记入 Issue |
| 0.2 | a3-integration 跑完整 gate（typecheck/test/depcruise/lint/budget）→ 合回 main → push | main 与 ed3cd93 对齐，gate 全绿；⚠️ 不得 --no-verify |
| 0.3 | 清理已合并分支（a1-layout-islands / a2-history-tx / fix/centers-review）与两个完成的 worktree（g6-review、a1-islands、a2-history） | `git worktree list` 只剩主工作区 |
| 0.4 | **契约拍板**（下面五个开放项，建议值已给，改动请改任务书对应行） | 决策写进 Issue 首评 |
| 0.5 | 开两个 Issue：`cid 身份层` / `节点生长方向 note.dir`（gh 未认证就网页开，把 Issue 号填进任务书） | 两个 Issue 号 |
| 0.6 | 记录基线 SHA（合回后的 main HEAD），填进两份任务书 | — |

**契约拍板项（建议值）**：
1. cid 格式：`c7` 短码（可读可输入；不建议长码）
2. 手写 cid：允许 + dup 时 first-wins + 诊断
3. dir 键名：`dir`（与 centers 条目一致；非法值 → 诊断 + 按继承处理）
4. cid 分配时机：升格/切线/接回事务内自动分配；旧数据**惰性补发**（不写迁移工具）
5. 节点 dir 语义：**子级声明**（本节点相对父级的生长侧；缺省继承最近显式 → 岛 dir）

---

## 第 1 步 · 分包与文件所有权（冲突预防是外派成败关键）

| 文件 | C 包（cid 身份层） | D 包（note.dir 方向） | 集成人（你/主会话） |
|---|---|---|---|
| kernel/registry/note-anchor.ts | ✔ 改 | | |
| kernel/registry/anchor-migrate.ts | ✔ 改 | | |
| kernel/layout/layouts.ts | | ✔ 改 | |
| kernel/layout/forest.ts / islands.ts | 只读 | 只读（岛 dir 交互按契约） | |
| react/render/centers.ts | ✔ 改 | | |
| react/edit/cutAttach.ts | ✔ 改（cid 埋点） | | |
| react/render/growDir.ts（新建） | | ✔ 建 | |
| react/edit/contextMenuItems.ts | | | ✔（C3 复制编号 + D3′ 生长方向，两项都归集成人） |
| apps/canvas/MindmapStage.tsx / NodeContextMenu.tsx | | | ✔ |
| kernel/index.ts / react/index.ts | 回执写明需导出符号 | 回执写明 | ✔ 统一导出（ADR-0004：只增不删） |
| 各自 tests/ | ✔ 新文件 | ✔ 新文件 | |

**结论：C 与 D 文件零交叉，两个 agent 可完全并行。** UI 菜单两项（复制编号 / 生长方向）都归集成人——这是刻意安排，contextMenuItems 是两系列唯一的潜在冲突点。

---

## 第 2 步 · 外派包 C：cid 身份层（复制本节整段发给实现 agent）

```
你要在 E:/Development/MyAwesomeApp/mindcanvas 实现「cid 子树持久身份层」。
基线：main @ <填入SHA>（布局岛 A1–A6 已合入）。分支：feat/cid-identity（从 main 切）。
关联 Issue：#<填入>。

【必读，先读后写】
- outputs/2026-09-05-progress-locate-and-cid-plan.md（Part 2 设计全文）
- outputs/2026-09-05-multi-file-aggregate-exploration.md（§10.2 契约）
- packages/react/src/render/centers.ts（DocCenter 现状：at/dir/x/y/parent_link/detached）
- packages/kernel/src/registry/anchor-migrate.ts（planReferenceMigration，nodeId 语义）
- packages/react/src/edit/cutAttach.ts（planCutTreeEdge/planAttachIsland 事务埋点位）

【已拍板契约】
- cid 格式 c7 短码；root.note.next_cid 单调计数、永不复用
- 节点笔记 cid: c7（H 级标题前的笔记块）；centers[].cid 关联；at 降级为位置提示
- 手写 cid 允许，dup → first-wins + 诊断；降格不回收；跨文档粘贴重新分配（paste-as-new-identity）
- 旧文件无 cid：读侧兼容 + 事务写入时惰性补发，不做迁移工具

【工作边界（严格遵守）】
你拥有：kernel/registry/note-anchor.ts、kernel/registry/anchor-migrate.ts、
react/render/centers.ts、react/edit/cutAttach.ts、你的新测试文件。
禁止碰：kernel/layout/*、contextMenuItems.ts、MindmapStage.tsx、两个 index.ts
（需导出的符号写回执，集成人统一导出）、outputs/*、.workbuddy/*。
不得 --no-verify；不得改预算脚本；新守卫做变异验证。

【实现内容 = C1 + C2】
C1：DocCenter.cid?、note.next_cid、assignCid 纯函数；升格/切线/接回三处事务内
    自动分配；collectCenters 读侧 dup→first-wins+诊断；无 cid 条目兼容。
C2：note-anchor 增加 cid: scheme 一等锚（与 node:/@kind:id 并列）；解析优先级
    cid 优先、at 为提示；anchor-migrate 双轨——cid 锚按身份重建 at（迁移后刷新
    at 提示），无 cid 走现有 nodeId 路径匹配（旧数据行为不变）。
    注意 kernel 纯协议分层：cid 索引由调用方注入，kernel 不读 DOM。

【验收】
- 先失败用例再实现；覆盖：分配/永不复用/降格保留/再升格沿用/序列化 round-trip/
  dup 诊断/惰性补发/改名后 cid 锚不 dangling（at 提示被刷新）/edges 用 cid 锚
- 变异 ≥2 条（去掉 cid 优先解析→dangling 回归红；next_cid 复用→dup 诊断红）
- 命令（禁止 npx/pnpm，沙箱会吞输出，落盘读日志）：
  "E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
    "packages/kernel/node_modules/vitest/vitest.mjs" run --root "packages/kernel" > /tmp/k.log 2>&1
  react 包同理；typecheck：
  "E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" \
    "packages/react/node_modules/typescript/bin/tsc" -b packages/kernel/tsconfig.json \
    packages/react/tsconfig.json --pretty false
- 回执：基线SHA/分支/改动文件/实现与未实现清单/测试数/变异证据/需集成人导出的符号/风险。
  未完成写未完成，不把生成代码当完成。
```

---

## 第 3 步 · 外派包 D：节点生长方向 note.dir（复制本节整段发给实现 agent）

```
你要在 E:/Development/MyAwesomeApp/mindcanvas 实现「节点级生长方向 note.dir（思想分叉）」。
基线：main @ <填入SHA>（布局岛 A1–A6 已合入）。分支：feat/node-grow-dir（从 main 切）。
关联 Issue：#<填入>。

【必读，先读后写】
- outputs/2026-09-05-pg-free-direction-audit.md（§5 修订版 D1′–D4′ 设计全文）
- packages/kernel/src/layout/layouts.ts（layoutLogic/layoutOrg/placeOrg 现状）
- packages/kernel/src/layout/forest.ts（LAYOUT_BY_DIR 四向映射，复用不重写）
- packages/kernel/src/layout/islands.ts（岛 dir 语义：岛整体摆放方向；节点 dir 是岛内部署，两层不冲突）

【已拍板契约】
- note.dir: left|right|up|down = 本节点相对父级的生长侧（子级声明）
- 缺省 = 继承（最近显式声明 → 岛 dir）；非法值 → 诊断 + 按继承处理
- 同一父节点的子节点按有效 dir 分组 → 各组挂对应侧（思想分叉）
- dir 是语义意图（先例：via/edge/desc/qa 挂节点），不是坐标状态；节点不挂 x/y
- 切线/接回/粘贴：dir 随子树天然携带，零迁移（这是相对 centers at 锚的核心优势）

【工作边界（严格遵守）】
你拥有：kernel/layout/layouts.ts、react/render/growDir.ts（新建：dir 读取/校验/
  有效方向解析的纯函数）、你的新测试文件。forest.ts/islands.ts 只读。
禁止碰：kernel/registry/*、centers.ts、cutAttach.ts、contextMenuItems.ts、
  MindmapStage.tsx、两个 index.ts（需导出写回执）、outputs/*、.workbuddy/*。
不得 --no-verify；新守卫做变异验证。

【实现内容 = D1′ + D2′】
D1′：note.dir 读取/校验纯函数（放 react/render/growDir.ts；解析「有效 dir」=
     节点自身 dir ?? 最近祖先显式 dir ?? 岛 dir）；序列化 round-trip 探针（标量，
     既有机制覆盖，但要做 upsertNote 写回不丢键的定向验证）。
D2′：layouts.ts 每节点分组调度——子节点按有效 dir 分 right/left/up/down 组，
     每组调 LAYOUT_BY_DIR 对应布局函数；邻侧防叠：right↔down、down↔left 等相邻
     组做 bounds 检测+布局期一次推开（不学 PG 运行时迭代）；无分组的节点走现状
     路径零行为变化（旧文件布局必须逐像素一致——先建回归快照）。

【验收】
- 覆盖：单节点左右分叉/三向分叉/嵌套覆盖（孙再覆盖）/继承链/非法 dir/
  保存重开/改名移动零迁移（dir 随节点）/与折叠、LOD 的交互/岛 dir 与节点 dir 叠加
- 邻侧防叠探针：右组与下组都长时不重叠（几何断言，非截图目测）
- 变异 ≥2 条（去掉分组→方向断言红；去掉防叠→重叠断言红）
- 命令同 C 包（kernel/react 定向测试 + tsc -b）；回执格式同 C 包。
```

---

## 第 4 步 · 集成人（你或主会话）回收与收尾

**合并顺序建议：先 D 后 C。** D 更小更独立、不碰 centers 元数据结构；C 改变锚体系，验收更严。

1. **真实 diff 复核**（不信回执）：两包都应只动授权文件；`git diff --stat main..<branch>` 对照所有权矩阵
2. **补 UI（C3 + D3′，约 1–1.5 人日，两个都归你）**：
   - C3：contextMenuItems「复制中心编号」（`主.mm.md#c7`）+ 中心诊断位显示 cid + AI 编写守则增补 cid 寻址约定
   - D3′：右键「生长方向」子菜单（四向 + 继承）；学 PG 预设-固化：会话预设 → 生长时事务写入 note.dir
3. **统一导出**：按两包回执在 kernel/index.ts、react/index.ts 增导出（只增不删，ADR-0004）
4. **验收（C4 + D4′）**：保存重开 / 外部编辑 dup cid / 混合方向树 / undo-redo / 完整 gate / 浏览器实操截图（沿用 verify-shots 规矩）
5. **合回 main + push + 关 Issue**；两包都合后再考虑清理 feat 分支

**单 agent 顺序（若只有一个实现者）**：D 包先行（1.5–2.5d，独立见效快）→ C 包（2–4d）→ 集成人 UI。

## 总时间线（两 agent 并行）

```
Day 0     第0步前置（0.5d，你自己）
Day 0–3   C 包 ∥ D 包（并行）
Day 3–4   集成人：diff 复核 + UI + 导出
Day 4–5   C4/D4′ 验收 + gate + 合 main
```
