# Quest City Web student-web — OCI container. Build context is the monorepo root:
#   docker build -f infrastructure/containers/student-web.Dockerfile -t quest-city-web-student-web .
#
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc* ./
COPY apps/student-web/package.json apps/student-web/package.json
COPY packages ./packages
# BuildKit cache mount for pnpm's content-addressable store: see
# api.Dockerfile for why this is needed (persists independently of image
# layer caching / `docker compose down -v` between verify.sh runs).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @quest-city-web/student-web...

FROM deps AS build
COPY . .
RUN pnpm --filter @quest-city-web/student-web... run build

FROM base AS runtime
ENV NODE_ENV=production
# npm (bundled with the node:24-slim base image) is never invoked at
# runtime -- this container only ever runs `node apps/student-web/server.js`
# -- but its own bundled dependencies (tar/ip-address/undici, none of them
# reachable from application code) carry real CVEs that a container scan
# flags regardless of whether npm itself is ever executed. Removing it is
# a real reduction in shipped attack surface, not a scanner workaround.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build /workspace/apps/student-web/.next/standalone ./
COPY --from=build /workspace/apps/student-web/.next/static ./apps/student-web/.next/static
COPY --from=build /workspace/apps/student-web/public ./apps/student-web/public
USER node
EXPOSE 3000
ENV PORT=3000
# Docker injects HOSTNAME=<container-id> into every container; Next.js's
# standalone server.js binds to process.env.HOSTNAME when set, which would
# otherwise make it unreachable via localhost/127.0.0.1 inside the container.
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/student-web/server.js"]
