# 环形快捷操作 Phase 3 设计（① 幽灵预览 / ② 二级环 / ③ 频率学习 / ④ 触屏长按）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-11 |
| 状态 | ① 已实现（2026-09-11，A1=内收，见 `docs/dispatch/2026-09-11-radial-ghost-preview-plan.md`）；②③④ 待选型（决策点见 §6） |
| 上游 | v1.8.0 Phase 1+2 已落地并推送（`7ca1ea7`）；预览页「幽灵预览 / 删除预览」已在 Phase 1 手感升级实现（画布版待搬） |
| 定位 | Phase 3 候选四件。按 writing-plans 纪律：**四项互相独立，各自出 dispatch 计划**——每项独立可交付、逐任务 TDD、独立提交可回滚 |

## 0. 总览与推荐顺序

| # | 项 | 用户价值 | 依赖 | 体量 | 建议 |
|---|---|---|---|---|---|
| ① | 幽灵预览（画布版） | 建/删前先看到结果（把预览页已验证的预告形态搬进画布） | MapView 新增 2 个只读 API | S–M | **先做**（价值最高、风险最低） |
| ② | 二级环 | 「更多操作…」环内展开，不再跳右键菜单 | radialActions 状态机扩展（纯逻辑） | M | 第二 |
| ③ | 动作频率学习 | 环适配个人习惯（守住 marking 肌肉记忆） | localStorage（有先例） | S–M | 第三（依赖 ② 的排序接口） |
| ④ | 触屏长按 | 平板/触屏本可用（当前只有键盘 Alt） | 手势层接线 + 状态机复用 | M | 第四（需触屏验收） |

原则：**不改 v1.8.0 已冻结的交互**——一级环四扇区映射、Alt 双通道、接线层守卫（模态/白名单/撤环时机）全部原样；四项各自独立立项。

---

## 1. ① 幽灵预览（画布版）

### 1.1 目标
环内高亮「新建子节点」→ 在生长方向显示**虚线幽灵节点**（即将创建的预告）；高亮「删除节点」→ 节点 + 整棵子树**红色虚线描边**（删除范围预告）。预览页已有同形实现，本次搬到主画布。

### 1.2 交互
- 幽灵位置 = 生长方向侧的兄弟位，与 `addChild` 命令**同源推断**（`preDirsRef` → `inferChildDir`），保证「看到的落点 = 提交后的落点」
- 尺寸：按「新节点」文本近似宽高（与测宽公式一致）× 当前缩放 `k`；内容「新节点」
- 删除描边：子树所有节点盒红色虚线（只描边、不遮内容）
- 全部 `pointer-events: none`，z-index 59（环 60 之下）；贴视口边缘时幽灵向内收

### 1.3 技术方案
- `MapViewApi` 新增（只读，与 `nodeCorner` 同构逆变换）：
  - `nodeBox(id): { x; y; w; h } | null`（客户端坐标；未命中 → null）
  - `subtreeBoxes(id): Array<{ id: string; x; y; w; h }>`（含自身；未命中 → 空数组）
- 纯函数（可单测）：`ghostBoxOf(nodeBox, dir, k, gap)` —— 四向偏移（right: `x+w+gap`；down: `y+h+gap`；left/up 对称）+ 视口内收
- 组装在 `MindmapStage`（**单一动作源纪律**：方向推断与 addChild 同一处）→ 以 props 传给 `RadialStageOverlay`：`ghost?: { box; label }`、`dangerBoxes?: Box[]`
- 渲染：`RadialStageOverlay` 内 fixed 定位 div；样式入 `RADIAL_SURFACE_CSS`（新增 `.ghost-node` / `.danger-box`）

### 1.4 测试
- 纯函数：`ghostBoxOf` 四向 / 贴边内收 / k 缩放
- 组合：视觉部分以纯函数测试 + 页面手工验收为准（hook 层不断言视觉）
- 回归：无高亮时**零渲染**（不产生任何幽灵/描边 DOM）

### 1.5 风险与取舍
- 新节点宽度不可知 → 近似估算（YAGNI：不做真实 measure 预排）
- 贴边时幽灵可能出屏 → **决策点 A1**

---

## 2. ② 二级环

### 2.1 目标
「更多操作…」不再跳右键菜单，改为**环内二级**（外圈浮现），把右键菜单高频项收进环。右键菜单保留（渐进披露兜底，不删）。

### 2.2 交互
- 一级环高亮「更多」并确认 → 外圈浮现**二级环**（同心、扇区与一级对齐）
- 二级内容（初版提案，全部一次性动作、**无三级**）：
  - 上 = 编辑描述（与 Shift+Enter 同动作）
  - 右 = 升级/取消出线枢纽（按 `note.hub` 动态显示）
  - 下 = 复制节点文本
  - 左 = 打开完整右键菜单（兜底）
- 提交：二级内 Enter / 点击 / 松 Alt 提交；**Esc 先降级**（二级 → 一级），再 Esc 关闭
- 明确不进环：生长方向（已有 Alt+方向键预方向通道）、出线长度（数值型不适合环）

### 2.3 技术方案
- `edit/radialActions.ts` 扩展（纯逻辑、零 DOM）：
  - `RadialState` 增 `level: 1 | 2`、`parentSlot: RadialSlotKey | null`
  - 子项来源：从 `contextMenuItemsFor` **派生 + 高频过滤**（单一动作源），映射为 `RadialItem[]`；子项 id 前缀 `sub:` 防撞
  - 事件不变；`hover / arrow / click / confirm` 在 level 2 下对**外圈几何**命中
  - `radialGeometryOf(state)` 保持返回主环；新增 `outerRingOf(state, cfg2)`（`outerR2 = outerR + band2`）
