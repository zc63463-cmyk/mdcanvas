# 布局岛实施计划与验收矩阵

状态：供外派评审，非已实现。依赖同目录2026-09-05-layout-islands-design.md。主目录 E:/Development/MyAwesomeApp/mindcanvas。

## 0. 开工门禁

1. 用户确认设计G1/G2/G3。未批准时只做基线、接口评审、现状探针，不把推荐当需求实施。
2. 开Issue后开发分支/worktree；本次没有代开Issue、代提交。遵循需求先开Issue，禁止直接向main推送、禁止绕过hooks。
3. 记录HEAD、git status、已有diff及文件哈希。2026-09-05本轮HEAD为6f3af86639102175e96c520dd145cc7594e32591，但工作区在并行改变。不得回滚现有pipeline/菜单/测试改动。
4. 核实当前命令与测试环境，跑现有基线，单独列出既有失败。旧48通过不替代本次基线。
5. 指定一位集成人拥有apps/canvas/src/MindmapStage.tsx、packages/react/src/index.ts、packages/kernel/src/index.ts、demo/pipeline.ts与包配置；其他人不得同时改这些文件。

## 1. 工作包与依赖

| 包 | 目标/交付 | 主文件边界 | 依赖 | 粗估人日 |
|---|---|---|---|---:|
| A0 | 基线、G1–G3批准、接口/坐标语义冻结、Issue拆分 | 设计/测试规格、只读源码核实 | 无 | 0.5–1 |
| A1 | 校验中心、递归布局岛、唯一owner、折叠边界 | kernel/layout下纯函数和测试；centers适配由集成人接 | A0 | 1.5–3 |
| A2 | 历史原子事务、锚索引迁移、字段删除逆操作 | kernel/tree/tree-op.ts、react/edit、引用测试 | A0 | 2–4 |
| A3 | 接入投影/documentRoot、保留位置与根区域、跨区边 | pipeline、MapView、forest、Stage；集成人负责 | A1；A2接口冻结 | 1–2 |
| A4 | 中心拖动实时子树预览、取消/提交、缩放规则 | useMapGestures与渲染预览；Stage接线走集成人 | A3+A2 | 1.5–3 |
| A5 | 切线/接回命令及树边选择入口 | 领域命令、树边命中层、菜单与Stage | A2+A3；G2/G3批准 | 1.5–3 |
| A6 | 保存重开、导出/后端门禁、端到端与性能验收 | 集成测试、导出路径、验收材料 | A4+A5 | 1–2 |

总量约9–18人日，不是日历承诺。单人按依赖推进；两人可并行A1/A2，后续A4/A5有MapView/Stage冲突不能直接无协调并写。若旧坐标不兼容或引用格式存在不可唯一表示的边界，先出变更单，不硬凑工期。

## 2. 每包可执行要求

### A0 基线与契约
- 复查已存在中心拖动链路：isCenter→onCenterMove→upsertCenter→updateNote，不重新造同功能。
- 记录一级中心限制是旧止损，新增深层功能必须配合递归投影替换。
- 用旧.mm.md样例建立坐标基准：无desc、带desc、带note展开三组。明确center位置是旧box中心还是新body中心，给版本/兼容策略。用户不应因升级看到中心跳位。
- 盘点所有文档级/节点级路径锚字段、树边/自由边入口及导出行为，逐项登记文件:行号。
- 冻结projectIslands/ownerByNodeId、transaction结果、preview结果、boundaryLink契约。接口变更必须通知消费者。

### A1 布局投影（可以先独立外派）
- 先写失败测试，验证深层与嵌套升格不会重复；不要把失败测试改成一级拒绝。
- DFS划分全树owner，折叠是后续可见性而非丢节点；投影不得直接删除源children。
- 校验重复中心、坏锚、非法方向/坐标；无有效中心回退旧单树行为。
- 默认文档根始终在内容模型；是否显示只作用几何。
- 四向布局与手工/自动混排bounds；局部节点本体锚稳定。
- 删除中心/降格后其独立后代仍保留有效区域，符合G1。

