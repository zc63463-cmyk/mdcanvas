# mindcanvas

纯文本思维导图内核与应用（微内核 + 插件 + 渐进增强架构）。

| 项 | 值 |
|---|---|
| 状态 | 接口已冻结（semver 管理，见 `docs/adr/ADR-0004`）· 内核 v1.3.1 · **764 测试全绿** |
| 仓库 | <https://github.com/zc63463-cmyk/mdcanvas>（公开） |
| 开发规范 | **`CONTRIBUTING.md`** —— 分层、导出面、类型、文件规模、协议纪律、环境坑 |
| 前身 | [knowledge-canvas](../knowledge-canvas)（只读参考源：协议层 / 326 测试 / 布局引擎的移植出处） |
| 平台 | Web-first（PWA + local-first），库优先（`packages/kernel` headless / `packages/react` 渲染器 / `apps/canvas` 应用入口） |
| 数据 | `.mm.md` 纯文本事实源（markdown + 行内实体引用 + 笔记块透传键）—— 规格见 **`docs/specs/2026-09-02-mm-md-protocol.md`** |

## 文档地图

- **`CONTRIBUTING.md`** — 开发规范（新代码怎么写、为什么这么写）
- `docs/roadmap/` — 内核重构路线图 K0-K5 + 下一阶段规划
- `docs/adr/` — 架构决策记录（0004 接口冻结 / 0005 依赖守护 / 0006 渲染后端 / 0007 组件拆分）
- **`docs/2026-09-02-next-steps.md`** — 后续开发指导（待办优先级 + 纪律速查 + 待拍板事项）
- `docs/specs/2026-09-02-mm-md-protocol.md` — **`.mm.md` 协议规格**（数据层权威定义）
- `docs/specs/` — forgejo-bridge 联动 spec（首个参考消费者规格，R1-R14）
- `docs/research/` — OSS 调研与方案对比
- `docs/mirrors/` — 三面镜子（消费者规格，接口设计的验收标尺）
- `docs/dispatch/` — 外派执行任务书与交付报告
- `docs/2026-09-02-code-structure-plan.md` — 代码结构规范化规划（层次 / 编写 / 实现）

## 快速开始

```bash
pnpm install
pnpm gate                  # 全量门禁：typecheck + 764 测试 + depcruise + lint + budget（2-3 分钟）
pnpm --filter canvas dev
```

结构实测（规模 / 导出面 / 复杂度热点）：`node scripts/analyze-codebase.mjs`

## 命名说明

仓库名 `mindcanvas` 为占位命名，如需更换：改目录名 + `git remote set-url` + 根 `package.json` 名即可，无历史包袱。
