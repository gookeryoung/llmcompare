# CI/容器化用 Dockerfile —— 多阶段：构建前端 → 轻量运行时
# 使用国内镜像源拉取基础镜像（如不需要可替换为官方镜像）
# 备选镜像源前缀：docker.1ms.run / dockerpull.com / docker.xuanyuan.me
FROM docker.m.daocloud.io/node:22-slim AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY web ./web
RUN pnpm build

# ---- 运行时：server 零依赖（纯 node 内置模块），无需 node_modules ----
FROM docker.m.daocloud.io/node:22-slim

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

WORKDIR /app
COPY --from=build /app/web/dist ./web/dist
COPY server ./server

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8787
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/models').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
