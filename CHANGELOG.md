# mindcanvas Changelog

本文件记录已冻结的公开接口面（K0-K5 阶段演进）。自 **1.0.0** 起，`@mindcanvas/kernel` 与 `@mindcanvas/react` 的公开导出遵循 semver 管理（见 `docs/adr/ADR-0004-interface-freeze-v1.md`）。

> **版本号说明（2026-09-11 补记）**：`v1.4.0`–`v1.7.0` 的号位最初预定于代码注释
> （`packages/kernel/src/protocol/types.ts`）。其中「布局岛 / cid 持久身份 / `note.dir`」
> （09-05~09-06）与「图引擎适配 / 文件工作台」（09-10）等批次未单独标号，
> 按完成时间归入对应段落末尾的「同批」小节。

## [1.7.0] — 2026-09-11 · 四向分叉碰撞消解 + 出线枢纽 / 逐向层距 + 拖共享梁（kernel/react minor）

**触发**：四向生成子树（`note.dir`）后，节点盒会互相压叠、连线从别的节点身上穿过——
D2′ 的「邻侧防叠」只在同层相邻组之间做**一次** bbox 推开、不迭代，三向以上复杂分叉
或子树内部再分叉必然残留重叠（ADR-0009 已列为已知取舍）。

| 项 | 内容 | 说明 |
|---|---|---|
| **新增 `layout/separate.ts`** | `separateTree` / `findOverlaps` / `boxesIntersect` / `overlapXOf` / `overlapYOf` + `SEPARATE_MARGIN` / `SEPARATE_MAX_ROUNDS` | 布局无关的纯几何消解：自底向上把**相交的兄弟子树整棵刚性推开**，子树内部相对布局逐像素不变 |
| **分支布局接线** | `layoutMindmapBranched` 在分组落位后调用 `separateTree`，随后重新生成连线 | 连线端点/长度自动跟随新盒坐标，不再残留穿盒旧 path；`BranchLayoutOptions.separate` 可传 `false` 关闭（仅对照测试用） |
| **森林自动排列修正** | `layoutForest` 无 pos 的岛改为对齐**真实右边界**（原 `cursorX += w` 会漏算左生长岛的左翼） | 四向生长的岛不再相互压叠；有 pos 的岛仍按用户坐标落位 |
| **新增 `layout/linkClear.ts`（连线避障）** | `NodeIndex` / `findLinkCrossings` / `pickClearGeometry` / `polylineHitsBox` / `segmentHitsRect` | **不动节点，只换连线**：在同族几何里挑一条不压节点盒的（梁线换共享梁 y 与竖干 x、贝塞尔换弓向/弓高）。默认几何干净时逐值返回默认 → 多数文档零视觉变化 |
| **子树不得回压父的出边** | `clearParentEdges`：子树朝反方向长回去（右向节点的 left 孙节点等）时整棵沿生长方向外推 | 这是「连线穿过自己子树」的根源——空间被自己的子树占住，**换任何连线画法都躲不开**；外推后父线变长（连线距离自动更新） |
| **出边走廊判定（口径修正）** | 越界判定改为 `corridorSubtreeBox`：只统计真的落进「父 → 本节点」空隙走廊的盒；落进走廊的反向分支仍整棵外推 | 原「整棵子树包围盒」口径过宽——left 组绕过祖先盒生长时仍判越界，整棵子树被无谓外推（实测根 → 议题外推 148px，未声明兄弟跟着位移、B″ 局部性被破坏）。修正后同时保住「孙节点落在父右缘 ↔ 子左缘之间 → 整棵外推」的契约 |
| **落位期避让祖先链盒** | `layoutMindmapBranched` 的 `place` 维护祖先链盒栈并并入落位避让基准 `occ`：left/up 组主动避开祖父盒 | 零重叠由落位期达成，而非事后外推——否则「left 组落进祖父盒 → clearParentEdges 整棵外推」会连带未声明兄弟位移（B″ 局部性回归） |
| **连线几何同源** | `bezierControls` / `bezierPath` / `sampleBezier` / `orgBeamPoints(Up)` 成为渲染与避障的唯一几何来源 | 避障判定的折线与真正画出来的线是同一条，不会算出「假安全带」 |
| **B″：锚定子节点的生长轴以基线落位为准** | 未声明 `dir` 且父节点也未声明的子节点，其有效方向改由「基线把它放在父的哪一侧」反推 | 修复「两兄弟被排成链式、连线穿过兄弟」：此前经典左右平衡把第 2 个子节点分到另一侧，而生长轴仍记成继承方向，消解便沿 +x 把它推回走廊。布局本身零移动，经典左右平衡保留；要强制同侧展开仍显式标 `dir` |
| **上下组水平钳制（走廊约束 + 梁线段闸门）** | 四向组**全部落位后**统一钳制：`down/up` 组水平钳制进「左右组内侧窗口」、hub 左右组纵向钳制进「上下组内侧窗口」——互读对方**最终**位置。闸门收窄到**梁线段本身**（railY ∈ 侧组 y 带 且 侧组 x 压住「子中线 ∪ 父中线」跨度，±6px） | 修复两代钳制缺陷：① 在分支内钳会读到未平移的**基线盒**（基线全在父节点下方 → 窗口倒置 [298,0]，「居中尽力」把右组瞬移 +339px）；② 高程带取整组高度（宽出几十倍），右组在父旁、down 组挂其下 14px 也判相交，居中正下的 down 组被挤偏 -287px。梁线段闸门 + 落位后执行双修：down 回正、右组回中、零重叠零穿盒 |
| **走廊排斥退役** | `clearLinkCorridors` 移出布局管线（导出保留）；「梁线被挡」由钳制闸门（落位期）与换画法 `beamVariants` 抬梁/压梁（几何期）接管，实测该场景零穿越（2026-09-11：`layout-separate.test.ts` 走廊用例 1 → 0） | 它按「折线包围盒」判走廊——共享梁的包围盒罩住梁线与父之间的整片空区，同组兄弟贴边即误判（len 抬升后链 A/B 被逐个推高 6/12px、层距参差）；四轮「排斥↔消解」博弈还会把右组当代价品挪成楼梯。两者都是用户明确反对的破坏形态，故整体退役 |
| **`note.lens`：逐方向组缺省** | `Note.lens?: { up?/down?/left?/right?: number }`——父节点四个方向组各自的共享梁层距；优先级 子 `len` > 父 `lens[dir]` > 父 `len`（仅 up/down，向后兼容）> V_GAP/H_GAP；下限钳到 `SEPARATE_MARGIN` | 四向共用一个尺度必然顾此失彼，逐方向才是规范形态；也是后续「拖共享梁」交互的落盘形态（拖哪根写哪个方向）。新模块 `layout/beamSide.ts` 承载 len/lens/beamX 家族（branching.ts 回到 600 行预算内） |
| **`note.hub`：出线枢纽（左右共享竖梁 + 出线箭头）** | `Note.hub?: boolean`——标记节点的 left/right 组从贝塞尔切换为共享竖梁 bus 线型（父中线段 → 横段 → 竖梁 → 横段 → 子中线段）；内核 `beamXVariants`（换轴镜像 `beamVariants`，避障采样滑梁位）+ `clampBeamGroupVertical`（纵向闸门钳制，镜像横向窗口）；右键菜单「升级为出线枢纽 / 取消」；react `horizontalBeamMap` + `buildLinkPath` hub 分支渲染同形正交线；**出线箭头**（左入右出、上入下出）= `hubArrowTip` 实心三角 path——MapView / sceneBuilder / exportSvg 三处同形，无需 marker defs（path 原语补 `fill`，canvas 端补 fill 分支） | 与 up/down 共享梁对称，四向枢纽形态齐了；**选择性启用**——未标记节点一根线不变（无 dir 逐像素闸门与非 hub 布局均不回归） |
| **拖共享梁（直接操纵层距）** | 新模块 `render/beamDrag.ts`（纯逻辑可测）：把手构建（hub 连线按「父+方向」分组 → 梁段范围 + 起始层距 = |梁−父出边|×2）、命中测试（±8px 带）、拖拽映射（行程轴位移 → 新层距，钳 [14, 600]）；`useMapGestures` 接入第四种手势（节点命中之后、画布平移之前）；拖拽中只更新预览叠层（梁线随指针移动 + 「出线 Npx」徽标，**节点不动**），松手经 `onBeamLensChange` → `controller.updateNote` 写 `lens[dir]`（单条 undo），布局权威重排；**层距上限 `BEAM_MAX_LEN=600`**（内核读取侧同钳）——坏窗口期拖出的巨型值在读取时自动归位，旧文档无需手动清理 | 层距调节从「菜单选值」升级为「抓住梁拖」——所见即所拖；起點取自梁位置本身（rail 是层距中点），逐子节点 `len` 覆盖不受影响（提交写组缺省，落位重排即正确） |
| **梁线候选障碍采样** | `beamVariants` 额外采样「走廊内障碍物上缘之上 / 下缘之下」的梁位 | 空隙内没有干净一层时，抬梁/压梁绕开；是否干净由节点索引复检 |
| **方向指定方式澄清** | 预方向快捷键是 `Alt+方向键`（先按方向，再 Tab/Enter 生长时固化进新节点）；事后改向走右键「生长方向」 | 修正 `MindmapStage` 里残留的 `W W / S S / A A / D D` 过时注释（那是参考项目 PG 的键位，本项目实现是 Alt+方向键），并让帮助面板（`?`）文案更明确 |
| **打开/保存健壮性** | `LocalDocHost.open()` 不再吞掉非取消异常；`handleOpen` 捕获后走隐藏 `<input type=file>` 兜底 | 修复「在嵌入预览窗里点打开毫无反应」——FS Access 不可用/被权限拦截时异常被静默吞掉；在途收敛（09-11）补 3 例测试锁住三分支（成功 / 取消不弹 / 抛错兜底） |

