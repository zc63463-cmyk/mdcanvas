# Sections Phase 1 收尾 + 在途债务清偿：交付报告

**日期**：2026-09-10
**范围**：Sections Phase 1（T1–T6）推送落地 + 会话前既有 WIP 隔离提交 + 代码债务清偿 + pre-push 门禁修复
**结果**：14 个提交全部推送至 `origin/main`（`b232223..4f7094b`）

---

## 一、交付清单

| # | 提交 | 内容 |
|---|---|---|
| 1 | `aa244d2` | **T1+T2** 协议与锚解析——`SectionSpec`/`sectionsOf`/`upsertSection`/`removeSection`/`makeSectionId` + `resolveSections` 三态 + `W-SECTION-DANGLING` |
| 2 | `12278ce` | **T3** 渲染层——`sectionFrames` 纯几何（成员盒 AABB 外扩）+ `SectionLayer` 背景框 |
| 3 | `e5cc2b8` | **T4** 菜单与拖拽闭环——三态入口（取消/标记/升为中心）+ 标题栏接管 center 管线 |
| 4 | `bdcda03` | **T5** 折叠钮（会话态不落盘）+ 选中态退出三件套 |
| 5 | `e1c6450` | 协议文档 v1.4/v1.5 补记（note/note_text 与 sections） |
| 6 | `53eb9ae` | T1–T6 交付报告 |
| 7 | `5651ff0` | *(隔离)* FA1/FA2 图引擎适配器与分枝布局 |
| 8 | `4d79470` | *(隔离)* 分枝布局 + 节点图标/染色/落点感知 |
| 9 | `05ed575` | *(隔离)* 资产宿主/图标面板/目录授权/保存句柄 |
| 10 | `af76875` | *(隔离)* canvas 文件树模型与库面板重构 + 在途文档 |
| 11 | `bf3c2c2` | *(隔离)* react 定向测试补全 |
| 12 | `86f98dd` | **债务清偿**——拆大文件 + 清断言至基线 |
| 13 | `fcefce5` | *(hook)* pre-push 区分环境噪声与真失败 |
| 14 | `83f739c` / `4f7094b` | *(hook)* 日志落 `.git/`、修 `set -e` 短路、**剥 ANSI 序列（真根因）** |

---

## 二、债务清偿明细（`86f98dd`）

### 断言之债：-1 bang / -7 as

| 位置 | 原写法 | 改法 |
|---|---|---|
| `graphJsonAdapter.ts` | `graph.nodes[0]!.id` | 可选链 + `undefined` 判别 |
| `graphJsonAdapter.ts` | `'right' as GrowDir` ×2 | 具名常量 `DEFAULT_CENTER_DIR: GrowDir` |
| `section.ts` | `color as SectionColor` | 拆为 `readSectionColor`（读侧开放透传，唯一收敛点）+ `isKnownSectionColor` 守卫 |
| `edit/fsError.ts`（新增） | `(e as Error).name` ×3 | `isAbortError(e)` 类型守卫，`in` 收窄 |
| `handleStore.ts` | `handle as Partial<PermissionAware>` | `'queryPermission' in handle` 收窄 |
| `AssetPanel.tsx` | `Object.keys(X) as AssetAction[]` | 显式 `ASSET_ACTION_ORDER` 常量 |

> **关键纪律保留**：`section.ts` 的读侧必须**开放接收任意字符串**（未知 color token 在
> 「解析→序列化」往返中不能丢值），收窄只发生在渲染侧 `sectionColorOf`。
> 中途曾误把读侧一并收窄，被 `section-roundtrip` 的「未知 token 透传」用例拦下。

### 大文件之债：6 → 4（全部 ≤600 行）

| 原文件 | 行数 | 现分拆 |
|---|---|---|
| `AssetPanel.tsx` | 690 → **337** | `assetViews.tsx`（卡片/列表行）+ `assetTypes.ts`（共享类型） |
| `FileManager.tsx` | 890 → **598** | `fileManagerShared.ts`（样式/纯函数/`useStarredKeys`）+ `FileManagerChrome.tsx`（StorageBar/ViewTabs/FlatDocRow）+ `FileManagerContextMenu.tsx` |

顺带消除 4 处「从 `AssetPanel` 绕行导入 `AssetItem`」，直指 `assetTypes`。

---

## 三、pre-push 门禁误拦：三层根因链

沙箱下 push 连续 3 次被拦，每层「修好」后仍失败。逐层剥离：

| 层 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | budget 超预算 | FA1/FA2 在途债务（基线满预算，新增即超） | 实测清偿，不上调基线 |
| 2 | depcruise 报 syntax error | `.bin` shell wrapper 在 hook 的 `sh` 下炸 | 走真实 JS 入口 |
| 3 | 判定逻辑不执行 | `set -e` 下 `timeout` 返回 124 当场终止 | `\|\| _code=$?` |
| 4 | 日志文件为空 | MSYS `mktemp` 返回 Windows 路径，重定向落空 | 日志落 `.git/` 固定路径 |
| **5** | **判「无结果输出」却明明全绿** | **vitest 输出带 ANSI 颜色序列** | **grep 前 `sed` 剥 `\x1b\[[0-9;]*m`** |

**第 5 层是真根因**，最隐蔽：

```
$ grep "Tests" f.log | cat -A
      Tests ^[[22m ^[[1m^[[32m427 passed^[[39m^[[22m^[[90m (427)^[[39m$
```

`Tests` 与数字间夹着 ANSI，`grep -E "Tests +[0-9]+ passed"` 永不命中——**无论测试是否全绿**。

**方法论**：终端工具输出解析失败时，**先 `cat -A` 看真实字节再改正则**，不要盲调正则。

---

## 四、最终验证基线

| 检查项 | 结果 |
|---|---|
| typecheck（3 包 `tsc -b`） | ✅ 0 错误 |
| test | ✅ **1388 用例全绿**（kernel 54 文件/427 + react 94 文件/907 + canvas 5 文件/54） |
| depcruise | ✅ 0 违规（328 模块 / 947 依赖） |
| lint | ✅ 0 error（1400 warning 均为既有） |
| budget | ✅ 全项持平（any 0 / tsIgnore 0 / bang 90 / asCast 31 / console 4 / todo 1 / defaultExport 2 / bigFiles 4） |

工作区干净（仅 `tools/`、`verify-shots/` 未跟踪，按既有约定不入库）。

---

## 五、副产品：环境纪律沉淀

- 更新技能 `win-sandbox-test-logging`，新增三节：
  - **§5 ANSI 转义序列**——grep 判定 vitest 结果的隐形杀手
  - **§6 hook/CI 判定模式**——看输出不唯退出码 + 三个必避坑
  - **§7 `.bin` shell wrapper** 在 hook/sh 下会炸
- 项目记忆新增「沙箱工具陷阱」章节，与 `.git` 损毁恢复流程并列。

## 六、遗留

- `.git/refs/remotes/origin` 结构在第二次 .git 损毁恢复时未重建，本次补写完成。
  后续若再遇 `origin/main` 无法解析，用 `git ls-remote origin main` 取 sha 手写即可。
- `docs/`、`outputs/` 已在 `biome.json` 排除（历史 HTML 报告被当源码检查报 error）。
  注意门禁的 lint 实际只扫 `packages apps`，此排除是配置正确性而非 gate 必需。
