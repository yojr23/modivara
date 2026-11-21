# Evidencia del cierre del POS horizontal (PLAN-POS-001 v2)

Rama `pos/cierre-v2` (desde `pos/mesas`, con `pruebas` tras el PR #29 de PLAN-003). Corte: 21/11/2026, SHA de código `77025d4`.
Entorno: Node 24.22.0, pnpm 10.18.3, PostgreSQL 18.6 (demo Docker y `db-test`). Sin secretos ni datos sensibles.

## Puertas

| Puerta | Estado | Evidencia |
|---|---|---|
| G0 línea base | PASS | Diagnóstico de solo lectura (seguridad/moneda, composición/datos, portal) sobre `verif/plan003-pos`. |
| G1 ADR y políticas | PASS | ADR-006 aceptado (21/11) y corregido a 5 dominios / 4 productos; POS-001 al día. Decisiones del responsable: permiso `hospitality.tables.link_sale`, moneda bloqueada (`currency_locked`), stock nunca negativo. |
| G2 PLAN-003 en `pruebas` | PASS | PR #29 fusionado (`cbd67b6`). |
| G3 merge controlado | PASS | Conflictos de `pos/mesas` + PLAN-003 resueltos con la referencia ya verificada de `verif/plan003-pos`; luego `pruebas` sin conflictos. |
| G4 seguridad y moneda | PASS | `pos-link-permission.int.test.ts`, `currency-lock.int.test.ts` (barreras reales y pool `max: 2`), `permissions-matrix.int.test.ts`. |
| G5 Core + POS aislado | PASS | `pnpm test:composition:core-pos-isolated`: BD con solo esquemas `core` y `pos`, sin URLs ajenas, health, login, venta, outbox sin consumidores, vínculo con proveedor ausente → 404. |
| G6 concurrencia y migraciones | PASS | Rollback inducido y dos operadores en la misma mesa (`prisma-sale-store.int.test.ts`, `pos-tables.int.test.ts`); migraciones sobre BD poblada (`migrations-populated.int.test.ts` de core y pos); `pos 0004` aplicada sobre la demo con datos. |
| G7 portal | PASS | Etiqueta «zona · mesa» íntegra (≤ 93), errores ligados al campo, botones de mesa con zona, textos de cobro declarado, E2E de teclado y de solo POS. |
| G8 suites y revisión | PASS | Ver abajo. Codex: 3 rondas (TOCTOU de moneda, conteos de restauración, espera circular del pool), todo corregido; la última aprueba sin hallazgos. |
| G9 PR y smoke | Pendiente | PR `pos/cierre-v2` → `pruebas`; el responsable fusiona. |

## Suites en `77025d4`

| Comando | Resultado |
|---|---|
| `pnpm build`, `pnpm typecheck`, `pnpm check:separability` | OK |
| `pnpm test` | 823 pruebas en 18 paquetes, OK |
| integración (`vitest.integration.config.ts`, `db-test`) | 1121/1121, 66 archivos |
| `pnpm test:e2e` (demo reconstruida desde la rama) | 63/63 |

Corridas anteriores en el camino: una integración con 1 fallo de tiempos en `hospitality/.../outbox-poller.int.test.ts` bajo carga (archivo sin cambios en la rama; 3/3 al repetirlo solo) y E2E con fallos por cambios esperados (moneda bloqueada, botón «zona · mesa», Caja ve «Por mesa») ya actualizados.

## Pendiente / deuda

- P1: marcar en «Por mesa» las mesas con venta abierta exige exponer el vínculo (`provider`, `resource_type`, `resource_id`) en el DTO de venta.
- `backup.sh` y `restore-check.sh` no se ejecutaron de punta a punta (necesitan la demo); `counts.sql` sí, contra una BD temporal con filas en cada tabla de POS.
- Fuera de alcance por plan: POS-32…38 (stock y analytics de ventas; el stock nunca queda negativo), pagos reales, impuestos, factura.
