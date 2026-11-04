# Portal — pantallas, permisos y datos (estado al 30/10/2026)

> Documento descriptivo del frontend tal como está en `main` (8cce82a). No es un ADR: las decisiones de producto viven en ADR-001…003, TECH-001 y DATA-001; el plan y el estado por tarea, en PLAN-001 y PLAN-002.

## Rutas

| Ruta | Qué es | Quién la ve |
|---|---|---|
| `/` | Portada: «¿Cuál es tu negocio?». Valida el slug con `slugSchema` (core-contracts) y lleva a `/<negocio>`. | Todos |
| `/<negocio>` | Login por negocio (ADR-002 D2). Con sesión de ese negocio redirige a la app; con sesión de otro, muestra el login para entrar a este. | Todos |
| `/<negocio>/app` | Abre la primera pantalla permitida. | Con sesión |
| `/<negocio>/app/tablero` | Tablero operativo sobre los planos publicados (L-06). | Módulo `hospitality` + `hospitality.calls.read` |
| `/<negocio>/app/historial` | Historial de llamados (F3-14). | Módulo `hospitality` + `hospitality.calls.read` |
| `/<negocio>/app/espacios` | Editor de espacios y planos (L-05). | Módulo `hospitality` + `hospitality.tables.manage` |
| `/<negocio>/app/metricas` | Métricas de llamados e inventario (F5-12). | Módulo `analytics` + `analytics.calls.read` o `analytics.inventory.read` |
| `/<negocio>/app/inventario` | Registro de stock (F4-09). | Módulo `commerce` + `commerce.stock.read` |
| `/<negocio>/app/usuarios` | Usuarios del negocio (F1-15). | `core.users.manage` en el local (sin módulo) |
| `/labs/app/consola` | Consola de superadmin (F2-14, F3-15): gateways, botones y detectados sin asignar. | Permisos `platform.*` (solo superadmin; sin módulo) |
| `/_tokens` | Muestra interna de la base visual (T6). | Interna |

Si la URL es de otro negocio que el de la sesión, la app redirige al negocio real. La navegación solo oculta; la autorización la decide siempre el backend.

Usuarios de demo (`pnpm seed`): `bar-demo/{admin,barra,mesero1,inventario1}`, `bar-demo-pisos/admin`, `labs/superadmin`. La clave es la de `SEED_PASSWORD`.

## Estructura del código

```text
apps/portal/src/
  routes/       routes.tsx, RequireSession, Login, AppShell (sesión → local activo → pantallas permitidas; tiempo real por local)
  app/          pantallas y piezas: Board (tablero), Spaces + editor-kit (editor), Metrics, Inventory,
                ui.tsx (Page, contexto de la app, esqueletos, estados), charts.tsx, plan.tsx (formas del plano, áreas), format.ts
  ui/           Button, StatusBadge, cn
  index.css     tokens de BRAND-002 §9, series de gráficos, animaciones (apagadas con prefers-reduced-motion)
```

Las pantallas usan solo los hooks públicos de cada `domains/<d>/web` (TanStack Query) y los tipos de `*-contracts`.
`// OPEN:` al separar repos (ADR-002 D1), ¿las pantallas pasan a cada `domains/<d>/web` con un kit visual compartido? Hoy viven en el portal porque el kit (botones, shell, gráficos) está aquí.

## Pantallas y sus datos

**Tablero** (`app/Board.tsx`): `useLayouts` (planos publicados de todos los espacios), `useZones`, `useTables`, `useActiveCalls` (REST + `service_call.changed` por Socket.IO), `useAcknowledgeCall`/`useCompleteCall` (409 si otra persona ya lo tomó: se avisa y el caché queda al día), `useConnectionStatus`, `useGatewaysStatus` y `useDeviceStatus` (franja «Sin señal de botones» con el nombre de cada gateway sin señal, su última señal y qué revisar; se actualiza al cambiar `gateways.status`). Accesibilidad: acciones de la cola con la mesa en el nombre, hoja de la mesa con foco y Escape, gráficas con `role="img"`; contraste AA verificado por `src/contrast.test.ts` (trazos de «pendiente» usan `--pending-line`). Todos los pisos lado a lado; la cola global abajo, siempre visible, también para mesas sin ubicar en ningún plano. Pulso de tres ondas al llegar un llamado, con tono opcional (interruptor «Sonido», apagado por defecto y recordado por dispositivo; Web Audio, `app/sound.ts`); anillo ámbar → rojo a los 2 y 5 min (ESP-24).

