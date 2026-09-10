# Layout Islands · A5+A6 验收报告

日期：2026-09-05 · 分支：layout-islands 主线（A0–A4 已合入） · 范围：A5（切断/接回）+ A6（验收与交付）

---

## 1. 交付摘要

### A5 切断树边 / 接回子树（G2 批准案）

| 项 | 内容 | 关键文件 |
|---|---|---|
| 数据层 | `DocCenter.detached` / `Center.detached` 标注字段（协议透传，容错 `"true"` 字符串往返） | `packages/react/src/render/centers.ts` |
| 投影 | detached 岛**强制不产生容器边**（islands 投影过滤），岛成员/诊断不受影响 | `packages/kernel/src/layout/islands.ts` |
| 命令层 | `planCutTreeEdge`（切断→文档根末尾直接分支 + detached 标记 + 坐标保留）、`planAttachIsland`（显式接回→清 detached、坐标进 `center_pos` 历史区）；全批预校验、`TreeOp[]` 事务提交、`planReferenceMigration` 引用迁移（centers/center_pos/edges/links/groups 五清单） | `packages/react/src/edit/cutAttach.ts` |
| 结构化拒绝 | `is-root` / `already-detached` / `not-detached` / `attach-to-self` / `attach-to-descendant`（成环）/ `depth-limit`（H1–H6 → 相对深度 ≤5）/ `reference-conflict` | 同上 |
| UI 接线 | 树边弹窗「✂ 切断并独立」（EdgeEditor）；detached 岛根右键「接为子树/接为所选节点的子树」（无选中目标时置灰禁用）；命令拒绝 → 4s 通知条 | `EdgeEditor.tsx` / `NodeContextMenu.tsx` / `contextMenuItems.ts` / `MindmapStage.tsx` |
| 菜单基建 | `ContextMenuItem.disabled`（置灰、不可点、无 hover 反馈） | `chrome/ContextMenu.tsx` |

### A6 验收与交付

| 项 | 内容 | 关键文件 |
|---|---|---|
| 导出补线（T23） | `exportSvg` / `exportPng` / `useExportActions` 接入 `boundaryLinks`——跨岛父子连接以与渲染侧同款虚线（`6 4` / opacity .55）随全图导出；端点盒缺失跳过、两端点包围盒裁剪（E8 同款语义） | `chrome/exportSvg.ts` / `chrome/exportPng.ts` / `apps/canvas/src/hooks/useExportActions.ts` |
| Canvas 门禁（T23） | `resolveBackend(forceBackend, nodeCount)`：显式 `'svg'` **压过** >50K 自动降级；含中心岛或自由边的文档由 `MindmapStage` 强制 SVG（宁慢不丢，不声称 Canvas 等价）；纯树文档保持既有降级策略 | `render/sceneBuilder.ts` / `render/MapView.tsx` / `MindmapStage.tsx` |
| 协议容错（T21/T24） | 读侧数值/布尔容错（`.mm.md` 往返后 `"250"`/`"true"` 字符串还原），kernel 冻结协议不动；坏锚 dangling 显式提示、不误绑 | `render/centers.ts` |
| 冒烟修复 | MapView 初始渲染 React key 警告两条根因：① `visibleNodes.map` 返回无 key Fragment → `<Fragment key>`；② 树边以 SVG d 字符串作 key（几何相同的边重复）→ 端点 id 键 | `render/MapView.tsx` |

---

## 2. T 矩阵核对（本批次必验收项）

