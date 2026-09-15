# P2 收口报告：节点卡背面编辑（2026-09-15）

> 派遣计划：`docs/dispatch/2026-09-15-p2-card-back-edit-plan.md`；设计稿：`docs/specs/2026-09-14-node-card-flip-markdown-design.md` §7。
> 基线（复核实测核对）：HEAD=`9f0da8e`；三包 **523 / 1266 / 209**；depcruise **440/1254**；lint **1468+46**；budget 持平（bigFiles **3/4**）。
> 提交：`566af4c`（docs 前置）→ `e21566a`（feat(react)）→ `b9c1a72`（feat(canvas)）→ **docs 收口（本报告随该提交入库）**。**不 push**。

## §0 交付摘要

**功能**：背面态「编辑背面」→ 屏幕浮窗内 `NoteBackEditor`（源文 textarea + 「源文/预览」单窗双态；预览复用 `CardBackMarkdown` 零新解析）→ 失焦/`Shift+Enter` 提交 → `controller.updateNote` 写回（空文本删 `md` 键）；undo / 自动保存 / S2G 守卫零成本继承。**`flipActive` 门、S2F 判据、S2G 守卫、L 批行内链接、note 三区域渲染语义逐字未动。**

**门禁（收口终值）**：

| 项 | 基线 | 终值 | 说明 |
|---|---|---|---|
| kernel 测试 | 523 | **523 不动** | 未改 kernel |
| react 测试 | 1266 | **1281**（+15） | 新单测 `note-back-edit.test.tsx` |
| canvas 测试 | 209 | **211**（+2） | 新 e2e `note-back-edit.test.tsx` |
| tsc ×3 | 0 | **0** | kernel/react/canvas 各自 `tsc -b` |
| depcruise | 440/1254 | **443/1262 零违规** | +3 模块 / +8 deps（见 §P2-4 归因） |
| lint | 1468+46 | **1468+46 逐数持平** | Checked 442 = 439 + 3 |
| budget | 3/4 持平 | **全持平**（bigFiles **3/4**） | NotePopover budget 口径 **600 ≤ 600** |
| react dist | — | **重建（BUILD_REACT=0）** | 改源后收口复查 |

**新增用例**：react +15（组件纪律 5 + 接线 10）；canvas +2（全链编辑 / 清空删键）。**阴性对照 2 组**（§P2-4 红原文）。

---

## §P2-1 NoteBackEditor 组件（`e21566a`）

**新文件** `packages/react/src/chrome/NoteBackEditor.tsx`（三导出，P2 新 UI 不内联——NotePopover 守线）：
- `NoteBackEditor`：源文 textarea（**非受控 `defaultValue`**，防 IME/焦点抖动——同 NotePopover 正文区做法）+「源文/预览」单窗双态（切换按钮 `pointerdown` **preventDefault**：防按钮取焦触发失焦提交，预览得以停留；预览 = `CardBackMarkdown` 同源渲染）。锚点 `data-note-md-editor` / `data-note-md-mode`（含 `data-note-md-toggle` / `data-note-md-input` / `data-note-md-preview` 辅助锚点）。
- `MdEditButton`：「编辑背面」入口（`data-note-md-edit`；`pointerdown` stopPropagation 纪律同 ⟳）。
- `NoteBody`：自 NotePopover 提取的面板主体三态渲染块（md 编辑面 → 翻卡 → 正面直出）；**DOM 与提取前逐字一致**（P1 钉不受影响：`[data-flip-card]` / `data-flip-state` / `[data-note-back-scroll]` 的 `overflowY:auto` 等全数复跑绿）。

### DescBlock 口径抄录（实测，`packages/react/src/chrome/DescBlock.tsx`）

