# PLAN-002 — Prototipos de tablero, métricas e inventario (L-06, F5-12, F4-09)

> **Rama:** `diseno/pantallas-operacion` (desde `main` 695547b). **Fecha:** 29/10/2026.
> **Qué es:** tres alternativas por pantalla (9 en total) como rutas `/_proto/*` con datos locales, para que el responsable elija.
> No son pantallas reales: no llaman a la API. Las formas de los datos copian los contratos (`ServiceCallMetrics`, `InventoryMetrics`, `ProductDto`, `BalanceDto`, `MovementDto`, `ServiceCallDto`).
> **Fuera de alcance:** el editor L-05 (`Editor.tsx`, `editor-kit.tsx`) no se toca; `plan.tsx` solo se importa. Única línea tocada de `Editor.tsx`: la lista `PROTOS` del índice (con permiso del responsable).

## Decisiones de la ronda de preguntas (29/10/2026)

| # | Decisión |
|---|---|
| Q1 | 3 alternativas completas por pantalla (A, B, C). |
| Q2 | Shell común igual al editor: barra lateral `ink` con wordmark y navegación por módulo, header blanco con negocio y título. |
| Q3 | Tablero en tema claro, tableta horizontal primero; en celular solo la cola. |
| Q4 | Gráficos a mano (SVG/HTML + Tailwind), sin Recharts. |
| Q5 | Carga simulada de unos 700 ms con esqueletos al entrar y al cambiar filtros; control discreto de «Estados del prototipo» (normal, cargando, vacío, error, sin conexión). |
| Q6 | Inventario = F4-09 (catálogo y saldos, entrada/salida/ajuste por conteo, historial). F4-10 (lugares y motivos) fuera. |
| Q7 | Movimiento sutil (150–250 ms) y pulso solo en mesas con llamado nuevo; todo se apaga con `prefers-reduced-motion`. |
| Q8 | Commit por pantalla y push de la rama; `main` no se toca. |

## Lenguaje visual (heredado del editor L-05)

- **Color:** `ink` #101E33 (barra lateral), `bg` #F7FAFC, `surface` #FFFFFF, `line` #D3DDE9, `connect` #1BAA95 (único primario), `interface` #3865E9 (En atención), `amber` #E6A03D (Pendiente), `danger` (> 5 min). El color fuerte se reserva al estado; superficies blancas, borde izquierdo y chips pequeños.
- **Tipo:** Manrope para títulos y números grandes (tabulares), Inter para el resto. Sin mayúsculas sostenidas en rótulos.
- **Botones:** un solo `primary` por vista (la acción que importa ahora), `secondary` para acciones de fila, `ghost` para lo terciario.
- **Datos:** secuencial en un solo tono (`interface`), sin arcoíris; estados con ícono + texto; tooltip al pasar y tabla oculta para lectores de pantalla.

## Alternativas

### Tablero (L-06) — `/_proto/tablero/{a,b,c}`
- **A · Plano y cola:** barra lateral angosta, pestañas de piso con pendientes, plano con áreas al centro y cola fija a la derecha; tocar un llamado lleva a su piso y resalta la mesa.
- **B · Cola protagonista:** tarjetas grandes legibles a distancia, cada una con un mini plano del piso que marca dónde está la mesa; el plano completo se abre aparte.
- **C · Todo el local a la vista:** los pisos lado a lado (nada queda oculto), la cola como franja inferior y las acciones en una hoja junto a la mesa tocada.

### Métricas (F5-12) — `/_proto/metricas/{a,b,c}`
- **A · Informe:** resumen en una frase, cuatro cifras sobrias, llamados por día u hora, ranking de mesas y áreas, inventario por motivo.
- **B · Sobre el plano:** el plano del editor teñido por llamados por área y mesa, panel con el detalle de lo seleccionado.
- **C · Franjas horarias:** mapa de calor día × hora para decidir cuándo reforzar personal, y saldos con su tendencia de 14 días.