| 编号 | 场景 | 结论 | 证据 |
|---|---|---|---|
| T13 | 切深层 A→B 与切一级边：子树保留、独立角色与 G2 一致、位置保留 | ✅ | `cut-attach.test.ts`（K3 子树保留/根末尾分支/detached 锚迁移/undo 完整恢复）；深度约束只看子树相对深度（对照：深链叶子可切） |
| T14 | 切 B 时 C 已独立：C 按 G1 保位，全部引用迁移一致 | ✅ | `planReferenceMigration` 五清单盘点测试（centers/center_pos/edges/links/groups）+ 引用迁移测试（文档级边重锚后仍解析回同一物理节点） |
| T19 | detached 普通降格/显式接回 | ✅ | 接回测试（结构恢复 + detached 清除 + 坐标进历史区）；非 detached 节点拒绝接回（`not-detached`） |
| T20 | 接回自身后代/深度超限：拒绝、树与 history 不变 | ✅ | `attach-to-self` / `attach-to-descendant` / `depth-limit`（目标深度 4 + 子树 1 + 1 = 6 > 5）断言；失败零副作用由事务语义保证 |
| T21 | 保存重开：新 id 下角色/坐标/连接状态一致 | ✅ | T21 往返测试：cut → `serializeMm` → `parseMm` → 新 id 树上 detached 中心 well-formed、坐标 `{250,80}` 还原、接回语义成立 |
| T22 | 自由边与树边菜单：删除自由边不拆树，切树边不删内容 | ✅ | `edge-editor.test.tsx` 删除后节点/结构原样断言（本批次补强）；`cut-attach.test.ts` 切断子树保留 |
| T23 | SVG/PNG 与 Canvas 门禁：不静默丢岛/边/内容，不导出未提交预览 | ✅ | `export-svg.test.ts`（补线 3 例：同款虚线/ghost 跳过/视口裁剪）；`scene-builder.test.ts` `resolveBackend` 4 例（显式 svg 压过自动降级）。导出输入为已提交 `LayoutResult`，无未提交预览态 |
| T24 | 文本外部编辑导致坏锚：可打开，提示，不自动重绑 | ✅ | `centers-pipeline.test.ts` T24 测试：坏锚 .mm.md 解析成功、`dangling` 显式、`nodeId=null` 不误绑、布局回退单树 |

既有项（前批次已验收，本批回归通过）：T01（无 centers 旧文件不变）、T12（缩放手势）、T15–T18（undo 原始态/事务零副作用/改名迁移/歧义锚阻断）。

## 3. 测试与门禁

- 本批新增/补强测试：`cut-attach.test.ts`（7 例，含 T21）、`export-svg.test.ts`（+3）、`scene-builder.test.ts`（+4，resolveBackend）、`mapview-render-clean.test.tsx`（+1，key 卫生回归）、`centers-pipeline.test.ts`（+1，T24）、`edge-editor.test.tsx`（补 T22 断言）
- 全量门禁 `pnpm gate`：**typecheck ✅ / test ✅（kernel 45 + react 77 个测试文件，646+ 用例）/ depcruise ✅ / lint ✅ / budget ✅**
- 债务预算回到持平：bang 90/90、asCast 31/31——本分支引入的 cutAttach/centers 债务已全部用运行期守卫消化（`isRec` 窄化、Note 索引签名直读），并顺手消除 controller 存量 1 处 `as Note`

## 4. 性能采样（`scripts/bench-islands-a6.mjs`，同机同文档 15 次取中位）

文档：1097 节点（3 叉深度 6），4 中心（3 升格 + 1 detached），1 条 parent_link:show 边界边。

| 指标 | baseline（单树） | candidate（岛布局） |
|---|---|---|
| 布局 layoutMs | 1.4 | 1.6（**+9%**） |
| 投影+路由 projectionMs | – | 0.34 |
| 边界边 path 构建 | – | ≈0（×1 条） |
| 切断事务 commitCutMs | – | 0.33 |
| 绘制 cull / links | 0.02 / 0.35 | 同量级 |

结论：森林路径无缓存（已知取舍）下布局开销 +9%，投影/事务/补线均为亚毫秒级，无门禁风险。

## 5. 真实浏览器冒烟（Chromium + Vite dev）

- 切断全链路 PASS：树边弹窗「✂ 切断并独立」→ 连线 24→23、节点 25/25 不变（内容保留）、detached 岛独立摆放、undo 可用
- 接回入口 PASS：detached 岛根右键「接为子树」无选中目标时正确置灰（`data-menu-disabled`）
- 截图：`verify-shots/a5-01~04*.png`
- 冒烟发现并已修复：MapView React key 警告（见 §1），并落回归测试 `mapview-render-clean.test.tsx` 复验零告警

## 6. 已知边界与后续项

- Canvas 后端不渲染边界补线/自由边（场景树只有树线+节点卡）——已按门禁强制此类文档走 SVG，并在代码注释中说明限制
- 导出仍不含自由边/树边 chip 标签（FreeEdgeLayer 为渲染层私有，属导出完整性既有课题，非本批引入）
- 性能采样为 Node 端纯计算口径；浏览器端 frame 采样待统一 perf 工具化
- kernel `parseMm` 裸标量保字符串为 v1.0.0 冻结协议行为，读侧容错已覆盖 centers/center_pos；其余未知键维持透传
