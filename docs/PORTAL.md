# Portal — pantallas, permisos y datos (estado al 30/10/2026)

> Documento descriptivo del frontend tal como está en `main` (8cce82a). No es un ADR: las decisiones de producto viven en ADR-001…003, TECH-001 y DATA-001; el plan y el estado por tarea, en PLAN-001 y PLAN-002.

## Rutas

| Ruta | Qué es | Quién la ve |
|---|---|---|
| `/<negocio>` | Login por negocio (ADR-002 D2). Con sesión de ese negocio redirige a la app; con sesión de otro, muestra el login para entrar a este. | Todos |
| `/<negocio>/app` | Abre la primera pantalla permitida. | Con sesión |
| `/<negocio>/app/tablero` | Tablero operativo sobre los planos publicados (L-06). | Módulo `hospitality` + `hospitality.calls.read` |
| `/<negocio>/app/espacios` | Editor de espacios y planos (L-05). | Módulo `hospitality` + `hospitality.tables.manage` |
| `/<negocio>/app/metricas` | Métricas de llamados e inventario (F5-12). | Módulo `analytics` + `analytics.calls.read` o `analytics.inventory.read` |
| `/<negocio>/app/inventario` | Registro de stock (F4-09). | Módulo `commerce` + `commerce.stock.read` |
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

**Tablero** (`app/Board.tsx`): `useLayouts` (planos publicados de todos los espacios), `useZones`, `useTables`, `useActiveCalls` (REST + `service_call.changed` por Socket.IO), `useAcknowledgeCall`/`useCompleteCall` (409 si otra persona ya lo tomó: se avisa y el caché queda al día), `useConnectionStatus` y `useGatewaysStatus`. Todos los pisos lado a lado; la cola global abajo, siempre visible, también para mesas sin ubicar en ningún plano. Pulso de tres ondas al llegar un llamado; anillo ámbar → rojo a los 2 y 5 min (ESP-24).

**Editor de espacios** (`app/Spaces.tsx`, `app/editor-kit.tsx`): espacios = zonas (más «Salón principal» si hay mesas sin zona o no hay zonas). Por espacio carga borrador o publicado (`useLayoutDraft`), guarda con `revision` (`useSaveLayoutDraft`; 409 → recargar la versión vigente o conservar la propia y reemplazar) y publica (`usePublishLayout`). Crea espacios (`useCreateZone`) y mesas (`useCreateTable`), renombra (`useUpdateZone`, `useUpdateTable`). Modo «Actividad»: llamados por mesa y área del período (`useServiceCallMetrics`).

**Métricas** (`app/Metrics.tsx`): `useServiceCallMetrics` (todo el local y, al elegir una mesa, con `table_id`) sobre el plano publicado teñido por área; `useInventoryMetrics` por producto (una consulta por producto, `ponytail:`) con `useProducts` para la unidad y `useMovements` para los últimos movimientos.

**Inventario** (`app/Inventory.tsx`): `useProducts`, `useStockLocations` (lugar por defecto), `useBalances`, `useMovements` (100 más recientes), `useReasons`, `useRegisterMovement`/`useAdjustToCount` con `Idempotency-Key` por intento (se renueva solo tras un éxito) y `useCreateProduct`.

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
```

Para generar un llamado sin hardware: el simulador (`/sim`, con `SIM_GATEWAY_KEY` del gateway) o `POST /api/v1/device-events` con la cabecera `x-gateway-key` y `{ "device_code": "btn-07" }`.

## Decisiones abiertas del portal

- Pantallas en el portal vs. en cada `domains/<d>/web` al separar repos (ver arriba).
- `GET …/movements` no trae el nombre de quien registró: el inventario muestra «tú» o nada.
- Métricas de inventario: `total_delta` sin `product_id` mezcla unidades; la UI muestra conteos para todo el local y cantidades por producto. ¿La API agrega `by_product`?
- Tiempos hasta «En atención» por área: la API no filtra por área (las áreas no son zonas); el detalle de un área muestra solo llamados.
- Motivo por defecto al registrar: el primero que devuelve la API para esa dirección.
- Pendientes de pantalla: usuarios (F1-15), historial de llamados (F3-14), consola de superadmin (F2-14, F3-15), lugares y motivos (F4-10), desactivar mesas y zonas, simulador para celular (F2-10), alerta sonora del tablero, E2E con Playwright.
