# Makefile - llmcompare project shortcuts (front-end + API full-stack)
# Run `make help` to list all available commands.
# 约定：本文件只做命令编排，跨平台 / 多行逻辑放 scripts/，保证目标一眼可读。

.DEFAULT_GOAL := help

# dev 目标绑定地址/端口，可在命令行覆盖：make dev DEV_PORT=8787 WEB_PORT=5173
DEV_HOST ?= 127.0.0.1
DEV_PORT ?= 8787
WEB_PORT ?= 5173
# `make dev` 启动前释放的端口：API 后端 DEV_PORT + Vite WEB_PORT（见 scripts/dev.mjs）
DEV_PORTS ?= $(DEV_PORT) $(WEB_PORT)

# 前端依赖 stamp：pnpm install 成功后由 make 刷新，lock / package.json 未变时零开销跳过
DEPS_STAMP := node_modules/.make-sync

.PHONY: help sync free-dev-ports dev start build lint typecheck test test-api test-ui \
        gitkeep-check adr-check check-docs check-fast flow check clean doctor kill-port doc \
        docker push bump patch minor major

# ── 开发 ──────────────────────────────────────────────────────────────

help: ## 显示帮助信息
	@node scripts/help.mjs $(MAKEFILE_LIST)

sync: $(DEPS_STAMP) ## 安装依赖（pnpm；lock / package.json 未变时跳过）

$(DEPS_STAMP): package.json pnpm-lock.yaml
	pnpm install --frozen-lockfile
	@touch $(DEPS_STAMP)

free-dev-ports: ## 结束占用开发端口的旧进程（API $(DEV_PORT) / Web $(WEB_PORT)；可用 DEV_PORTS 覆盖）
	@node scripts/kill-port.mjs $(DEV_PORTS)

dev: free-dev-ports $(DEPS_STAMP) ## 开发模式：先释放旧端口，再同时启动 API 与 Vite（Ctrl+C 一起停）
	PORT=$(DEV_PORT) WEB_PORT=$(WEB_PORT) WEB_HOST=$(DEV_HOST) node scripts/dev.mjs

start: ## 生产模式：单进程同时服务 /api/* 与 web/dist 静态资源
	@pnpm start

kill-port: ## 释放端口（默认 PORT 或 8787；用法: make kill-port PORT=8787）
	@node scripts/kill-port.mjs $(PORT)

# ── 构建 ──────────────────────────────────────────────────────────────

build: $(DEPS_STAMP) ## 构建前端（Vite，产物输出到 web/dist/）
	@pnpm build

# ── 质量门禁 ──────────────────────────────────────────────────────────

lint: ## 代码风格检查（ESLint，带缓存）
	@pnpm lint

typecheck: ## 类型检查（tsc --noEmit）
	@pnpm typecheck

test: ## 单元测试 + 覆盖率（vitest，含 web/src/lib 覆盖率门槛）
	@pnpm test:unit

test-api: build ## API 冒烟测试（自动起隔离后端）
	@pnpm test:api

test-ui: build ## UI 冒烟测试（构建后起服务用浏览器检查）
	@pnpm test:ui

gitkeep-check: ## 校验占位目录未被清空（空目录须有 .gitkeep）
	@uv run python -c "import pathlib,sys;ds=[p for p in map(pathlib.Path,['docs/adr','docs/requirements','docs/_static']) if p.is_dir()];bad=[str(p) for p in ds if not any(p.iterdir())];[print('gitkeep-check: 空目录缺少 .gitkeep -> '+b) for b in bad];print('gitkeep-check: 通过') if not bad else None;sys.exit(1 if bad else 0)"

adr-check: ## 校验 ADR 编号/命名与索引登记
	@uv run python -c "import pathlib,re,sys;d=pathlib.Path('docs/adr');fs=[p for p in sorted(d.glob('*.md')) if p.name not in ('README.md','template.md')] if d.is_dir() else [];ns=[p.name for p in fs];idx=(d/'README.md').read_text(encoding='utf-8') if (d/'README.md').is_file() else '';dups=sorted({n[:4] for n in ns if sum(m[:4]==n[:4] for m in ns)>1});bad=[f'{n}: 文件名应为 NNNN-<topic>.md' for n in ns if not re.fullmatch(r'\d{4}-[\w-]+\.md',n)]+[f'编号 {x} 重复' for x in dups]+(['docs/adr/README.md 缺失'] if fs and not (d/'README.md').is_file() else [])+[f'{n}: 未登记到 docs/adr/README.md 索引' for n in ns if n not in idx];[print('adr-check: '+b) for b in bad];print(f'adr-check: 通过（{len(fs)} 个 ADR）') if not bad else None;sys.exit(1 if bad else 0)"

# L0 文档改动：只跑文档级校验
check-docs: gitkeep-check adr-check ## L0 文档门禁（gitkeep-check + adr-check）
# L1 配置改动：轻量静态门禁（无测试）
check-fast: gitkeep-check adr-check lint typecheck ## L1 配置/内环门禁（gitkeep + adr + lint + typecheck）
# L2 代码改动：轻量静态门禁 + 全量单测
flow: check-fast test ## L2 代码门禁（check-fast + test）

check: check-fast test-api ## 全量门禁（check-fast + test + test-api）

# ── 工具 ──────────────────────────────────────────────────────────────

clean: ## 清理构建产物、缓存与依赖
	@node scripts/clean.mjs

doctor: ## 环境自检（node/pnpm 版本、端口占用等）
	@node scripts/doctor.mjs

doc: ## 构建 Sphinx 文档
	@uv run sphinx-build -b html docs docs/_build/html

# ── 发布 / 推送 ────────────────────────────────────────────────────────

push: ## 推送当前分支到全部 remote（含 tags；可用 make push REMOTES="origin github" 指定）
	@node scripts/push.mjs $(REMOTES)

BUMP_PART := $(filter-out bump,$(MAKECMDGOALS))

bump: ## 版本号 bump（默认 patch，用法: make bump [minor|major]，自动提交并打 tag）
	@pnpm version $(if $(BUMP_PART),$(firstword $(BUMP_PART)),patch)

patch minor major:
	@:

docker d: ## 构建生产镜像（多阶段：pnpm build → node 运行）
	docker build -t llmcompare:latest .
