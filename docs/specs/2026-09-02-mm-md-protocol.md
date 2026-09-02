# `.mm.md` 协议规格 v1.3.1

> 日期：2026-09-02 · 状态：**生效**
> 适用：`@mindcanvas/kernel` ≥ 1.0.0（接口冻结自 ADR-0004）
> 共享方：Forge 知识画布 / markvault-js MindFlow / markvault-reborn（见 `packages/kernel/src/protocol/types.ts` 头注）
>
> 本文每条规则均**经行为实测**，探测脚本 `apps/canvas/scripts/diag-protocol-probe.mts` 可复现：
> ```bash
> cd apps/canvas && npx vite-node scripts/diag-protocol-probe.mts
> ```

---

## 一、定位与设计原则

`.mm.md` 是**纯文本思维导图事实源**：既是人可读、可 diff、可用任意编辑器修改的 Markdown，
又是结构化的思维导图数据。

三条不可动摇的原则：

| 原则 | 含义 |
|---|---|
| **数据无损** | `parse → serialize → parse` 结构等价；序列化幂等 |
| **前向兼容** | 未知 kind、未知字段一律保留，绝不丢弃 |
| **宽松读入、规范写出** | 解析容忍各种手写形态；序列化输出 canonical 格式 |

---

## 二、文件结构

### 2.1 整体形态

```
<!--                      ← 文档级 edges（可选，见 §5.2）
edges:
  - from: node:路径/到/源
    to: "@issue:8"
    rel: blocks
-->
# 根                      ← H1，有且仅应有一个

## 分支 A                 ← H2–H6
- 列表项
  - 子项

## 分支 B
- @issue:1                ← 实体引用
<!--                      ← 笔记块（归属其**后**的节点）
one_liner: 一句话
-->
- 另一个节点
```

### 2.2 行词法

解析器逐行分类（**首个匹配即止**）：

| 形态 | 正则 | 归类 |
|---|---|---|
| `[ \t]*<!--[ \t]*` | 独占一行 | 笔记块开始 |
| `[ \t]*-->[ \t]*` | 独占一行 | 笔记块结束 |
| `[ \t]*<!--.*-->[ \t]*` | 单行内闭合 | 行内注释（忽略） |
| `[ \t]*` | 空行 | 忽略 |
| `#{1,6}[ \t]+标题` | H1–H6 | 标题 |
| `#{7,}` | 7 个以上井号 | 非法标题 → `W-STRAY-LINE` |
| `[ \t]*-[ \t]+内容` | 列表项（内容非空） | 列表项 |
| 其他 | — | 杂散行 → `W-STRAY-LINE` |

> 行尾统一归一化为 `\n`（`\r\n` 与 `\r` 均接受）。

### 2.3 缩进规则（**重要：相对而非绝对**）

列表层级由**缩进的相对大小**决定，**不是**固定的 2 空格：

```
- a          - a
  - b    ≡       - b      ≡   - a
    - c             - c           - b
                                      - c
```

实测：`0/2/4`、`4/8`、`tab` 三种写法产生**完全相同**的结构。
tab 在度量时折算为 4 个空格。

> 含义：手写时缩进风格自由，但**同一文档内应保持一致的相对层级**。
> 序列化输出统一为 2 空格缩进。

---

## 三、节点类型

列表项内容按 **R1 → R2 → R3** 优先级分类：

| 优先级 | 形态 | 结果 |
|---|---|---|
| R1 | `@kind:id`（kind 合法：小写字母开头 + `[a-z0-9_]`） | 实体节点（见 §4） |
| R1′ | `@XXX:` 有引用意图但 kind 非法（如 `@ISSUE:42`） | 文本节点 + `W-INVALID-REF` |
| R2 | `![alt](url)` | 图片节点 |
| R3 | 其他 | 文本节点 |

> R1′ 存在的意义：把"想写引用但写错了"和"就是一段普通文字"区分开，前者给出诊断。

---

## 四、实体引用

### 4.1 语法

```
@<kind>:<id>
```

- `kind`：`[a-z][a-z0-9_]*`（小写字母开头）
- `id`：按 kind 校验（见下表）

### 4.2 已注册 kind 与 id 校验