1. **进入编辑**：`useEffect [editing, text]` → `setDraft(text)` + `focus()` + 光标移末尾（L210-219）。
2. **提交值**：`commit = () => onCommit?.(draft.trim())` —— **上抛 trim 后的值**（L221-223）；（空串=删除描述由上层映射：`MindmapStage` L1720-1724 `text === '' ? { desc: undefined } : { desc }`，**并 `setDescEditingId(null)` 退出**）。
3. **提交触发**：① `onBlur={commit}`（**失焦提交**，L304）；② `keydown: Enter + shiftKey → preventDefault + commit`（**Shift+Enter 提交**，L295-298）。
4. **取消**：`Escape → preventDefault + onCancel`（L299-302，**不提交**；上层仅退出编辑态）。
5. **换行**：无修饰 `Enter` 不拦截（textarea 默认换行）。
6. **形态**：DescBlock 为**受控**（`value={draft}` + onChange）；本批按计划用**非受控**（同 NotePopover 正文区），提交纪律（第 3 条）保持一致。
7. **Ctrl+Enter：不存在**——`keys.ts` `matchEditorKey` ctrl 分支（s/o/n/z/y/[/]/0/f/d/Shift+A/Shift+R/Shift+Tab）无 Enter → `null` 无动作；react src 全仓 `ctrlKey` 仅 `keys.ts` 两处。

**冲突裁决记录（§4 停止条款①触发）**：设计稿 §7 L129 转述为「失焦/`Ctrl+Enter` 提交（比照既有 `DescBlock` 纪律）」；**实测 DescBlock 为 Shift+Enter**。按 §4①「以 DescBlock 为准」执行：实装 **Shift+Enter**（e2e 另显式断言「Ctrl+Enter 不提交」把差异钉在测试里）。与 DescBlock 的**受控差异**一条：**上抛原文（不 trim）**——P2-3 施工单「不 trim 存储值，只 trim 判空」（markdown 前导空白有意义；判空移至写回链）。

**组件 diff 摘要**：新文件为主（273 行）；核心接口：

```tsx
export interface NoteBackEditorProps {
  md: string;
  token: TokenSet;
  onCommit?: (md: string) => void;   // 失焦 / Shift+Enter：上抛原文（不 trim）
  onCancel?: () => void;             // Esc：不提交
  onJumpToAnchor?: (anchor: string) => void;
}
```

**react 单测 +15**（`packages/react/tests/note-back-edit.test.tsx`，红→绿）。**红原文**（组件未创建时）：

```
FAIL tests/note-back-edit.test.tsx [ tests/note-back-edit.test.tsx ]
Error: Failed to resolve import "../src/chrome/NoteBackEditor.js" from "tests/note-back-edit.test.tsx". Does the file exist?
```

**绿**：`Tests 15 passed (15)`。用例分布：

```
P2 入口①：编辑背面按钮条件（零新增 DOM）——5 例（缺省/正面态/floating/editing/空串空白）
P2 入口②：进入编辑 → 浮窗编辑器——5 例（进入替代 seq/text + floating 落位；Shift+Enter 提交、
  失焦提交、未改动不写盘、Esc 取消；均含"退出回背面视图"断言）
P2-N2：NoteBackEditor 组件纪律——5 例（autofocus；双态切换（含输入保留/预览同源渲染）；
  pointerdown 抑制默认；上抛原文不 trim；Enter 换行不拦截）
```

---

## §P2-2 NotePopover 接线（`e21566a`）

**diff 全貌**（`git diff 9f0da8e..e21566a -- packages/react/src/chrome/NotePopover.tsx`，39 行变更）：
1. import：`- { CardBackMarkdown } - { FlipCard } + { MdEditButton, NoteBody }`（后两者下沉到 NoteBackEditor.tsx）。
2. props：`+ onChangeMd?: (md: string) => void`（P2 提交回调）。
3. state：`+ const [mdEditing, setMdEditing] = useState(false)`（会话态，不落盘）。
4. `floating` 判定扩展：`mode !== 'embedded' || editing` → `... || mdEditing`（D1：编辑器浮窗化）。
5. `+ mdEditActive = isFlipped && !floating && (md ?? '').trim() !== ''`（入口渲染条件）。
6. header：`+ {mdEditActive && <MdEditButton ... />}`（仅背面态 + md 非空 + 非浮窗）。
7. 渲染块：`FlipCard 三元` → `<NoteBody ... />`（提取；onChangeMd 对比当前 md 无改动不写盘 + 退出）。

