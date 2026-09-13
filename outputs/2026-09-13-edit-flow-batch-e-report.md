# 批次 E 执行报告：编辑流保全（保存不打断会话）

> 计划：`docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md` · 执行日：2026-09-13
> 起点基线（复核实测）：kernel **480** / react **1093** / canvas **170** = **1743 全绿** ✓；起点 HEAD `a10fc59`（计划文档先单独提交为 `de4aac4`）

## 1. 逐任务（commit / 改动 / 实测 / 新增用例）

### E-1 — `95580b9` `fix(canvas): 自动保存改写 savedSource 而非 source（切断保存→重建环）`
- **改动**：`packages/react/src/edit/document.ts`（+`savedSource?: string` 字段与语义注释）；`apps/canvas/src/hooks/useAutoSave.ts`（新，纯搬迁）；`apps/canvas/src/MindmapStage.tsx`（删内联 effect → 调用 hook）；`apps/canvas/tests/useAutoSave.test.tsx`（新）
- **分包测试（实测）**：canvas **175 passed (175)**（22 files；基线 170 + 新 **5** 例）
- **红①（模块不存在）**：
  ```
   FAIL  tests/useAutoSave.test.tsx [ tests/useAutoSave.test.tsx ]
  Error: Failed to resolve import "../src/hooks/useAutoSave" from "tests/useAutoSave.test.tsx". Does the file exist?
    Plugin: vite:import-analysis
   Test Files  1 failed (1)
        Tests  no tests
  ```
  （计划预期 `Cannot find module ...`；实际 Vite 解析器报 `Failed to resolve import ... Does the file exist?`，语义相同。）
- **红②（故意保留旧口径 `source` → 判别力验证）**：
  ```
   ❯ tests/useAutoSave.test.tsx (5 tests | 1 failed) 29ms
       × dirty+saved+handle：300ms 后保存，写回 savedSource 且不改写 source 18ms
  FAIL  tests/useAutoSave.test.tsx > ... > dirty+saved+handle：300ms 后保存，写回 savedSource 且不改写 source
  AssertionError: expected undefined to be 'SRC' // Object.is equality
   ❯ tests/useAutoSave.test.tsx:90:30
       90|     expect(next.savedSource).toBe('SRC');
   Test Files  1 failed (1)
        Tests  1 failed | 4 passed (5)
  ```
- **转绿**：`✓ tests/useAutoSave.test.tsx (5 tests)` / `Tests 5 passed (5)`（exit=0）

### E-2 — `83b4fb4` `fix(canvas): 手动保存/另存为不改写 doc.source（同口径）`
- **改动**：`apps/canvas/src/hooks/useDocumentActions.ts`（`:142` handleSave、`:155-161` handleSaveAs 两处 setDoc 补丁 → `savedSource`；`remember` 契约未动）；`apps/canvas/tests/useDocumentActions.test.tsx`（+2 例，既有 24 例零修改）
- **红（先写 2 例）**：`❯ tests/useDocumentActions.test.tsx (26 tests | 2 failed)`；两例均为 `AssertionError: expected [ { name: 'a.mm.md', …(4) } ] to deep equally contain ObjectContaining{ "savedSource": "NEW-SRC", "source": "X" }`（received 中 `source: "NEW-SRC"`、无 `savedSource`）
- **绿**：`✓ tests/useDocumentActions.test.tsx (26 tests)` / `Tests 26 passed (26)`
- **分包测试（实测）**：canvas **177 passed (177)**（+2）

### E-3 — `aa3b339` `refactor(canvas): 抽出 useDocumentSwitch（文档切换语义单点化）+ 守卫测试`
- **改动**：`apps/canvas/src/hooks/useDocumentSwitch.ts`（新，纯搬迁原 371-395 effect）；`apps/canvas/src/MindmapStage.tsx`（接线；`entityHost` 块与 `expandedQaId` 声明前移——消除 hook 参数求值的 TDZ，同时保持 effect 注册顺序：switch 先于 autosave）；`apps/canvas/tests/useDocumentSwitch.test.tsx`（新）
- **三段**：红①（`Failed to resolve import "../src/hooks/useDocumentSwitch"`）→ 红②（deps 误为对象身份 `[doc]` → t1 红）→ 绿
  ```
   ❯ tests/useDocumentSwitch.test.tsx (2 tests | 1 failed) 21ms
       × t1：source 不变的 doc 新对象（仅 savedSource/ts/handle 变）→ 四个动作零调用 16ms
       ✓ t2：source 变化 → 四动作各恰一次（切换回归钉）+ 首挂只登记不动树 3ms
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
   ❯ tests/useDocumentSwitch.test.tsx:75:23
       75|     expect(reset).not.toHaveBeenCalled();
  ```
  转绿：`✓ tests/useDocumentSwitch.test.tsx (2 tests)` / `Tests 2 passed (2)`
