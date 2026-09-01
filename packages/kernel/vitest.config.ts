import { defineConfig } from 'vitest/config';

/**
 * kernel 测试配置。
 * K0 阶段从 T2 起逐步补充单测；passWithNoTests 保证「暂无测试文件」时 test 门禁仍绿，
 * K1 移植协议层 326 测试后移除该可选项。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