**`flipActive` 门逐字未动**（`const flipActive = !floating && typeof md === 'string' && md.trim() !== '';` —— 只在其前方扩展 floating 定义）。**正面编辑（editing）路径零改动**。

### 行数前后（600 守线）

| 口径 | 改前（HEAD） | 峰值（提取前） | 终值 |
|---|---|---|---|
| `wc -l` | 599 | 608 | **599** |
| budget（`split(/\r?\n/)`） | **600** | 609 | **600** |

**守线过程**：直连后 608（超 8）→ 按计划「优先把背面渲染块一并提取」→ 提取 `NoteBody`（三态块）+ `MdEditButton` 至 NoteBackEditor.tsx → 代码复检时发现 `noUselessFragments` 1 条 info > 基线（收口期清掉）→ **终值 599/600（budget 口径）**——**未触 bigFiles（3/4 保持）**。

### 既有钉未动证据

- `note-panel-flip.test.tsx`（P1 三钉：零感知 :47-48 / 按钮命中区 / footprint）**未修改、12/12 绿**；`note-popover.test.tsx` **未修改、17/17 绿**；两文件对 `9f0da8e..HEAD` 的 diff 为**空**：

```
$ git diff 9f0da8e..HEAD --stat -- packages/react/tests/note-panel-flip.test.tsx packages/react/tests/note-popover.test.tsx
(空输出)
```

---

## §P2-3 写回链 + e2e（`b9c1a72`）

**MapView**（`packages/react/src/render/MapView.tsx`，+4 行含注释）：加法 prop `onNoteChangeMd?: (id, md) => void`（同 `onNoteChangeSeq` 先例）；**固定卡渲染位**透传 `onChangeMd={(md) => onNoteChangeMd?.(panel.id, md)}`（悬停预览位零改动）。

**MindmapStage**（`apps/canvas/src/MindmapStage.tsx`，+4 行含注释）：

```tsx
// P2：背面源文写回（空文本 → 删 md 键；不 trim 存储值，只 trim 判空）
onNoteChangeMd={(id, md) =>
  controller.updateNote(id, md.trim() === '' ? { md: undefined } : { md })
}
```

（`updateNote` 的 `md: undefined → delete` 由 P1 已就位路径承接；dirty → 自动保存 → S2G 守卫正常放行——守卫只查 doc.source 同步标记，编辑不触碰 source）。

### e2e（`apps/canvas/tests/note-back-edit.test.tsx`，+2，真 MindmapStage）

**用例 1**：翻面 → 编辑背面 → **Ctrl+Enter 不提交（实测对齐 DescBlock 的显式钉）** → **Shift+Enter 提交** → 背面显示新内容 → 关闭面板重挂（卸载重挂）→ 仍背面 + 新内容 → **点「保存」→ 库 `source` 含 `md: "## 新标题"` 逐字（serialize() 往返）**。

**用例 2**：清空提交（纯空白）→ **`md` 键删除**：翻面按钮消失 + 编辑入口消失 + 面板仍存活（正面区回来）+ **保存后 source **无 `md:`** 键**（删键的数据层钉子）。

