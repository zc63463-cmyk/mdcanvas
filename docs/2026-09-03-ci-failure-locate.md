# 深度定位：CI 门禁「中断卡死」根因

> 日期：2026-09-03 · 方法：Git 元数据 + GitHub Actions API + 本地实测复现
> 结论等级：**P0** —— CI 自建库起 11 次运行全部失败，从未绿过

---

## 一、一句话结论

本地日志全程写着「全绿已推送」，但 **GitHub Actions 从第一次运行起 11 次全红**，
且**每次都失败在同一步：类型检查**。本地测试全绿是因为 **vitest 不做类型检查**，
而本机 `pnpm gate` 又必然卡死（vitest 跑完不退出），导致 typecheck 从未真正跑过。

三件事叠在一起，形成闭环：

```
vitest 跑完不退出（Windows 环境问题）
        ↓
pnpm gate / pre-push 本机必卡 → 只能 --no-verify 推送
        ↓
typecheck 被跳过 → 类型错误混入主干（vitest 全绿，完全掩盖）
        ↓
CI（Linux，不卡）在 typecheck 步骤失败 → 11 次全红且无人看
```

---

## 二、证据链（全部实跑，非读文档）

### 1. CI 状态：11/11 failure

```
$ curl api.github.com/repos/zc63463-cmyk/mdcanvas/actions/runs

11  2026-09-03  e29e93d  completed  failure
10  2026-09-03  e1a7cc2  completed  failure
 9  2026-09-02  1172a66  completed  failure
 8  2026-09-02  63d0dcf  completed  failure
 7  2026-09-02  d4df74b  completed  failure
 6  2026-09-02  0ae2652  completed  failure
 …  （更早 6 次同样 failure，因 API 限流未逐个展开）
 1  2026-09-02  006961d  completed  failure   ← 建库后第一次推送
```

Job 步骤明细（run 11 / `e29e93d`）：

| 步骤 | 结论 |
|---|---|
| 检出代码 / 安装 pnpm / 安装 Node / 安装依赖 | success |
| **6 · 类型检查（3 包）** | **failure** |
| 7 · 测试（794 个） | skipped |
| 8 · 构建 | skipped |
| 9–11 · depcruise / lint / budget | skipped |

### 2. 本地 typecheck：kernel 10 个错误（已修）

```
$ cd packages/kernel && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
tests/verify-roundtrip-note-order.test.ts(13,25): TS2835  相对导入缺 .js
tests/verify-roundtrip-note-order.test.ts(14,46): TS2835
tests/verify-roundtrip-note-order.test.ts(28,28): TS2345  MindNode | null ≠ MindNode
… 共 10 条
```

同一个文件里 10 个类型错误，而 `vitest` 报 **301 全绿** —— 测试与类型检查完全脱节。

### 3. 但更早的提交也红 → 还有第二个原因

`d4df74b` / `63d0dcf` / `1172a66` 都早于今早新增的测试文件，同样失败在 typecheck。
说明存在一个**与今天代码无关的结构性缺陷**。

---

## 三、根因 A（主因）：CI 步骤顺序错误 —— build 排在 typecheck 之后

`.github/workflows/ci.yml` 的步骤顺序：

```
安装依赖 → 类型检查(6) → 测试(7) → 构建(8) → depcruise → lint → budget
                    ↑                ↑
             需要 dist         dist 在这里才生成
```

而：

- `dist/` 在 `.gitignore` 中，`git ls-files | grep dist/` → **0 个文件进仓库**
- `packages/react/tsconfig.json` **没有 paths 映射**，30 个文件 `import from '@mindcanvas/kernel'`
  → 走 package.json `exports` → `packages/kernel/dist/index.d.ts`

**本地复现**（临时移走 `packages/kernel/dist`）：

```
src/chrome/assetDiagnostics.ts(6,44): TS2307: Cannot find module '@mindcanvas/kernel'
src/chrome/EdgeEditor.tsx(11,44):     TS2307: Cannot find module '@mindcanvas/kernel'
src/MindmapStage.tsx(8,43):           TS2307: Cannot find module '@mindcanvas/kernel'
```

→ **即使代码零错误，CI 也必然失败。** 这与记忆里那条「app 层 typecheck 走 dist 而非 src」
是同一个坑，只是这次它发生在 CI 上。

---

## 四、根因 B（今日引入，已修）：新增测试漏跑 typecheck

今早 08:50 修 `verifyRoundTrip` 误报时新增的 `tests/verify-roundtrip-note-order.test.ts`：

