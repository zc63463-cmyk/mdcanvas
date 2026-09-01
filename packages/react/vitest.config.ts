import { defineConfig } from 'vitest/config';

/** @mindcanvas/react 测试配置（K3：主题令牌 + 渲染核心 + 翻卡组件；jsdom 用于交互组件） */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