| kind | id 规则 | 示例 |
|---|---|---|
| `issue` / `pr` | 纯数字（不以 0 开头） | `@issue:1` `@pr:12` |
| `doc` / `img` / `draw` | 相对路径，禁绝对路径、禁 `\`、禁 `..` 与 `.` 段、每段不含 `@ :` 与控制字符、总长 ≤512 | `@doc:docs/a.md` |
| `milestone` / `note` | 非空、不含 `@ :` 与控制字符 | `@milestone:M1` |
| `idea` | 可选项目前缀 + 数字：`[a-z][a-zA-Z0-9_-]*:?<数字>` | `@idea:proj:3` |
| `annotation` | `[A-Za-z0-9][A-Za-z0-9._-]*` | `@annotation:anno-1` |
| **未注册 kind** | **不校验**，原样保留 | `@unknownkind:xyz` |

**前向兼容（关键）**：未注册 kind **仍解析为实体节点**并保留到 `refs`，仅附 `W-UNKNOWN-KIND` 诊断。
这样 v0.3 引入新 kind 时，存量文件不会退化成文本。

### 4.3 跨库前缀（v0.2.2）

`id` 可带 `org:` 或 `org/repo:` 前缀，校验时先剥离前缀再按上表校验本体：

```markdown
- @issue:myorg/repo:42      ← 合法，本体为 42
```

> 例外：`idea` 的前缀是**项目名**语义，不适用跨库语法。

---

## 五、笔记块

### 5.1 语法与归属

```markdown
- 节点 A
<!--
one_liner: 摘要
-->
- 节点 B
```

- 笔记块由独占一行的 `<!--` 与 `-->` 包裹
- **归属其后的第一个结构节点**（上例中归 `节点 B`，不是 `节点 A`）
- 公共缩进会被剥离，因此列表下缩进书写是合法的
- 无后继节点 → `W-ORPHAN-NOTE`，笔记丢弃
- 未闭合 → `E-UNCLOSED-NOTE`，整体丢弃
- 内容非 YAML mapping → `E-INVALID-NOTE-YAML`，整体丢弃
- 前一个未绑定笔记被新的覆盖 → `W-NOTE-SHADOWED`

### 5.2 字段

已知字段的固定顺序（序列化时按此输出）：

```
one_liner → decisions → status → next → reminder
```

**其余字段**（`desc` / `qa` / `links` / `edges` 等）不在固定序列内，
按对象插入顺序（即解析时的书写顺序）排在上述 5 个之后，随后是未知字段。

> 实测：`KNOWN_NOTE_ORDER` 仅含 5 个字段（`packages/kernel/src/protocol/serializer.ts`）。
> 不要假设 `desc` / `qa` / `links` 有固定位置。

| 字段 | 类型 | 说明 |
|---|---|---|
| `edges` | 对象列表 | **文档级**标注边（写于文件头，§6.2） |
| `one_liner` | string | 一句话摘要 |
| `status` | string | 状态 |
| `next` | string 或 string[] | 下一步 |
| `reminder` | string | 提醒 |
| `desc` | string | 幕布风格描述（v1.3.0），多行以 `\n` 转义 |
| `qa` | string[] | 快速注释，多条目按需展开 |
| `links` | 对象列表 | 节点级关系（§6.1） |
| `decisions` | string[] | 决策记录 |

**未知字段一律透传**（`Note` 有 `[key: string]: unknown`），序列化时排在已知字段之后。
这是前向兼容的核心机制。

### 5.3 值形态

**标量**
```yaml
one_liner: 摘要
edge: {"rel":"blocks","dir":"back"}     # {...} 形态尝试 JSON 解析，失败回落字符串
```
实测：`{"rel":"blocks"}` 解析为对象 → 序列化为带引号的 JSON 字符串 `"{...}"` → 再解析回对象，**往返无损**。

**字符串列表**
```yaml
qa:
  - 问题一
  - 问题二
```

**对象列表（1.1.0 起，用于 `links` / `edges`）**
```yaml
links:
  - rel: blocks
    to: "@issue:1"
    dir: back
```

对象项判别是**保守的三条件判定**（避免误伤冒号字符串）：

1. 不以引号开头
2. 形如 `- key: value`
3. **紧随续行字段**（下一非空行有缩进且为 `key: value`）

> 因此 `qa` / `decisions` 这类冒号字符串列表行为不变。

**转义规则**：多行文本（如 `desc`）以 `\n` 转义写入，解析时还原为真实换行。

序列化器在以下任一情形**强制加双引号**并转义（防止被重解析为别的结构）：

| 条件 | 例 |
|---|---|
| 空串 | `key: ` |
| 首尾有空白 | `key: " x "` |
| 以特殊字符开头 | `" ' [ ] { } > \| & * ! # % @ \` ,` |
| 以 `- ` 开头（防误判为列表项） | `- foo` |
| 值为 `---` 或 `-->` | 防 YAML 文档分隔符 / 笔记块结束符 |
| 形如 `key:value`（防误判为对象项） | `rel:blocks` |
| 含换行或 tab | 多行描述 |

转义内容：`\` → `\\`，`"` → `\"`，换行 → `\n`，tab → `\t`。

> 最后一条是 v1.3.0 的关键修复：裸换行会截断 YAML 行结构，
> 重解析时第二行不是 `key: value` → `E-INVALID-NOTE-YAML` → **整块笔记丢弃**。

---

## 六、关系

### 6.1 节点级 `links`

写在源节点的笔记块内。`links` **永远声明在源节点**（单一事实源，无镜像写入）。

| 字段 | 说明 |
|---|---|
| `rel` | 关系类型（开放字符串；已知类型走 `REL_META` 视觉映射） |
| `to` | 目标锚（节点路径或实体锚） |
| `dir` | `fwd`（默认）/ `back` / `both`，**仅渲染端箭头语义**，不产生第二条数据 |
| `label` | 边上的短标签 |
| `note` | 边的备注 |
| `attrs` | 任意属性（内联 JSON） |

