# Quest City Web API — OCI container (07_06 §4: images built in CI, digest-pinned,
# never `latest` in production). Build context is the monorepo root:
#   docker build -f infrastructure/containers/api.Dockerfile -t quest-city-web-api .
#
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc* ./
COPY apps/api/package.json apps/api/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @quest-city-web/api...

FROM deps AS build
COPY . .
RUN pnpm --filter @quest-city-web/api... run build

FROM base AS runtime
ENV NODE_ENV=production
# npm (bundled with the node:24-slim base image) is never invoked at
# runtime -- this container only ever runs `node apps/api/server.js` --
# but its own bundled dependencies (tar/ip-address/undici, none of them
# reachable from application code) carry real CVEs that a container scan
# flags regardless of whether npm itself is ever executed. Removing it is
# a real reduction in shipped attack surface, not a scanner workaround.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build /workspace/apps/api/.next/standalone ./
COPY --from=build /workspace/apps/api/.next/static ./apps/api/.next/static
COPY --from=build /workspace/apps/api/public ./apps/api/public
USER node
EXPOSE 4000
ENV PORT=4000
# Docker injects HOSTNAME=<container-id> into every container; Next.js's
# standalone server.js binds to process.env.HOSTNAME when set, which would
# otherwise make it unreachable via localhost/127.0.0.1 inside the container
# (only via the container's network IP) and fail the compose healthcheck.
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/api/server.js"]
