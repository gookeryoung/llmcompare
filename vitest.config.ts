import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 服务端（纯 node）与前端（React / DOM）分项目跑，各自用对的环境
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.mjs'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['web/src/test/setup.ts'],
          include: ['web/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
    // 覆盖率只对「纯逻辑层」设门槛：
    //   web/src/lib/** 与 api.ts 无副作用、易测，值得卡死；
    //   服务端与 React 组件分别由 test:api / e2e 用真实进程与浏览器覆盖，
    //   放进 Istanbul 口径的数字里只会自欺欺人。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['web/src/lib/**/*.ts', 'web/src/api.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