- **分包测试（实测）**：canvas **179 passed (179)**（+2）

### E-4 — `ff9d761` `fix(canvas): 最近文档快照改读 savedSource（连带口径）+ 防回潮注释`
- **改动**：`MindmapStage.tsx`（`library.upsert` 快照 → `doc.savedSource ?? doc.source`；deps 加 `doc.savedSource`）；`useDocumentSwitch.ts`（防回潮注释；`useAutoSave.ts` 的等价说明在 E-1 已内置）；`MindmapStage.tsx` 重建 effect 调用点补注释
- **核对型 DoD（无新增测试）**：canvas **179 passed (179)** 保持；见 §3
- **新增用例**：0

### E-5 — `cb830fe` `docs: 编辑流保全收口（CHANGELOG 1.8.8）`
- **改动**：`CHANGELOG.md`（[1.8.8] 段：因果链 / 四类损失 / 两条守卫 / 契约说明）；全 gate 见 §4

## 2. 两条阴性对照（DoD 第 2 条，原始报错）

### 对照① `useAutoSave` 补丁改回 `source`
```
 ❯ tests/useAutoSave.test.tsx (5 tests | 1 failed) 24ms
     × dirty+saved+handle：300ms 后保存，写回 savedSource 且不改写 source 15ms
AssertionError: expected undefined to be 'SRC' // Object.is equality
 ❯ tests/useAutoSave.test.tsx:90:30
     90|     expect(next.savedSource).toBe('SRC');
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

### 对照② `useDocumentSwitch` deps 改对象身份 `[doc]`
```
 ❯ tests/useDocumentSwitch.test.tsx (2 tests | 1 failed) 24ms
     × t1：source 不变的 doc 新对象（仅 savedSource/ts/handle 变）→ 四个动作零调用 19ms
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 ❯ tests/useDocumentSwitch.test.tsx:75:23
     75|     expect(reset).not.toHaveBeenCalled();
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

### 恢复确认
- 恢复后复跑：`✓ tests/useAutoSave.test.tsx (5 tests)` / `✓ tests/useDocumentSwitch.test.tsx (2 tests)` / `Test Files  2 passed (2)` / `Tests  7 passed (7)`（exit=0）
- `git diff --stat` → **空输出**；`git status --short` 仅 `?? tools/graph-engine/`（既有未跟踪残留，未动）

## 3. §1.4 七处口径核对（DoD 第 3 条）

### `git grep -n "doc.source" apps/canvas/src packages/react/src`（E-4 后实测原始输出）
```
apps/canvas/src/MindmapStage.tsx:192:  const data = useMemo(() => buildEditable(doc.source), [doc.source]);
apps/canvas/src/MindmapStage.tsx:383:  // 注意：保存路径不得改写 doc.source（解析输入）——见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md
apps/canvas/src/MindmapStage.tsx:446:  // 手动 Ctrl+S 取消 pending；失败静默由手动保存兜底；口径：写回 savedSource，不碰 doc.source）
apps/canvas/src/MindmapStage.tsx:757:  // E 批口径：快照读 savedSource（最近一次成功保存的内容）；保存路径不得改写 doc.source ——
apps/canvas/src/MindmapStage.tsx:764:        source: doc.savedSource ?? doc.source,
apps/canvas/src/MindmapStage.tsx:768:  }, [doc.id, doc.name, doc.savedSource, doc.source, doc.saved, library]);
apps/canvas/src/hooks/useAutoSave.ts:9: * 口径修正（E 批）：保存路径不得改写 `doc.source` —— 它是「本次会话打开/新建时的
apps/canvas/src/hooks/useAutoSave.ts:55:              // 保存路径不得改写 doc.source（E 批口径修正）：快照写入 savedSource
apps/canvas/src/hooks/useDocumentActions.ts:142:      // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
apps/canvas/src/hooks/useDocumentActions.ts:158:        // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
apps/canvas/src/hooks/useDocumentSwitch.ts:5: * - `doc.source` 变化 = 真正的文档切换 → controller.reset（清 history/折叠/选中）
apps/canvas/src/hooks/useDocumentSwitch.ts:10: * 依赖纪律（E 批判别）：**保存路径不得改写 `doc.source`**（见
apps/canvas/src/hooks/useDocumentSwitch.ts:11: * docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md）——deps 严格锁在 `doc.source`：
apps/canvas/src/hooks/useDocumentSwitch.ts:50:  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保持 [doc.source]（原 eslint-disable 注释），行为由 useDocumentSwitch.test 判别
apps/canvas/src/hooks/useDocumentSwitch.ts:72:  }, [doc.source]);
packages/react/src/edit/docLibrary.ts:152:      source: doc.source,
packages/react/src/edit/document.ts:123:      const ok = await writeToHandle(doc.handle, doc.source);
packages/react/src/edit/document.ts:127:    return saveMarkdown(doc.source, doc.name);
packages/react/src/edit/document.ts:151:    this.library.upsert({ id: doc.id, name: doc.name, source: doc.source });
```

