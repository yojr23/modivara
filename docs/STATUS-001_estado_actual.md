# STATUS-001 — Estado actual del proyecto

> **Fuente única de «qué está hecho, en curso y próximo».** Corte: commit `197b260` de `main` (03/11/2026); §0 y §2 al día con el corte del 09/11/2026 (`main` `0349945` + PR `fix/auditoria-11-09`). Cuando otro documento diga algo distinto, vale este (y si este se equivoca, se corrige aquí).
> **Históricos (no se editan, no son estado):** `docs/HANDOFF.md` (sesión nocturna del 19/10), `docs/NOCHE-LOG.md` (bitácora de esa sesión y siguientes hasta el 28/10) y `docs/E2E-HALLAZGOS.md` (informe de la primera suite, 30/10). Sus «pendientes» ya no son vigentes; las excepciones están en «Pendiente» más abajo.
> **Siguen siendo vivos pero solo para lo suyo:** `PLAN-001` (tareas y criterios; sus notas «Estado» son una bitácora por fecha), `PLAN-002` (diseño de pantallas), `docs/PORTAL.md` (mapa del frontend), `BACKLOG-001` (mejoras; sección M = traza), `DATA-001` (decisión) y `DATA-002` (as-built).
> **Cómo se comprobó:** leyendo el repo en ese commit (rutas, specs, migraciones, `git merge-base --is-ancestor`). No se corrieron pruebas para escribir este documento; las cifras de pruebas son las que reporta la traza `BACKLOG-001 M.5` y se marcan como tales.

## 0. Corte 09/11/2026

- **Flujo de ramas:** `main` y `pruebas` están protegidas en GitHub (ruleset «main y pruebas: solo por PR»): todo cambio entra por PR, sin push directo, force-push ni borrado. No exige aprobaciones (un solo responsable).
- **CI en verde por primera vez** (`0349945`). Nunca había pasado en GitHub: sin `.env`, `docker compose` fallaba al interpolar `SIM_GATEWAY_KEY:?` aunque solo levanta `db-test`; el workflow ahora copia `.env.example` antes de `test:integration`. Integración 775/775 en local y en un clon limpio. Playwright sigue fuera de CI (QA-02).
- **Dependabot:** subidas menores aplicadas (Nest 12.3.2, react-query 5.105.0, vite 8.3.5, acciones checkout/setup-node 7 y pnpm/action-setup 5). Node se queda en 24 en CI, `.nvmrc` y `Dockerfile`; las mayores de `node` y `@types/node` se ignoran en `.github/dependabot.yml` y se suben a mano en los tres sitios a la vez.
- **Auditoría del 09/11** (detalle en `BACKLOG-001` M.8): sin agujeros de seguridad nuevos; `pnpm audit` sin vulnerabilidades. Arreglados: rótulos de métricas en la zona del navegador y clave de idempotencia de stock reutilizada con otros datos.

## 1. Hecho

### Por dominio

| Dominio | Qué hay | Evidencia |
|---|---|---|
| `core` | Organizaciones, locales, usuarios, membresías con roles por local, sesiones, entitlements, superadmin (organización `is_platform`), `audit_log`, outbox. Limitador de login por IP (solo cuentan los fallos, SEC-05). Auditoría de acciones de plataforma recibida por evento (SEC-06). | `domains/core/api/src` (37 archivos `*.test.ts`, 14 de ellos `*.int.test.ts`); migraciones `0001_init`, `0002_outbox_events`; `e2e/auth.spec.ts`. |
| `hospitality` | Zonas, mesas, gateways, botones y asignaciones; ingesta HTTP y MQTT con debounce y bloqueo por botón/mesa (ARC-03); llamados con transiciones; outbox y realtime Socket.IO; planos (borrador, publicación, archivados) con validación de áreas solapadas y elementos fuera del lienzo al publicar (ARC-01/02); desactivar mesas, espacios y gateways. | `domains/hospitality/api/src` (39 / 12 int); migraciones `0001`–`0003`; `concurrency.int.test.ts`, `layouts-api.int.test.ts`, `mqtt.int.test.ts`; `e2e/service-call.spec.ts`, `spaces.spec.ts`, `mqtt.spec.ts`, `console.spec.ts`. |
| `commerce` | Productos, lugares de stock, motivos, saldos (CHECK `quantity >= 0`), movimientos idempotentes, historial con cursor `(occurred_at, id)` y filtros en servidor (DAT-03), `actor_name`. | `domains/commerce/api/src` (14 / 5 int); migraciones `0001`, `0002`; `e2e/inventory.spec.ts`, `inventory-settings.spec.ts`. |
| `analytics` | Proyección de llamados y movimientos desde eventos (tolerante a desorden, deduplicada por `processed_events`), métricas de llamados por periodo/zona/mesa y de inventario con `by_product`; `total_delta` es `null` si se mezclan productos (ARC-05). Sin outbox propio. | `domains/analytics/api/src` (9 / 6 int); `apps/api/src/e2e/analytics-rebuild.int.test.ts`; `e2e/metrics.spec.ts`. |
| Transversal | Host `apps/api` que solo compone módulos; `check:separability` con reglas de capas; CI en `.github/workflows/ci.yml` (build, typecheck, separabilidad, `pnpm audit` críticos, unitarias, integración); plantillas de PR/issues; Dependabot; salud `/health/live` y `/health/ready`; producción con HTTPS, cabeceras de seguridad y sin `/sim` (`docker-compose.prod.yml`, `infra/caddy/Caddyfile.prod`); límite de 256 kb en JSON; reintento manual del outbox (`apps/api/src/outbox-retry.ts`). | Archivos citados; `BACKLOG-001` M.3 y M.5. |

