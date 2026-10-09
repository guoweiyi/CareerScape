# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.16.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV CI=true NUXT_TELEMETRY_DISABLED=1
# Native modules are installed for Linux in this stage; never copy host node_modules.
# node-gyp's Unix requirements: Python, make and a C/C++ compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN --mount=type=cache,id=careerscape-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm build
# Verify Nitro traced both native runtime dependencies and their Linux binaries.
RUN cd apps/web/.output/server \
    && node --input-type=module -e "import Database from 'better-sqlite3'; import argon2 from 'argon2'; const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); const encoded = await argon2.hash('build-native-smoke'); if (!await argon2.verify(encoded, 'build-native-smoke')) process.exit(1)"

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    AI_PROVIDER=mock \
    DATABASE_PATH=/data/careerscape.sqlite \
    ASSET_PUBLIC_DIR=/app/public \
    NUXT_TELEMETRY_DISABLED=1
RUN mkdir -p /data && chown node:node /data && chmod 0750 /data
COPY --from=build /src/apps/web/.output/ /app/
COPY scripts/container-admin.mjs /app/server/container-admin.mjs
COPY scripts/container-db.mjs /app/server/container-db.mjs
COPY ASSET_LICENSES.md /app/ASSET_LICENSES.md
# Fresh named volumes inherit /data ownership. Existing volumes must be writable
# by UID/GID 1000; permissions are never widened or recursively rewritten here.
VOLUME ["/data"]
USER node:node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
    CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(4000) }); if (!r.ok || (await r.json()).status !== 'ok') process.exit(1)"]
CMD ["node", "/app/server/index.mjs"]