**性质**：kernel 仅新增导出（ADR-0004「minor 可加不可改」），既有签名零变更。
验收：随机四向树 200 例消解后零重叠（对照组确有残留）、四向嵌套/三向共存零重叠、
森林左生长岛按 gap 精确错开、10K 级宽树耗时可控。
**在途收敛（2026-09-11）**：`pnpm gate` 全绿——typecheck 0 错误 / **1418 用例**
（kernel 451 + react 911 + canvas 56）/ depcruise 0 / budget 全项持平。
`beamDrag.ts` 的 `g.lo` 类型错误与 `geometry.ts` 的 `beamX` 收窄一并修复；
布局侧三处失败（局部性 / left·down 组 / 走廊穿越）全部收敛。

## [1.6.0] — 2026-09-11 · 出线长度 `note.len`（kernel minor 加法）

| 项 | 内容 | 说明 |
|---|---|---|
| **`note.len`：出线长度** | `Note.len?: number`——本节点与父节点连线的直线段长度（盒边到盒边），按有效方向解释（up/down 垂直、left/right 水平）；分支布局逐子节点消费，缺省/非法回落 `V_GAP`/`H_GAP`，下限钳到 `SEPARATE_MARGIN`。**up/down 组缺省归父**：父节点的 `len` 同时是其 up/down 组的缺省层距（子节点自己的 `len` 优先、孙层不受牵连） | 层次节奏的**软约束**：只调这条线的层距，不改居中/避让/消解——up/down 的转折弯（子树竖段 → 共享梁 → 父中线段）语义归父，**父上设一处、整组上下子树连同共享梁一起抬升/下移**；left/right 组不消费父级缺省（贝塞尔无共享梁，逐子节点自设）；仅分支布局消费（无 `note.dir` 的文档仍走经典布局，逐像素不变） |
| **右键菜单「出线长度」** | `GrowDirMenuActions` 追加可选 `lenOf`/`onSetLen`；菜单块在「生长方向」之后追加扁平项：预设 14/32/60/100 + 缺省（✓ 标当前值）+ 自定义…（prompt 输入，取消/非法静默放弃） | app 层经 `controller.updateNote` 写 `note.len`（undefined 删键 = 恢复缺省），undo 走 OpHistory；可选字段向后兼容——旧调用方不传即不出现该项 |

