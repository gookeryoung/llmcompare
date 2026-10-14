# ─────────────────────────────────────────────────────────────
# 构建阶段：只装依赖并产出 web/dist
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS web

WORKDIR /app

# 显式安装 pnpm：Node 25 起发行版不再内置 corepack，
# 这里不依赖 corepack，保证镜像行为与版本号可预期
RUN npm i -g pnpm@12.4.2

# 先复制清单文件，让依赖层在源码变动时仍能命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY web ./web
RUN pnpm run build

# ─────────────────────────────────────────────────────────────
# 运行阶段：服务端零运行时依赖，镜像里不需要 node_modules
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY --from=web /app/web/dist ./web/dist

# 数据目录需要可写：模型配置（含 API Key）、题库、评测记录都在这里
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
