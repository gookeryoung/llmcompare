# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- `Makefile`：`make help` 列出全部命令；`check` 为全量门禁，`check-fast` 为开发中快速反馈。
- `scripts/with-server.mjs`：测试夹具，用**独立端口 + `.tmp/e2e-data` 数据目录**拉起隔离实例，
  `pnpm test:api` / `pnpm test:ui` 不再依赖手动启动的服务，也不会读写真实的 `data/`。
- 单元测试层（vitest）：`web/src/lib/**` 覆盖率门槛 85%，服务端 CSV 与地址归一化亦有用例。
- ESLint 10 扁平配置，覆盖 `web/src`（React）与 `server` / `scripts`（Node）。
- 工程配置：`.editorconfig`、`.gitattributes`、`.npmrc`、`.env.example`、`.pre-commit-config.yaml`。
- GitHub Actions CI、Dependabot、`Dockerfile`（运行阶段零 `node_modules`）。
- `CONTEXT.md` 领域词汇表与 `docs/adr/` 架构决策记录。
- 运维脚本：`doctor`（环境体检）、`kill-port`（释放被占用端口）、`clean`（安全清理，绝不动 `data/`）。

### 变更

- 服务端支持 `.env`（自带零依赖加载器，不覆盖已有环境变量）。
- 端口被占用时输出可执行的排查建议，不再抛裸堆栈。
- UI 测试与截图脚本改用 `scripts/lib/chrome.mjs` 跨平台定位浏览器，支持 `CHROME_PATH` 与 CI 无沙箱环境。

### 修复

- `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`：`pnpm-workspace.yaml` 中 esbuild 的白名单此前是占位提示，
  已改为有效的 `allowBuilds: { esbuild: true }`。
- UI 测试原先假定「默认全选恰好 3 个模型」，使用者已有模型时会误报失败；现改为显式收敛到本次创建的模型。

## [1.0.0] - 2026-10-14

### 新增

- 模型接入：OpenAI 兼容 / Anthropic / Gemini / Ollama / 内置模拟，含连接测试与模型列表拉取。
- 对话：多会话、流式输出、Markdown 与代码高亮、思考过程折叠、首字与成本指标、重新生成。
- 题库管理：多题库、题目 CRUD、难度与标签、JSON/CSV 导入、JSON/CSV/Markdown 导出。
- 横向对比：同一问题并行跑 N 个模型，并排/指标/表格三视图、同步滚动、星级评分与备注、AI 裁判、导出与记录留存。
- 概览与评测记录页面，全部数据保存在本机 `data/`。

[Unreleased]: https://example.com/dsh-model-tester/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/dsh-model-tester/releases/tag/v1.0.0