**性质**：加法字段（ADR-0004「minor 可加不可改」），既有签名零变更。

## [1.5.0] — 2026-09-10 · Section 空间分区 Phase 1（kernel/react minor）

**触发**：需要「带装饰的 Center Island」把一组相关节点框起来（调研见 `docs/2026-09-05-project-graph-调研与减法设计.md`；交付报告见 `outputs/2026-09-10-sections-phase1-delivery.md`）。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议 `root.note.sections`** | `SectionSpec`（id / title / color / root `cid:` / members·collapsed 预留）+ `sectionsOf` / `upsertSection` / `removeSection` / `makeSectionId` | 文档级对象列表；子树锚定，写入一律 `cid:`（读取兼容 `node:` 路径） |
| **锚三态** | `resolveSections`：well-formed / dangling / stale + `W-SECTION-DANGLING` | dangling **保留元数据** + 幽灵态（灰虚线 chip + 显式 ✕ 清理），绝不静默删除 |
| **渲染层** | `sectionFrames` 纯几何（成员盒 AABB 外扩）+ `SectionLayer` 背景框（标题栏 / 成员徽标 / 折叠钮） | 背景层永在连线与节点之下；Canvas 模式自动降级不渲染 |
| **交互闭环** | 三态菜单（取消 / 标记 / 设为 Section）+ 标题栏拖拽整岛（复用 center 管线）+ 折叠钮（会话态不落盘）+ 选中态退出三件套（Esc / 空白 / 再点同框） | 单条 undo；不变量：Phase 1 的 Section **必然是**升格 center（D1 裁决） |
| **同批（未单独标号，09-10）** | 图引擎只读适配器 `graphJsonToMindmap`（入度 0 → 多中心；跨分支边 → 文档级自由边）；canvas 文件树模型与文件工作台（工作区 / 虚拟库双模式）；`DirectoryWorkspaceHost` 目录授权与保存句柄；节点图标 / 染色 / 落点感知；债务清偿与定向测试补全 | 按完成时间归入本段 |

