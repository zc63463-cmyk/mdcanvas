# R6 执行报告：边 attrs 链路透传 + 丢弃诊断口径补全（R6-S1 → R6-S3）

- **日期**：2026-09-14
- **起点 HEAD**：`69323e6`（F5 发布完成）→ 计划文档先行提交 `eb6a7b3`
- **计划**：`docs/dispatch/2026-09-14-r6-attrs-and-diagnostics-plan.md`
- **结论**：R6-S1 / R6-S2 / R6-S3 全部完成（**S1b 未降级**）。三包 **1931 全绿**（kernel 517 / react 1218 / canvas 196）；门禁全绿、lint 与 budget 持平；**零协议改动**（`.mm.md` parse/serialize/ADR 一行未碰；`cid:` 归后续 ADR）。**S3 提交被并行 P1 批次产物卡 hook（内容已就绪，见 §R6-S3「提交状态」）；不 push——等复核与 push 授权。**

---

## §R6-S1 · 诊断口径补全 + 畸形项可处置（commit `cb33079`）

**改动文件**（9）：

| 文件 | 变更 |
|---|---|
| `packages/react/src/render/edgeHealth.ts` | +52：`EdgeHealthBreakdown` 接口 + `healthBreakdown` 加法导出 |
| `packages/react/src/chrome/EdgeHealthBar.tsx` | +32/−：标题改消费互斥分类（`breakdownParts`，非零类目拼接） |
| `packages/react/src/chrome/EntityGraphPanel.tsx` | +80：`malformedRows` 畸形项组（行 + 删除 + 计数） |
| `packages/react/src/index.ts` | 导出登记（`healthBreakdown` / `EdgeHealthBreakdown`） |
| `packages/react/tests/edge-health.test.ts` | +84：healthBreakdown 3 例（含优先级/求和判据） |
| `packages/react/tests/entity-graph-panel.test.tsx` | +146：畸形项 4 例（含删除闭环） |
| `apps/canvas/tests/edge-health-bar.test.tsx` | +53/−：口径断言更新 + 求和判据 1 例 |
| `apps/canvas/src/SidePanels.tsx` | +3：接线 |
| `apps/canvas/src/MindmapStage.tsx` | +6：接线（memo 派生 + prop） |

（提交期发现 1 条新 lint 告警（canvas 测试 `m[1]!`）已即时修正，amend 入本提交：`0a2f8f3` → `cb33079`；每任务一条 commit 保持。）

**新增用例数**：react **+7**（edge-health +3 / entity-graph-panel +4）、canvas **+1**。

### 红证据（原文）

① 纯函数缺失（实现前）：

```
 FAIL  tests/edge-health.test.ts > healthBreakdown（R6-S1a：互斥主分类——总数 = 各项之和） > 组合夹具（8 类病例）：每项恰归一档；7 分类之和 === problems.length，+healthy === total
TypeError: healthBreakdown is not a function
 ❯ tests/edge-health.test.ts:191:15
      Tests  3 failed | 7 passed (10)
```

② 诊断条旧口径（三例——含「总数与分项不齐」的两个现场）：

```
Expected: "关系线诊断：1 条（悬空 1）"
Received: "⚠ 关系线诊断：1 条（悬空 1 / 陈旧 0 / 失效 0）· node:根/A → node:根/不存在：悬空"

Expected: "关系线诊断：5 条（悬空 3 / 陈旧 1 / 自关联 1）"
Received: "⚠ 关系线诊断：5 条（悬空 3 / 陈旧 1 / 失效 0）· node:根/A → node:根/坏1：悬空· node:根/A → node:根/坏2：悬空· node:根/A → @issue:8：陈旧… 其余 2 条略"

Expected: "关系线诊断：3 条（悬空 1 / 失效 1 / 原始项非法 1）"
Received: "⚠ 关系线诊断：3 条（悬空 1 / 陈旧 0 / 失效 1）· node:根/A → node:根/坏：悬空· 第 2 条：原始项非法· node:根/A → node:根/B：已失效"
      Tests  3 failed | 3 passed (6)
```

