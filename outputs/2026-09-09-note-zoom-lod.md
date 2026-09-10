# note 浮框在滚轮缩放下的显示与渲染改造（2026-09-09）

## 1. 问题（改造前实测口径）

| 现象 | 根因 |
| --- | --- |
| 画布缩小（k<0.7）后 note 浮框被压成细条、文字溢出/截断 | 外层容器尺寸取 `box.w * k`，内部字号却是固定屏幕像素（12px 级），外层先被压小、文字再被浏览器最小字号限制撑爆 |
| 悬停预览看不清 | 预览本是屏幕 UI（HUD），却被节点盒的缩放尺寸约束 |
| 滚轮时掉帧 | 每个 DOM 的字号/内边距在每帧被 JS 重算，未走合成器 |

## 2. 改动

### 2.1 `packages/react/src/chrome/NotePopover.tsx`
新增 `mode: 'floating' | 'embedded'`（缺省 floating）：

- **floating（屏幕空间 HUD）**
  - 宽度 = `floatingNoteWidth(nodeWidth, vw)`：**对齐节点长度**（节点屏幕宽 `box.w * k`），
    仅在节点窄到装不下内容时兜到 `FLOATING_NOTE_MIN_W=120`，且不超出视口（两侧各留 10）
  - 字号 = `noteFontSizeOf(nodeFontSize)`：`min(NOTE_FONT_MAX=11, 节点字号)` —— **不大于所属节点字体**；
    仅当节点字号本身已小到不可读（如 k=0.4 时的 4px）才兜到 `NOTE_FONT_MIN=9`
  - 节点字号口径：depth ≥ 2 用 `token.font.sizeLeaf`，否则 `token.font.size`（与 DescBlock 同分档）；
    floating 传屏幕值（×k），embedded 传世界值（卡片整体再被 scale(k) 缩放）
  - 水平越界钳回视口；下方空间不足时按 `estimateFloatingNoteHeight()` 判定并翻转到节点上方（`translate3d(0,-100%,0)`）
  - 整体高度上限 320（超出内部滚动，k=2.5 也不遮全屏）
- **embedded（世界空间卡片）**
  - 在 **k=1 基线**下排版，宽高用世界 px（宽 = 节点基线宽），由外层一次 `transform: translate3d(0,0,0) scale(k)` + `transform-origin: 0 0` 驱动
  - 最小基线保护：`EMBEDDED_NOTE_MIN_W=120` / `MIN_H=72`，极小尺寸不溃缩
  - 字号同样受 `min(11, 节点字号)` 封顶
  - 滚轮每帧只变一处 transform（走 GPU 合成），不再逐像素改嵌套字号 → 无 subpixel 抖动、无 12px 截断
- **编辑态升级**：`editing && k < 0.7`（`NOTE_EDIT_FLOAT_K`）自动改用 floating，输入框与 IME 选词框位置稳定；进入编辑时若焦点不在浮窗内则主动聚焦 textarea
- 输出 `data-note-mode` 便于测试与排查

### 2.2 `packages/react/src/render/fixedNotePanels.ts`
- 新增 `noteLodFor(k)` 与阈值常量：`NOTE_LOD_FULL_K=0.65` / `NOTE_LOD_BADGE_K=0.35`
- `FixedNotePanelData` 尺寸口径改为**世界基线**：`worldWidth` / `worldHeight` + `k`（原 `width/height` 为屏幕 px）。屏幕锚点 `x/y` 不变
- 新增 `depth`（供上层取节点字号封顶笔记字号）

### 2.2b `packages/react/src/chrome/QaEditor.tsx`
- 新增可选 `fontSize`（缺省 chrome 小字号，其它调用方行为不变）；note 浮窗传入受节点字号封顶的值，编辑态与展示态字号一致

### 2.3 `packages/react/src/render/MapView.tsx`
- 新增 `nodeFontOf(token, depth)`：depth ≥ 2 → `font.sizeLeaf`，否则 `font.size`
- 悬停预览传 `nodeWidth = box.w * k`、`nodeFontSize = nodeFont * k`
- 固定卡片传 `nodeFontSize = nodeFont`（世界口径）
三档调度（`noteLod`）：

| 档位 | k | 行为 |
| --- | --- | --- |
| full | ≥ 0.65 | 固定卡片完整渲染（embedded）+ 悬停浮窗预览 |
| badge | 0.35 ~ 0.65 | 固定卡片**不生成**，只留节点角标；悬停仍以屏幕浮窗（floating 260px）预览 |
| none | < 0.35 | note 相关 DOM（含角标、悬停预览）全部不生成 |

- 悬停预览恒为 floating，并传入 `anchorTop` / `viewportW` / `viewportH`
- 角标门控：`hasNote && noteLod !== 'none' && (noteLod === 'badge' || !lodSkipText(lod, depth))`
- **唯一例外**：正在编辑（`editingNoteIds`）的面板在任何档位都保留，并自动升级为屏幕浮窗 —— 否则用户缩一下画布就丢掉正在输入的内容

### 2.4 `packages/react/src/render/nodeAuxiliary.ts`
只加注释：附属区预留是**布局契约**，不随缩放档位变化（预留若随 k 变化会导致滚轮每帧全图重排 + 节点跳动）。

## 3. 验证

- `packages/react` 全量测试：**91 文件 / 882 用例通过**（exit 0）
- `tsc -b`（含 tests）：0 报错
- 新增 `tests/note-zoom-lod.test.tsx`（22 用例）：
  - 档位阈值与脏值退化
  - floating **宽度对齐节点**（160/320 → 同宽；过窄兜 120；超视口收窄）
  - floating **字号 ≤ 节点字号**（9/11/28 三档），节点过小时兜到可读底线 9
  - 越界钳制、翻转与不翻转
  - embedded 基线尺寸 + `scale(k)` + 最小尺寸保护
  - 编辑态 k<0.7 升级为 floating
  - MapView 集成：同一实例 full → badge → none 的 DOM 生成/剔除；编辑中面板保留
- 更新 `tests/note-auxiliary-layout.test.ts`（尺寸口径改为 world 基线，并断言 `world × k` 与旧屏幕像素口径等价）
- `biome lint` 对改动文件：0 error（仅既有 warning）

## 4. 约束与已知限制

- **未触碰序列化/反序列化**：改动全部在呈现与交互层，`.mm.md` roundtrip 契约不变
- 布局预留区不随档位收缩：badge/none 档位下节点仍保留 note 卡片的空间（留白换布局稳定）
- 未改动的既有债务（非本次引入）：`check-code-budget` 报 bang 91/90、asCast 37/31、bigFiles 6/4 —— 本次 diff 新增 0 处 `!` / `as`，MapView 在改动前已是 1592 行（>600）
- 视口尺寸未观测到时（首帧/容器隐藏）不做边界钳制，避免浮窗被钉在左上角