**e2e 基建记录（新增设施 `waitForStablePos`）**：关闭 note 面板会移除「note 预留」→ 森林布局重排，节点位置经历多帧过渡（实测快照：`open y=-46.03 → closed y=-57.82 → 稳定 y=-17.09`，~40px 级位移）；过渡窗口内点击会被 hit-test 落空（`useMapGestures` 的手势判定在 down/up 间的节点位置对不上）——**这是既有画布行为（P1 同款链路，note-flip-host 靠时序窗口侥幸通过），非 P2 引入**；真实用户「关闭 → 移动指针 → 点击」的间隔天然覆盖该窗口，测试显式 `waitForStablePos`（连续 3 采样位置不变）后再点击。另以 `clickNodeFlushed`（down/up 间让出一帧）贴近真实浏览器时序。

**首跑失败的红原文（诊断过程，保留）**：

```
AssertionError: expected null not to be null（重开后面板未出现）
→ dump：pops=0 nodes=2 k=1 t=(0,0)
→ 位置快照定位：open=[t=(86,-46.03)…] closed=[t=(86,-57.82)…] after=[t=(86,-17.09)…]
```

---

## §P2-4 收口

### 阴性对照 ①：双态切换不生效（恒源文态）→ 钉红

故障注入（`NoteBackEditor.toggleMode` 改为「仅更新草稿、不切换 mode」）→ `tests/note-back-edit.test.tsx` **红**（回退后 15/15 绿 + `git diff HEAD` 空）：

```
FAIL tests/note-back-edit.test.tsx > P2-N2 NoteBackEditor 组件纪律 > 双态切换：源文 → 预览（…）→ 源文；输入保留
AssertionError: expected 'source' to be 'preview' // Object.is equality
Expected: "preview"
Received: "source"
 ❯ tests/note-back-edit.test.tsx:175:20
```

### 阴性对照 ②：空文本不删键 → 钉红

故障注入（`MindmapStage.onNoteChangeMd` 改为跳过判空 `{ md }` 直存）→ e2e **红**（用例 2；回退后 2/2 绿 + git diff 复核接线版）：

```
FAIL tests/note-back-edit.test.tsx > … > 清空提交 → md 删键：…
AssertionError: expected '# 根\n\n<!--\nnote:\n  - 条目一\nmd: "   …' not to contain 'md:'
- Expected
+ Received
- md:
+ # 根
+
+ <!--
+ note:
+   - 条目一
+ md: "   "
+ -->
```

### 门禁原样（收口复跑，最终源码）

```
-- kernel full --
 Test Files  61 passed (61)
      Tests  523 passed (523)

-- react full（终稿源码重跑）--
 Test Files  132 passed (132)
      Tests  1281 passed (1281)

-- canvas full --
 Test Files  30 passed (30)
      Tests  211 passed (211)

-- tsc ×3 --
TSC_KERNEL=0
TSC_REACT=0
TSC_CANVAS=0
（react dist 已重建：BUILD_REACT=0；验证：dist/chrome/NoteBackEditor.js/.d.ts 已产出）

-- depcruise（两种 reporter 口径一致）--
✔ no dependency violations found (443 modules, 1262 dependencies cruised)
归因：+3 模块 = NoteBackEditor.tsx + packages/react/tests/note-back-edit.test.tsx
      + apps/canvas/tests/note-back-edit.test.tsx；
      +8 deps = 新文件出边 9 条（NoteBackEditor 5 / react 单测 3 / e2e 1）
      − NotePopover 净 −1（+NoteBackEditor、−CardBackMarkdown、−FlipCard）。

-- lint --
Checked 442 files in 273ms. No fixes applied.
Found 1468 warnings.
Found 46 infos.

-- budget --
  bigFiles           3      4   ↓1 优于
  bang              89     90   ↓1 优于
  asCast            31     31   持平
  console            4      4   持平
  todo               1      1   持平
  defaultExport      2      2   持平
✅ 全部指标在预算内（债务未增长）
```

### `git status --short`（收口原文）

```
 M CHANGELOG.md
?? _tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f
?? outputs/2026-09-15-p2-back-edit-report.md
?? tools/graph-engine/
```