### 逐条核对表
| # | 位置（现行号） | 用途 | 判定 | 理由 |
|---|---|---|---|---|
| 1 | `MindmapStage.tsx:192` `buildEditable(doc.source)` | 解析输入 | **不动** | `source` 语义 = 「打开时内容」；本批保证保存路径不再击穿它（切断回读环的关键一侧） |
| 2 | `useDocumentSwitch.ts:72` deps `[doc.source]`（原 `MindmapStage.tsx:395`，E-3 搬迁） | 重建 effect deps | **不动**（deps 逐字保留） | 同上：源冻结后永不误触发；hook 内 `biome-ignore` 注明「刻意保留」 |
| 3 | `MindmapStage.tsx:764/768` | `library.upsert` 快照 + deps | **改口径**（E-4） | → `doc.savedSource ?? doc.source`；deps 加 `doc.savedSource`（快照 = 最近成功保存的内容） |
| 4 | `document.ts:123,127` `save()` 写盘 | 调用方传入 source | **不动** | 写盘内容恒为调用方传入（autosave / 手动保存都传「新内容」） |
| 5 | `document.ts:151` `remember()` | 契约「传入即内容」 | **不动** | §1.5 坑 1：改读 `savedSource` 会因 spread 保留旧值 → 最近文档存旧内容 |
| 6 | `docLibrary.ts:152` | `DocEntry.source`（快照字段） | **不动** | 快照内容由写入侧（#3 与 `remember` 调用方）保证 |
| 7 | `FileManagerModal.tsx:87` / `StartupScreen.tsx:46,109,140` | 从快照打开 / 计数 | **不动** | 读 `DocEntry.source`（非 `doc.source`）；快照正确性由 #3 保证。原始输出见下 |

### 清单 #7 两个文件的 source 读取（原始输出）
```
apps/canvas/src/FileManagerModal.tsx:77:        // 只剩元数据（旧条目被配额剥掉 source）→ 重新选文件。
apps/canvas/src/FileManagerModal.tsx:79:        if (entry.source === undefined) {
apps/canvas/src/FileManagerModal.tsx:87:          source: entry.source,
apps/canvas/src/StartupScreen.tsx:10: * **含 source**（所以能直接恢复内容、无需重新授权），但**文件句柄被主动丢弃**
apps/canvas/src/StartupScreen.tsx:24:  /** 选择某条最近文档（内容即存下的 source） */
apps/canvas/src/StartupScreen.tsx:46:function countNodes(source: string | undefined): number {
apps/canvas/src/StartupScreen.tsx:109:                {countNodes(latest.source)} 个节点 · {formatRelative(latest.ts)}
apps/canvas/src/StartupScreen.tsx:140:                        {countNodes(d.source)} 个节点 · {formatRelative(d.ts)}
```

## 4. 门禁与预算实测（E-5 收口，全部原样）

- **tsc ×3**：`KERNEL_TSC_OK` / `REACT_TSC_OK` / `CANVAS_TSC_OK`（rc=0）
- **react dist 重建**：`REACT_DIST_OK`（`tsc -p packages/react/tsconfig.build.json`）
- **三包套件**（gate 慢项，一跑）：
  ```
  ===== KERNEL =====    Test Files  57 passed (57)      Tests  480 passed (480)    Duration  33.67s
  ===== REACT  =====    Test Files  115 passed (115)    Tests  1093 passed (1093)  Duration  161.03s
  ===== CANVAS =====    Test Files  23 passed (23)      Tests  179 passed (179)    Duration  46.68s
  ```
  合计 **1752 全绿**（基线 1743 + E 批 +9）
