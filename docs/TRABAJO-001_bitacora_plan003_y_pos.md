# TRABAJO-001 — Bitácora de ejecución: PLAN-003 y cierre de PLAN-POS-001

> Archivo vivo. Se actualiza al terminar cada tarea para que otra sesión pueda retomar sin perder contexto.
> Inicio: 14/11/2026. Pedido del responsable: terminar POS, ejecutar `docs/PLAN-003_modularidad_pruebas_por_rama.md`, E2E y pruebas en navegador de POS e Inventario, auditoría con Codex.

## Cómo retomar

- Repo: `~/Desktop/JUNIOR/trabajo/emprendimiento/modivara`. Node: `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`.
- Worktrees: `.claude/worktrees/pos-mesas` (rama `pos/mesas`, POS terminado y empujado) y `.claude/worktrees/plan-003` (rama `test/plan-003-modularidad`, desde `origin/pruebas` `18289d6`).
- Planes: `docs/PLAN-003_modularidad_pruebas_por_rama.md` (esta rama) y `docs/PLAN-POS-001_pos_mesas_por_rama.md` (rama `pos/mesas`, con tabla «Estado» al final). Los originales de Descargas se movieron al repo.
- La demo Docker (proyecto compose `modivara`) corre desde la worktree `pos-mesas`. `db-test` es compartido: **no correr `pnpm test:integration` en dos worktrees a la vez**.
- Codex: `node ~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs review --base <ref> --scope branch --model gpt-6.1-terra` (esfuerzo `xhigh` por `~/.codex/config.toml`). Para `task`/`adversarial-review` agregar `--effort xhigh`.
- Reglas: commits como yojr23 sin trailers `Co-Authored-By`; sin force-push; no tocar `main`; no `down -v`; no imprimir secretos; no tocar `apps/portal/src/app/editor-kit.tsx` ni `plan.tsx`; esta rama no agrega código de `domains/pos` ni `pos` a Core (PLAN-003 §0).
- Orden de PR (PLAN-003 §6): primero `test/plan-003-modularidad → pruebas`; luego `pos/mesas` se actualiza desde `pruebas` y abre su PR. PR #22 (sincronizar `pruebas` con `main`) sigue abierto: lo decide el responsable.