（`CHANGELOG.md` + 本报告 = 第 4 提交内容；`_tmp_93540_*` = 环境项（§偏差④）；`tools/graph-engine/` = 禁区未动。）

### 定向清理

- 复核者残留（7 项点名）：`tmp-push.ps1` / `tmp-push.log` / `tmp-push-1.out` / `tmp-push-1.err` / `tmp-v7-s1.diff` / `tmp-v7-s2.diff` —— **6 项已清除**；**`_tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f`（0 字节）未能删除**——内核级拒绝（见 §偏差④）。`tools/graph-engine/` 未触碰。
- 本批自产 `tmp-p2-*`（诊断/门禁日志 31 个 + `ps-del.log`，均被 gitignore 覆盖）：**收口已清理**（关键红/绿原文已全文誊入本报告，无需日志佐证）。

---

## §偏差与记录

1. **键位实测（§4①触发）**：设计稿/派遣计划转述 `Ctrl+Enter`；实测 `DescBlock` = **Shift+Enter** 提交 —— 按「以 DescBlock 为准」实装 Shift+Enter；e2e 显式钉「Ctrl+Enter 不提交」；全链抄录见 §P2-1。
2. **提交值不 trim**：DescBlock 组件内 `draft.trim()` 后上抛；本批按 P2-3 施工单「不 trim 存储值，只 trim 判空」**上抛原文**，判空移至写回链（`md.trim() === '' → { md: undefined }`）。markdown 前导空白语义保留。
3. **NotePopover 守线过程**：直连后超线 8 行 → 提取 `NoteBody`/`MdEditButton`（占位后终值 599/600，budget 口径零余量持平）。提取后的 `NoteBody` 亦承接「提交 → 对比 → 写回 → 退出」链（调用方只掏 `onChangeMd`/`onExitMdEdit`）。
4. **`_tmp_93540_*` 清障失败（环境项）**：该 0 字节文件对全部删除路径返回 ACCESS_DENIED（`rm`/genie-trash 失败、`.NET File.Delete`、`ctypes DeleteFileW`（lasterr=5）、同目录 rename、`fsutil hardlink list`（错误 5）、`CreateFile(DELETE)` 均被拒）——**内核层面锁死（疑 delete-pending / 句柄占用），非本批引入、0 数据风险**；建议重启后清理。psutil 全进程扫描（可访问范围内）未见持有者。
5. **e2e 关闭→重开链路**：见 §P2-3「e2e 基建记录」——布局过渡窗口导致的点击落空为**既有画布行为**；测试以 `waitForStablePos` 显式等待（未改产品代码）。**待复核点**：若认为需产品侧兜底（面板关闭后短窗口内的点击防抖），另立小批。
6. **清理范围说明**：点名的 7 项中 `tmp-v7-*.log` 系列（历史批次日志，gitignore 内）与 `tmp-c-*`/`tmp-f-*` 等历史日志**不在点名清单**，未动。

## §附：改动文件清单

| 文件 | 类型 | 行数变化 |
|---|---|---|
| `packages/react/src/chrome/NoteBackEditor.tsx` | 新 | +273（三导出） |
| `packages/react/src/chrome/NotePopover.tsx` | 改 | 599 → 599（wc）/ 600 → 600（budget 口径） |
| `packages/react/src/render/MapView.tsx` | 改 | +4（含注释） |
| `apps/canvas/src/MindmapStage.tsx` | 改 | +4（含注释） |
| `packages/react/tests/note-back-edit.test.tsx` | 新 | +208 行 / 15 例 |
| `apps/canvas/tests/note-back-edit.test.tsx` | 新 | +369 行 / 2 例 |
| `docs/dispatch/…p2-card-back-edit-plan.md` + `docs/roadmap/…open-items.md` | 新 | 前置 docs 提交（`566af4c`） |
| `CHANGELOG.md` | 改 | [1.8.21] 段 |

**总 diff**（`9f0da8e..HEAD`，986 insertions / 19 deletions）。
