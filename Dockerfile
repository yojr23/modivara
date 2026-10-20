# Una sola imagen de build para el monorepo; un target por app (api, web, button-sim).
FROM node:24.22.0-alpine3.24 AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# ponytail: copia el workspace completo con dependencias de desarrollo; pasar a `pnpm deploy --prod` cuando importe el tamaño de imagen.
FROM base AS api
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM base AS button-sim
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/button-sim
USER node
EXPOSE 4000
CMD ["node", "src/main.ts"]

FROM caddy:2.11.7 AS web
COPY infra/caddy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/portal/dist /srv