## [1.4.0] — 2026-09-04 · 注释双区域 + 布局岛 / cid 持久身份 / `note.dir`（kernel/react minor）

**触发**：幕布式注释需要「序列」与「纯文本」两个区域；随后完成三项结构性增量（布局岛、cid、方向分叉）。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议 `Note.note` / `Note.note_text`** | 序列区域（条目列表，浮窗内编号渲染）/ 纯文本区域（整段多行，段落渲染） | 取代旧 `qa` 的展开形态；读取兼容 `qa`（`noteOf` 回退） |
| **浮窗 `NotePopover`** | 同一浮窗两个区域；非受控 textarea（可点入编辑）；标题收口为「note 笔记」 | 附路径定位与「入口可发现性」修复 |
| **同批（未单独标号，09-05~09-06）** | 布局岛 A1–A6（升格 / 切断接回 / 边界补线导出）；cid 子树持久身份（`note.cid` + `next_cid` 单调计数器 + `cid:` 锚 + 迁移双轨）；`note.dir` 方向分叉接线（ADR-0009 第一步）；`IdbAssetHost`（IndexedDB 持久资产宿主）；C3 复制中心编号 + D3′ 生长方向菜单 | 按完成时间归入本段 |

## [1.3.1] — 2026-09-02 · 序列化分段保真（patch · 非破坏性）

