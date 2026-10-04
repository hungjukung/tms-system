# 從 repo 根目錄建置（pnpm workspace monorepo，需要看到 packages/shared）：
#   docker build -f apps/api/Dockerfile -t tms-api .
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /repo

FROM base AS deps
# bcrypt 在沒有對應平台預編譯檔時會退回原始碼編譯，裝好工具鏈避免安裝失敗
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tms/shared build && pnpm --filter @tms/api build

FROM base AS runtime
ENV NODE_ENV=production
# 容器預設時區是 UTC，若不指定會導致每日/每月/年度結帳的日期邊界跟台灣時間差 8 小時
ENV TZ=Asia/Taipei
COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist

WORKDIR /repo/apps/api
EXPOSE 8080
CMD ["node", "dist/main.js"]