（② 第 2 例：旧括号 3+1+0=4 ≠ 总数 5——自关联那条在括号里没有席位；第 3 例：1+0+1=2 ≠ 3——畸形项数不出。这就是 ③ 要收的口径账。）

③ 面板畸形行缺失（4 例）：

```
AssertionError: expected '连线 1正常 1relates-tonode:根/A → node:根/B删' to contain '连线 2'
Error: element not found: [data-edge-delete="e1"]
Error: element not found: [data-edge-section]
AssertionError: expected null not to be null
      Tests  4 failed | 17 passed (21)
```

### 绿证据（原文）

```
edge-health:      Tests  10 passed (10)
edge-health-bar:  Tests   6 passed (6)     ← canvas（含新求和判据）
entity-graph-panel: Tests 21 passed (21)
S1 时点全量：react 1213/1213 / canvas 196/196
```

### 分类判据实测（`healthBreakdown`：互斥主分类，测试钉死）

- 组合夹具（8 类病例 / 9 项）：`expect(b).toEqual({ malformed: 2, invalid: 1, dangling: 1, stale: 1, selfAnchor: 1, duplicate: 1, unknownRel: 1, healthy: 1 })`；
- **验收判据**：`problemsSum(b) === h.problems.length`（= 8）且 `problemsSum(b) + b.healthy === h.total`（= 9）；
- 优先级夹具（多标记只归一档）：`invalid`（dangling+软失效）/ `stale`（歧义+未知关系）/ `selfAnchor`×2（同键自关联的重复标记被 selfAnchor 覆盖）——`problemsSum === problems.length` 同样钉死；
- 标题求和（canvas 组件级）：`nums.reduce((a,b)=>a+b,0) === health.problems.length`（含 malformed 的混合夹具），且零类目（陈旧/自关联/重复/未知关系）不出现在标题括号区。

### 标题文案终稿

```
⚠ 关系线诊断：N 条（悬空 X / 陈旧 Y / 失效 Z / 原始项非法 W / 自关联 V / 重复 U / 未知关系 T）
```

类目序：悬空 / 陈旧 / 失效 / 原始项非法 / 自关联 / 重复 / 未知关系；**仅非零类目出现**（全零类不出现，防一行过长）；类目判定/优先级在 `render/edgeHealth.ts`（不内联在 bar 里，R6-A2）。

### 口径变更对照表（旧断言 → 新断言 + 为什么不是放宽）

| # | 旧断言 | 新断言 | 为什么不是放宽 |
|---|---|---|---|
| 1 | `1 条（悬空 1 / 陈旧 0 / 失效 0）` | `1 条（悬空 1）` | 删掉的是恒零类目文本；「悬空 1」分项与总数 1 均未变，零类目不携带信息 |
| 2 | `5 条（悬空 3 / 陈旧 1 / 失效 0）`（3+1+0=4 ≠ 5） | `5 条（悬空 3 / 陈旧 1 / 自关联 1）`（3+1+1=5） | 旧括号盖不住总数（自关联那条数不出）——是**补齐**不是放宽 |
| 3 | 标题无全覆盖约束 | **新增钉：括号内数字之和 === problems.length** | 新约束覆盖全部病理（含 malformed/自关联/重复/未知关系），强于旧断言 |
| 4 | 明细最多 3 条 + 其余略 / 全健康不渲染 / 零类目不出现 | 未动 | 既有契约原样 |
| 5 | `edge-health.test.ts` 计数语义（byState/invalid/malformed/…） | 未动（逐字段原样） | 语义不动，仅新增 describe |

### S1b 完成说明（未降级）

- 面板为**纯加法**：新增可选 `malformedRows?: readonly number[]`；既有 `EdgeListItem` 行结构与 `data-*` 契约零改动；
- 宿主改动：`MindmapStage` +6 行（memo 派生 + 1 行 prop）/ `SidePanels` +3 行——**远低于「宿主改动 >15 行/处」降级阈值**；
- 判据（测试钉死）：删除后 `edgeHealthOf(root).malformed === 0`、`problems === []` → 诊断条不渲染（组件级闭环）；section 计数同步（`连线 = 可解析 + 畸形`）；仅有畸形项时连线区仍渲染、空态引导不误现；未注入 `onDeleteEdge` 时行在、删除入口不在（向后兼容）。

