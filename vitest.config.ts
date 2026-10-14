import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/src/**/*.test.ts', 'server/**/*.test.mjs'],
    // 覆盖率只对「纯逻辑层」设门槛：
    //   web/src/lib/**  无副作用、易测，值得卡死；
    //   服务端与 React 组件分别由 test:api / test:ui 用真实进程与浏览器覆盖，
    //   放进 Istanbul 口径的数字里只会自欺欺人。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['web/src/lib/**/*.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
