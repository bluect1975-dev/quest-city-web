# Quest City Web dashboard — OCI container. Build context is the monorepo root:
#   docker build -f infrastructure/containers/dashboard.Dockerfile -t quest-city-web-dashboard .
#
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @quest-city-web/dashboard...

FROM deps AS build
COPY . .
RUN pnpm --filter @quest-city-web/dashboard... run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/apps/dashboard/.next/standalone ./
COPY --from=build /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /workspace/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3001
ENV PORT=3001
# Docker injects HOSTNAME=<container-id> into every container; Next.js's
# standalone server.js binds to process.env.HOSTNAME when set, which would
# otherwise make it unreachable via localhost/127.0.0.1 inside the container.
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/dashboard/server.js"]