**触发**：纯文本事实源的体验缺陷——手写 `.mm.md` 经应用保存后**所有空行被抹掉**，
整篇挤成一坨，首次导入产生全量 diff，削弱「可读 / 可 diff / 外部编辑器友好」的价值。

| 项 | 修复 | 说明 |
|---|---|---|
| **序列化保留分支分段** | `emitNode` 在非首个 heading 前输出一个空行 | 实测 `gateway.mm.md`：空行 62 → 12（分段保留，非原样逐行保留）；往返仍无损且幂等 |
| **空行位置在笔记块之前** | 笔记块归属其**后**的节点（解析规则）；若插在笔记之后会拆开「笔记 ↔ 所属节点」 | 约束已写入代码注释 |

**性质**：纯格式改进，**数据语义完全等价**（`parse → serialize → parse` 结构无损、幂等）。
影响面：canonical 输出文本变化 → 依赖精确字符串比对的测试需同步。
已更新 `serializer-roundtrip.test.ts` 的 canonical 用例并补幂等守卫。

## [1.3.0] — 2026-09-01 · 幕布风格描述（note.desc）· **补记**

> 事后补录：功能已于 2026-09-01 全链路实现并在代码中标注 v1.3.0，但当时未写入 CHANGELOG。

**触发**：对齐幕布（mubu.com）的「描述」语义——对某一主题的解释说明，常驻节点下方。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议层 `Note.desc`** | 新增可选字段 `desc?: string` | 纯文本，多行以 `\n` 分隔；空串视为无描述（写回时删除）。与 `qa`（快速注释，按需展开）是两套并存机制 |
| **parser / serializer** | 多行描述以 `\n` 转义往返 | serializer 侧多行标量强制双引号 + `\n` 转义，parser 侧还原为真实换行 |
| **渲染 `DescBlock`** | 节点下方引用块，默认收缩一行、点击展开全文 | 仅视口内有 `desc` 的节点参与渲染 |
| **布局参与** | 有描述的节点加高；展开全文的节点额外加高 | `demo/pipeline.ts` 计入布局 → 推开其它节点 |
| **编辑入口** | Shift+Enter 切换「主题 → 描述」编辑；右键菜单「编辑描述」 | 幕布「切换主题与描述」语义 |

**性能**：编辑性能深度优化——`measure` 只依赖 `desc` 内容、不依赖 editing 状态，
且 `descEditingId` 不入缓存语义键，进入/退出描述编辑不触发全树重排（10K 图亦不卡）。

**冻结合规**：`Note.desc` 为**可选新增字段**（ADR-0004「minor 可加不可改」），既有字段与签名零变更。

## [1.2.0] — 2026-08-31 · 边一等公民交互与编辑闭环（E2-E7/E6.1 · react 侧 minor 加法）

**触发**：E 批执行 + 蒋指导交互反馈五轮 + markvault-js 采纳批。kernel 仅 1.1.0 的协议增量的延续（本轮 kernel 0 改动）。

| 项 | 内容 | 说明 |
|---|---|---|
| **MapView 加法 props** | `selectedEdgeKey / onEdgeClick / onTreeEdgeEdit / onEdgeConnect / onNodeClick(mods)` | 自由边叠加层（collectFreeEdges/FreeEdgeLayer）、连接手柄拖拽、树边右键编辑 |
| **文档级边标注** | root note.edges 透传键（DocEdge：from/to 锚 + rel/dir/label/note/style/invalidAt/source） | 边=画布级标注对象非节点属性；锚存路径跨会话稳定；updateNote 写入 undo 继承 |
| **树自然线关系标注** | 子节点 note.edge 对象（TreeEdgeAnn）+ note.via 字符串兼容 | 仅右键触发；chip 显示 label→rel→via 兜底；协议层对象标量（1.1.0 延续） |
| **RelationSchema** | 关系类型注册表（14 主动×5 分组+12 被动反向+构造三查+reverseOf） | relVisualOf 接 schema 语义色 |
| **软失效/来源** | DocEdge.invalidAt（失效/恢复二段）+ source（manual/inferred/imported） | B 线 AI 提议边识别前置 |