## Estado

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` hecho · `[!]` bloqueado/decisión del responsable.

### POS (`pos/mesas`)

- [x] Codex gpt-6.1-terra sobre `c59f7d1` (doble toque): sin hallazgos.
- [x] E2E Playwright ampliado (`4d039bb`, empujado): `e2e/pos-edge.spec.ts` (9) y `e2e/inventory-edge.spec.ts` (5), todos en verde: cantidades por unidad, venta vacía, anular línea, venta cobrada solo lectura, duplicados, inactivos, permisos de Caja/mesero/inventario, idempotencia, aislamiento entre negocios, historial paginado, `currency_mismatch` a 390 px y escritorio; stock insuficiente, conteo igual al saldo, permisos de inventario, replay de movimientos, aislamiento. Suite completa 54/55: falló `service-call.spec.ts:78` (reconexión tras reiniciar la API, timeout de 60 s mientras `db-test` se recreaba), pasa sola. No detecta el bug de la coma: Playwright llena «0.5» con punto.
- [ ] Pruebas manuales en navegador (Brave + extensión Claude) de POS e Inventario: casos y casos borde.
- [!] PR `pos/mesas → pruebas` (borrador, después del de PLAN-003): mismo bloqueo. Al entrar PLAN-003: `git merge origin/pruebas` en `pos/mesas`; la resolución ya está hecha y probada en `verif/plan003-pos` (empujada).

### PLAN-003 (`test/plan-003-modularidad`)

- [x] MOD-09 línea base sobre `18289d6` (Node 24.22.0, pnpm 10.18.3): build, typecheck, separabilidad, unit e integración (51 archivos, 775 pruebas) en verde. E2E se corre al final contra esta rama.
- [~] Subramas en paralelo: `p3/a1-host` (worktree `p3-a1`: MOD-10…15, 26, 23 mínimo) y `p3/a2a3-portal` (worktree `p3-a2`: MOD-25, 52, 53, 60, 61, 74). Se integran en `test/plan-003-modularidad`. Bloqueo de `db-test`: directorio `scratchpad/dbtest.lock` (mkdir/rmdir).
- [x] A0 MOD-01…05 y MOD-50: `docs/MOD-001_productos_y_modularidad.md` (`208876b`). [!] MOD-00: ADR-006 sigue Propuesto, aprobación del responsable.
- [x] A1 MOD-10: esquema de auditoría de plataforma en `core-contracts/platform-events.ts` (mismo tipo de evento v1); `core-api` sin `hospitality-contracts` (`5ca4aba`).
- [x] A1 MOD-11: regla única (deps e imports), core sin dominios, prueba de regresión (`1d2344e`).
- [x] A1 MOD-12: `core-commerce.int.test.ts` en base propia con solo esquemas core y commerce; `pnpm test:composition:core-commerce` (`cd995c5`).
- [x] A1 MOD-13: `hostMetadata(core, domains[])`, `forDomains(DynamicModule[])` con suscriptores opcionales (`bda8878`).
- [x] A1 MOD-14/26/23 mínimo: `PUT /platform/organizations/:id/modules/:module` (auditado), eventos `core.module.enabled/disabled` v1, commerce siembra al activar y omite `location.created` sin módulo; T11/T12 en integración (`edb2fe9`).
- [x] A1 MOD-15/54/72: movimiento de commerce confirma con analytics caído; entrega única al recuperar (`28b8862`).
- [x] A2 MOD-25: `/me` entrega solo permisos de módulos habilitados (prefijo vs `MODULES`) y `analytics.*` solo con su fuente (`PERMISSION_SOURCES`) (`fb470a3`, `3dac32a`).
- [x] A2 MOD-26: cubierto por el endpoint de A1 (datos se conservan, 403 `module_disabled`, reactivar sin duplicar).
- [~] A2 MOD-23 (P1): habilitar/suspender módulos por API hecho; crear negocios por API pendiente.
- [x] A3 MOD-52/53: Métricas muestra pestañas solo con fuente y permiso, «Sin fuentes de datos» sin pedir nada; Espacios no consulta analytics sin módulo (`e5d1159`).
- [x] A3 MOD-54: ya cubierto (dedup, rebuild) + nuevo aislamiento de commerce (`28b8862`).
- [x] A3 MOD-60: unidad por defecto «Unidades», textos neutros, `bottle` sigue disponible (`d399ca7`).
- [x] A3 MOD-61/MOD-74: seeds `zapateria-demo` (solo commerce) y `restaurante-demo` (solo hospitality); `seed:commerce` salta negocios sin commerce; E2E `inventory-only.spec.ts` y `hospitality-only.spec.ts` escritos (`0f79053`), en verde en los E2E combinados (`c9629cb`).
- [x] A4 MOD-70…72: matriz `docs/MOD-002_matriz_escenarios_plan003.md` con evidencia y PASS (`a44ec58`; E2E combinados `c9629cb`). Sin prueba dedicada (declarado): T14 en host parcial, log `outbox.failed_pending`, reintento conjunto de suscriptores.
- [x] A4 MOD-73/75 (P1): runbook OPERACION-001 §9 (y §6 corregido: `outbox:retry` sin dominio solo imprimía uso). Diagnóstico de lag/correlación por producto pendiente. MOD-74 E2E escritos.
- [x] Revisión y auditoría Codex (gpt-6.1-terra, xhigh): revisiones de A1, A2, del rebuild y adversarial de toda la rama; todos los hallazgos corregidos; última revisión sin hallazgos.
- [!] PR `test/plan-003-modularidad → pruebas`: texto listo (`scratchpad/pr-plan003.md` de la sesión, resumido en la bitácora); abrirlo quedó bloqueado por permisos del entorno: lo abre el responsable o autoriza `gh pr create`.

## Registro

| Fecha | Qué | Resultado |
|---|---|---|
| 14/11 | Worktree `plan-003` creada desde `origin/pruebas` `18289d6`; planes movidos a `docs/`. | OK |
| 14/11 | Codex gpt-6.1-terra sobre el último arreglo de POS. | Sin hallazgos. |
| 15/11 | Corrida final `a44ec58`: build, typecheck, separabilidad, 699 unit, integración 798/798. Verificación combinada `c9629cb` (+ POS, `MODIVARA_DOMAINS` con `pos`): integración 1101/1101, E2E 61/61. Rebuild por fuentes (`f9bbc34`) revisado por Codex sin hallazgos. | OK |
| 15/11 | Merge `p3/a5-codex` (auditoría adversarial): permisos efectivos también en guards (`a4f0f01`), reactivar re-publica `core.module.enabled` sin nueva auditoría (`e6be2f8`), bloqueo por negocio al cambiar módulos (`75ced3f`), `MODIVARA_DOMAINS` (`e8928f1`), rebuild por fuentes (`565347d`); Codex P1/P2 sobre eso: arranque con el parser de la API y rebuild que no borra fuentes omitidas. T05 ahora espera 403 en llamados sin hospitality. Corrida en `643a736`: build, typecheck, separabilidad, unit 698 e integración 798/798 en verde. Queda: rebuild que vacía solo las fuentes compuestas (Codex P1 de carrera), en curso. | OK |
| 15/11 | Merge `p3/a4-gaps`: hospitality ignora locales inactivos (`d84ff00`), separabilidad revisa SQL de migraciones (`1860a33`), T07/T12 (`1fca735`), T05 (`2808e64`). `seed-history` con margen de 300 s (pasaba en 117 s de 120 sola). | OK |
| 15/11 | Navegador, demo combinada, `zapateria-demo/admin`: menú solo Inventario y Usuarios; unidad por defecto «Unidades», textos neutros; producto en kg: entrada «2,5» → +2,5 kg, «1,2345» rechazado con mensaje, «,5» → −0,5 kg. El historial ahora nombra los productos desactivados («Viejo (desactivado)», `d9de751`). | OK |
| 15/11 | E2E completos contra la demo combinada (`verif/plan003-pos` @ `bb097ae`, 5 negocios): 60/61; `screens.spec.ts:73` falló por URL relativa en una página nueva tras 1 min y pasa sola (intermitente). Incluye pos, pos-edge, pos-tables (etiqueta de mesa), inventory-edge, inventory-only (zapatería 15−2=13) y hospitality-only. | OK |
| 14/11 | Merge `p3/a1-host` (`fe04225`): 680 unit, integración 787/787 en la subrama. Codex A2: 3 hallazgos P2 corregidos (`6dcd7e1`, `4c44319`). Mesas 11/12 en plano de demo (`20f2add`). | OK |
| 14/11 | Merge `p3/a2a3-portal` en esta rama (`564b151`). Unit 685 en verde; integración 774/775 (timeout de `seed-history` con la máquina cargada, pasa solo). | OK |

## Hallazgos y decisiones

- **Codex adversarial sobre toda la rama (15/11, gpt-6.1-terra, needs-attention), en curso en `p3/a5-codex`:** (1) los guards no aplican los permisos efectivos de `/me` (métricas legibles con la fuente suspendida); (2) activar un módulo cuando el host no lo compone pierde la inicialización y re-activar no hace nada; (3) activar/suspender concurrentes pueden confirmar el estado equivocado; (4) `AppModule` desplegable siempre compone los tres productos (selección por `MODIVARA_DOMAINS`); (5) `analytics:rebuild` exige todas las fuentes.
- **Verificación combinada (15/11):** rama local `verif/plan003-pos` (worktree `verif`) = `pos/mesas` + `test/plan-003-modularidad`, solo para probar; no se empuja ni reemplaza el orden de PR. 12 conflictos resueltos (host por composición con `PosModule` como quinto dominio, seeds de los 5 negocios, `cashier` + `PERMISSION_SOURCES`). Integración 1089/1090 (falla intermitente `mqtt.int.test.ts`: orden de `deviceEvent` con `receivedAt` igual). Arreglo necesario al combinar: `posReferenceValidators` inyecta `ListTables` como opcional. La demo Docker corre ahora desde `verif` con los 5 negocios (bar-demo, bar-demo-pisos, tienda-demo, zapateria-demo, restaurante-demo).
- **Incidente demo (15/11):** caddy, mqtt, button-sim y db-test se cayeron (button-sim 137); `mqtt` no arrancaba en `verif` por faltar `infra/mosquitto/passwd` (ignorado por git; copiar desde `pos-mesas`). Restaurado con `docker compose -p modivara up -d`.
- **Auditoría de docs vs código (14/11):** `/health/ready` no devuelve conteos de outbox fallido (solo log `outbox.failed_pending`); la API de métricas no valida la fuente (solo `/me`); analytics proyecta eventos de negocios sin analytics (OPEN); `analytics:rebuild` exige las cuatro URLs (no sirve en instalación parcial, P1). En curso (`p3/a4-gaps`): T05 y T07/T12-Hospitality con host real, suscriptor de hospitality ignora locales inactivos, separabilidad revisa SQL de migraciones entre esquemas.
- **Codex A1 (14/11):** P1 el alta no publicaba activación para locales existentes; P2 reactivar recreaba motivos desactivados. Corregidos en `3703a70` (`p3/a1-host`).
- [x] **Por corregir (responsable, 14/11):** en Bar Demo el plano publicado no pinta las mesas 11 y 12, pero sí llegan llamados de ellas (cola/historial). Causa: `scripts/seed-floor-plans.mjs:60` deja «Mesas 11 y 12 sin ubicar a propósito» en el plano de Primer piso, pero siguen con botón (btn-11, btn-12). Verificado en navegador: el llamado de btn-11 aparece en la cola, no se marca en el plano y el «1 esperando» del piso no lo cuenta. Corregido: `seed:planos-demo` ubica Mesa 11 y 12 en Zona A (escena nueva y, en bases ya sembradas, las agrega al plano publicado sin tocar lo demás; idempotente). Aplicado a la demo y verificado: el llamado de btn-12 se marca en el plano y el piso cuenta «1 esperando». El tablero sigue ADR-003 CU-11 (una mesa sin ubicar recibe llamados solo en la cola).
- [x] **Hallazgo navegador (14/11):** la venta abierta desde «Venta» en la ficha de la mesa no muestra a qué mesa pertenece («Venta en curso», «Historial» y lista de abiertas sin «Mesa 3»). En el bar, `caja1` (rol Caja) no tiene «Por mesa» (exige `hospitality.calls.read`) y no puede saber qué venta abierta es de qué mesa. Arreglado en `pos/mesas` (`f2a20ae`, migración POS `0003_external_link_label`; Codex pidió incluir la zona → `9ce2dca`, «Primer piso · Mesa 4»). Verificado en navegador: chip de venta abierta, ticket de `caja1` y fila del historial muestran «Primer piso · Mesa 4». ¿Dar «Por mesa» a Caja? Decisión del responsable.
- [x] **Caso base del bar en navegador (14/11, admin):** botón simulado → llamado en mesa 3 → «Marcar en atención» → «Venta» desde la ficha → artículos (unidad y kg; 0,75 kg × $60.000,50 = $45.000,38 redondeo correcto) → 1,5 unidades rechazado → anular línea → cobro con tarjeta $16.000 → el llamado sigue «en atención» hasta «Finalizar» (independientes) → «Por mesa» retoma la misma venta → historial muestra la cobrada. Duplicado de nombre en minúsculas, precio negativo y con 3 decimales rechazados con mensaje claro. `caja1`: solo «Ventas» (Vender, Historial), URL forzada a tablero redirige.
- [x] **Bug Inventario (navegador, 14/11, grave)** — arreglado en `a448bd7` (`parseDecimal`, campo de texto): la cantidad es `type="number"` (`Inventory.tsx:138`): «0,5» kg queda «05» (= 5) y «1,5» botellas queda «15»; la coma decimal, que la propia UI muestra («160,5 kg»), se pierde en silencio → movimiento 10× mayor. Asignado al agente del portal (`p3/a2a3-portal`).
- [x] **Hallazgo Inventario (14/11)** — arreglado en `7bcf033`: el panel «Hoy» dice «Producto desactivado» para productos que solo faltan en la lista cacheada (creados en otra sesión). Asignado junto con el anterior.
- [x] **Inventario en navegador (14/11, `inventario1`):** salida mayor al saldo rechazada con mensaje y saldo intacto; conteo igual al saldo rechazado («no hay nada que ajustar»); solo ve Métricas e Inventario.
- [ ] **Hallazgo navegador (14/11):** «Por mesa» no distingue qué mesas tienen venta abierta; el catálogo lista primero decenas de artículos «Inactivo» de E2E; los campos del diálogo «Nuevo artículo» no tienen nombre accesible (lectores de pantalla).
- [ ] **Hallazgo navegador (14/11):** Bar Demo no trae artículos de venta sembrados; el caso base del bar empieza con catálogo vacío.
- `main` tiene 1 commit que no está en `pruebas` y `pruebas` 2 que no están en `main`; PR #22 abierto (sincronización). Base efectiva de esta rama: `18289d6`.
