# P1 收尾小修执行报告（T1 翻卡态提升宿主 / T2 FlipCard 非交互模式 / T3 最小记录）

- **日期**：2026-09-14
- **批次**：P1-T1 → P1-T3（逐任务提交；本报告为收口产物）
- **起点 HEAD**：`da1c67d`（本地 = 远端 = origin/main）→ 开工先提交计划 `1cb752c`
- **提交链（本批）**：`1cb752c`（计划）→ `09d3007`（T1）→ `9839b6f`（T2）→ 本报告 + CHANGELOG `[1.8.18]` + 设计稿注记（收口 docs 提交）
- **一句话**：翻卡态从「面板内 state（卸载即丢）」提升为**宿主（MindmapStage）会话态**（卸载/重挂不丢、按节点 id 记、不落盘）；`FlipCard` 新增 `interactive`（受控 no-op 去「幽灵按钮」a11y 语义）+ `data-flip-card`/`data-flip-state` 锚点；设计稿/CHANGELOG 落最小记录。**零协议 / 零布局改动**。

## §0 起点基线核对（开工实测 vs 计划参考）

| 项 | 计划 §0 参考 | 开工实测 | 说明 |
|---|---|---|---|
| 提交 | `da1c67d` | **`da1c67d`** ✓ | 本地 = 远端 |
| 三包 | kernel 516 / react 1206 / canvas 195 = 1917 | **kernel 523 / react 1258 / canvas 196 = 1977 全绿** | 计划参考值为**陈旧读数**（= P1 报告 §0 的「计划参考」列）；实测与 P1 报告口径一致 |
| depcruise | 432 模块 / 1224 deps | **436 / 1241 零违规** | 同属陈旧参考值（hook 实测） |
| lint | 1468 + 46 | **1468 + 46** ✓ | — |
| budget | bigFiles 3/4 | **bigFiles 3/4**（bang 89/90 等全同）✓ | — |

核对法：三包各跑全量（`node <pkg>/node_modules/vitest/vitest.mjs run`）；depcruise 走真实入口。**未因基线不符停工**：目标提交一致，仅计数值陈旧 → 按实测口径执行并在本报告列明。

## §T1 · 翻卡态提升宿主（②）

- **commit**：`09d3007 feat(canvas,react): 翻卡态提升宿主保持（离屏不丢；NotePopover 受控双模）`（5 文件，+447/−8）
- **改动文件**：`apps/canvas/src/MindmapStage.tsx`（+16）· `packages/react/src/render/MapView.tsx`（+13）· `packages/react/src/chrome/NotePopover.tsx`（596→**600 行**，守线）· `packages/react/tests/note-flip-host.test.tsx`（**新增**，6 例）· `apps/canvas/tests/note-flip-host.test.tsx`（**新增**，1 例端到端）
- **新增用例**：7（react 6 + canvas e2e 1）

### 接线三段 diff（原文）

**① MindmapStage（宿主会话态）**

```diff
+  // P1-T1：翻面态提升宿主 —— 会话态集合（不落盘；不顺手清——承 onBlankClick「不静默关面板」裁决口径）
+  const [flippedNoteIds, setFlippedNoteIds] = useState<Set<string>>(() => new Set());
+  /** Set → 数组（引用稳定化：仅集合变化时更新；MapView prop 形态 = readonly string[]） */
+  const flippedNoteIdList = useMemo(() => [...flippedNoteIds], [flippedNoteIds]);
+  const toggleNoteFlip = (id: string, next: boolean): void => {
+    setFlippedNoteIds((prev) => {
+      if (prev.has(id) === next) return prev; // 幂等：同值重复调用 → 原引用（不产生状态更新）
+      const out = new Set(prev);
+      if (next) out.add(id);
+      else out.delete(id);
+      return out;
+    });
+  };
@@
         pinnedNoteIds={pinnedNoteIds}
         editingNoteIds={editingNoteIds}
+        flippedNoteIds={flippedNoteIdList}
+        onToggleNoteFlip={toggleNoteFlip}
```

**② MapView（两新 props / 受控集合 / 固定卡渲染位）**

