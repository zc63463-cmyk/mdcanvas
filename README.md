# mindcanvas

纯文本思维导图内核与应用（微内核 + 插件 + 渐进增强架构）。

| 项 | 值 |
|---|---|
| 状态 | K0 地基阶段（见 `docs/roadmap/`） |
| 前身 | [knowledge-canvas](../knowledge-canvas)（只读参考源：协议层 / 326 测试 / 布局引擎的移植出处） |
| 平台 | Web-first（PWA + local-first），库优先（`packages/kernel` headless / `packages/react` 渲染器 / `apps/canvas` 应用入口） |
| 数据 | `.mm.md` 纯文本事实源（markdown + 行内实体引用 + 笔记块透传键） |

## 文档地图

- `docs/roadmap/` — 内核重构路线图 K0-K5（当前执行 K0）
- `docs/specs/` — forgejo-bridge 联动 spec（首个参考消费者规格，R1-R14）
- `docs/research/` — OSS 调研两辑（集成侧 + 内核侧）
- `docs/mirrors/` — 三面镜子（消费者规格，接口设计的验收标尺）
- `docs/adr/` — 架构决策记录
- `docs/dispatch/` — 外派执行任务书

## 快速开始（K0 完成后）

```bash
pnpm install
pnpm -r test
pnpm --filter canvas dev
```

## 命名说明

仓库名 `mindcanvas` 为占位命名，如需更换：改目录名 + `git remote set-url` + 根 `package.json` 名即可，无历史包袱。