### Por pantalla (portal)

Todas funcionan contra la API real (no hay datos simulados) y están en `apps/portal/src/app/`. Detalle de datos y hooks: `docs/PORTAL.md`.

| Ruta | Archivo | E2E |
|---|---|---|
| `/` (portada) y `/<negocio>` (login) | `routes/` | `e2e/auth.spec.ts` |
| `/<negocio>/app/tablero` | `Board.tsx` | `service-call.spec.ts` |
| `/<negocio>/app/historial` | `History.tsx` | `history.spec.ts` |
| `/<negocio>/app/espacios` | `Spaces.tsx`, `editor-kit.tsx`, `Deactivate.tsx` | `spaces.spec.ts` |
| `/<negocio>/app/metricas` | `Metrics.tsx` | `metrics.spec.ts` |
| `/<negocio>/app/inventario` (+ «Lugares y motivos») | `Inventory.tsx`, `InventorySettings.tsx` | `inventory.spec.ts`, `inventory-settings.spec.ts` |
| `/<negocio>/app/usuarios` | `Users.tsx` | `users.spec.ts` |
| `/labs/app/consola` | `Console.tsx` | `console.spec.ts` |
| Simulador de botones (`/sim/`, solo demo) | `apps/button-sim` | Sin E2E propio: `apps/button-sim/src/simulator.test.ts` (unitaria); los E2E pulsan por `POST /device-events` y `mosquitto_pub`, no por el simulador |

Pantallazos de cada vista y usuario: `e2e/screens.spec.ts` → `docs/pantallazos/`.

### Pruebas (cifras de la traza, no recomprobadas)

- `BACKLOG-001 M.5`: al integrar `backlog/ronda-2`, `pnpm build`, `typecheck`, `check:separability`, unitarias, integración 306/306 y E2E 24/24 sobre la demo recreada.
- En el repo hay hoy 26 casos E2E declarados en `e2e/*.spec.ts` (conteo por `grep` de `test(`/`it(`); la diferencia con 24 es de `screens.spec.ts` y la portada, añadidos con `875723a`. **No se confirmó que los 26 pasen**: el E2E y la integración los corre quien audita (no los corre CI).

### Hitos de PLAN-001 §7 (verificación «demo mostrable»)

H1 a H10 tienen pantalla y, salvo H8, E2E según la tabla anterior; H8 (simulador en celular por HTTP y MQTT) tiene `mqtt.spec.ts` para MQTT, pero la prueba en un celular físico no queda registrada en el repo. H9 (`docker compose up` + seed) lo verificó la sesión del 27 y 30/10 según PLAN-001.

## 2. En curso

- Nada en curso. Las rondas 2, 3 y 4 (`ronda4/auditoria-visual`) están en `main`; ninguna rama del repositorio tiene commits fuera de `main` salvo las de Dependabot (comprobado con `git rev-list --count origin/main..<rama>` el 09/11/2026). La traza de cada ronda está en `BACKLOG-001` sección M (M.8: corte del 09/11).

## 3. Pendiente / siguiente

Lo que `BACKLOG-001 M.5` deja fuera de la ronda 2, sin cambios de estado desde entonces:

