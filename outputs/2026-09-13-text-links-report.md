# 文本区域链接 Phase 1（L 批 L1→L4）执行报告

- **日期**：2026-09-14（批次派遣稿：2026-09-13）
- **起点 HEAD**：`3312a63`（派遣稿已先行提交；C 批并行线在跑）
- **终点 HEAD（收口时）**：`2ba219a` + L4 收口提交
- **派遣稿**：`docs/dispatch/2026-09-13-text-links-phase1-plan.md`
- **一句话**：把「命名 + 跳转 + 改名跟随」接到三处文本（desc / note / note_text / qa 读兼容）——CommonMark 行内链接语法 + 既有锚体系 + 迁移收集扩展，未动 kernel 冻结面。

## §0 数字总览（提交时点实测）

| 任务 | commit | 改动文件 | 内核/ react / canvas（实测） | 新增用例 |
|---|---|---|---|---|
| L1 | `0990caf` | 12 文件（+985/-6，见 §1） | **483 / 1186 / 195** | +3 kernel、+33 react 纯函数、+13 react 渲染 |
| L2 | `597e71f` | 3 文件（+247/-2） | **483 / 1193 / 195** | +7 迁移（cut-attach 追加 2 + migration 5） |
| L3 | `e6bfc7d` | 6 文件（+335/-10） | **483 / 1202 / 195** | +2 纯函数、+7 插入交互 |
| 加固 | `4decf73` / `2ba219a` | 1/1 文件 | **483 / 1203 / 195** | +1（caret 对照钉） |
| **终态** | — | — | **483 / 1203 / 195 = 1881 全绿** | **+66** |

**门禁（终态）**：tsc ×3 = 0；react dist 重建 = 0；depcruise = 0（429 模块 / 1214 deps）；lint **1468 warnings + 46 infos**（持平原水位）；budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4）。

## §1 L1 · 解析纯函数 + 只读渲染 + 跳转（`0990caf`）

**改动文件**（12）：`edit/textLinks.ts`（新）、`chrome/TextLinkSpans.tsx`（新）、`chrome/DescBlock.tsx`、`chrome/NotePopover.tsx`、`chrome/NoteGrowthPanel.tsx`、`render/overlays.tsx`、`render/MapView.tsx`、`index.ts`、`apps/canvas/src/MindmapStage.tsx`、`tests/text-links.test.ts`（新）、`tests/text-links-render.test.tsx`（新）、`kernel/tests/text-links-roundtrip.test.ts`（新）。

### 红证据原文（先红后绿）

1. 纯函数 31 tests → **29 failed**（stub 阶段）：

```
FAIL  tests/text-links.test.ts > parseTextLinks · 基础形态 > 无链接 → 单一 text span 覆盖全文
AssertionError: expected [] to have a length of 1 but got +0
```

2. 渲染接入 13 tests → **9 failed**：

```
FAIL  tests/text-links-render.test.tsx > DescBlock 只读态：链接渲染 > well-formed 链接：span 标记 + 显示名（括号原文不可见）
AssertionError: expected null not to be null
 ❯ tests/text-links-render.test.tsx:47:22
```

3. `findEntityNodeId` stub 红：

```
AssertionError: expected null to be 'ndmu017721o' // Object.is equality
```

### round-trip 保真钉（§1.4 证据化）输入/输出原文

输入（裸写 desc + 引号写 note[2]，两种书写形态）：

```md
<!--
desc: [名A](node:根/任务A)
note:
  - 普通条目
  - 另一条
  - "[名C](cid:c7)"
note_text: [名B](node:根/B)
-->
# 根
```

断言（`kernel/tests/text-links-roundtrip.test.ts`，**3/3 绿**）：

```
first.desc === '[名A](node:根/任务A)'
first.note?.[2] === '[名C](cid:c7)'
first.text === '[名B](node:根/B)'
s1 = serializeMm(rootOf(SRC))
second.desc === '[名A](node:根/任务A)'   // parse → serialize → parse 逐字相同
second.note?.[2] === '[名C](cid:c7)'
second.text === '[名B](node:根/B)'
s2 === s1                                 // canonical 幂等
```

即：`[` 起始文本经 `yamlScalar` 自动加引号 → `stripQuotes` 还原 → `scalarValue` JSON.parse 失败 catch 回原串，**三字段往返逐字不变**——协议零改动。

### 三区域截图（真浏览器）

- `verify-shots/l-links-preview.png` / `l-links-preview-zoom.png`——预览浮窗内 `A`（实线下划线、链接色）与 `丢`（虚线幽灵）；`l-links-jump.png`——跳转后 A 居中；`l-links-insert-picker.png` / `l-links-insert-done.png`——插入入口（见 §4）。

## §2 L2 · 迁移收集扩展（`597e71f`）

