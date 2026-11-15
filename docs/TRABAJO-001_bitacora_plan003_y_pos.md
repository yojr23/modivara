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
- [ ] Actualizar desde `pruebas` cuando entre PLAN-003 y abrir PR `pos/mesas → pruebas`.

### PLAN-003 (`test/plan-003-modularidad`)

- [x] MOD-09 línea base sobre `18289d6` (Node 24.22.0, pnpm 10.18.3): build, typecheck, separabilidad, unit e integración (51 archivos, 775 pruebas) en verde. E2E se corre al final contra esta rama.
- [~] Subramas en paralelo: `p3/a1-host` (worktree `p3-a1`: MOD-10…15, 26, 23 mínimo) y `p3/a2a3-portal` (worktree `p3-a2`: MOD-25, 52, 53, 60, 61, 74). Se integran en `test/plan-003-modularidad`. Bloqueo de `db-test`: directorio `scratchpad/dbtest.lock` (mkdir/rmdir).
- [ ] A0 MOD-00…05: ADR-006 copiado igual que en `pos/mesas` (Propuesto) [!] aprobación del responsable; MOD-01…05 documentales.
- [ ] A1 MOD-10 `core-api` sin `hospitality-contracts`.
- [ ] A1 MOD-11 `check:separability` falla ante dependencia inversa.
- [ ] A1 MOD-12 host Core + Commerce con PostgreSQL real.
- [ ] A1 MOD-13 `AppModule`/subscribers por composición.
- [ ] A1 MOD-14 activación tardía de Commerce.
- [ ] A1 MOD-15 consumidores ausentes, outbox y replay.
- [ ] A2 MOD-25 navegación por entitlement + permiso + fuente.
- [ ] A2 MOD-26 suspensión/reactivación Commerce/Hospitality.
- [ ] A2 MOD-23 (P1) alta sin seeds: evaluar.
- [ ] A3 MOD-52/53 Metrics por fuente disponible.
- [ ] A3 MOD-54 proyecciones: dedup, rebuild, fallo aislado.
- [ ] A3 MOD-60 unidad `unit` por defecto, sin jerga de bar.
- [ ] A3 MOD-61 E2E zapatería Core + Commerce (15 entradas, 2 salidas, saldo 13).
- [ ] A4 MOD-70…72 matriz T01/T05/T07/T09/T11/T12/T14, negativos y fallos.
- [ ] A4 MOD-73…75 (P1) diagnóstico, E2E paquetes, runbook.
- [ ] Revisión y auditoría Codex de la rama.
- [ ] PR `test/plan-003-modularidad → pruebas`.

## Registro

| Fecha | Qué | Resultado |
|---|---|---|
| 14/11 | Worktree `plan-003` creada desde `origin/pruebas` `18289d6`; planes movidos a `docs/`. | OK |
| 14/11 | Codex gpt-6.1-terra sobre el último arreglo de POS. | Sin hallazgos. |

## Hallazgos y decisiones

- [x] **Por corregir (responsable, 14/11):** en Bar Demo el plano publicado no pinta las mesas 11 y 12, pero sí llegan llamados de ellas (cola/historial). Causa: `scripts/seed-floor-plans.mjs:60` deja «Mesas 11 y 12 sin ubicar a propósito» en el plano de Primer piso, pero siguen con botón (btn-11, btn-12). Verificado en navegador: el llamado de btn-11 aparece en la cola, no se marca en el plano y el «1 esperando» del piso no lo cuenta. Corregido: `seed:planos-demo` ubica Mesa 11 y 12 en Zona A (escena nueva y, en bases ya sembradas, las agrega al plano publicado sin tocar lo demás; idempotente). Aplicado a la demo y verificado: el llamado de btn-12 se marca en el plano y el piso cuenta «1 esperando». El tablero sigue ADR-003 CU-11 (una mesa sin ubicar recibe llamados solo en la cola).
- [x] **Hallazgo navegador (14/11):** la venta abierta desde «Venta» en la ficha de la mesa no muestra a qué mesa pertenece («Venta en curso», «Historial» y lista de abiertas sin «Mesa 3»). En el bar, `caja1` (rol Caja) no tiene «Por mesa» (exige `hospitality.calls.read`) y no puede saber qué venta abierta es de qué mesa. Arreglado en `pos/mesas` (`f2a20ae`, migración POS `0003_external_link_label`; Codex pidió incluir la zona → `9ce2dca`, «Primer piso · Mesa 4»). Verificado en navegador: chip de venta abierta, ticket de `caja1` y fila del historial muestran «Primer piso · Mesa 4». ¿Dar «Por mesa» a Caja? Decisión del responsable.
- [x] **Caso base del bar en navegador (14/11, admin):** botón simulado → llamado en mesa 3 → «Marcar en atención» → «Venta» desde la ficha → artículos (unidad y kg; 0,75 kg × $60.000,50 = $45.000,38 redondeo correcto) → 1,5 unidades rechazado → anular línea → cobro con tarjeta $16.000 → el llamado sigue «en atención» hasta «Finalizar» (independientes) → «Por mesa» retoma la misma venta → historial muestra la cobrada. Duplicado de nombre en minúsculas, precio negativo y con 3 decimales rechazados con mensaje claro. `caja1`: solo «Ventas» (Vender, Historial), URL forzada a tablero redirige.
- [~] **Bug Inventario (navegador, 14/11, grave):** la cantidad es `type="number"` (`Inventory.tsx:138`): «0,5» kg queda «05» (= 5) y «1,5» botellas queda «15»; la coma decimal, que la propia UI muestra («160,5 kg»), se pierde en silencio → movimiento 10× mayor. Asignado al agente del portal (`p3/a2a3-portal`).
- [~] **Hallazgo Inventario (14/11):** el panel «Hoy» dice «Producto desactivado» para productos que solo faltan en la lista cacheada (creados en otra sesión). Asignado junto con el anterior.
- [x] **Inventario en navegador (14/11, `inventario1`):** salida mayor al saldo rechazada con mensaje y saldo intacto; conteo igual al saldo rechazado («no hay nada que ajustar»); solo ve Métricas e Inventario.
- [ ] **Hallazgo navegador (14/11):** «Por mesa» no distingue qué mesas tienen venta abierta; el catálogo lista primero decenas de artículos «Inactivo» de E2E; los campos del diálogo «Nuevo artículo» no tienen nombre accesible (lectores de pantalla).
- [ ] **Hallazgo navegador (14/11):** Bar Demo no trae artículos de venta sembrados; el caso base del bar empieza con catálogo vacío.
- `main` tiene 1 commit que no está en `pruebas` y `pruebas` 2 que no están en `main`; PR #22 abierto (sincronización). Base efectiva de esta rama: `18289d6`.
