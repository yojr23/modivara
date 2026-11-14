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
- [ ] E2E Playwright ampliado de POS e Inventario con casos borde.
- [ ] Pruebas manuales en navegador (Brave + extensión Claude) de POS e Inventario: casos y casos borde.
- [ ] Actualizar desde `pruebas` cuando entre PLAN-003 y abrir PR `pos/mesas → pruebas`.

### PLAN-003 (`test/plan-003-modularidad`)

- [~] MOD-09 línea base (build, typecheck, separabilidad, unit, integración).
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

- `main` tiene 1 commit que no está en `pruebas` y `pruebas` 2 que no están en `main`; PR #22 abierto (sincronización). Base efectiva de esta rama: `18289d6`.
