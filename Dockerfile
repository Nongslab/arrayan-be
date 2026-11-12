# syntax=docker/dockerfile:1
# Image production Arryan HRIS API — lihat docs/DEPLOYMENT.md
ARG NODE_IMAGE=node:22-alpine

# --- base: OpenSSL dibutuhkan Prisma engine di Alpine ---------------------------
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache openssl
WORKDIR /app

# --- build: compile TypeScript (app + seed) -------------------------------------
FROM base AS build
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.seed.json ./
COPY src ./src
RUN npm run build && npx tsc -p tsconfig.seed.json

# --- prod-deps: hanya dependency runtime (+ Prisma CLI untuk migrate deploy) ----
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate

# --- runtime ---------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod 0755 ./entrypoint.sh

# Jalan sebagai user non-root bawaan image node
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/server.js"]