```diff
+  /** P1-T1：翻面中的固定 note 笔记 id（受控；宿主持有；缺省 → 面板内部态，现行为） */
+  flippedNoteIds?: readonly string[];
+  /** P1-T1：翻面意图回传（宿主据此写回 flippedNoteIds） */
+  onToggleNoteFlip?: (id: string, next: boolean) => void;
@@
   pinnedNoteIds,
   editingNoteIds,
+  flippedNoteIds,
+  onToggleNoteFlip,
@@
+  // P1-T1：翻面集合 —— 缺省 undefined（= 面板内部态，现行为）；传入即受控
+  const flippedNoteIdSet = useMemo(
+    () => (flippedNoteIds === undefined ? undefined : new Set(flippedNoteIds)),
+    [flippedNoteIds],
+  );
@@  固定卡渲染位（embedded）
             md={panel.md}
+            flipped={flippedNoteIdSet?.has(panel.id)}
+            onFlipChange={(next) => onToggleNoteFlip?.(panel.id, next)}
```

**③ NotePopover（受控/非受控双模）**

```diff
-  // P1：翻面态 —— 会话态、按节点 id 记（渲染位以 key={panel.id} 挂载/卸载），不落盘
-  const [flipped, setFlipped] = useState(false);
+  // P1-T1：翻面态 —— 受控（flipped 传入即宿主持态）或非受控（缺省回退内部 state）；不落盘
+  const [selfFlipped, setSelfFlipped] = useState(false);
+  const isFlipped = flipped ?? selfFlipped;
+  const setFlip = (next: boolean): void => { if (flipped === undefined) setSelfFlipped(next); onFlipChange?.(next); };
@@
-            aria-pressed={flipped}
-            title={flipped ? '翻回正面' : '翻面：查看 markdown 背面'}
+            aria-pressed={isFlipped}
+            title={isFlipped ? '翻回正面' : '翻面：查看 markdown 背面'}
@@
-            onClick={(e) => { e.stopPropagation(); setFlipped((v) => !v); }}
+            onClick={(e) => { e.stopPropagation(); setFlip(!isFlipped); }}
@@
-          flipped={flipped}
+          flipped={isFlipped}
```

约束核对：`flipActive` 门（`:255`）逐字未动 ✓；floating 预览渲染位零改动 ✓；`estimateNoteAreaHeight` 链零改动 ✓；不落盘 / 不顺手清 ✓。

### 红证据（原文；**行为层红**——vitest 不做类型检查）

```
 FAIL  tests/note-flip-host.test.tsx > ① 受控：A 在 flippedNoteIds → A 翻面、B 不受影响
AssertionError: expected 'rotateY(-180deg)' to be 'rotateY(0deg)'
 FAIL  tests/note-flip-host.test.tsx > ② 点击翻面按钮 → onToggleNoteFlip(id, true) 恰一次；受控下不自翻
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 FAIL  tests/note-flip-host.test.tsx > ③ 卸载重挂保持：pinnedNoteIds 移除再恢复 → 重挂后仍背面
AssertionError: expected 'rotateY(-180deg)' to be 'rotateY(0deg)'
 FAIL  tests/note-flip-host.test.tsx > 受控：flipped 传入 → 显示背面；点击按钮只回传 onFlipChange(false)，不自翻
AssertionError: expected 'rotateY(-180deg)' to be 'rotateY(0deg)'

 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

（2 passed = 阴性对照④ + 非受控自翻「现行为」钉。）

### 绿证据（原文）

```
 ✓ tests/note-flip-host.test.tsx (6 tests) 284ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

回归面：`note*` 家族 6 文件 **70/70** 全绿（含既有 `note-panel-flip` 12/12 未破）；`mapview-pan-memo` **2/2**（「纯平移不重渲染任何节点组件」机制钉保住）；`TSC_REACT=0 / TSC_CANVAS=0`。

### 「卸载重挂保持」测试原文

```tsx
  it('③ 卸载重挂保持：pinnedNoteIds 移除再恢复 → 重挂后仍背面', () => {
    const fx = layoutTwoNotes();
    const { container, rerender } = renderMap(fx, {
      pinnedNoteIds: [fx.aId],
      flippedNoteIds: [fx.aId],
    });
    expect(facesOf(panelOf(container, '正文 A')).back).toBe('rotateY(0deg)');

    rerender({ pinnedNoteIds: [] }); // 面板卸载（props 变化）
    expect(container.querySelectorAll('[data-note-popover]').length).toBe(0);

    rerender({ pinnedNoteIds: [fx.aId] }); // 重挂
    expect(facesOf(panelOf(container, '正文 A')).back).toBe('rotateY(0deg)');
  });
```

