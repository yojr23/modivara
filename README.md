# Modivara

Monorepo del MVP (pnpm workspaces). Destino: cuatro repositorios (`platform-core`, `hospitality-ops`, `commerce`, `analytics`); ver ADR-002 D1.

Documentación de arquitectura en `../documentos/` (ADR-001, ADR-002, TECH-001 v1.3, DATA-001, BRAND-002).

## Desarrollo

Requisitos: Node 24 y pnpm 10 (`corepack enable`). Docker para la demo completa.

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm check:separability   # cada dominio compila y pasa sus pruebas aislado (ADR-002 D1)
pnpm --filter @modivara/portal dev
```

## Demo local con Docker

```bash
cp .env.example .env        # ajustar contraseñas locales
# Usuarios del broker MQTT (el archivo passwd no se versiona):
docker compose run --rm mqtt mosquitto_passwd -c -b /mosquitto/config/passwd api <clave-api>
docker compose up --build
```

Portal en `http://localhost`, API en `http://localhost/api/v1/health`, simulador en `http://<ip-del-pc>/sim` desde el celular (misma Wi‑Fi).

## Estructura

```text
apps/api          host NestJS: solo compone los módulos de dominio
apps/portal       SPA React
apps/button-sim   simulador de gateway (proceso aparte, HTTP/MQTT)
domains/<d>/{api,web,contracts}   d ∈ core, hospitality, commerce, analytics
```

Dentro de cada `domains/<d>/api/src`: `domain/`, `application/` (casos de uso + `ports/`), `infrastructure/`, `presentation/` (TECH-001 §5 v1.3).