---

## §R6-S2 · attrs 链路透传 + 只读呈现 + 四颗保真钉（commit `a5ee1c2`）

**改动文件**（6）：

| 文件 | 变更 |
|---|---|
| `packages/react/src/render/freeEdges.ts` | +12：`DocEdge.attrs` / `FreeEdge.attrs` / 守卫透传（无 `as`） |
| `packages/react/src/chrome/EdgeEditor.tsx` | +30：只读属性区（2 行 + title） |
| `apps/canvas/src/EdgeDraftLayer.tsx` | +2：挑选链补 attrs（引用原样到浮窗） |
| `packages/react/tests/free-edges.test.tsx` | +21：钉 1 |
| `packages/react/tests/edge-editor.test.tsx` | +100：钉 2 + 钉 3 |
| `packages/kernel/tests/passthrough-ironlaw.test.ts` | +38：钉 4（edges 面协议往返） |

**新增用例数**：react **+5**、kernel **+1**、canvas +0（EdgeDraftLayer 接线经 tsc + 全量套件背书）。

### 四颗保真钉（原文）

**钉 1 · collectFreeEdges 引用相等透传（红 → 绿）**：

```
红: AssertionError: expected undefined to be { severity: 'high', w: 3 } // Object.is equality
绿: tests/free-edges.test.tsx 全绿（其含守卫分支：字符串 / 数组值 → attrs 为 undefined）
```

（判定：`withAttrs.attrs` 与夹具 `attrs` 对象 `toBe` 引用相等——不克隆、不重建；非对象/数组值不视为 attrs。）

**钉 2 · patchEdgeAt spread 保真（钉既有行为，初跑即绿）**：

```
✓ R6-S2：patchEdgeAt 后 attrs 原样在（spread 语义保真钉——防未来改成从 FreeEdge 重建 DocEdge）
```

（断言：`patched.label === 'x'`；`patched.attrs` 与 `original.attrs` 均 `toBe(attrs)`——引用相等 + 原数组不可变。**故意钉住写路径的 spread 语义**。）

**钉 3 · EdgeEditor 渲染有则呈现无则不渲染（红 → 绿）**：

```
红: Error: element not found: [data-edge-attrs]
    Error: element not found: [data-edge-attr-row]
绿: 3 例全绿（Tests 91 passed (91)，含既有全绿回归）
```

**呈现 DOM 断言**（原文摘录）：`[data-edge-attrs]` 出现且含 `属性 3 项` + `severity = high` + `w = 3`；`[data-edge-attr-row]` 恰 **2 行**（最多 2 行）；第 0 行 `title === 'severity = high'`（全量）；区内无 `input` / `button`（**只读**）；无 attrs / 空对象 → 区不渲染（既有布局零变化）；长值（240 字符）行内 `nowrap` + `ellipsis`、DOM 文本与 title 全量（264px 紧凑卡不爆版）。

**钉 4 · 协议往返（kernel，补钉，初跑即绿）**：

```
✓ tests/passthrough-ironlaw.test.ts (4 tests) 8ms
  含新钉：edges 数组内嵌 attrs：parse → serialize → parse 原样保留、二次序列化字节稳定（R6-S2c-4）
```

（E1 已覆盖 note.links 面（`link-edge-schema.test.ts`）；本钉补 **edges 面**一例：`attrs: {"severity": "high", "w": 3}` 内联 JSON → 结构逐值相等 + 二次序列化**字节幂等**。位置：透传铁律文件（未知值永不丢失的底座原则）。）

### 写路径保真证据