- 相对导入缺 `.js`（kernel 用 `moduleResolution: node16`，必须带扩展名）
- `parseMm(src).root` 类型是 `MindNode | null`，直接传给了要求 `MindNode` 的函数

**已修复**，且未新增非空断言（债务预算冻结 bang 只减不增）：

```ts
/** 显式判空抛错来收窄类型，而不是到处补 `!` */
function parseRoot(src: string): MindNode {
  const { root } = parseMm(src);
  if (!root) throw new Error(`解析未产出根节点：${src}`);
  return root;
}
```

修复后：kernel typecheck **10 错 → 0 错**，该测试 4 条仍全绿。

---

## 五、根因 C（环境，会反复咬人）：vitest 跑完不退出

全部重定向到文件（排除管道缓冲干扰）后的实测：

| 用例 | 结果 |
|---|---|
| kernel 40 文件 / 301 测试（node 环境） | **exit=0，正常退出** |
| react 64 文件 / 469 测试 | 全绿但 **exit=124**（挂满 300s timeout） |
| react 单文件（jsdom） | exit=0，正常退出 |
| canvas 4 文件 / 24 测试 | 全绿但 **exit=124** |
| react 前 16 文件，默认 pool | exit=124；改 `--pool=forks` → **exit=0** |
| react 全量 + `--pool=forks` | 仍 exit=124 |

规律：**纯 node 环境从不挂，jsdom 环境必挂**；与规模/组合相关
（8 文件 126 测试挂、8 文件 78 测试不挂）。二分到文件级未找到单一泄漏源 ——
判定为 **Windows 下 vitest worker 回收问题，非代码缺陷**（CI 是 ubuntu-latest，不受影响）。

这条直接导致 `pnpm gate` / pre-push 在本机必然卡死，是整条因果链的起点。

---

## 六、当前实测基线

| 项 | 状态 |
|---|---|
| kernel typecheck | ✅ 0 错（修后） |
| react typecheck | ✅ 0 错 |
| canvas typecheck | ✅ 0 错 |
| kernel 测试 | ✅ 301 绿 |
| react 测试 | ✅ 469 绿 |
| canvas 测试 | ✅ 24 绿（2 skipped = 停用的 stage-render） |
| **CI** | 🔴 **11/11 failure** |

---

## 七、待拍板：修法选择

### 方案 A（推荐，最小改动）—— CI 里把 build 提到 typecheck 之前

```yaml
- name: 构建（先产出 dist，供下游 typecheck 解析）
  run: pnpm build

- name: 类型检查（3 包）
  run: pnpm typecheck
```

- 优点：与本地现有行为一致，改动一行顺序
- 缺点：build 失败时 typecheck 的错误信息会被掩盖（可接受，build 失败本身就是要修的）

### 方案 B（更彻底）—— tsconfig 加 paths 指向 src

让 typecheck 彻底不依赖 `dist`，本地和 CI 都不需要「先 build 再 typecheck」。

- 优点：根治该坑，本地新 clone 后可直接 `pnpm gate`
- 缺点：要改 kernel / react / canvas 三个 tsconfig，需验证与 `tsconfig.build.json`
  （发布构建，仍应输出 dist）不冲突

### 配套纪律（无论选哪个都要做）

1. **禁用 `npx vitest`**，统一 `./node_modules/.bin/vitest`，后台跑 + 落盘日志 + 显式 timeout
2. `--no-verify` 推送前**必须**手动跑完三个包的 typecheck（今天就是漏了这一步）
3. 推送后看一眼 CI —— 建议 `gh run watch`，或至少 `gh run list --limit 3`

---

## 八、尚未处理的相关项

| 项 | 说明 |
|---|---|
| 8 月 157 commits 未进远端 | 只存在于 bundle，历史不连续无法拼接 |
| 两个遗留文件未入库 | `split-stage.mjs`、`MindmapStage.pre-split.bak`，**未进任何备份**，删了不可恢复 |
| **F 自用周从未开始** | 无 friction-log；它是下一轮功能规划的唯一事实源 |
| **E5 网络视图永久挂起** | 触发条件 = friction-log ≥2 条跨文档关系类摩擦 → 因 F 周未开而永远不触发 |
| ⚠️ E5 编号撞车 | roadmap 的 E5 = 网络视图（挂起）；增补批的 E5 = 存储重构（已完成 `b851fb9`） |
| 仓库名 `mdcanvas` vs 项目名 `mindcanvas` | 若是有意缩写则忽略 |