非法 `dir` 回落 `fwd` + `W` 级诊断。

### 6.2 文档级 `edges`

写在**文件头**的独立笔记块中（不归属任何节点），用于树形之外的自主连线。

| 字段 | 说明 |
|---|---|
| `from` / `to` | 两端锚（节点路径或实体锚） |
| `rel` / `dir` / `label` / `note` / `style` / `attrs` | 同 §6.1 |
| `invalidAt` | 软失效时间戳（失效/恢复二段） |
| `source` | `manual` / `inferred` / `imported` |

---

## 七、结构装配

| 规则 | 行为 |
|---|---|
| 标题栈 | H1 为根；H2–H6 按层级入栈挂载 |
| 列表栈 | 按缩进相对层级挂载（§2.3） |
| **最大深度 16** | 超限节点**不挂载且不压栈**，子树自然上提 → `E-DEPTH-EXCEEDED` |
| 无 H1 | 合成空标题根 → `E-NO-ROOT`；**合成根不接收笔记** |
| 重复 H1 | 后者降级为根下分支 → `E-MULTI-ROOT`（保持 H1 栈语义） |
| 全文本子节点 | 序列化时继续标题链（≤H6）；含实体的混合子节点 → 全部保持列表形态 |

---

## 八、诊断码

| 码 | 级别 | 含义 | 数据影响 |
|---|---|---|---|
| `E-NO-ROOT` | E | 无 H1，合成空标题根 | 合成根 |
| `E-MULTI-ROOT` | E | 多个 H1 | 后者降级 |
| `E-DEPTH-EXCEEDED` | E | 深度 > 16 | 节点不挂载 |
| `E-UNCLOSED-NOTE` | E | 笔记块未闭合 | 笔记丢弃 |
| `E-INVALID-NOTE-YAML` | E | 笔记体非 mapping | 笔记丢弃 |
| `W-UNKNOWN-KIND` | W | kind 未注册 | **保留为实体节点** |
| `W-INVALID-REF` | W | 引用形态非法或 id 校验失败 | 降级为文本节点 |
| `W-ORPHAN-NOTE` | W | 笔记后无节点 | 笔记丢弃 |
| `W-NOTE-SHADOWED` | W | 前一未绑定笔记被遮蔽 | 前一笔记丢弃 |
| `W-STRAY-LINE` | W | 杂散行 | 忽略该行 |

> `E` 级表示结构已按容错规则调整；`W` 级表示数据保留但值得注意。
> **`W-UNKNOWN-KIND` 不丢数据**——这是前向兼容的关键。

---

## 九、canonical 输出格式

`serializeMm()` 的规范输出：

1. 分支（heading）之间**保留一个空行**（1.3.1 起；保住手写分段，避免首次保存产生全量 diff）
2. 空行插在**笔记块之前**——笔记归属其后的节点，插在之后会拆开两者
3. 列表缩进 2 空格
4. 笔记块三行式（`<!--` / 字段 / `-->`）
5. 末尾单个 LF
6. 字段顺序：先 `one_liner → decisions → status → next → reminder`，
   再其余字段（按插入顺序），最后未知字段（§5.2）

示例：

```markdown
# 根

## 分支
<!--
one_liner: 摘要
-->
### 甲
```

**幂等**：`serialize(parse(serialize(parse(x)))) === serialize(parse(x))`。

---

## 十、往返契约（硬要求）

```
parse(text) → MindNode → serializeMm → text' → parse → MindNode'
```

必须满足：

- `MindNode' ≡ MindNode`（深度相等）
- `refs` 一致
- 诊断不因往返而新增 `E` 级

验证脚本：

```bash
cd apps/canvas && npx vite-node scripts/diag-mm-roundtrip.mts       # 合成压力用例
cd apps/canvas && npx vite-node scripts/diag-roundtrip-real.mts     # 真实文件（gateway / 10K）
```

---

## 十一、前向兼容承诺

对**读取方**（解析器）：

1. 新增 kind 不会使存量文件解析失败（保留 + `W-UNKNOWN-KIND`）
2. 新增笔记字段不会丢失（未知字段透传）
3. 放宽 id 校验不会使原合法文件变非法

对**写入方**（序列化器）：

1. 不产出当前版本解析器无法读回的内容
2. canonical 格式变更视为行为变更，须同步 `CHANGELOG` 与本文

---

## 十二、版本历史

| 版本 | 变更 |
|---|---|
| v1.3.1 | canonical 输出保留分支分段空行（格式改进，数据语义等价） |
| v1.3.0 | 新增 `Note.desc` 幕布描述（多行 `\n` 转义） |
| v1.2.0 | 文档级 `edges`：`invalidAt` 软失效、`source` 来源溯源 |
| v1.1.0 | `links` 支持对象列表；`dir` / `label` / `note` / `attrs` 透传 |
| v1.0.0 | 接口冻结（ADR-0004）：协议层公开签名变更视为 major |
| v0.2.2 | 跨库前缀 `org:` / `org/repo:` |
| v0.2.1 | 新增 `idea` kind 与项目前缀 |
