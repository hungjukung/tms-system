# 從 repo 根目錄建置（pnpm workspace monorepo，需要看到 packages/shared）：
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.<你的網域>/api -t tms-web .
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @tms/shared build && pnpm --filter @tms/web build

FROM node:22-slim AS runtime
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /repo/apps/web/dist ./dist
EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