**Historial** (`app/History.tsx`): `useCallHistory` (rango `from` inclusivo / `to` exclusivo sobre días del navegador, mesa con `useTables`, estado; «Cargar más» sigue el cursor) y `useCallDetail` en un panel lateral con la línea de tiempo de transiciones y nombres.

**Editor de espacios** (`app/Spaces.tsx`, `app/editor-kit.tsx`): espacios = zonas (más «Salón principal» si hay mesas sin zona o no hay zonas). Por espacio carga borrador o publicado (`useLayoutDraft`), guarda con `revision` (`useSaveLayoutDraft`; 409 → recargar la versión vigente o conservar la propia y reemplazar) y publica (`usePublishLayout`). Crea espacios (`useCreateZone`) y mesas (`useCreateTable`), renombra (`useUpdateZone`, `useUpdateTable`) y desactiva mesas y espacios (`app/Deactivate.tsx`: `useDeactivateTable`/`useDeactivateZone`, con confirmación; la mesa también se quita del borrador del plano). Modo «Actividad»: llamados por mesa y área del período (`useServiceCallMetrics`). El título del espacio se confirma con Enter o al perder el foco y Escape cancela. Con cambios sin guardar, `useBlocker` + `beforeunload` avisan al salir de la pantalla o cerrar la pestaña (Guardar y salir / Descartar y salir / Seguir editando); el cambio de espacio lo pregunta el editor.

**Errores de carga**: `ErrorState` (`app/ui.tsx`) recibe `error` y `app/error-copy.ts` (`describeError`) elige copy y acción: sin conexión (`navigator.onLine`, `NetworkError`, `TypeError`) y 404/409/5xx reintentan; 401 ofrece volver a entrar; 403 no ofrece acción. Sin `error` (Board, Inventory, Spaces) usa copy genérico.

**Métricas** (`app/Metrics.tsx`): `useServiceCallMetrics` (todo el local y, al elegir una mesa, con `table_id`) sobre el plano publicado teñido por área; `useInventoryMetrics` (una consulta de todo el local: `by_product` da salidas y cantidades por producto; otra con `product_id` para la serie del producto elegido) con `useProducts` para la unidad y `useMovements` para los últimos movimientos.

**Inventario** (`app/Inventory.tsx`): `useProducts`, `useStockLocations` (lugar por defecto), `useBalances`, `useMovements` (lo de hoy, desde el inicio del día **del local**, `location.timezone`), `useReasons`, `useRegisterMovement`/`useAdjustToCount` con `Idempotency-Key` por intento (se renueva solo tras un éxito) y `useCreateProduct`. «Ver historial» (`HistoryView`): `useMovementPages`, filtros de producto, tipo y rango de fechas (días del local) en el servidor, paginación por cursor `(occurred_at, id)` y «Cargar más»; cada fila muestra motivo, fecha y quién registró. El producto se elige con botones `aria-pressed` agrupados por categoría y «Nuevo producto» es un `<dialog>` nativo (`Modal` de `ui.tsx`: Escape, foco atrapado y devuelto al disparador). Las fechas de inventario usan `fmtWhen(…, tz)`/`dayKey`/`dayStart` de `format.ts`. Vista «Lugares y motivos» (`app/InventorySettings.tsx`, con `commerce.reasons.manage` o `commerce.catalog.manage`): `useStockLocations`/`useCreateStockLocation` (alta; sin renombrar ni desactivar), `useReasons`/`useCreateReason`/`useDeactivateReason` (agrupados por dirección, desactivar con confirmación; el registro rápido solo ofrece los activos) (F4-10).

**Usuarios** (`app/Users.tsx`): `useUsers` (lista con búsqueda; tarjetas en celular), `useCreateUser` + `useSetLocationRoles` (crear exige local y roles; si el segundo paso falla se avisa con un aviso fijo), por usuario `useSetLocationRoles`, `useResetPassword` (se pide la clave nueva; la API no devuelve ninguna), `useRevokeUserSessions` y `useDeactivateUser` con `<dialog>` (no a uno mismo). Valida con `usernameSchema`/`passwordSchema` de core-contracts. `GET /users` trae los roles por local (`locations`) que el actor puede ver; la lista los muestra y el panel los precarga. No trae desactivados: un usuario desactivado sale de la lista.

