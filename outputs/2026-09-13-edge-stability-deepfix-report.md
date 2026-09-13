# 边会话稳定性深度修复报告（跨文档换代检查 / 鼓向顶点化 / 路由事实门控）

- **日期**：2026-09-13
- **起点 HEAD**：`2ab6ad2`（R5 收口）→ **收口**：见 CHANGELOG `[1.8.12]` 引用的三条 commit
- **触发**：R5 收口复核的独立探针复现两处缺陷（① 数据级：自由边跨文档整层不渲染；② 行为级：鼓向推断被跳线桥污染），修复中又收口同族第三处（③ 选中边路由事实未按 key 门控）。

| # | commit | 内容 | 改动面 |
|---|---|---|---|
| 1 | `77c5c3b` | fix(react): 自由边稳定化带来源换代检查 | `stableArray.ts` / `MapView.tsx` / 新 `freeedge-crossdoc.test.tsx` |
| 2 | `84fe718` | fix(react,canvas): Opp 鼓向改用路由折线顶点 | `edgeRouting.ts` / `EdgeEditor.tsx` / `src/index.ts` / `useEdgeActions.ts` / `EdgeDraftLayer.tsx` / +3 测试文件 |
| 3 | `43c20ae` | fix(canvas): 三项路由事实统一按 key 门控 | `useEdgeActions.ts` / `edge-bow-side.test.tsx` |

---

## 一、①②的机制与触发（都由探针复现，非"读代码推断"）

### ① 自由边跨文档整层不渲染（数据级）

机制链（三段闭合）：

```
FreeEdge.key = `e${index}`            ← freeEdges.ts:239（**位置键**）
  × stableByKeys 只比 key              ← stableArray.ts:17-25（O(n) 廉价，不做深比较）
  × MapView:992 memo 出口返回 prev     ← freeEdgesStableRef
= 换文档后「边数相同且非零」时逐项 key 相等 → 复用**旧文档的边对象**
  → sourceId/targetId 指向已丢弃的树 → 端点盒全落空（renderable=false）
  → 自由边整层不渲染（含标签 / 命中区 / 手柄）
```

探针原文（修复前）：

```
[探针①] 文档A 边数=1 → 切换文档B 后边数=0
AssertionError: expected +0 to be 1
```

用户感知 = "这份文档的关系边一条都看不见"。触发条件 = 切换前后边数相同且非零（都 1 条、都 2 条…）——**高频**。

### ② 鼓向推断的跳线桥污染（行为级，R5-1 遗留）

`inferBowSide(d)` 从路径字符串提顶点；折线桥把 rise/fall 抬离弦 `radius` →

```
[探针②] 折线桥 d = M 0 0 L 45 0 L 45 5 L 55 5 L 55 0 L 100 0
[探针②] 折线桥   inferBowSide = right     ← 跳线方向被读成鼓向
[探针②] 旧拱弧   inferBowSide = auto      ← R5-1 之前的语义
```

影响：**又直又带跳线**的边，Opp 首次点击按跳线抬升方向落 `left`，而非自动兜底的 `right`。R5-1 的 commit message 已注明该漂移，但未落测试（本批补）。

### ③ 三项路由事实未按 key 门控（同族，修复中收口）

`selEdgeCurrentD` / `selEdgeForcedSideFallback` 只存裸值：换到「本帧尚未收到路由」的边时，会**沿用上一条边的结论**——Opp 的回落解析（`currentD`）会据**上一条边的 d** 翻转。实测（阴性对照④）：

```
AssertionError: expected 'M 0 100 C 50 0, 150 0, 200 100' to be undefined
```

---

## 二、修法（与"为什么这样修"）

1. **换代检查**：稳定化 ref 由 `readonly FreeEdge[]` 改为 `{ source, arr }`，`source = rootNode`（正是 `collectFreeEdges` 的输入，`MapView:634-635`）。
   - 为什么用 `rootNode` 而不是新造 epoch：平移/缩放不换 `rootNode` → G-P1/G-P9 的「pan 零路由重算」保证不受影响（既有 `freeedge-pan-reroute.test.tsx` 的 mock 计数器仍通过）；打开/切换文档必然换代。
   - 同时把**调用方契约**写进 `stableArray.ts` 头部（key 相同 ≠ 成员内容相同；跨代次必须先换代）——防同类误用再犯。