**性能**：树边 cubicMid 正则热路径消除、自由边视口裁剪、低 LOD 交互层门控、mapview 测试轮询化。

## [1.1.0] — 2026-08-31 · 边一等公民 schema（E1 · minor 加法扩展）

**触发**：E 批「边一等公民」规划（`docs/roadmap/2026-08-31-edge-first-relations.md`）——关系在连线上：连线需要属性/笔记/方向，支持树形之外的自主连线。

| 项 | 内容 | 说明 |
|---|---|---|
| **ResolvedLink 加法字段** | `dir?: LinkDir` / `label?` / `note?` / `attrs?` / `warnings?` | 全部可选，既有签名零变更；`dir: fwd(默认)/back/both` 仅是渲染端箭头语义（links 永远声明在源节点，无镜像写入） |
| **resolveLinks 透传** | 新字段逐条透传；非法 dir 回落 `fwd` + `warnings: ['invalid-dir-defaulted-fwd']`（W 级，不影响锚定三态） | |
| **协议层扁平对象列表** | parser/serializer 支持 note 块 YAML 的对象列表项（`- rel: blocks` + 缩进续行字段）——修复 spec §5.5 `links` 在文本协议无法表达的缺口（此前对象列表直接 E-INVALID-NOTE-YAML 丢弃整块笔记） | 对象项判别保守：未引号 + `key: value` 形态 + 存在续行字段，三者同时满足；qa/decisions 等冒号字符串列表行为不变。`attrs` 支持内联 JSON；嵌套对象/数组序列化为内联 JSON 字符串 |
| **yamlScalar 收紧** | 形如 `key:value` 的标量写端强制加引号 | 防字符串项与对象项在重新解析时歧义 |

**冻结合规**：仅增可选字段与新类型 `LinkDir`（ADR-0004「minor 可加不可改」）；既有 golden（T01-T30）与透传铁律测试全绿。

## [1.0.1] — 2026-08-29 · 资产节点渲染修复（patch · 非破坏性）

**触发**：资产节点（`@img` / `@draw`）显示异常（审查记录见 `docs/review/2026-08-29-asset-render-review.md`）。

| 项 | 修复 | 说明 |
|---|---|---|
| **P0 布局未给资产预留空间** | 内核 `displayMetrics` 对 `img`/`draw` kind 追加可选 `assetH`（96px），高度公式纳入资产区；`NodeG` 改为卡片式布局——图片占顶部独立区、文本区下移 | 修复前图片被压进约 26px 高的条带并与文字重叠（布局层与渲染层对节点高度认知不一致） |
| **P0 glass 连线对比度不足** | `linkStroke` `#3a3f4d` → `#646b7d` | 旧值对底色 `#16181d` 仅 2.3:1，低于 WCAG 非文本 3:1 |
| **P1 展开态注释区几何** | 注释区由全圆角 `rect` 改为 `path`（上半直角连体、下半圆角），去掉冗余分隔线 | 修复前连体处有圆角缺口，且顶边 stroke 与分隔线三线叠加成粗横线 |
| **P2 资产加载失败** | `<image>` 加 `onError` 降级 | 加载失败时隐藏图片区，纯文本呈现 |

**冻结合规**：`DisplayMetrics` 新增 `assetH?: number` 为**可选字段**（ADR-0004「minor 可加不可改」）；高度变化仅作用于 `img`/`draw` kind 节点，既有节点行为不变（有回归测试锁定 `issue.assetH === 0`）。属 bug fix 而非破坏性变更，故按 patch 发布。

