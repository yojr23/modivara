# Pantallazos por usuario y en vivo

Generados por `e2e/screens.spec.ts`, `e2e/live.spec.ts` y `e2e/gateway-signal.spec.ts` contra la demo de Docker con dos meses de historial (`pnpm exec playwright test e2e/screens.spec.ts`; se reescriben en cada corrida).
Para capturas limpias, correrla sobre una demo recién sembrada (`scripts/demo-reset.sh`) antes que el resto de los E2E, que dejan productos y lugares «E2E …». El «Gateway E2E» de la consola lo crea `e2e/global-setup.ts`.
`screens.spec.ts` abre un turno antes de capturar (cinco mesas llaman y Barra toma dos), así el tablero, el historial y «Hoy» no salen vacíos; al final cierra los llamados. Cada carpeta muestra solo las vistas del menú que el portal le arma a ese usuario según sus permisos, más las pestañas de cada pantalla y el historial completo de inventario (`*-inventario-historial.png`). Todo con datos reales de la API sobre la demo sembrada.

No hay un rol «cajero»: los roles por local son `admin`, `staff` e `inventory` (`core-contracts/permissions.ts`). Barra y meseros comparten el rol `staff` y, por eso, la misma pantalla; en celular el plano se oculta y cada llamado lleva su botón en la cola.

| Carpeta | Usuario | Rol | Vistas |
|---|---|---|---|
| `bar-demo-admin/` | Administrador | admin | Tablero, Historial, Espacios, Métricas, Inventario, Usuarios |
| `bar-demo-barra/` | Barra | staff | Tablero, Historial |
| `bar-demo-mesero1/` | Mesero 1 | staff | Tablero, Historial |
| `bar-demo-inventario1/` | Inventario 1 | inventory | Métricas, Inventario (pestaña «Lugares de stock»: gestiona productos y lugares, no motivos; DATA-001 §2) |
| `bar-demo-pisos-admin/` | Administrador de Bar Demo Pisos | admin | Las del admin, en otro negocio |
| `labs-superadmin/` | Superadmin | plataforma | Consola (sin negocio y actuando en Bar Demo) |
| `llamados/` | Barra y Mesero 1 | staff | Tablero con las 15 mesas llamando y 3 en atención: escritorio recién pulsado y con el reloj adelantado 6 min (más de 5 min), celular 390×844 a los 3 min (pantalla y página completa). Los llamados se cierran al final |
| `login/` | — | — | Portada (`00-portada.png`, `/`: elegir negocio) y pantalla de entrada de cada negocio |
| `en-vivo/` | Barra (escritorio), Mesero 1 (celular), Administrador, Inventario 1 | — | Turno simulado con los tableros abiertos sin recargar (`live.spec.ts`): llega la mesa 3, hora pico con 6 mesas (una por MQTT), la mesa 3 pulsa 2 veces, Barra la toma y el mesero lo ve, el mesero cierra la 8, esperas de más de 2 y de 5 min, métricas de hoy y de 30 días, historial y detalle del turno, una venta en inventario. `13`/`14`: el gateway de demo se apaga y vuelve, y el aviso aparece y se va solo (`gateway-signal.spec.ts`) |