### A2 事务与引用
- 增强现有OpHistory而非新增竞争历史；保留apply(TreeOp)行为与导出兼容。
- 事务先暂存、后一次提交；检查拒绝操作返回原对象不能被误当成功。
- 初次note创建/删除、零位移、无效操作、redo分支、半批失败专项测试。
- 锚迁移按“前树解析到ID→后树生成路径→后树解析验证同ID”，不能全字符串替换。
- 明确未解析旧锚与本次新歧义不同：后者拒绝提交；前者保留并诊断。
- 编辑改名、结构移动、切线/接回共用事务；键盘层级调整也不能绕过。

### A3 集成边界
- MapView由props取得完整documentRoot，freeEdges/resolve不读裁剪投影。
- centerIds来自同一份校验结果，不允许布局忽略某中心但手势仍把它当中心。
- boundaryLinks与普通树线/自由边区分，参与选择/导出但不进入布局。
- 保存source仅从内容模型生成；禁止序列化投影树。
- 新升格先采当前坐标，防首帧跳位；已有坐标不因dir patch被删除。

### A4 手势
- 拖动预览移动owner成员、本地线和附属区，不移动其他岛；不能通过每帧updateNote实现。
- pointercancel/Esc/blur/document切换/revision变更恢复，dirty和history不变。
- 多指、缩放、pointer capture、鼠标移出画布、释放后click防误触。
- 0.5/1/2倍缩放验证落点：位移一致换算，无松手跳变。
- 浏览器真实输入测试，禁止只断言回调次数就声称整棵子树拖动完成。

### A5 切线与接回
- 先实现领域命令测试，再做UI，不用UI状态充当断线持久化。
- 支持一级和深层线、已有中心边、节点同名/斜杠冲突、根不可切、真实边验证。
- 选中父子线可“切断并独立”；free edge菜单保持既有删除；误点击不删除内容。
- 重新连接通过显式命令选择目标，拒绝成环和深度超限；不因移动到节点上隐式降格。
- redo重放历史落点，不重新采样视口或节点位置。

### A6 验收与交付
- 测试UI形成的文档而不是仅手工fixture；保存→重新parse重建id→再次操作。
- 运行完整类型检查、测试、depcruise、lint、budget；新增导出遵守ADR-0004，不删外部API。
- 真实浏览器录制：深层升格、生长、移动、切线、取消、undo/redo、重开、SVG/PNG导出。
- 性能数据分布局/路由/提交/绘制；同机器同文档baseline与候选各重复采样。
- 若仅SVG支持本功能，显式禁用该文档的自动Canvas降级并说明限制；不声称Canvas等价。

## 3. 必须验收的测试矩阵

| 编号 | 场景 | 必须断言 |
|---|---|---|
| T01 | 不含centers旧文件 | 旧布局、文本序列化不变 |
| T02 | 第三级B升格 | 没有重复ID，B不留父岛，源树未改 |
| T03 | B和后代C均升格 | owner唯一，B移动是否带C严格按G1 |
| T04 | 所有一级分支升格 | documentRoot元数据仍可读，自由边不消失 |
| T05 | 无效/重复/悬空中心 | 内容不丢、诊断、无重复绘制 |
| T06 | 四向+缺坐标+手工坐标混排 | 自动bounds合理，手工中心不漂移 |
| T07 | 首次升格/有展开note/编辑desc | 本体落脚点不跳动 |
| T08 | B处Tab/Enter连续输入 | 生长行为保留，中心不移动；新兄弟不无故自动升格 |
| T09 | 祖先折叠、独立后代展开 | 按G1显示，边代理合理，不误报dangling |
| T10 | pointermove多次→pointerup | 子树实时随动，只一条history |
| T11 | Esc/cancel/blur/文档切换 | 原位、原dirty、原history，预览清空 |
| T12 | 缩放0.5/1/2与二指介入 | 世界位移正确、无突跳、手势互斥 |
| T13 | 切深层A→B与切一级边 | 子树保留、独立角色与G2一致、位置保留 |
| T14 | 切B时C已独立 | C按G1保位，全部引用迁移一致 |
| T15 | 新中心从无note创建后undo | 原始note缺失状态准确恢复 |
| T16 | 事务中间非法/零位移 | 全无副作用，不清redo，不留部分树 |
| T17 | 改名/移动中心及其祖先 | centers/history/edges/links/groups正确更新 |
| T18 | 同名/含斜杠/歧义锚 | 不误指；本次新增歧义阻断，有提示 |
| T19 | detached普通降格/显式接回 | 无父时不能直接降格；接回后正确生长 |
| T20 | 接回自身后代/深度超限 | 拒绝、树与history不变 |
| T21 | 保存关闭重开 | 新id下角色/坐标/四向/连接状态一致 |
| T22 | 自由边与树边菜单 | 删除自由边不拆树，切树边不删内容 |
| T23 | SVG/PNG与Canvas门禁 | 不静默丢岛/边/内容，不导出未提交预览 |
| T24 | 文本外部编辑导致坏锚 | 可打开，提示，不自动重绑到错误节点 |

