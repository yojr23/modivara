# ADR-006 — POS como quinto producto horizontal e independiente

> **Estado:** Aceptado por el responsable (21/11/2026). Aplicado en `pos/mesas` desde el 13/11/2026.
> **Fecha:** 13/11/2026. **Enmienda:** ADR-001 (POS dentro de `commerce`, cuatro dominios). **Supera:** ADR-005 en su orientación por mesa. No edita el texto de ADR-001/002/003.

## Contexto

- ADR-001 dejaba el «POS completo» fuera del MVP y lo ubicaba dentro de `commerce` («Commerce agrupa inventario y POS futuro»), con cuatro dominios y cuatro repositorios de destino (ADR-002 D1).
- ADR-005 (en evaluación, 09/11) propuso `pos` como dominio propio, pero orientado a cuentas por mesa: `menu_items`, `checks.table_id NOT NULL` y un payload gastronómico.
- `PLAN-POS-001` v3 pide un POS vendible por sí mismo y útil para cualquier rubro (zapatería, café, servicios, bar); la mesa es solo un primer escenario de integración.

## Decisión

1. La plataforma tiene **cinco dominios técnicos y cuatro productos contratables**. `core` es la plataforma compartida (identidad, negocios, permisos, entitlements): no se vende ni se habilita aparte. Los productos son `pos`, `inventory` (técnicamente `commerce`, sin renombrar), `analytics` y `hospitality`; cada uno se habilita por su entitlement (`core.module`) y tiene permisos propios. *(Redacción corregida el 21/11/2026 con la aceptación del responsable; antes decía «cinco productos».)*
2. **POS es sectorialmente agnóstico**: su núcleo solo conoce artículo vendible, venta, línea, cantidad, precio, moneda, estado y cobro declarado. No conoce mesas, cartas, meseros ni tipos de negocio.
3. **POS depende solo de Core** (`core-contracts`, `CoreAccessPort`). No importa `hospitality`, `commerce` ni `analytics`, ni consulta sus esquemas.
4. **Integraciones por eventos y por adaptadores compuestos en el host**: POS emite `pos.sale.completed.v1` (ningún consumidor es obligatorio) y vincula una venta a un recurso externo (p. ej. una mesa) con referencias externas validadas por un adaptador registrado en el host (`sale_external_links`, POS-15/27).
5. Quedan **superados** de ADR-005 `menu_items`, `checks.table_id NOT NULL` y el payload gastronómico. Se mantiene su decisión de que `pos` es dominio propio y futuro repositorio.

## Consecuencias

- Core suma el módulo `pos`, los permisos `pos.*` y el rol de local `cashier` (migración incremental de enums, sin tocar tablas de otros dominios).
- Un negocio puede contratar solo POS; Hospitality, Inventario y Analytics siguen funcionando sin POS.
- La independencia de POS se exige en runtime y en base de datos: un host con `MODIVARA_DOMAINS=pos` arranca con solo los esquemas `core` y `pos` (prueba `test:composition:core-pos-isolated`). La imagen del host sigue incluyendo el código de los otros dominios; empaquetarlos por separado es capacidad futura, no probada.
- El destino de repositorios pasa de cuatro a cinco; `check:separability` y la prueba de agnosticismo de `domains/pos` vigilan la independencia.
- **Stock nunca negativo** (decisión del responsable, 21/11/2026): cuando POS descuente inventario (POS-32…35), ningún movimiento puede dejar el saldo por debajo de cero; se mantiene la regla actual de commerce (`insufficient_stock`).
- ADR-001/002/003 conservan su texto; los documentos derivados (`README.md`, `STATUS-001`) apuntan a este ADR.

## Referencias

- [`PLAN-POS-001_pos_mesas_por_rama.md`](PLAN-POS-001_pos_mesas_por_rama.md) — plan de la rama `pos/mesas`.
- [`POS-001_especificacion_pos_horizontal.md`](POS-001_especificacion_pos_horizontal.md) — especificación del POS horizontal.
- [`ADR-005_propuesta_pos_cuentas_por_mesa.md`](ADR-005_propuesta_pos_cuentas_por_mesa.md) — propuesta superada, registro histórico.