| Tema | Tickets |
|---|---|
| Operación | SEC-03 (backups: no existe `scripts/backup.sh` ni restauración ensayada), SEC-09 (rol migrador separado e imagen mínima), QA-02/03/05/08/09/10 |
| Hardware real | SEC-04 (transporte seguro del gateway), PLAN-001 F6-08 y Q-01; ver `ADR-004` (propuesto) |
| Seguridad | SEC-07/QA-06 (matriz negativa completa) |
| Dominio | ARC-06/DAT-08 (semántica histórica de áreas; ver `ADR-004` (c)), ARC-07/08, PAT-03 |
| UX | UX-02 (toca `editor-kit.tsx`), UX-10, UX-11 |
| Producto | MOD-05, MOD-07 |
| Gobernanza | DOC-01 (visibilidad del repositorio: no verificable sin `gh`), DOC-02/03/04 (esta ronda) |
| Fase 6 de PLAN-001 | Sin evidencia de cierre en el repo: F6-03 a F6-06 (parcial: cabeceras y límites de SEC-08/10), F6-09, F6-11 a F6-14. F6-07 (VPS): el compose de producción existe; que haya un despliegue real no es comprobable desde el repo. |
| Auditoría 09/11 | Decidir qué es «gateway en uso» al desactivarlo (hoy: último gateway activo del local con botones asignados; `OPEN` en `gateways.ts`). Cada aviso en tiempo real revalida sesión y permisos de cada socket: suficiente para un bar, cachear si crece el número de locales (`realtime-broadcaster.ts`). |
| Decisiones del responsable aún abiertas | Q-01 (hardware), Q-03 (criterios del piloto), hallazgo C de E2E-HALLAZGOS (admin que no puede desactivar un usuario sin local), E2E automático sobre base desechable (hallazgo F/K; hoy CI no corre Playwright), `// OPEN:` de `layout-geometry.ts` (solapes y rotación) |

## 4. Contradicciones encontradas entre documentos

| # | Dónde | Qué dice | Qué es cierto (evidencia) |
|---|---|---|---|
| 1 | `README.md` «Estado (30/10/2026)» | «Faltan las pantallas de usuarios, historial de llamados, consola de superadmin y lugares y motivos». | Existen (`Users.tsx`, `History.tsx`, `Console.tsx`, `InventorySettings.tsx`) con E2E. |
| 2 | `README.md` «Estructura» | `app/` = «tablero, espacios, métricas, inventario». | También historial, usuarios, consola, lugares y motivos. |
| 3 | `PLAN-001` nota del 31/10 y `BACKLOG-001` M.2 | Las ramas `api/huecos` → `pantallas/pendientes` están «sin integrar en `main`». | Ambas son ancestro de `main` (`git merge-base --is-ancestor` verdadero en `197b260`). M.2 era cierto al escribirse y quedó viejo. |
| 4 | `PLAN-001` nota del 30/10 | H3, H5, H8 «pendientes»; H1/H2 «a medias». | Superada por la nota del 31/10 y por el código: todas hechas. |
| 5 | `docs/PORTAL.md` encabezado | «estado al 30/10/2026 … `main` (8cce82a)». | El cuerpo ya describe Usuarios, Consola, Historial y los cambios de la ronda 2. Está más al día que su encabezado. |
| 6 | `docs/PORTAL.md` «Probarlo» | Los E2E cubren F1-16, F3-16, F4-11, F5-13 y L-07. | `e2e/README.md` suma F1-15, F2-15, F3-14, F3-15, F4-10, Q-01 y pantallazos. |
| 7 | `docs/E2E-HALLAZGOS.md` §1 | «15 pruebas, 15 en verde». | Hoy hay 26 casos declarados; M.5 reportó 24/24 en la ronda 2. |
| 8 | `docs/E2E-HALLAZGOS.md` B y `e2e/README.md` | El límite de login cuenta todos los intentos (30 / 15 min) y una corrida usa unos 13. | Desde SEC-05 solo cuentan los fallos (`BACKLOG-001` M.3). El límite y el almacenamiento en memoria siguen vigentes. |
| 9 | `docs/E2E-HALLAZGOS.md` K («ningún E2E corre automáticamente») y §5 | Propone workflow de Actions. | `ci.yml` existe pero sin Playwright: K sigue cierto en lo esencial. A la vez `BACKLOG-001` M.2 dice que el 31/10 se decidió «sin GitHub Actions por ahora» y M.3 lo implementó sin que ningún documento registre que el responsable reabrió esa decisión. |
| 10 | `README.md` línea de documentación | Lista `HANDOFF` y `NOCHE-LOG` junto a ADR y TECH como documentación de arquitectura. | Son históricos (este documento). |
| 11 | `docs/NOCHE-LOG.md` y `HANDOFF.md` | F2-10/F2-13/F2-14, F3-13/14/15, F4-09/10, F5-12 «pendientes»; «DATA-001 pendiente de revisión»; «339 pruebas». | Todo lo anterior está hecho o aprobado; cifras vencidas. |
| 12 | `DATA-001` §6 | `ix_outbox_pending` sin `failed_at`. | El índice real incluye `failed_at IS NULL` (ver DATA-002). |
| 13 | `BACKLOG-001` M.1 | «No existe `.github/`» (QA-01). | Era cierto en `db11844`; hoy existe (M.3). No es error: es traza histórica. |

No se modificaron los documentos congelados (ADR, DATA-001, PLAN, BACKLOG y los históricos). `README.md` solo recibió el enlace a este documento; sus filas 1, 2 y 10 y las de `docs/PORTAL.md` (5 y 6) las corrige quien edite esos archivos.