**改动文件**（3）：`edit/cutAttach.ts`、`tests/cut-attach.test.ts`（追加 2 用例）、`tests/text-links-migration.test.ts`（新，5 用例）。

### 红证据原文（7 failed）

```
FAIL  tests/cut-attach.test.ts > A5 引用收集（collectReferenceAnchors） > L2：文本字段内的链接进入盘点清单（span 级 field，按出现顺序编号）
AssertionError: expected undefined to be 'node:根/生活' // Object.is equality
 ❯ tests/cut-attach.test.ts:311:35
```

### 迁移前后锚值对照（改名 / 切搬）

| 场景 | 迁移前 | 迁移后（断言原文） |
|---|---|---|
| 改名 A→A2（desc/note[0]/note_text 三字段同目标） | `看 [名](node:根/任务/A) 与 [稳](cid:c-a)` | `看 [名](node:根/任务/A2) 与 [稳](cid:c-a)`（cid 锚**原样保留**） |
| 父改名 任务→任务2（同字段两条链接） | `乙 [e2](node:根/任务/K3) 与 甲 [e1](node:根/任务/A)` | `乙 [e2](node:根/任务2/K3) 与 甲 [e1](node:根/任务2/A)` |
| 切断 A（planCutTreeEdge） | `去 [x](node:根/任务/A)` | `去 [x](node:根/A)` |
| 坏锚回归钉 | `坏 [x](node:根/不存在) 好 [y](node:根/生活)` | `坏 [x](node:根/不存在) 好 [y](node:根/生活2)`（坏锚保留、不阻断） |

### 同字段两处替换的顺序证据

- 判别原理：替换经 `applySpanReplace` **从右往左**（按 start 降序应用）——同字段两条 update 由 `buildMigrationOps` 逐条处理、每条基于最新文本重新解析（span 序号在链接数量不变时语义稳定）；`text-links.test.ts` 的「多处替换：从右往左（前段替换变长也不位移后段）」用例直接钉死工具层（传入顺序故意「左在前」）。
- 迁移用例落点：父改名后**两条链接同时更新**（上方对照第 2 行）——若实现按旧偏移左→右批量替换，第二条将错位，此断言即变红。

### 阴性对照原文（去掉文本字段扫描 → 迁移用例红；已恢复、`git diff` 空）

```
FAIL  tests/text-links-migration.test.ts > L2 · 文本链接迁移：改名（R1-1 管线自动迁移） > desc / note[0] / note_text 内路径锚随新路径迁移；cid: 锚原样保留
AssertionError: expected '看 [名](node:根/任务/A) 与 [稳](cid:c-a)' to be '看 [名](node:根/任务/A2) 与 [稳](cid:c-a)'
```

（同轮 7 用例全红：盘点 2 + 迁移 4 + 切断 1。恢复后 18/18 绿。）

## §3 L3 · 插入入口（`e6bfc7d`）+ 收口期两处修复

**改动文件**（6）：`edit/textLinks.ts`（+`preferredLinkAnchor`）、`chrome/NotePopover.tsx`、`chrome/NoteGrowthPanel.tsx`、`index.ts`、`tests/text-links.test.ts`（+2）、`tests/text-links-insert.test.tsx`（新，7 用例）。

- **`EdgeAnchorPicker` 公开契约零改动**（choices/onPick/onClose 原样复用；调用点 `createPortal` 到 body——浮窗根有 `transform`（合成器层），fixed 遮罩若留在浮窗内会被困住）。
- 插入：`[显示名](锚)`；显示名取候选 label 路径末段；锚经 `preferredLinkAnchor`——**目标有 cid 写 `cid:`**（T-A7），否则照抄路径锚。

### 红证据（天然红 + mutation 对照）

1. 首跑 2 红——初版测试**缺 `afterEach(cleanup)`**（vitest 未开 globals，RTL 不自动清理；本文件用 baseElement 查 portal，跨用例残留命中错误实例）：

```
AssertionError: expected 'AB' to be 'A[A](node:根/任务/A)B'
AssertionError: expected '' to be '[A](cid:c-a)'
```

修复：按仓内既有纪律（asset-panel-grid 等先例）加 `afterEach(cleanup)` → 7/7 绿。

2. mutation 对照（临时禁用两处按钮渲染 → 5 红，恢复后绿）：

```
Error: 夹具断言失败：未渲染 插入链接按钮
```

### 收口期修复 1：光标记录移到 pointerdown（`4decf73`）

问题：按钮 onClick 时 textarea 已失焦、selection 可能被重置 → 「光标处插入」退化为「开头插入」。修法与对照（恒重读版 → 1 红）：

```
AssertionError: expected '[A](node:根/任务/A)AB' to be 'A[A](node:根/任务/A)B'
```

### 收口期修复 2：链接 pointerdown 不冒泡（`2ba219a`）