- `patchEdgeAt` = `arr.map((e, i) => (i === index ? { ...e, ...patch } : e))`（`edgeEditorShared.tsx:70-73`）——spread 保未知键；
- 同族同语义：`mergeStyleAt` / `removeEdgeAt` / `duplicateEdge`（`{...item}`）；
- 故本项**不是「修 attrs 丢失」**（写路径从未丢过）——动机是「协议层能存能往返、react 层零命中（存了看不见）」的透传与呈现；方向写错会做出无用的「防御」。钉 2 把该语义锁死，防未来有人改成「从 FreeEdge 重建 DocEdge」。

---

## §R6-S3 · 收口

- **CHANGELOG**：`[1.8.16]` 段追加于 `[1.8.15]` **之上**（最新在上）。
- **报告**：本文件。

### 三包（全量复跑，原样输出）

```
kernel: Test Files  60 passed (60)  | Tests  517 passed (517)
react:  Test Files 128 passed (128) | Tests 1218 passed (1218)
canvas: Test Files  27 passed (27)  | Tests  196 passed (196)
合计 1931（512 基线 1917 + 14 新增；react = +12、kernel = +1、canvas = +1）
```

### 门禁（复跑，原样输出）

| 项 | 实测 | 判定 |
|---|---|---|
| tsc -b ×3 | kernel / react / canvas 全部静默通过（显式 "OK"；error 0） | ✓ |
| react dist | 重建成功（dist 未入库，仅本地验证路径用） | ✓ |
| depcruise（干净口径） | `✔ no dependency violations found (432 modules, 1228 dependencies cruised)` | ✓（+4 deps 见偏差 2） |
| depcruise（含并行产物口径） | `437 modules, 1229 dependencies` 零违规 | 说明见偏差 3 |
| lint（按路径分桶） | **本批口径 `0 errors / 1468 warnings / 46 infos`**；并行物 `41 errors / 1167 warnings / 29 infos` | ✓ 持平 |
| budget | 见下方原样输出 | ✓ |

### budget（原样输出）

```
  指标            实测   预算   状态
  ────────────────────────────────────────────────
  any                0      0   持平
  tsIgnore           0      0   持平
  bang              89     90   ↓1 优于
  asCast            31     31   持平
  console            4      4   持平
  todo               1      1   持平
  defaultExport      2      2   持平
  bigFiles           3      4   ↓1 优于

  超 600 行文件（3）：
    apps/canvas/src/MindmapStage.tsx (2299)
    packages/react/src/render/edgeRouting.ts (1235)
    packages/react/src/render/MapView.tsx (2230)

✅ 全部指标在预算内（债务未增长）
```

（MindmapStage 2293 → **2299**（+6 接线级，计划允许）；其余超 600 行文件未动。）

### S3 提交状态（执行期如实记录：被并行批次产物卡 hook，未提交）

- S3（本 CHANGELOG 段 + 本报告）按计划应一条 docs commit 落地；执行期**并行批次（节点卡 P1）在飞**：其 N1 前置探针产物 `packages/react/tmp-n1-bundletest/`（含 112KB bundle 输出）与 `tmp-n1-probe.mjs` 落在 biome 扫描范围（贡献 41 errors）→ **pre-commit 必红**（实测 `pnpm lint` exit=1；14:07 复核仍 blocked）。
- 该批产物属 P1 工作证据（其设计稿注明「引擎可行性实测……记入 P1 报告」；其计划 §并行纪律 约定两批**文件面零互碰**）——**本批未触碰其任何文件**，也未绕过 hook（未用 `--no-verify`、未改 hooks/config）。
- **处置就绪**（产物清离扫描范围或复核处置后，一条命令完成 S3 提交）：

  ```
  git add CHANGELOG.md outputs/2026-09-14-r6-attrs-diagnostics-report.md
  git commit -F tmp-r6-s3-commit-msg.txt
  ```

  提交文案已备：`tmp-r6-s3-commit-msg.txt`（即使被清理，用下方附录重打即可）。

### `git status --short`（执行期原文；停止时点）

```text
 M CHANGELOG.md
?? _tmp_93540_b1100fb5b7f824e4e2dd0db8943f342f
?? outputs/2026-09-14-r6-attrs-diagnostics-report.md
?? packages/react/tmp-n1-bundletest/
?? tmp-n1-probe.mjs
?? tmp-r6-s3-commit-msg.txt
?? tools/graph-engine/
```

