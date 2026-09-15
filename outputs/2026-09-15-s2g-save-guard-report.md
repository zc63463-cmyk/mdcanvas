# S2G 执行报告：保存侧同步守卫（syncedSourceRef 三写两读）

- **日期**：2026-09-15
- **批次**：S2G-1 → S2G-3（逐任务提交；本报告为收口产物）
- **起点 HEAD**：`b4967b3`（S2F 收口；未推送状态按现状继续）→ 开工先提交计划 `19f2d32`
- **提交链（本批）**：`19f2d32`（计划）→ `231e832`（S2G-1+2：守卫实现 + 全部新钉）→ 本报告 + CHANGELOG `[1.8.20]`（收口 docs 提交）
- **一句话**：写盘前的**同步不变量**——`syncedSourceRef`（「controller 的树所对应的 `doc.source`」，三写点置位）→ `canWriteDoc` 精确等值判定（两读点拦截）：把「将来再出现同类错位」从**静默数据损坏**降级为**拒写 + 通知 + 另存为逃生口**。
- **范围与纪律**：只改 `apps/canvas` → **未重建 dist**。四动作/`remember`/effect deps（`[doc.source]`）与 S2F 判据逐字未动；`handleSaveAs` 不拦；现有测试零放宽。

## §0 基线核对（开工实测）

| 项 | 计划参考 | 实测 | 判定 |
|---|---|---|---|
| HEAD | `b4967b3` | `b4967b3` ✓ | 一致（7 commit 未推，按现状继续） |
| 三包 | 523 / 1266 / 203 | 523 / 1266 / 203（= S2F 收口实测，本批起点仅 +1 docs 提交差额） | 一致 |
| depcruise / lint / budget | 439/1250、1468+46、持平 | 逐项对账一致 | 一致 |
| 未跟踪 | `_tmp_93540_*`、`tmp-v7-s1/s2.diff`（不动）/ `tmp-r2-*`（若在则清）/ `tools/graph-engine/`（禁区） | `tmp-r2-*` 已不在（复核者已清）；其余与计划一致 | 一致 |

## §S2G-1 · 基建 + 三写点 + 两读点

### `saveGuard.ts`（新模块，谓词 + 文案单点）

```ts
/** 写盘前判定：controller 的树是否确属该文档。synced 为 null（尚未置位）→ 不同步。 */
export function canWriteDoc(synced: string | null, docSource: string): boolean {
  return synced === docSource;
}

/** 守卫拦截文案（两处通知同源：自动保存「每 doc.source 一次」/ 手动保存「每次」） */
export const SAVE_BLOCKED_NOTICE =
  '已阻止保存：当前画布内容与文档不同步（防误写）。改动未丢失——请用「另存为」保存到新文件，然后重新打开原文档。';
```

（模块头注释含「为什么必须簿记」：两个直觉判据——`doc.source` vs `serialize()` / `root === editable`——均恒不等、全误报，见计划 §1。）

### 三写两读设计表（diff 锚点）

| 类型 | # | 位置 | diff 原文（新增行） |
|---|---|---|---|
| 写 | ① | `MindmapStage.tsx` controller 创建处 | `syncedSourceRef.current = doc.source; // S2G 写点①：controller 按当前树创建 = 确定同步` |
| 写 | ② | `useDocumentSwitch.ts` skip 分支 | `syncedSourceRef.current = doc.source; // S2G 写点②：跳过 = 树本就同源，置位（幂等）` |
| 写 | ③ | `useDocumentSwitch.ts` reset 分支后 | `syncedSourceRef.current = doc.source; // S2G 写点③：reset 后树 = 该文档 → 置位` |
| 读 | ① | `useAutoSave.ts` 定时器回调、`serialize()` 前 | `if (!canWriteDoc(syncedSourceRef.current, doc.source)) { …通知（每 source 一次）… return; }` |
| 读 | ② | `useDocumentActions.ts` `handleSave` 任务开头 | `if (!canWriteDoc(syncedSourceRef.current, doc.source)) { onBlockedSave?.(SAVE_BLOCKED_NOTICE); return; }` |

### 三写两读 diff 原文（节选，`git diff` 所载）

