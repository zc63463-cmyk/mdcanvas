import { CHROME, ErrorBoundary } from '@mindcanvas/react';
import MindmapStage from './MindmapStage';

/**
 * apps/canvas：应用组合入口（app = kernel 数据 + react 渲染器 + 玻璃 chrome 壳）。
 * 全屏深色玻璃外壳（ADR-0003 决策 3：外壳恒定，画布主题可换）。
 */
export default function App() {
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: CHROME.bg,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
      }}
    >
      <ErrorBoundary>
        <MindmapStage />
      </ErrorBoundary>
    </main>
  );
}