（`CHANGELOG.md` + 本报告 = R6-S3 待提交内容；`packages/react/tmp-n1-bundletest/`、`tmp-n1-probe.mjs`、`_tmp_93540_*` = 并行批次产物，未触碰；`tmp-r6-s3-commit-msg.txt` = S3 提交文案；`tools/graph-engine/` 常态保留。）

### 附录：S3 提交文案（备好；与 `tmp-r6-s3-commit-msg.txt` 同文）

```
docs: R6 小批收口（CHANGELOG [1.8.16] + 执行报告）

- CHANGELOG [1.8.16]：边 attrs 链路透传 + 丢弃诊断口径补全（R6 小批 / 零协议改动）——
  S1 `cb33079`（healthBreakdown 互斥分类；诊断条总数=各项之和；畸形项面板可处置）、
  S2 `a5ee1c2`（attrs 对象守卫引用透传；EdgeEditor 只读呈现；四颗保真钉）。
- 报告 outputs/2026-09-14-r6-attrs-diagnostics-report.md：逐任务红/绿原文 + 口径变更
  对照表（旧断言→新断言） + 四钉原文 + 三包/门禁/budget 原样输出 + 并行干扰分桶归因
  （本批口径 0 errors / 1468 warnings / 46 infos，与基线逐数持平）。
- 三包 1931 全绿（kernel 517 / react 1218 / canvas 196）；不 push（等复核授权）。
```

### 定向清理

- 已清（本批过程产物，全部）：`tmp-r6-*.log`（s1a / s1b / s2 / S3 三包复跑 / lint 分桶等）+ `tmp-r6-dep.json` + `tmp-r6-lint.json` + `tmp-r6-lint-check.log`；复核者遗留 `tmp-push.log`；
- 保留：`tmp-r6-s3-commit-msg.txt`（S3 提交文案，备好待用）；
- 未触碰：`tools/graph-engine/`（勿动勿提交）、并行批次产物（见偏差 3 与上方「提交状态」）。

---

## 偏差与原因

1. **lint 一次 +1 告警（已即时修正）**：S1 首版提交时 canvas 测试用了 `m[1]!`（`noNonNullAssertion`：1468 → 1469）；发现后改为显式 undefined 守卫并 amend 入 S1（`0a2f8f3` → `cb33079`）。最终 **1468 持平**（全仓逐数核对）。
2. **depcruise deps +4（1224 → 1228）**：`entity-graph-panel.test.tsx` 新增 4 条 src 相对导入（EdgeHealthBar / edgeHealth / freeEdges / EdgeEditor）——已用 depcruise JSON 输出逐条归因；模块数 432 不变、零违规。
3. **并行进程干扰（如实记录）**：收口期工作树出现并行批次（节点卡 P1 的 N1 探针）产物：`packages/react/tmp-n1-bundletest/`（含 112KB bundle 输出）、`tmp-n1-probe.mjs`、`_tmp_93540_*`（其间出现的 `packages/react/package.json` / `pnpm-lock.yaml` 瞬时改动已由并行侧自行还原）。这些**均未触碰、未提交**；但它们落进 `biome lint packages apps` 扫描范围 → 全量读数出现 `41 errors / 2635 warnings / 435 files` 的假象。按文件路径分桶后：**本批口径 = 0 errors / 1468 warnings / 46 infos（与基线逐数持平）**；depcruise 的干净读数（432/1228）在产物进入巡航范围前捕获，其后读数（437/1229）同样零违规。
4. **计划内不做（无偏差）**：`cid:` 边锚化未动（协议面变更，归「R6-大」，须先出 ADR）；attrs 不做编辑、不影响视觉（rel 语义/样式仍由 rel + style 决定）；`.mm.md` parser/serializer/ADR 一行未碰；未 push、未动 `.codebuddy/` / `.workbuddy/` / `tools/graph-engine/`。

**然后停——等复核与 push 授权。**