### 端到端结论（尽力项：**已做，非残余**）

真 `MindmapStage` 全链用例（`apps/canvas/tests/note-flip-host.test.tsx`）：启动页进入 →「最近」菜单打开含 `note.md` 文档 → 点节点固定面板 → 翻面 → 关闭面板（卸载）→ 重新点节点固定（重挂）→ **仍背面**。去偏绿后复跑 3 次均 1/1 通过（335ms → 451ms → 366ms 量级）。

迭代 6 轮与两个现场发现（均如实记录）：

1. 首版走「继续上次」进入 → `节点「甲」缺失`；加诊断后 dump 揭示 **doc 名已切换、画布树仍为 gateway**（见 §范围外发现 ①）→ 改走「看内置示例 + 最近菜单」（`applyDoc` → 已挂载 `useDocumentSwitch` → reset 生效）。
2. 修正入口后点击成功但面板未挂载（诊断 `popover=0 badge=0 k=1 t=(0,0)`）→ 探针定位**夹具语法**：`note: ["…"]` 流式序列被自研 YAML 读成**字符串** → `hasNote=false`（点击不固定面板）。修正为块序列（`note:` + `- 条目`）后全绿。
3. 说明：e2e 入口路径为「看内置示例 + 最近菜单」；`k` 档位守卫与失败诊断均为工具化防御（jsdom 实测 k=1 恒等）。

## §T2 · FlipCard 非交互模式（③）

- **commit**：`9839b6f fix(react): FlipCard 增加 interactive（受控 no-op 去幽灵按钮语义；锚点 data-flip-card）`（4 文件，+55/−19）
- **改动文件**：`packages/react/src/chrome/FlipCard.tsx`（98→109 行）· `packages/react/src/chrome/NotePopover.tsx`（`interactive={false}` 并入既有行，**600 行不动**）· `packages/react/tests/chrome.test.tsx`（+2 例）· `packages/react/tests/note-panel-flip.test.tsx`（白名单 3 处）
- **新增用例**：2（锚点始终输出；interactive=false 全语义）

### FlipCard diff（原文，核心节选）

```diff
   /**
    * 交互开关（缺省 true = 点击/键盘可翻）。false：不渲染 role/aria/tabIndex/键盘与整卡点击，
    * cursor 也不给 pointer —— 供「受控 no-op」宿主（如固定 note 面板，翻转由面板头按钮驱动）。
    */
   interactive?: boolean;
@@
-      role="button"
-      aria-pressed={isFlipped}
-      aria-label={title}
-      onClick={() => set(!isFlipped)}
-      tabIndex={0}
-      onKeyDown={(e) => {
-        if (e.key === 'Enter' || e.key === ' ') {
-          e.preventDefault();
-          set(!isFlipped);
-        }
-      }}
+      data-flip-card
+      data-flip-state={isFlipped ? 'back' : 'front'}
+      role={interactive ? 'button' : undefined}
+      aria-pressed={interactive ? isFlipped : undefined}
+      aria-label={interactive ? title : undefined}
+      onClick={interactive ? () => set(!isFlipped) : undefined}
+      tabIndex={interactive ? 0 : undefined}
+      onKeyDown={interactive ? handleKey : undefined}
       style={{
         width,
         height,
         perspective: 900,
-        cursor: 'pointer',
+        cursor: interactive ? 'pointer' : undefined,
         ...style,
       }}
```

（`handleKey` 为抽出的键盘处理器；React 对 `undefined` 属性**不落地** → `interactive={false}` 时真实去语义。）

### 白名单 3 处逐条理由（`note-panel-flip.test.tsx`）

| # | 位置 | 改动 | 理由 |
|---|---|---|---|
| 1 | `:48` | `div[role="button"]` → `[data-flip-card]` | 角色锚点随 T2 移除（non-interactive 不再渲染 `role`）；`[data-flip-card]` 为新的稳定锚点，语义不变（无 md → 无翻卡包装）。**若不换，该断言退化为「恒真空过」**（role 恒 null）——换成 data 锚点恢复真实覆盖 |
| 2 | `:77` | `div[role="button"]` → `[data-flip-card]` | 同上：取下卡元素引用；`role` 已不存在，锚点必须替换（否则构建即红） |
| 3 | `:80-85` | 卡级 `aria-pressed` → `data-flip-state`（`'back'`/`'front'`） | 卡级 `aria-pressed` 已随「去按钮语义」移除；`data-flip-state` **等价钉「按钮按了、卡真翻了」**。按钮级 `aria-pressed`（`:64/:80/:84/:125/:135`）**未动** |