### Inventario (F4-09) — `/_proto/inventario/{a,b,c}`
- **A · Tabla de saldos:** catálogo por categoría con búsqueda; un panel lateral con historial y el registro del producto.
- **B · Registro rápido:** formulario a la izquierda (tipo, producto, cantidad, motivo) y movimientos del día a la derecha; aviso claro si el saldo no alcanza.
- **C · Conteo de cierre:** hoja de conteo de todos los productos con diferencia en vivo, revisión y «Aplicar N ajustes»; historial en otra pestaña.

## Tareas

| ID | Tarea | Verificación | Estado |
|---|---|---|---|
| P-01 | Plan y tareas (este documento) | — | hecha |
| P-02 | Base común: `shell.tsx` (shell, esqueletos, carga simulada, estados, control del prototipo), animaciones en `index.css`, rutas `/_proto/{tablero,metricas,inventario}/:alt` | typecheck + build | hecha |
| P-03 | Datos de demo deterministas (`demo-data.ts`): 14 días de llamados y movimientos, agregados con la forma de los contratos | prueba Vitest: totales = suma por mesa = suma por período | hecha (`demo-data.test.ts`, valida con los esquemas Zod de los contratos) |
| P-04 | Gráficos a mano (`charts.tsx`): barras por período, ranking, mapa de calor, sparkline; tooltip y tabla oculta; paleta validada | validador de paleta de dataviz | hecha (`#00927b`/`#3865e9`: todas las comprobaciones en verde) |
| P-05 | Tablero A, B, C | typecheck, pruebas, captura de pantalla | hecha (capturas a 1366 px y 390 px) |
| P-06 | Métricas A, B, C | typecheck, pruebas, captura de pantalla | hecha (capturas de las 6 vistas: 3 alternativas × Llamados/Inventario) |
| P-07 | Inventario A, B, C | typecheck, pruebas, captura de pantalla | hecha (capturas de A, A con panel, B y C) |
| P-08 | Índice `/_proto` con los enlaces nuevos; revisión de accesibilidad (teclado, foco, contraste, movimiento reducido) | revisión manual + capturas | hecha: Escape cierra paneles y diálogos, transiciones apagadas con movimiento reducido, foco visible en las mesas del SVG, estados con ícono + texto, tablas ocultas en los gráficos. Pendiente para pantallas reales: trampa de foco (usar `<dialog>` nativo). Índice: 3 líneas en `PROTOS` de `Editor.tsx`. |
| P-09 | Verificación final (`pnpm typecheck`, `pnpm test`, build del portal), commit por pantalla y push de la rama | salida de los comandos | hecha: typecheck del monorepo, 44 pruebas del portal, build del portal y `check:separability` en verde; 5 commits en `diseno/pantallas-operacion`, subidos. |

## Cómo revisarlos

`pnpm --filter @modivara/portal dev` y abrir `/_proto`. Cada pantalla tiene abajo a la derecha el control «Prototipo» para cambiar de alternativa (A, B, C) y forzar estados: cargando (esqueletos), vacío, error y sin conexión; el tablero además simula pulsaciones y botones desconectados. Atajos por URL: `/_proto/metricas/<alt>?tab=stock` abre Inventario en métricas, `/_proto/inventario/<alt>?tab=history` abre el historial y `/_proto/inventario/a?abrir` abre el panel de un producto.

Verificado con capturas a 1366 px (las 9 alternativas) y a 390 px (tablero A y C, esqueleto de métricas A e inventario B). El resto del celular está hecho con grillas responsivas pero no se capturó.

## Notas para la decisión