## [1.0.0] — 2026-08-28 · 接口冻结（K5）

**里程碑**：三面镜子（Forgejo 联动 / MindFlow 标注 / PomodoroXI 任务项）压力测试六注册表与实体三件套全部通过；K5 期间按缺口修订的接口（resolveAll、note-anchor）已合入并记录于 ADR-0004 附录；自此公开签名变更视为 major。

### 冻结的公开接口面

**@mindcanvas/kernel（headless，零 DOM）**

- 协议层：`parseMm` / `serializeMm` / `astToEditable` / `editableToAst` / `validateId` / `stripOrgPrefix` / `refKey` / `unresolvedEntity` / `isUnresolved` / `REGISTERED_KINDS` / `KIND_META` / `KIND_FALLBACK_COLOR`；类型 `EntityRef` / `Entity` / `Note` / `MindNode` / `UnresolvedReason` / `Diagnostic` / `ParseResult`
- Entity 三件套：`EntityRef` / `Entity` / `Resolver`（`resolve`）+ 批量原语 `resolveAll`（K5 新增，部分失败语义）
- 六注册表：`KindRegistry` / `NoteKeyRegistry` / `RendererRegistry` / `LayoutRegistry` / `SemanticsRegistry` / `ChannelRegistry` + `Registry` 底座（`register/get/has/list` + `UnregisterHandle`）+ `createKernelRegistries` + `registerBuiltinKinds`
- links/groups 锚定契约（K5 新增）：`parseLinkAnchor` / `resolveLinkAnchor` / `resolveLinks` / `resolveGroups` + 类型 `AnchorResolutionState` / `LinkAnchor` / `ResolvedLink` / `ResolvedGroup`
- 插件基类与生命周期：`Plugin` / `PluginHost`（自注销）
- 编辑树与 TreeOp：`applyOp` / `invertOp` / `OpHistory` / `TreeOp` 判别联合（add-child / remove-node / move-node / update-node）+ `pathOf` / `nodeByPath` / `searchNodes` 等 treeOps 助手
- 布局引擎：`layoutMindmap` 等布局算法 + `MeasureFn` / `CharMeasure` 抽象 + 视口裁剪 `isBoxInView` / `filterVisibleLinks`

**@mindcanvas/react（渲染器）**

- 主题令牌系统：`ThemeProvider` / `useTheme` / `TokenSet`（classic / sticker / glass 三主题）
- 渲染核心：`MapView`（公开 props：layout/entities/char/apiRef/onStats/onNodeClick/onNodeContext/selectedId/editingId/collapsedIds/expandedId 等 + api：fit/zoomBy/resetZoom/focusNode）
- chrome 组件：`GlassCard` / `FlipCard` / `ThemeSwitcher` / `QaEditor` / `GrowthCommentPanel` / `ShortcutHelpPanel` / `ContextMenu` / `SearchPanel` / `OutlinePanel` / `formatNote`
- 编辑控制器：`EditorController` / `useEditor` / `matchEditorKey` / `EDITOR_KEY_BINDINGS`
- demo 数据管线：`buildEditable` / `buildEntities` / `layoutDemo` / `createCharMeasure`
- 搜索：`searchMind`（标题/笔记字段富文本匹配）

**apps/canvas（应用组合入口）**：v1.0.0 对齐；组合 = kernel + react 渲染器 + 内置 demo 插件。

### 测试基线（冻结门槛）

- kernel：266 测试（协议 225 基线 + 三面镜子 harness 25 + resolveAll 5 + note-anchor 11）
- react：126 测试
- kernel 依赖图零 react / 零 DOM（`pnpm why react --filter @mindcanvas/kernel` 无匹配）

### K5 接口修订（冻结前最后窗口，记录于 ADR-0004 附录）

- 新增 `resolveAll`（批量解析，镜子一对账场景缺口）
- 新增 note-anchor 模块（links/groups 锚定三态判定，镜子一/二缺口）
