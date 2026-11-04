# Pantallazos por usuario

Generados por `e2e/screens.spec.ts` contra la demo de Docker (`pnpm exec playwright test e2e/screens.spec.ts`; se reescriben en cada corrida).
Para capturas limpias, correrla sobre una demo recién sembrada (`docker compose down -v`, `up`, seeds; ver `README.md`) antes que el resto de los E2E, que dejan productos y lugares «E2E …». El «Gateway E2E» de la consola lo crea `e2e/global-setup.ts`.
Cada carpeta muestra solo las vistas del menú que el portal le arma a ese usuario según sus permisos, más las pestañas de cada pantalla y el historial completo de inventario (`*-inventario-historial.png`). Todo con datos reales de la API sobre la demo sembrada.

No hay un rol «cajero»: los roles por local son `admin`, `staff` e `inventory` (`core-contracts/permissions.ts`).

| Carpeta | Usuario | Rol | Vistas |
|---|---|---|---|
| `bar-demo-admin/` | Administrador | admin | Tablero, Historial, Espacios, Métricas, Inventario, Usuarios |
| `bar-demo-barra/` | Barra | staff | Tablero, Historial |
| `bar-demo-mesero1/` | Mesero 1 | staff | Tablero, Historial |
| `bar-demo-inventario1/` | Inventario 1 | inventory | Métricas, Inventario (pestaña «Lugares de stock»: gestiona productos y lugares, no motivos; DATA-001 §2) |
| `bar-demo-pisos-admin/` | Administrador de Bar Demo Pisos | admin | Las del admin, en otro negocio |
| `labs-superadmin/` | Superadmin | plataforma | Consola (sin negocio y actuando en Bar Demo) |
| `login/` | — | — | Portada (`00-portada.png`, `/`: elegir negocio) y pantalla de entrada de cada negocio |