根因（真浏览器实测）：预览浮窗内点链接时——pointerdown 先触发浮窗「点击固定」→ floating 预览被 embedded 固定卡替换、**DOM 重建** → pointerup/click 丢失 → **要点两次才生效**。修法：链接的 pointerdown stopPropagation（点链接 = 跳转意图，不承担固定浮窗职责）。修复后实测：一次点击 A 屏幕 (958,382) → (640,400) 精确居中。

## §4 真浏览器验证（`tools/verify-l-text-links.mjs`，截图 5 张）

夹具：`任务` 节点 note_text = `"[A](node:根/任务/A) 与 [丢](node:根/不存在)"`。

```
[preview] links = [{"anchor":"node:根/任务/A","state":"well-formed","decoStyle":"solid","cursor":"pointer"},
                   {"anchor":"node:根/不存在","state":"dangling","title":"链接失效：目标不存在（path-not-found）","decoStyle":"dashed","cursor":"default"}]
✔ 预览浮窗渲染 2 条链接
✔ well-formed：显示 label「A」+ cursor=pointer
✔ dangling 幽灵态：虚线 + title 含「失效」+ cursor=default
[jump] A 屏幕 = {"before":{"cx":958,"cy":382},"after":{"cx":640,"cy":400}}
✔ 点击 well-formed → A 屏幕位置变化（focusNode 平移）
✔ 跳转后 A 落在视口中心附近（±80px）
[ghost-click] A 屏幕 = {"beforeGhost":{"cx":640,"cy":400},"afterGhost":{"cx":640,"cy":400}}
✔ 点击 dangling 幽灵链接 → 视图不动（A 屏幕位置不变）
✔ Alt 长按 → 一级环出现
✔ 高亮「更多」停顿 → 二级环展开
✔ 二级环轮转到「编辑笔记」席
✔ 编辑态出现「插入链接」按钮
✔ 候选选择器含「任务 / A」候选
[insert] value before/after:
  before = "[A](node:根/任务/A) 与 [丢](node:根/不存在)"
  after  = "[A](node:根/任务/A)[A](node:根/任务/A) 与 [丢](node:根/不存在)"
✔ 选中候选 → textarea 插入 [A](node:根/任务/A)（光标处，出现第二条）

✅ L 批文本链接验证全部通过
```

**指标口径记录**：跳转断言用 **getBoundingClientRect（屏幕坐标）**——`g[data-node-id]` 的 `transform` 是**世界坐标**，viewport 平移不改它（首版脚本误用该指标，误判「没跳」；探针 `dispatchEvent` 对照后修正）。
**快照守卫**：`--allow-stale` 因 HEAD（`57e73e1`）为并行 docs 提交而正当——源码新鲜度检查通过（产物 01:44:54 > 最新源码 01:44:34）。

## §5 门禁与预算（终态实测，原样）

```
✔ no dependency violations found (429 modules, 1214 dependencies cruised)
Found 1468 warnings.
Found 46 infos.

  指标            实测   预算   状态
  bang              89     90   ↓1 优于
  asCast            31     31   持平
  console            4      4   持平
  todo               1      1   持平
  defaultExport      2      2   持平
  bigFiles           3      4   ↓1 优于
✅ 全部指标在预算内（债务未增长）
```

## §6 偏差与原因

1. **canvas 首轮全量 3 红（C 批 `center-actions-promote`，非确定性）**：`{at,dir}` 缺 `cid` / `centers` 长度 0。**判定：与本批无因果**——① 单跑（5/5）与后续两轮全量（195/195）均绿；② 该链路 op 全为 note patch，`isAnchorAffectingOp` 短路（不触发 `collectReferenceAnchors`/`applyAnchorUpdateToNote`，L2 改动路径**不可达**）；③ 仓内历史有「全量偶发、单跑即过」多次先例。**留观察**（建议 C 批/后续批次复核该测试的时序假设）。
2. **右键菜单无「编辑笔记」**：v1.8.2 瘦身已移出（环内二级 `sub:edit-note` 为等价席位）——验证脚本改走环路径（Alt → 更多 → 二级）。
3. **同工作树并行批次**：L2 后重建的 react dist / canvas 快照包含同树并行批次（C 批）源码；`tools/graph-engine/` 未动未提交；`C4 未提交改动` 期间先做了仓外快照备份（`E:\DevTemp\c4-backup-20260913`，C 批提交后已无用途）。
4. **号位**：C 批先提交 `[1.8.13]`（已完成）→ 本批顺延 `[1.8.14]`（照 §7 并行纪律）。

## §7 明确未做（照计划 §7）

富文本编辑器（contenteditable/WYSIWYG）；外部 URL 白名单与可点击外链；跨文档链接（B 线）；`members`/`collapsed` 协议字段；反链/双链面板。**T-A6 注**：`[a](http://…)` 等 URL 形态当前渲染为纯文本（不认作内部锚），安全白名单另立。
