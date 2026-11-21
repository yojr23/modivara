# Pruebas E2E (Playwright)

Prueban el portal de punta a punta contra la demo de Docker: navegador real (el Chrome instalado, `channel: 'chrome'`), API real, Socket.IO y base sembrada.

```bash
scripts/demo-reset.sh          # BORRA la base de la demo y la recrea: up --build, los cuatro seeds, clave del simulador en .env, planos
pnpm test:e2e                  # informe en e2e/report (pnpm exec playwright show-report e2e/report)
```

A mano: `docker compose up --build -d`, los seeds del README dentro del contenedor `api`, copiar la clave `SIM_GATEWAY_KEY=…` que imprime `seed-hospitality` al `.env` (si no, el tablero avisa «Sin señal de botones») y `pnpm seed:planos-demo`.

- **Credenciales:** `SEED_PASSWORD` del entorno o de `.env` (la misma del seed). Otra URL: `E2E_BASE_URL=http://... pnpm test:e2e`.
- **Sesiones:** `global-setup.ts` inicia sesión una vez por usuario y guarda las cookies en `e2e/.auth/` (fuera de git). La API limita a 30 logins FALLIDOS por IP cada 15 min (los correctos no cuentan, SEC-05); el bloqueo por cuenta (5 fallos) lo prueba `auth.spec.ts`. Si se agota: esperar o `docker compose restart api`.
- **Pulsaciones:** la primera corrida crea, como superadmin, un «Gateway E2E» en Bar Demo y guarda su id y clave en `e2e/.auth/`; los botones `btn-NN` del seed se pulsan por `POST /api/v1/device-events`.
- **Datos:** las pruebas usan la base de demo. Cierran los llamados que abren, desactivan el producto y el usuario que crean y republican los planos sin las áreas de prueba; desactivan los artículos de venta «E2E …»; los llamados, movimientos y ventas de prueba quedan en el historial.
- **Un solo worker:** comparten la base y una prueba reinicia la API (`docker compose restart api`).

| Archivo | Cubre (PLAN-001) |
|---|---|
| `auth.spec.ts` | F1-16: login correcto y erróneo, bloqueo a los 5 fallos, salir, aislamiento entre negocios (UI y API) |
| `service-call.spec.ts` | F3-16 / L-07: pulsación → plano y cola → reconocer → finalizar en dos tableros a la vez → historial; pulsación repetida; reconexión tras reiniciar la API; interruptor «Sonido» (F3-13) |
| `inventory.spec.ts` | F4-11: alta de producto, entrada, salida (y saldo insuficiente), ajuste por conteo, historial y API coherentes; staff sin inventario |
| `inventory-settings.spec.ts` | F4-10: crear lugar y motivo «E2E …», verlo en el registro rápido, desactivarlo y comprobar que ya no se ofrece (el lugar no se puede borrar y queda en la demo) |
| `history.spec.ts` | F3-14 / F3-16 «→ historial»: llamado tomado y cerrado por Barra → fila con quién tomó y cerró → detalle con línea de tiempo |
| `users.spec.ts` | F1-15: admin crea un usuario «E2E …» con local y rol, lo ve en la lista, le cambia el rol y lo desactiva (sin iniciar sesión con él) |
| `metrics.spec.ts` | F5-13: total de llamados de hoy en pantalla = historial; saldo en métricas = inventario |
| `mqtt.spec.ts` | Q-01: pulsación publicada por MQTT con el usuario del gateway (`scripts/mqtt-user.sh`, `mosquitto_pub` dentro del contenedor) → tablero → cerrar |
| `console.spec.ts` | F2-15 / F3-15: superadmin (`labs`) elige Bar Demo / Principal, crea un gateway «E2E consola …» (clave una vez), lo desactiva; asigna y desasigna el botón fijo `btn-e2e-consola` (no se puede borrar); pestaña de detectados; un admin no ve la consola |
| `diagnostics.spec.ts` | MOD-05: el tablero nombra el gateway sin señal y qué revisar; al desactivarlo desaparece |
| `screens.spec.ts` | Pantallazos de todas las vistas por usuario (admin, barra, mesero1, inventario1, caja1, pisos/admin, tienda-demo/admin, superadmin) la portada, el login, el historial de inventario y el tablero con 15 llamados en escritorio y celular 390×844, en `docs/pantallazos/` |
| `inventory-only.spec.ts` | MOD-61 / MOD-74 (PLAN-003 T01): `zapateria-demo` (solo commerce) crea `ZAP-NEG-40` en unidades, 15 de entrada, 2 salidas de 1, saldo 13 en pantalla, historial y API; menú solo Inventario y Usuarios; `/tablero`, `/espacios`, `/metricas`… vuelven a Inventario; ninguna petición a mesas, llamados, métricas ni Socket.IO; la API responde 403 a mesas y métricas |
| `hospitality-only.spec.ts` | MOD-74 (PLAN-003 T07): `restaurante-demo` (solo hospitality) ve Tablero, Historial, Espacios y Usuarios; `/inventario` y `/metricas` vuelven al tablero; ninguna petición a commerce ni analytics; 403 a productos |
| `spaces.spec.ts` | L-05 / L-07: publicar un área mientras otro mira el tablero; conflicto de edición (409) sin pisar el borrador ajeno; desactivar una mesa (sale del borrador) y 409 si tiene botón |
| `pos.spec.ts` | POS-31 / PLAN-003 T02: Tienda Demo (solo POS) ve Ventas y Usuarios, nunca Tablero, Inventario ni Métricas; crea y vende un zapato por SKU (`E2E-ZAP-42`, 2 unidades), una bebida y una hora de servicio (1,5 h) por el mismo flujo con cobro declarado, en escritorio y celular 390×844; historial y API coherentes; Hospitality, Commerce y Analytics → 403 `module_disabled` |
| `pos-tables.spec.ts` | POS-26 / PLAN-003 T08: la venta de Mesa 5 se abre desde la ficha del tablero (escritorio) y desde Ventas «Por mesa» (celular): la misma venta, también para `caja1` por la API; Caja la cobra con un llamado pendiente (sigue pendiente) y finalizar el llamado no cierra la venta siguiente. T07/T09: Pisos sin «Venta», sin «Ventas» y POS → 403. T14: una venta de Bar Demo → 404 para Tienda Demo. T12 (revocar POS) queda en la integración: exige escribir en la base |
| `pos-edge.spec.ts` | Casos borde de Ventas: «Unidad» rechaza 0, negativas y decimales y kg acepta 3 decimales (UI y API); venta vacía no se cobra, anular una línea recalcula el total y la cobrada es de solo lectura (celular 390×844); nombre/SKU duplicado y artículo desactivado; Caja sin catálogo ni anular (403); mesero1 e inventario1 sin Ventas; idempotencia (`replayed`, `idempotency_key_reused`); aislamiento con Tienda Demo; historial «Anuladas» y cursor; cambio de moneda con artículos activos → `currency_locked` (409) |
| `inventory-edge.spec.ts` | Casos borde de Inventario: salida rechazada por el servidor cuando otro equipo gastó el saldo (saldo intacto), conteo igual al saldo; inventario1 sin motivos (403) y staff sin inventario; producto desactivado fuera del registro (`inactive_entity`); idempotencia de movimientos y ajustes; local de otro negocio → 404 |