### Tablero (L-06)
- **A · Plano y cola:** la más cercana a ADR-003 §7. El primer pendiente de la cola es más grande y lleva el único botón primario; un llamado en otro piso muestra un aviso «Ir a la mesa». Mejor para una tableta fija en la barra.
- **B · Cola protagonista:** se lee a distancia (número de mesa de 60 px, tiempo grande) y el mini plano responde «dónde» sin interpretar el plano completo, que se abre en un panel lateral. Mejor si el personal mira de pasada; el plano pierde protagonismo frente a ADR-003.
- **C · Todo el local a la vista:** ambos pisos a la vez, así nada queda oculto; la cola es una franja abajo y la acción va en una hoja sobre la mesa tocada. Con más de dos pisos o planos grandes las mesas se achican: haría falta desplazamiento o un piso por pantalla.
- Comunes: tema claro; pulso de tres ondas solo cuando llega un llamado; anillo de espera ámbar→rojo (2 y 5 min, ESP-24); en celular solo la cola, con la acción en la fila; sin conexión deshabilita las acciones y lo dice; «Botones desconectados» siempre visible.
- Sin prototipar: la alerta sonora opcional de F3-13.

### Métricas (F5-12)
- **A · Informe:** se lee de arriba abajo como un resumen semanal: una cifra protagonista dentro de una frase, tres cifras de contexto, llamados por día (u hora para «Hoy»/«Ayer», con la cubeta en curso rayada para que no parezca una caída), ranking de mesas y de áreas. En Inventario: movimientos por día, salidas por motivo, entradas y salidas de un producto a elegir y tabla de saldos.
- **B · Sobre el plano:** el mismo plano del editor teñido por área (un solo tono) con el total de cada mesa; tocar un área o una mesa cambia el panel de la derecha. Es la que mejor responde «¿dónde se pide más servicio?» y conecta con el modo Actividad del editor; habría que decidir si las dos conviven o una reemplaza a la otra. En Inventario: ranking de salidas por producto con detalle al lado.
- **C · Franjas horarias:** mapa de calor día × hora y promedio por hora del día, para decidir turnos. En Inventario: saldos con su tendencia de 14 días ordenados por «alcanza para ~N días» (estimación marcada como tal; borde ámbar si son menos de 3).
- **Hallazgo del contrato (decisión abierta):** `by_reason.total_delta` y `by_period.in_delta/out_delta` suman cantidades de productos con unidades distintas (botellas + kg) si no se filtra por `product_id`. Los prototipos muestran conteos de movimientos para todo el local y cantidades solo por producto. Opciones: dejarlo así en la UI, o que la API devuelva los deltas agrupados por producto.
- **Le falta a la API para C:** tiempos hasta «En atención» por franja horaria (hoy solo hay el total del período).
- Rangos: «30 días» avisa desde qué fecha hay datos (la demo tiene 14).

### Inventario (F4-09)
- **A · Tabla de saldos:** el catálogo por categoría con búsqueda y el último movimiento de cada producto; tocar una fila abre un panel con saldo grande, el formulario (salida, entrada o ajuste por conteo) y el historial del producto. Pestaña «Historial» con filtros por producto y tipo. Mejor para quien administra.
- **B · Registro rápido:** pensado para el que está en la barra: elegir tipo, tocar el producto (cada botón muestra su saldo), cantidad con − y +, motivo y registrar; la nota se agrega solo si hace falta. A la derecha, lo registrado hoy (lo nuevo entra con un leve desplazamiento).
- **C · Conteo de cierre:** hoja con todos los productos y un campo «contado»; la diferencia aparece al escribir y una barra muestra cuántos van. Solo las diferencias se aplican, después de revisarlas, como «Corrección de conteo». Entradas y salidas sueltas en un diálogo aparte. Es la que mejor refleja el ajuste por conteo de DATA-001 §4 aplicado a todo el local.
- Comunes: errores en palabras del usuario con la regla de la API (cantidad mayor que cero, «No alcanza: hay 2 botellas de Whisky y quieres sacar 3», conteo igual al saldo = nada que ajustar); el botón pasa a «Registrando…» para evitar el doble toque; alta de producto con la unidad fija; sin conexión no se envía y el formulario conserva lo escrito.
- Decisión abierta: un umbral de «stock bajo» por producto no existe en el modelo; C de métricas lo aproxima con «alcanza para ~N días», que es una estimación.
