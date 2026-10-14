# Makefile - AI 模型工作台快捷命令
# 运行 `make help` 查看所有可用命令
#
# 约定（与个人项目 cndb 保持一致）：
#   * 目标说明写成行尾 `## 说明`，由 scripts/help.mjs 渲染；
#   * 复杂逻辑一律下沉到 scripts/*.mjs，Makefile 只做编排，
#     避免 `make -> shell` 两层转义把正则/引号搞坏，也保证 Windows 与 Linux 行为一致；
#   * `clean c` 取 clean 的语义（与 cndb 一致），全量门禁是 `check`（无短别名）。

PORT ?= 8787
NODE := node
PNPM := pnpm

# 并行度：Windows 取 NUMBER_OF_PROCESSORS，其余用 nproc；低核机器保守降档
ifeq ($(OS),Windows_NT)
CPUS := $(NUMBER_OF_PROCESSORS)
else
CPUS := $(shell nproc 2>/dev/null || echo 4)
endif
JOBS := $(if $(filter 0 1,$(CPUS)),2,$(if $(filter 2 3,$(CPUS)),4,8))

.DEFAULT_GOAL := help

.PHONY: help sync s dev d dev-api dev-web build b start serve typecheck tc lint l lint-fix \
        test-unit u test-api ta test-ui tu test t check-fast cf check \
        shots clean c kill-port doctor push

help: ## 显示所有可用命令
	@$(NODE) scripts/help.mjs $(MAKEFILE_LIST)

# ── 环境 ─────────────────────────────────────────────────────

sync s: ## 按 lockfile 安装依赖（pnpm install --frozen-lockfile）
	$(PNPM) install --frozen-lockfile

doctor: ## 环境体检（Node / pnpm / 依赖 / 数据目录 / 端口 / 浏览器）
	@$(NODE) scripts/doctor.mjs

# ── 开发与运行 ───────────────────────────────────────────────

dev d: ## 开发模式：API(:8787) + Vite(:5173) 热更新
	$(PNPM) run dev

dev-api: ## 仅启动 API 服务
	$(PNPM) run dev:api

dev-web: ## 仅启动 Vite 开发服务器（需另开一个终端跑 dev-api）
	$(PNPM) run dev:web

build b: ## 构建前端产物到 web/dist
	$(PNPM) run build

start serve: ## 启动生产服务（API + 已构建前端，默认 :8787）
	$(PNPM) run start

# ── 静态检查 ─────────────────────────────────────────────────

typecheck tc: ## TypeScript 类型检查
	$(PNPM) run typecheck

lint l: ## ESLint 检查
	$(PNPM) run lint

lint-fix: ## ESLint 自动修复
	$(PNPM) run lint:fix

check-fast cf: typecheck lint ## 快速静态门禁（只做类型与风格，适合开发中反复跑）

# ── 测试 ─────────────────────────────────────────────────────

test-unit u: ## 单元测试（vitest，带覆盖率门槛）
	$(PNPM) run test:unit

test-api ta: ## 接口端到端测试（自动拉起隔离实例，不读写 data/）
	$(PNPM) run test:api

test-ui tu: ## 浏览器 UI 测试（自动构建 + 隔离实例 + 无头 Chrome）
	$(PNPM) run test:ui

test t: test-unit test-api test-ui ## 跑全部测试

# 全量门禁。三条测试互相独立，`make -j$(JOBS) check` 可并行提速；
# 默认串行是为了让失败点一眼可见（并行时输出会交错）。
check: check-fast test ## 全量门禁（静态检查 + 单元 + 接口 + UI）

# ── 维护 ─────────────────────────────────────────────────────

shots: ## 重新生成 docs/screenshots 下的界面截图
	$(PNPM) run shots

clean c: ## 清理构建产物与缓存（绝不动 data/）
	@$(NODE) scripts/clean.mjs

kill-port: ## 释放被占用的端口（make kill-port PORT=8788）
	@$(NODE) scripts/kill-port.mjs $(PORT)

push: ## 推送当前分支与标签到所有远程仓库
	@$(NODE) scripts/push.mjs