- **depcruise**：`✔ no dependency violations found (406 modules, 1145 dependencies cruised)`（exit 0）
- **lint**：`Found 1464 warnings.` / `Found 46 infos.`（exit 0；基线 1481 + 46 → **净降 17**，见 §5.1）
- **budget**：
  ```
    指标            实测   预算   状态
    any                0      0   持平
    tsIgnore           0      0   持平
    bang              89     90   ↓1 优于
    asCast            31     31   持平
    console            4      4   持平
    todo               1      1   持平
    defaultExport      2      2   持平
    bigFiles           3      4   ↓1 优于
    超 600 行文件（3）：
      apps/canvas/src/MindmapStage.tsx (2241)
      packages/react/src/render/edgeRouting.ts (1213)
      packages/react/src/render/MapView.tsx (2088)
  ✅ 全部指标在预算内（债务未增长）
  ```
- **阈值 / 契约测试**：零放宽；`CULL_MARGIN` 未动；新文件均 <600 行（useAutoSave 71 / useDocumentSwitch 74 / 两个测试 ~110/96）；**`MindmapStage.tsx` 2269 → 2241（下降 28 行）**

## 5. 偏差与原因（记录在案）

1. **lint 抑制（net −17）**：搬迁的两段 `useExhaustiveDependencies` 警告——原位置合计 17 条（autosave effect 7 + B1 effect 10）；搬迁到 hook 文件后形态为 10 + 12 = 22 条（规则对 hook 文件的粒度差异）。为满足「水位不得上升」，按原 `eslint-disable` 的既有意图以 `biome-ignore`（行级、紧贴 hook 调用、注明理由）显式抑制 → 全仓 1481 → 1464（exit 0）。行为防回潮由 `useAutoSave.test` / `useDocumentSwitch.test` 承担（判别用例已由两条阴性对照验证）。
2. **红①文案差异**：计划预期 `Cannot find module '../src/hooks/useAutoSave'`；实际 Vite import-analysis 报 `Failed to resolve import "../src/hooks/useAutoSave" ... Does the file exist?`（同义）。
3. **effect 注册顺序**：`useDocumentSwitch` 调用点保持原位（原 effect 处）；为消除 hook 参数求值的 TDZ，将 `entityHost` 声明块与 `expandedQaId` 声明前移至调用点之前（纯位置调整，跨渲染无影响）。autosave 的 effect 仍在 switch effect 之后注册（切换时 reset 先行，autosave 读到 `dirty=false` 早退）。
4. **budget 误报排查（已解决）**：E-3 排查 biome 计数时创建过 `tmp-lint/`（HEAD 版副本 .tsx）——该目录被 budget 脚本从仓库根扫描（bang/asCast/defaultExport/bigFiles 各 +），已删除；最终 budget 全持平。**教训：仓库根不要放 .tsx 临时副本。**
5. **环境瞬时异常（已消除）**：E-2 一次 `EBUSY: resource busy or locked`（重试成功）；E-3 一次同消息并行编辑丢写（工具误报成功，经 `git diff` 全量核查无误改后重做）。最终产物均经 diff 核对。
6. **遵守 E-A5**：未写真浏览器 verify 脚本（autosave 需真实 FS 句柄）。
7. **遗留小项（未动）**：`useDocumentActions.test.tsx` 文件头注释「不测自动保存（那是 StageContent 内的 effect）」在 E-1 后略过时（autosave 已抽为 `useAutoSave` 并单独有测试）；为守住「既有 24 例原样」未改注释。

## 6. 交付 commits（未 push，按任务要求）

```
de4aac4 docs: 追加编辑流保全派遣计划
95580b9 fix(canvas): 自动保存改写 savedSource 而非 source（切断保存→重建环）
83b4fb4 fix(canvas): 手动保存/另存为不改写 doc.source（同口径）
aa3b339 refactor(canvas): 抽出 useDocumentSwitch（文档切换语义单点化）+ 守卫测试
ff9d761 fix(canvas): 最近文档快照改读 savedSource（连带口径）+ 防回潮注释
cb830fe docs: 编辑流保全收口（CHANGELOG 1.8.8）
```
