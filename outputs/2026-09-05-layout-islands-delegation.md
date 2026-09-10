# 可直接复制的外派实现任务书

## 使用方法

先由用户审查design中的G1–G3，再发以下总任务书。若未批准，只派A0基线与契约评审，不默认启动实现。两位实现者可分别领A1、A2，集成人统一接管公共文件。三个文件必须一起提供，不依赖原会话。

---

## 总任务书（复制本节）

你要在 E:/Development/MyAwesomeApp/mindcanvas 实现“布局岛：多中心+自由摆位+树形子树生长”，不是迁移Godot。

必须先读：
1. E:/Development/MyAwesomeApp/mindcanvas/outputs/2026-09-05-layout-islands-design.md
2. E:/Development/MyAwesomeApp/mindcanvas/outputs/2026-09-05-layout-islands-plan.md
3. 项目CONTRIBUTING.md、当前.mm.md协议、ADR-0004和现有tests。

用户已批准产品核心：升格是能力增强；任意深度节点可升格；切断父子线后的子树根可携带子树移动；保留Tab/Enter生长、折叠、四向。不要把它改成仅一级中心，也不要让所有普通节点都必须存坐标。

G1–G3若没有明确批准记录，你的首个交付仅为基线/契约评审与待确认清单，不能实施这些产品语义。不得把任务书中的“推荐”说成用户拍板。

### 已知现状，不要重复开发

2026-09-05调研HEAD为6f3af86639102175e96c520dd145cc7594e32591，工作区仍有未提交修改，开工必须重验。
- forest四向、centers/center_pos已存在。
- 中心手势isCenter/onCenterMove和Stage坐标写回已接入，不再是“拖拽零代码”。
- pipeline当前一级限制是旧止损；必须先实现递归投影再替换，不能裸删除守卫。
- MapView仍存在从首个depth=0推断文档根的路径，需显式documentRoot。
- 活跃历史为OpHistory，不是另一份History<T>；当前TreeOp只有单步操作。

### 工作边界与纪律

先Issue，再隔离分支/worktree。不直接推main，不绕过hooks，不覆盖他人的diff，不删除.workbuddy。不存在Issue号时要求分配/授权创建，不编造。
你只实施明确领取的工作包。触及他人文件先协调；公共入口、pipeline、MapView/Stage接线由集成人合并。不修改无关资产系统、不引入Godot/DI/CRDT，不用新增依赖逃避业务不变量。

### 实现顺序

A0确认→A1投影与A2事务并行→A3接入→A4拖动与A5切线按接口协同→A6集成验收。
每包先失败用例、再最小实现、再类型检查和回归。测试具体行为，不用assert(true)或只检查常量存在冒充回归。

### 强制正确性

1. 每节点唯一owner，布局ID不重复；布局投影不写回源树。
2. complete documentRoot用于文档元数据与锚解析，不读投影children。
3. 中心本体坐标稳定，展开note/编辑desc不漂移；旧坐标样例兼容。
4. 拖动实时显示整岛；pointermove不写文档，pointerup一次undo；Esc/cancel/blur/切文档无副作用。
5. 切线是领域事务，保留子树内容；与自由边删除分开。
6. 应用内改名/移动引用按节点身份迁移，不做字符串替换；新歧义阻止提交。
7. 初次无note→加中心→undo恢复字段缺失；事务中任一步失败完全回滚。
8. 保存重新解析产生新id后仍能操作；后端/导出不静默丢线。

### 验收与报告

逐条填写plan的T01–T24，未完成写未完成。分别报告单测、类型、全gate、真实浏览器操作、性能，不能互相替代。至少三条指定变异回归证明测试会红。记录命令/退出码/用例数/日志位置。

不要把生成代码当成完成。最终回执：基线SHA、分支、Issue、改动文件、实现和未实现清单、测试结果、截图/录屏、性能、接口变化、风险与回滚范围。若碰到协议不能表达、身份歧义或平台限制，停下受影响工作包，提交具体证据与选项，不擅自降级用户需求。

---

## 外派A1：布局纯函数专项（复制本节并附总任务书）

你只负责plan A1，不负责UI/历史/协议改写。依据design第4节设计projectIslands，递归划分内容树，升格节点从父岛投影剔除；遇独立后代再划新岛。输出唯一owner、边界线、诊断，保留不可变源树。

现有pipeline.ts:217–248只过滤一级，不能作为最终算法。复用kernel/layout/forest.ts四向布局。核心测试：深层与嵌套、重复中心、坏锚、根中心、折叠覆盖、无中心回退。不得修改pipeline、MapView、Stage和公共index，导出需求写回执交集成人。新增纯函数放kernel/layout合理文件，保持零DOM/React依赖。G1未定只提交候选契约和测试规格。

## 外派A2：历史与引用专项（复制本节并附总任务书）

你只负责plan A2。当前kernel/src/tree/tree-op.ts有单步TreeOp与OpHistory，需原子批次而不引入第二个历史栈。阅读invertOp/updateNode对undefined和字段删除的语义，先验证初次写note再undo的恢复行为。

按design第5/6节实现/提出applyTransaction，暂存全批验证、逆操作按逆序、失败零副作用、成功一次通知。引用按前后树同一会话nodeId迁移，盘点centers、center_pos、edges、links、groups，不碰未知字符串。新路径歧义拒绝提交。保留原apply(op)兼容，不改UI/布局；公共index与Stage由集成人接。报告所有新增API与失败结果形状。

## 集成人提示

先批准接口再接代码。对A1/A2真实diff复核，不凭代理回执合并。A3/A4/A5需要的共享MapView/Stage修改由你统一持有。每日重新核查工作区，不拿旧SHA覆盖新实现。没有批准G2时先完成已批准的升格路径，不自行实现一种切线存储方案。
