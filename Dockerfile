# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/localization/package.json packages/localization/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/database/package.json packages/database/
COPY apps/server/package.json apps/server/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl wget
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# Migratsiyalar har startda idempotent qo'llanadi
CMD ["sh", "-c", "npm run db:migrate && node apps/server/dist/main.js"]