其余断言（双击不翻 `:128-136` / 按钮命中区 stopPropagation `:116-126` / footprint 两钉 `:139-154` / floating 与编辑态不翻）逐字未动。`note-popover` / `note-zoom-lod` / `note-two-kinds` 等其它文件零改动。

### `chrome.test.tsx:34-46` 未动证据

`git show 9839b6f -- packages/react/tests/chrome.test.tsx`：`:34-46` 区块仅作为**上下文**出现（零 `-` 行）；该文件全部改动 = import 行（`+vi`）+ 新增 2 例：

```diff
-import { describe, expect, it } from 'vitest';
+import { describe, expect, it, vi } from 'vitest';
@@ -47,6 +47,32 @@
     expect(container.textContent).toContain('B');
   });
 
+  it('FlipCard：锚点 data-flip-card / data-flip-state 始终输出（交互缺省）', () => { … });
+  it('FlipCard：interactive=false → 去按钮语义 / 无 pointer / 点击不翻（受控 no-op 宿主）', () => { … });
+
   it('ThemeSwitcher：三主题一键切换（令牌随点击变化）', () => {
```

### 红 → 绿（原文）

```
 RED:  Test Files  2 failed (2) / Tests  3 failed | 16 passed (19)
   × 锚点 — Error: data-flip-card 缺失（chrome.test.tsx:53）
   × interactive=false — Error: data-flip-card 缺失（chrome.test.tsx:65）
   × 点击按钮 — expected null not to be null（note-panel-flip:78，[data-flip-card] 为 null）

 GREEN: ✓ tests/note-panel-flip.test.tsx (12 tests)
        ✓ tests/chrome.test.tsx (7 tests)
        ✓ tests/note-flip-host.test.tsx (6 tests)
        Test Files  3 passed (3) / Tests  25 passed (25)
```

## §T3 · 最小记录 + 收口（①）

- 设计稿实现注记（`docs/specs/2026-09-14-node-card-flip-markdown-design.md` §6 后 blockquote）：宿主勘误 + 孤儿状态 + 翻卡态宿主化 + 「派遣稿写宿主前先 grep 生产渲染点」纪律 ✓
- CHANGELOG `[1.8.18]` 新段（不并入 [1.8.17]、不跳号）✓
- 本报告 ✓

### 门禁原样输出（收口终态）

```
-- kernel --
 Test Files  61 passed (61)
      Tests  523 passed (523)
（KERNEL_EXIT=124：用例跑完、进程挂起（已知现象），以摘要块为准）

-- react --
 Test Files  131 passed (131)
      Tests  1266 passed (1266)
REACT_EXIT=0

-- canvas --
 Test Files  28 passed (28)
      Tests  197 passed (197)
CANVAS_EXIT=0

-- tsc x3 --
TSC_KERNEL=0
TSC_REACT=0
TSC_CANVAS=0
（react dist 已重建：BUILD_REACT=0）

-- depcruise --
✔ no dependency violations found (438 modules, 1249 dependencies cruised)
（P1 436/1241 → +2 模块 = 本批 2 个新测试文件；+8 deps）

-- lint --
Checked 437 files in 318ms. No fixes applied.
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
    apps/canvas/src/MindmapStage.tsx (2315)
    packages/react/src/render/edgeRouting.ts (1235)
    packages/react/src/render/MapView.tsx (2244)

✅ 全部指标在预算内（债务未增长）
```

### `git status --short` 原文（清理后、收口提交前）

```
 M CHANGELOG.md
 M docs/specs/2026-09-14-node-card-flip-markdown-design.md
?? _tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f
?? outputs/2026-09-14-node-card-p1-tail-fix-report.md
?? tmp-v7-s1.diff
?? tmp-v7-s2.diff
?? tools/graph-engine/
```

### 清理结果