```diff
// ① MindmapStage（StageInner；ref 声明 + 创建处置位）
+  // S2G：保存侧同步守卫的同步标记（写点①：下方 controller 创建处；其余写点见 useDocumentSwitch）
+  const syncedSourceRef = useRef<string | null>(null);
   if (controllerRef.current === null && editable) {
     controllerRef.current = new EditorController(editable, { … });
+    syncedSourceRef.current = doc.source; // S2G 写点①：controller 按当前树创建 = 确定同步
   }

// ②③ useDocumentSwitch（skip 分支 / reset 分支）
-    if (isFirst && controllerRef.current?.root === editable) return; // 首挂且同源才跳过（状态判据）；不同源补做切换
+    // 首挂且同源才跳过（S2F 状态判据）；不同源补做切换
+    if (isFirst && controllerRef.current?.root === editable) {
+      syncedSourceRef.current = doc.source; // S2G 写点②：跳过 = 树本就同源，置位（幂等）
+      return;
+    }
     controllerRef.current?.reset(editable);
+    syncedSourceRef.current = doc.source; // S2G 写点③：reset 后树 = 该文档 → 置位

// 读① useAutoSave（定时器回调内、serialize 前；每 doc.source 一次去重）
+  // S2G：拦截通知去重（每 doc.source 一次）——防定时器反复触发刷屏
+  const blockedNoticeForRef = useRef<string | null>(null);
     autoSaveTimer.current = setTimeout(() => {
       autoSaveTimer.current = null;
+      // S2G 读点①：写盘前同步不变量 —— 画布树不属于该文档 → 拒写（dirty 保持，不自动重试）
+      if (!canWriteDoc(syncedSourceRef.current, doc.source)) {
+        if (blockedNoticeForRef.current !== doc.source) {
+          blockedNoticeForRef.current = doc.source;
+          onBlockedSave?.(SAVE_BLOCKED_NOTICE);
+        }
+        return;
+      }
       const source = controller.serialize();

// 读② useDocumentActions（handleSave 任务开头；通知每次）
   const handleSave = useCallback(async (): Promise<void> => {
     await runSave(async () => {
+      // S2G 读点②：写盘前同步不变量 —— 不同步拒写（通知每次：用户手势触发，无刷屏问题）
+      if (!canWriteDoc(syncedSourceRef.current, doc.source)) {
+        onBlockedSave?.(SAVE_BLOCKED_NOTICE);
+        return;
+      }
       if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
```

接线：`StageInner → StageContent` 新增 `syncedSourceRef` prop（同 `controllerRef` 先例）；两 hook 新增 `onBlockedSave?: (msg: string) => void`，StageContent 接线 `setCommandNotice`（既有 4s 消退通道）；`useDocumentSwitch` 新增 `syncedSourceRef` option。`if (!editable) return;` 早退**不置位**（解析失败 → 后续写盘被拦，方向正确）。

## §S2G-2 · 判别钉（先红后绿；+6 例）

> **执行顺序偏差（如实记录）**：计划序列为「1 基建 → 2 新钉」，并期望 S2G-2 呈现「实现未做 → 红」。本批按任务粒度以 S2G-1（实现）先行，故「红」以**等效捕获**取得：`Pass A` 临时注释 uDS 两个写点 → t5 红（模拟写点未实现）；`Pass B` 临时 `canWriteDoc` 恒 true → 读点红（模拟守卫未实现；与 S2G-3 阴性对照同法，S2G-3 在提交后树上**再次复跑**留证）。两轮均即刻回退并以 `git diff`/grep 自证零残留。

### Pass A 红（写点中性化 → t5）原文

```
 × t5：首挂同源跳过置位 / source 变化 reset 后置位 / 首挂不同源同样置位 / editable=null 不置位
AssertionError: expected null to be 'SRC-A' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

### Pass B 红（守卫中性化 → 读点两文件）原文

```
 × handleSave 不同步 → 拒写 + 通知；savedSource/markSaved/remember 均不动
 × 不同步（synced ≠ doc.source）→ 拒写 + 通知恰一次；同 source 再触发不重复通知
 × 置位（ref = doc.source）后 → 写盘恢复
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times   （×3，「写盘照发」）
 Test Files  2 failed (2)
      Tests  3 failed | 33 passed (36)
```

### 绿原文（三文件）

```
 ✓ tests/useDocumentActions.test.tsx (29 tests)
 ✓ tests/useAutoSave.test.tsx (7 tests)
 ✓ tests/useDocumentSwitch.test.tsx (6 tests)
 Test Files  3 passed (3)
      Tests  42 passed (42)
```

### 既有 save 用例全绿证据（误伤率）

- `useDocumentActions.test.tsx` **29 例**（原 26 + 新 3）：applyDoc×5 / handleSave×3 / 句柄闭环×5 / handleNew·Open×5 / handleSaveAs×1 / 保存写回口径×2 / UnsavedPrompt×5 / S2G×3 —— **既有用例零改动、零放宽**。
- `useAutoSave.test.tsx` **7 例**（原 5 + 新 2）。
- `useDocumentSwitch.test.tsx` **6 例**（原 5 + t5）。
- mock 升级仅「补字段」：两处 setup 增 `syncedSourceRef`（缺省 = 与 `doc.source` 同源 = 现行为，同 S2F 先例）+ `onBlockedSave` spy；uDS setup 增 `editableNull` 分支。**未放宽任何断言**；无任何既有正常路径被判不同步（§4 误伤停条款未触发）。

## §S2G-3 · 收口

### 阴性对照（`canWriteDoc` 临时恒 true，提交后树上复跑）原文

```diff
-export function canWriteDoc(synced: string | null, docSource: string): boolean {
-  return synced === docSource;
-}
+export function canWriteDoc(synced: string | null, docSource: string): boolean {
+  void synced; void docSource;
+  return true; // 【阴性对照 · 临时】恒 true = 守卫未生效；贴完红即回退
+}
```

```
 × handleSave 不同步 → 拒写 + 通知；savedSource/markSaved/remember 均不动
 × 不同步（synced ≠ doc.source）→ 拒写 + 通知恰一次；同 source 再触发不重复通知
 × 置位（ref = doc.source）后 → 写盘恢复
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times   （×3）
 Test Files  2 failed | 1 passed (3)
      Tests  3 failed | 39 passed (42)
