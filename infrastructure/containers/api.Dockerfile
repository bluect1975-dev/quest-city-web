# Quest City Web API — OCI container (07_06 §4: images built in CI, digest-pinned,
# never `latest` in production). Build context is the monorepo root:
#   docker build -f infrastructure/containers/api.Dockerfile -t quest-city-web-api .
#
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @quest-city-web/api...

FROM deps AS build
COPY . .
RUN pnpm --filter @quest-city-web/api... run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/apps/api/.next/standalone ./
COPY --from=build /workspace/apps/api/.next/static ./apps/api/.next/static
COPY --from=build /workspace/apps/api/public ./apps/api/public
USER node
EXPOSE 4000
ENV PORT=4000
CMD ["node", "apps/api/server.js"]