2. **鼓向顶点化**：新 `inferBowSideFromPoints(points)`（约定与 `inferBowSide` 分支② 逐位一致）；`inferBowSide` 分支② 改为**委托**它（删重复实现）。判定依据：`applyLineJumps` **只改写 d、不改 points** → 跳线桥天然不进判向。
   - 管线：`useEdgeActions.handleEdgeRoutes`（`entry.route.points`）→ `EdgeDraftLayer` → `EdgeEditor.currentBowSide`（**首选**；缺省回落 `currentD` 字符串解析 → 旧调用方与既有测试行为不变）。
   - 导出：`inferBowSideFromPoints` 登记进 `src/index.ts`（包入口是**显式具名清单**，非 `export *`；canvas 侧消费 dist——首次跑测踩到 `is not a function`，重建 dist 后通过）。
3. **门控统一**：`d` / 鼓向 / `forcedSideFallback` 合并为单个 `selEdgeRoute`（含 key），出口 `selEdgeRouteHit` 统一门控 → 换边未收到新路由时三项一律回落默认；值比较（含 key）短路沿用 R3-4 防重渲纪律。

---

## 三、红→绿与阴性对照（四组，全部自跑）

| # | 破坏 | 变红结果（原文） |
|---|---|---|
| ① | 去掉换代检查（回到只比 key） | `freeedge-crossdoc`：`expected +0 to be 1`（另一例「边数不同」仍绿） |
| ② | EdgeEditor 忽略 `currentBowSide` | `edge-editor`：直线+跳线用例落 `left`（应为 `right`）；其余 31 例绿（含缺省回落兼容钉） |
| ③ | 宿主丢弃顶点（喂 `[]`） | `edge-bow-side`：弓形 `expected 'auto' to be 'left'`；直线用例仍绿 |
| ④ | 去掉 key 门控 | `edge-bow-side`：换边门控 `expected 'M 0 100 C 50 0, 150 0, 200 100' to be undefined`；其余 3 例绿 |

四组均恢复后复绿且 `git diff` 空。

**先红证据（新增测试）**：① 缺失（本批新增文件，红即失败）；② `expected "vi.fn()" to be called with [ { routingSide: 'right' } ]`；③ 三例全 `undefined`；④ 见上表（阴性对照同时充当先红）。

---

## 四、门禁与验收

- 三包：kernel **480** / react **1127**（+7）/ canvas **186**（+4）= **1793 全绿**。
- tsc ×3 = 0；react dist 重建 = 0；depcruise = 0（416 模块 / 1170 deps）；lint **1468 warnings + 46 infos**（持平，新代码零告警）；budget 持平（bang 89/90、asCast 31/31、bigFiles 3/4；超 600 行：edgeRouting 1221→1235 / MapView 2182→2193 / MindmapStage 2254 不变）。
- 提交经仓库 pre-commit 钩子（dependency-cruiser + biome lint）通过。

## 五、边界与未做

1. **`inferBowSide` 字符串 API 对含桥的 d 仍报侧**（保留为兼容/历史路径；已在 `edge-routing.test.ts` 作为「两法差异」钉住）。产品路径已全部走顶点，仅 d-only 调用方可见。
2. **未做**：`inferBowSide` 的字符串分支内部再做"桥识别"启发式 —— 判定依据是"顶点更可靠"，不引入新启发式（避免为兼容路径增加不可证伪的复杂度）。
3. **未做（另立）**：`nodeChoices` / `anchorById` 等其他按位置键缓存的下游（本批只收口自由边链路与选中边路由事实，未见同类跨代次复用）。
4. 真浏览器验证：本批两处缺陷均可由 jsdom 判别测试完全覆盖（① 是渲染层引用复用、②③ 是纯函数/状态门控），未写 verify 脚本——**不做无判别力的截图**（比照 R5-2 偏差 1 的教训）。