```

**回退自证**：还原后 `git diff --stat` = **空**（与提交 `231e832` 逐字节一致）；`grep -rn '阴性对照 · 临时|void synced' apps/canvas/src` = 零命中。

### 门禁原样输出（收口终态）

```
-- kernel --
 Test Files  61 passed (61)
      Tests  523 passed (523)
KERNEL_EXIT=0

-- react --
 Test Files  131 passed (131)
      Tests  1266 passed (1266)
REACT_EXIT=0

-- canvas --
 Test Files  29 passed (29)
      Tests  209 passed (209)
CANVAS_EXIT=0
（203 + 6 = 209：t5 + useAutoSave×2 + useDocumentActions×3）

-- tsc x3 --
TSC_K=0
TSC_R=0
TSC_C=0

-- depcruise --
✔ no dependency violations found (440 modules, 1254 dependencies cruised)
（439/1250 → +1 模块 = saveGuard.ts；+4 deps = 三个 hook 的导入）

-- lint --
Checked 439 files in 210ms. No fixes applied.
Found 1468 warnings.
Found 46 infos.

-- budget --
  any                0      0   持平
  tsIgnore           0      0   持平
  bang              89     90   ↓1 优于
  asCast            31     31   持平
  console            4      4   持平
  todo               1      1   持平
  defaultExport      2      2   持平
  bigFiles           3      4   ↓1 优于

  超 600 行文件（3）：
    apps/canvas/src/MindmapStage.tsx (2334)
    packages/react/src/render/edgeRouting.ts (1235)
    packages/react/src/render/MapView.tsx (2244)

✅ 全部指标在预算内（债务未增长）
```

### `git status --short` 原文（清理后、收口提交前）

```
 M CHANGELOG.md
?? _tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f
?? outputs/2026-09-15-s2g-save-guard-report.md
?? tmp-v7-s1.diff
?? tmp-v7-s2.diff
?? tools/graph-engine/
```

### 清理结果

- **执行（本批自产 `tmp-*` 11 个）**：`tmp-s2g-*.log`（tsc1 / redA / redB / neg / green / kernel / react / canvas / tsc-k / tsc-r / tsc-c）分 3 批（单条 `rm`、≤5 个/批），零残留。
- **保留**：`_tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f`、`tmp-v7-s1.diff`、`tmp-v7-s2.diff`（来源未识别）；`tools/graph-engine/`（禁区）——逐项未动。

### 边界清单（已接受，逐条）

1. **守卫键 = `doc.source` 字符串**（D1）：两份**内容逐字相同**的文档互切 → source 等值 → 视为同步（沿 E 批「source 不变 = 不重建」语义）。
2. **`handleSaveAs` 放行**（D3）：逃生口——把改动救到新文件；另存后会话仍是**原文档身份** → 原文档继续被拦（保持正确）；已接受边界：用户在系统选择器里**自行覆盖原文件**属知情操作。
3. **拦截后不自动重试**：自动保存拦截时 `dirty` 保持、不 `markSaved`；不自动重试（等下一次 dirty 边沿——通常来自一次成功保存后——或手动动作）。
4. **`editable=null`（解析失败）不置位** → 后续写盘被拦（无树可写，诚实方向）。
5. **通知策略**（D2）：自动保存**每 `doc.source` 一次**（ref 去重防刷屏）；手动保存**每次**（用户手势，无刷屏问题）。两处文案同源（`SAVE_BLOCKED_NOTICE` 单点）。

## 偏差与原因（汇总）

| # | 偏差 | 原因 | 处置 |
|---|---|---|---|
| 1 | S2G-2「先红」以**中性化等效捕获**（Pass A/B）呈现，而非「实现未做」的天然红 | 任务粒度执行（S2G-1 实现整块先行，其产出即提交 2 的一部分） | 两轮中性化即回退 + 零残留自证；S2G-3 阴性对照在提交后树上复跑留证 |
| 2 | `saveGuard.ts` 未加 `SyncedSourceRef` 类型别名 | D4 小模块取向：仅谓词 + 文案两导出，避免过度抽象 | 报告列明（各 hook 直接标注 `RefObject<string \| null>`） |
| 3 | 拦截发生时 `runSave` 的「保存中」指示会闪现一帧 | 检查点按计划置于 `runSave` 任务**开头**（指示器在任务外先置位） | 接受（语义无害）；如复核要求可挪到 `runSave` 之前 |

## 待复核 / 下一步（停，等指令）

1. 复核三写两读位置/语义、D1–D5 决策执行与边界清单。
2. 复核「先红」呈现方式（偏差 #1）是否接受。
3. push 授权（本批 **未 push**；提交链 `19f2d32 → 231e832 → 收口 docs`）。