## Planos: espacios y áreas (decisión del 30/10/2026)

- **Espacio** = piso o sector = zona de hospitality, con su propio plano (`zone_id` null = «Salón principal», E-01).
- **Área** = elemento `area` del plano (`{ type: 'area', name, x, y, width, height, rotation }` en `elements jsonb`, validado en `hospitality-contracts` y en `validateLayoutContent`). Sin migración.
- Una mesa pertenece al área que contiene su centro (`areaAt`). El editor no deja publicar áreas encimadas.
- Métricas por área = suma de los llamados de sus mesas con la geometría **actual** del plano publicado (`areaTotals`). Límite conocido: si una mesa cambia de área, sus llamados pasados cuentan en la nueva. Si hiciera falta el área histórica, el área tendría que ser una zona real (migración + API).

## Lenguaje visual

Tema claro (decisión del responsable sobre el oscuro de TECH-001): fondo `bg`, superficies blancas, barra lateral `ink`; color fuerte solo para estado (pendiente ámbar, en atención azul, más de 5 min rojo, siempre con ícono y texto). Un solo botón primario por vista. Gráficos hechos a mano: columnas ≤ 24 px, cuadrícula de 1 px, tooltip al pasar o enfocar, tabla oculta para lectores; entradas `#00927b` y salidas `#3865e9`, validadas con el validador de dataviz. Esqueletos al cargar; estados vacío, error (con «Reintentar») y sin conexión.

## Probarlo

```bash
pnpm --filter @modivara/portal test        # rutas por permiso, áreas del plano, contraste
docker compose up --build -d && pnpm seed  # demo completa en http://localhost/bar-demo
pnpm seed:planos-demo                      # opcional: los planos diseñados (Primer y Segundo piso con sus áreas)
pnpm test:e2e                              # Playwright contra el stack: login, tablero en vivo, editor, inventario, métricas
```

Los E2E (`e2e/`, detalle en `e2e/README.md`) cubren F1-16, F3-16, F4-11, F5-13 y L-07. Al escribirlos apareció que el personal (staff) no podía leer mesas ni zonas y su tablero mostraba «Mesa» sin número: `GET` de mesas y zonas ahora acepta `hospitality.calls.read` (modificarlas sigue exigiendo `hospitality.tables.manage`).

Para generar un llamado sin hardware: el simulador (`/sim`, con `SIM_GATEWAY_KEY` del gateway) o `POST /api/v1/device-events` con la cabecera `x-gateway-key` y `{ "device_code": "btn-07" }`.

**Consola** (`app/Console.tsx`): `usePlatformOrganizations` → negocio y local; elegir negocio hace `PUT /platform/acting-organization` (`useSetActingOrganization`: descarta cachés e invalida `/me`) y solo entonces carga las pestañas; «Dejar de actuar» o salir de la consola lo limpia (`null`). La URL sigue en `/labs` (el superadmin no es redirigido al negocio activo). Sin negocio elegido `/me` no trae locales: el shell usa un local «Plataforma» solo con permisos `platform.*`. Gateways (`useGateways`, `useCreateGateway` con la clave mostrada una vez y botón copiar, `useDeactivateGateway` con `<dialog>`; 409 `gateway_in_use` explicado), Botones (`useDevices`, `useCreateDevice`, `useAssignDevice`/`useUnassignDevice`; las mesas salen de `useTables`, que con acting-organization sirve las del negocio elegido) y Detectados (`useUnknownDevices`, ventana por defecto de la API; «Registrar y asignar» = crear + asignar).

## Decisiones abiertas del portal

- Pantallas en el portal vs. en cada `domains/<d>/web` al separar repos (ver arriba).
- Métricas de inventario: `total_delta` sin `product_id` mezcla unidades. Resuelta: la API agrega `by_product` (deltas y conteos por producto) y la UI lo usa.
- Tiempos hasta «En atención» por área: la API no filtra por área (las áreas no son zonas); el detalle de un área muestra solo llamados.
- Motivo por defecto al registrar: el primero que devuelve la API para esa dirección.
- El simulador de botones ya es apto para celular (F2-10). Consola: la API no borra botones ni gateways (solo desactiva gateways); el negocio activo vive en la sesión del superadmin, así que dos pestañas suyas comparten negocio.