- 渲染：`chrome/radialSurface.tsx` 增 `SubRing`（复用 `visibleArcs` / `ringArcPath`，半径参数化）；一级环降透明度
- 预览页同步（沙盒先试二级手感，再上画布）
- 测试：纯逻辑（进二级 / 降级 / 外圈命中 / 子项提交 / 一级零影响）+ hook 层（hover 外圈 → commit 走 actions）

### 2.4 风险与取舍
- 复杂度与可发现性：二级仅在「更多」出现，默认零侵入
- 内外圈命中冲突：level 2 时内圈只作视觉锚——**决策点 B3**（推荐：内圈命中 = 降级返回，符合"退回"直觉）

---

## 3. ③ 动作频率学习

### 3.1 目标
让常用动作更快可达——**但绝不重排一级环扇区**（破坏 marking 肌肉记忆是反模式，Phase 1 设计已定论）。

### 3.2 方案（A/B 叠加；C 明确不做）
- **A（推荐）**：开环时**默认高亮 = 上次提交的动作**（零位移、零风险，连续同操作提速）
- **B**：二级环 / 「更多」子项按**个人频次排序**（依赖 ② 的接口）
- **C（拒绝）**：一级扇区按频率重排

### 3.3 技术方案
- 存储：`localStorage['mindcanvas.radial.freq.v1'] = { [itemId]: count, __last: itemId }`；损坏/不可用 → 空表（try/catch，参照 `fileManagerShared.ts` 星标先例）；上限 64 键防脏数据
- 写入：commit 成功时 `bump(itemId)`
- 纯函数（packages/react）：`bumpFreq(map, id)` / `orderByFreq(items, map)` / `initialHighlight(last)`
- 作用域：全局（非按文档）——**决策点 C1**；「重置学习数据」入口放帮助面板——**决策点 C2**
- 测试：纯函数 + hook 层（提交后写入 localStorage / 开环预高亮）

### 3.4 风险
- 预高亮 A 的误触：默认高亮 ≠ 默认提交（仍需松 Alt）——**决策点 C3**（推荐：不加保护窗，保持简单）

---

## 4. ④ 触屏长按

### 4.1 目标
平板/触屏本可用环形菜单（复用同一状态机与渲染）。

### 4.2 交互
- 长按节点 **300ms**（期间位移 > 8px 取消）→ 环浮现
- 锚点：节点右上角（同桌面）；手指遮挡时整环上移 24px——**决策点 D1**
- 拖动手指 → 悬停高亮（pointermove 驱动）；松手 → 提交高亮项 / 无高亮关闭
- 长按触发前移动 = 原节点拖拽逻辑；触发后移动 = 环内漫游（不再拖节点）
- 可选：触发时 `navigator.vibrate(10)` 反馈

### 4.3 技术方案
- **状态机零改动**：`useRadialStage` 新增触屏会话 API `beginPress / pressMove / endPress`，内部发 `alt-down / hover / alt-up` 等价事件
- 长按计时 + 位移判定在 hook 内（假定时器可测）；仅 `pointerType === 'touch' | 'pen'` 生效
- 手势接线：`packages/react/src/render/useMapGestures.ts` 增 `onNodeLongPressStart / Move / End` 回调（与 nodeDrag 判定链并列，命中节点才启动）；`MindmapStage` 转接到 radial hook
- 触屏会话内：吞 `contextmenu`、画布容器 `touch-action: none`、阻止文本选中
- 测试：hook 层（300ms 触发 / 移动取消 / 松手提交 / 短按不触发 / 鼠标不触发）+ useMapGestures 层（长按与拖拽互斥）

### 4.4 风险
- iOS 长按系统菜单/文本选中的对抗（preventDefault + touch-action）
- 验收方式——**决策点 D2**

---

## 5. 明确不做（YAGNI）

- 一级环扇区频率重排（③C）
- 二级环三级展开（生长方向"方向环"——预方向通道已覆盖）
- 幽灵预览的动画 / 拖拽插入预览
- 触屏双击、三指等新手势

## 6. 决策点汇总（拍板表）

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| A1 | 幽灵贴视口边缘 | 内收 / 省略 | 内收 |
| B1 | 二级 Esc 语义 | 先降级再关 / 直接全关 | 先降级再关 |
| B2 | 二级内容来源 | 静态表 / 从右键菜单派生 | 派生 + 高频过滤 |
| B3 | level2 时内圈命中 | 不参与 / = 降级返回 | = 降级返回 |
| C1 | 频次作用域 | 全局 / 按文档 | 全局 |
| C2 | 学习数据开关 | 提供开关 / 默认开 + 重置入口 | 默认开 + 重置 |
| C3 | 预高亮误触保护 | 不加 / 加延迟窗 | 不加 |
| D1 | 触屏锚点遮挡 | 不动 / 上移 24px | 上移 24px |
| D2 | 触屏验收方式 | DevTools 模拟 / 真机 | 先模拟、真机后补 |

## 7. 交付流程（writing-plans 纪律）

每项独立走三步：**本设计（已出）→ `docs/dispatch/2026-09-11-radial-<feature>-plan.md`（逐任务 TDD 计划）→ 执行（每任务一提交）**。

推荐节奏：
1. 拍板 §6 决策点（可全按推荐）
2. 选定首项（建议 ①）→ 我出对应 dispatch 计划 → 开工
3. ①②③④ 逐项独立合并；每项完成后跑全量门禁（等价 `pnpm gate`）
