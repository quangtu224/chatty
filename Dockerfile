# Pin the Node 24 base; upgrade this digest deliberately with a verified release.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ARG RELEASE_SHA=development
ENV NODE_ENV=production PORT=3000 RELEASE_SHA=$RELEASE_SHA
LABEL org.opencontainers.image.revision=$RELEASE_SHA
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY src/model.js ./src/model.js
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs
# Public Supabase root CA (no secret): DATABASE_URL can use sslrootcert=/app/certs/supabase-ca.crt.
COPY certs ./certs
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=6s --start-period=15s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "server/index.js"]