- **执行（计划点名 5 文件）**：`tmp-push.ps1`、`tmp-push-1.out`、`tmp-push-1.err`、`tmp-push.log`、`tmp-r6-s3-commit-msg.txt` —— 已清。
- **执行（本批自产日志 29 个）**：`tmp-base-*`(3) / `tmp-t1-*`(13) / `tmp-t2-*`(6) / `tmp-t3-*`(7) 分 7 批（单条 `rm`、≤5 个/批；另 1 批为计划点名 5 文件）。第 3 批遇沙箱限流（3/5 部分生效）→ 补齐后全清（`ls` 核对零残留）。
- **保留**：`tmp-v7-s1.diff`、`tmp-v7-s2.diff`、`_tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f`（来源未识别）；`tools/graph-engine/`（禁区）——逐项未动。历史批次 `tmp-c-*` / `tmp-f-*` / `tmp-fx-*` / `tmp-l-*` / `tmp-r*` / `tmp-v7-*`(非本批) / `tmp-v8-*` 等非本批产物未动。

## §范围外发现（未动手，待裁定）

### ① 启动页直开文档：文档名切换、画布树不切换（疑似 ADR-0007 拆分引入的潜在回归）

- **现象（e2e 现场 dump 原文）**：从启动页「继续上次」打开 `e2e-flip.mm.md` 后：
  ```
  节点「甲」缺失；doc=e2e-flip.mm.md；节点=["…:Agent Gateway","…:文档（Forgejo 真实）","…:任务（真实 Issue）", …（全为 gateway 树）]
  ```
  即顶部文档名已是新文档、画布仍渲染**前一棵树**。
- **机制（逐段核过）**：`useDocumentSwitch`（`apps/canvas/src/hooks/useDocumentSwitch.ts`）的 effect 带**「首挂跳过」**（首挂只登记实体、不执行 `reset`）；而 effect 位于 `StageContent`（ADR-0007 从 `StageInner` 拆出）——启动页显示期间 `StageContent` 未挂载，点「继续上次」时 `setDoc` 直通 + `StageContent` 恰在 doc 已变后**首次挂载** → 唯一一次 `reset` 被「首挂跳过」消费 → `controller` 停在初始 gateway 树。影响面：启动页「继续上次」「最近列表」「新建」三条出口同路径（仅「看内置示例」不受影响）。
- **修复方向（建议，未实施）**：`reset` 条件改「`controller.root` 与当前 `editable` 不同源时补 reset」，或启动页出口改走 `applyDoc`（需适配冷启动无 controller 的既有说明）。
- **本批处置**：**未动手**（不在本批文件面/授权内）；e2e 改走「看内置示例 + 最近菜单」路径绕开。建议另批立项（「新建」出口一并复检）。

### ② 自研 note YAML 不支持流式序列（夹具层）

`note: ["条目一"]` 被解析为**字符串** `'["条目一"]'`（`hasNote=false`、序列区空）——列表须用**块形态**（`note:` + `- 条目`）。`packages/kernel/src/protocol/note.ts` 头注释的 `[条目…]` 为概念示意、易误读。建议：注释澄清 +（可选）parser 对 `[` 起首的标量给诊断。本批仅记录（e2e 夹具已用块形态并在注释中注明）。

## 偏差与原因（汇总）

| # | 偏差 | 原因 | 处置 |
|---|---|---|---|
| 1 | 计划 §0 基线参考值为陈旧读数（516/1206/195、432/1224） | 参考值抄录自 P1 计划时代 | 实测对账（523/1258/196、436/1241）后按实际执行并报告 |
| 2 | 端到端入口路径与「计划未指定入口」不一致（看示例 + 最近菜单） | 启动页直开路径为范围外缺陷（见发现①） | 已报告；e2e 绿 |
| 3 | e2e 迭代 6 轮（首轮起 2 次失败） | 发现① + 发现②（夹具语法） | 均转为报告记录（不静默） |
| 4 | `interactive={false}` 并入既有行（非独立行） | NotePopover 600/600 零余量（budget 守线） | 报告列明 |
| 5 | 测试名/头注释仍称「双层 aria-pressed」（note-panel-flip `:9`/`:73`） | 白名单仅许**断言**改动 3 处；描述性文字不在授权内 | 未动；如需更新请指示 |

## 待复核 / 下一步（停，等指令）

1. 复核三项收口（T1/T2/T3）与白名单 3 处口径。
2. §范围外发现①（启动页直开文档树不切换）——是否立项修复（涉及 `useDocumentSwitch` / 启动页出口，非本批文件面）。
3. §范围外发现②（note 流式序列）——是否加解析诊断/注释澄清。
4. push 授权（本批 **未 push**；提交链 `1cb752c → 09d3007 → 9839b6f → 收口 docs`）。
