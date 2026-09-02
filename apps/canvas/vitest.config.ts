import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * apps/canvas 测试配置。
 *
 * 合并 vite.config.ts 以复用 @mindcanvas 各包 → src 的 alias ——
 * 不加 alias 会解析到 packages 下的 dist 构建产物，测到陈旧代码（与浏览器同坑）。
 * jsdom：应用层组件需要 DOM 环境。
 *
 * 注意：块注释内不要写「星号紧跟斜杠」的字面组合，它会提前终止注释。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
    },
  }),
);