变异验证至少三条：恢复旧一级filter或移除递归剪枝→T02/T03失败；documentRoot改回几何根→T04失败；pointermove写history或移除取消→T10/T11失败。变异只在隔离worktree进行并恢复，不能污染并行开发工作区。

## 4. 性能验收口径

样例建议：500/2,000/10,000节点，5/20/50中心，0/100/500关系边；包含真实分布而非全部横穿画布的伪负载。记录字体、窗口、DPR、浏览器与硬件。

交互目标：2,000节点常用样例在约定机器上中心拖动p95目标≤16.7ms/帧；若超标必须附profile与降级方案，不能隐藏失败。10K用于压力画像，不能把50K配置阈值当承诺。静态pan不应无故触发局部树布局；拖动期不持久化；全局避障必要时结束后计算。没有可复现实测前不引入空间索引/Worker大改。

## 5. 执行命令与报告纪律

使用仓库已安装工具，禁止npx临时拉取vitest。当前Windows受管Node：E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe。示例（执行前核实路径）：
```bash
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" "E:/Development/MyAwesomeApp/mindcanvas/packages/kernel/node_modules/vitest/vitest.mjs" run --root "E:/Development/MyAwesomeApp/mindcanvas/packages/kernel"
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" "E:/Development/MyAwesomeApp/mindcanvas/packages/react/node_modules/vitest/vitest.mjs" run --root "E:/Development/MyAwesomeApp/mindcanvas/packages/react"
"E:/WorkBuddyData/binaries/node/versions/22.22.2-2/node.exe" "E:/Development/MyAwesomeApp/mindcanvas/packages/react/node_modules/typescript/bin/tsc" -b "E:/Development/MyAwesomeApp/mindcanvas/packages/react/tsconfig.json" "E:/Development/MyAwesomeApp/mindcanvas/apps/canvas/tsconfig.json" --pretty false
```
补跑apps/canvas测试及根package.json定义的其他gate步骤。记录实际命令、退出码、用例数、失败清单；受环境阻塞就标阻塞，不能把“工具没输出”写成通过。不得跳过hooks或改预算放行。

每个外派包回执必须有：基线/分支、变更文件、每项验收结果、真实日志、已知限制、未处理事项、给集成人的接口变化、可回滚提交范围。主审检查真实diff，不仅相信代理总结。

## 6. 发布与回滚

领域层、布局层、手势/UI分批提交，保持旧单树路径与旧centers读取。新字段未知于旧版，因此禁止宣称可无损降级：旧版可能忽略detached/parent_link或把深层中心忽略。保留发布前原文件副本，升级后文档不要交旧版写回。

如用功能开关，关闭开关也不能绕过数据识别后静默重排/覆盖新文件：对新语义文档提示只读/需新版本。回滚代码使用git revert并保留用户文档，绝不通过删除用户元数据“修复”。
