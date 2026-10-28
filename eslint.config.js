// ESLint 扁平配置 —— 覆盖 React + TypeScript 前端与 Node 脚本
// 运行: make lint（检查） | make lint-fix（自动修复）
//
// 目录职责：
//   web/src/**         浏览器环境 + React 规则
//   server|scripts/**  Node 环境
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const UNUSED_VARS = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'web/dist/**',
      'dist/**',
      'data/**',
      '.tmp/**',
      '.venv/**',
      'coverage/**',
      'htmlcov/**',
      'docs/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── 前端：React + TypeScript ────────────────────────────────
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      // Provider 文件同时导出 Context 与自定义 hook 是刻意设计
      'react-refresh/only-export-components': 'off',

      // React Compiler 视角的规则：本项目的取数模式是「挂载后异步拉取 → setState」
      // 以及「从 context/草稿同步一次性初值」，都属于官方认可的外部系统同步场景，
      // 但规则无法区分「同步 setState」与「await 之后的 setState」。
      // 全项报错会逼着把可用代码改成 compiler 风格，收益不抵风险，故降为 warn 保留可见性。
      'react-hooks/set-state-in-effect': 'warn',

      '@typescript-eslint/no-unused-vars': UNUSED_VARS,
      // 上游返回的宽松 JSON 与 catch(err) 处理中 any 是务实选择
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // 允许 `catch {}` 形式的静默忽略（本项目统一写成 `catch { /* 原因 */ }`）
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // ── 后端与脚本：Node ESM ────────────────────────────────────
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': UNUSED_VARS,
      '@typescript-eslint/no-explicit-any': 'off',
      // 探测型脚本里用空 catch 表达「这条路径不通」是可读的
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },

  // ── 构建期 TS 配置与测试 ────────────────────────────────────
  {
    files: ['*.ts', 'web/vite.config.ts', 'vitest.config.ts', '**/*.test.{ts,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': UNUSED_VARS,
    },
  },
);
