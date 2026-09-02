/**
 * ⚠️ 本文件**已停用**（describe.skip），保留仅为记录一次实测结论。
 *
 * 结论：不要在 jsdom 里整体渲染 `MindmapStage`。
 * 尝试过 `render(<MindmapStage />)` —— 进程挂起被 SIGTERM 终止，无法在 CI 中运行。
 * 原因：Stage 会挂载完整画布（MapView + 全量布局 + 边路由），jsdom 下开销过大。
 *
 * 对后续拆分 `StageContent` 的启示：
 * 想给面板区建立回归保护，不能靠整体渲染，要走两条路——
 *   1. 抽出的 hook 单独测（renderHook，见 tests/useDocumentActions.test.tsx 模式）
 *   2. 单个面板组件分别测（它们本来就在 packages/react 且有测试环境）
 *
 * app 层的地板由 smoke.test.tsx 提供（模块可加载 + jsdom 生效 + alias 指向源码）。
 */
import { describe, it } from 'vitest';

describe.skip('MindmapStage 整体渲染（jsdom 下挂起，停用）', () => {
  it('能在 jsdom 中挂载且不抛错', () => {
    // render(<MindmapStage />) —— 实测会 SIGTERM，勿启用
  });

  it('挂载后产出 SVG 画布容器', () => {
    // 同上
  });
});
