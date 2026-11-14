# PLAN-POS-001 v3 — Implementación del POS horizontal e integración opcional con mesas (`pos/mesas`)

> **Versión:** 3.0 — plan exclusivo de la rama `pos/mesas`, coordinado con PLAN-003. Sustituye operativamente la versión 2.0; preserva los ID `POS-*`.
> **Fecha:** 11 de noviembre de 2026.
> **Repositorio / rama de trabajo:** `yojr23/modivara` / `pos/mesas`. **PR objetivo:** `pos/mesas → pruebas`. Después, `pruebas → main`.
> **Estado:** plan propuesto, sin cambios aplicados al repositorio. No constituye un ADR aprobado.
> **Línea base revisada (11/11/2026):** `pos/mesas` (`130eadb3`) deriva de `pruebas` (`18289d6`), adelantada dos commits, con un solo archivo nuevo respecto de la base: `docs/ADR-005_propuesta_pos_cuentas_por_mesa.md`. No existe todavía `domains/pos`. Antes de implementar, reconfirmar el diff, porque el repositorio puede cambiar.
> **Documentos a reconciliar:** ADR-001 (POS asociado previamente a Commerce), ADR-002 (separabilidad), ADR-003 (tablero y mesas), ADR-005 (propuesta por mesa, en evaluación), DATA-001, TECH-001 y PLAN-001.
> **Criterio de precedencia:** el cambio a cinco dominios/productos requiere la decisión nueva `ADR-006` (propiedad de la rama de PLAN-003). `ADR-005` debe marcarse como **propuesta superada** en su orientación de POS por mesa, sin falsear el historial. No cambiar migraciones antes de aceptar ADR-006.

---

## 0. Contrato de esta rama y coordinación obligatoria con PLAN-003

**Este es uno de dos planes por rama, no un backlog unificado.** La otra rama es `test/plan-003-modularidad`, creada desde `pruebas`, con su propio archivo `PLAN-003_modularidad_pruebas_rama.md`. Ambas ramas se integran por PR a `pruebas`; no se fusionan entre sí. La rama POS es dueña del **nuevo producto**; la rama PLAN-003 es dueña de **hacer separable y verificable la plataforma existente**.

| En `pos/mesas` (este plan) | En `test/plan-003-modularidad` (otro plan) |
|---|---|
| `domains/pos/{contracts,api,web}`, esquema y rol `pos`, venta genérica, API, permisos y entitlement `pos`. | Quitar dependencia inversa `core-api → hospitality-contracts`, endurecer `check:separability` y validar arranque real Core + Commerce. |
| Adaptador Hospitality→POS, acción contextual en tablero y pruebas de venta por mesa. | Composición configurable y subscribers opcionales en host, sin inicializar productos ausentes; validación de activación tardía. |
| Host Core+POS de prueba usando la infraestructura de composición que ya haya entrado a `pruebas`. | Correcciones de UI Inventory sector-neutral y Analytics sin hooks obligatorios hacia otras fuentes. |
| E2E POS-only (retail/café/servicios) y Hospitality+POS. | E2E Inventory-only, Hospitality-only, Inventory+Analytics, tenant/entitlements y regresión del piloto. |

**Archivos potencialmente conflictivos:** `apps/api/src/app.module.ts`, `apps/api/src/integration-subscribers.module.ts`, `scripts/check-separability.mjs`, `apps/portal/src/routes/AppShell.tsx` y contratos de Core. Regla: **PLAN-003 modifica primero la infraestructura compartida**; POS se actualiza desde `pruebas` después de integrar ese PR. En `pos/mesas` agregar el módulo `pos` y su UI sobre esa infraestructura; no replicar una segunda implementación de composición. `identity.ts`, permisos POS y migración de `core.module` son responsabilidad **exclusiva de esta rama**.

**Puerta de entrada:** se puede diseñar y probar el dominio POS en paralelo, pero no declarar listo el runtime Core+POS ni enviar PR final mientras falten los cambios de composición y neutralidad de Core de PLAN-003. La decisión ADR-006 debe estar integrada antes de crear migraciones POS definitivas.

**Orden Git recomendado (sin cambiar ramas protegidas directamente):**

```bash
# PLAN-003 integra primero sus arreglos en pruebas mediante PR.
git fetch origin
git switch pos/mesas
git merge origin/pruebas  # o rebase controlado, si la rama aún no es compartida y se acuerda
git status --short
git diff --stat origin/pruebas...HEAD
# Resolver conflictos respetando ownership; volver a ejecutar toda la batería.
# Abrir PR pos/mesas -> pruebas; jamás pos/mesas -> main.
```

**No confundir los hitos:** terminar la rama `pos/mesas` exige POS-only + Hospitality→POS; **no** exige la futura sincronización POS→Inventario ni las métricas de venta POS→Analytics. Se documentan como integraciones posteriores para no perder su trazabilidad.

---

## 1. Objetivo de producto: tres independencias distintas

**POS es un producto horizontal de la plataforma Modivara, comercializable por sí mismo y reutilizable en negocios de distintos sectores.** La gastronomía es el primer escenario de integración, no el contexto que define su modelo.

Hay **tres propiedades diferentes**, y la rama debe demostrar las tres:

| Propiedad | Significado | Prueba objetiva |
|---|---|---|
| **Independencia comercial (SaaS)** | POS tiene habilitación, permisos, navegación, configuración y propuesta comercial propios. No se contrata Inventario, Hospitality ni Analytics para acceder a POS. | Dar de alta un cliente con **solo POS**, sin crear mesas ni asignar permisos de otros productos, y ejecutar una venta completa. |
| **Independencia técnica/de dominio** | El núcleo de POS posee reglas, datos, API, contratos y eventos propios. No importa código ni consulta bases de datos de otros dominios opcionales. | Compilar, probar y levantar una composición **Core + POS** sin instalar/activar Hospitality, Commerce o Analytics ni sus esquemas. |
| **Agnosticismo sectorial** | El POS no sabe si una venta pertenece a bar, restaurante, tienda, supermercado, ferretería o servicios. Su modelo no presupone mesas, carta gastronómica ni tipo de negocio. | Ejecutar **el mismo API y modelo de venta**, sin condicionales por rubro, con artículos de zapatería, café y servicios. |

**Única dependencia común admitida:** Platform Core, como proveedor de identidad, organización, local, autorización y entitlements. Eso no impide vender POS como un producto separado: Core es infraestructura compartida de la plataforma. Una eventual extracción de repositorio debe consumir **contratos/APIs públicos de Core**, no sus tablas ni clases internas.

### Reglas arquitectónicas no negociables

1. `POS` **no importa** `hospitality-api`, `commerce-api`, `analytics-api`, sus paquetes web ni sus tablas PostgreSQL. Integraciones externas se implementan en adaptadores/composición fuera del núcleo POS.
2. El dominio POS **no contiene** campos, enumeraciones o decisiones como `table_id`, `restaurant_id`, `waiter_id`, `businessType`, `menu_item`, `shoe_size` o `if (industry === 'restaurant')` en sus entidades/casos de uso. Los adaptadores sectoriales pueden usar estos conceptos, **no el core POS**.
3. **Ninguna venta necesita un contexto externo.** Un cliente POS-only puede crear, cobrar declarativamente y consultar ventas sin un proveedor de contexto. «Mostrador» es una experiencia de UI, no un tipo de venta obligatorio.
4. El núcleo solo conoce conceptos transversales: **artículo vendible, catálogo de venta, venta/ticket, línea, cantidad, precio, moneda, estado, cobro registrado, actor y auditoría**.
5. POS tiene **catálogo vendible propio**, aunque no exista Inventario. Su catálogo representa lo que se ofrece y el precio; Inventario decide existencias y consumos. No deben confundirse ambos modelos.
6. La vinculación de una venta a mesas, pedidos externos u otros objetos se hace mediante un **mecanismo genérico de referencia externa, opcional y validado por un adaptador registrado**. No se aceptan IDs externos arbitrarios provenientes del cliente.
7. POS emite **eventos de venta genéricos**. Ningún consumidor (Inventario, Analytics, Hospitality) es obligatorio para confirmar una venta.
8. Cada producto conserva entitlements, permisos y reglas propias. La UI puede componerse en un mismo portal, pero una integración no se convierte en una dependencia de inicio o operación del POS.
9. La extracción posterior de `domains/pos` a su repositorio/despliegue debe ser factible sin reescribir su lógica de negocio. **No se exige abrir hoy otro repositorio o microservicio**.
10. Las operaciones respetan `organization_id`, `location_id`, permisos y trazabilidad; no confían en un tenant indicado por el navegador.

### Qué significa y qué **no** significa agnóstico

**Sí:** una referencia de zapatos talla 42 puede venderse como un SKU, un café como una unidad y un servicio por horas mediante las mismas reglas de venta. **No:** que el primer MVP ya incluya gestión especializada de tallas, comandas, facturación fiscal, devoluciones avanzadas o reservas. Estas son capacidades verticales o ampliaciones futuras. El núcleo no debe impedirlas, pero tampoco implementarlas anticipadamente.

---

## 2. Definición del producto vendible y escenarios obligatorios

### Composición comercial independiente

La plataforma objetivo comprende `core` (infraestructura compartida), `pos`, `inventory` (**denominado `commerce` en el código actual**), `analytics` y `hospitality`. Este cambio enmienda el objetivo de cuatro dominios de ADR-001: POS e Inventario pasan a ser **productos separados**. En esta rama no se recomienda renombrar masivamente `commerce`; ese trabajo se gestiona aparte para evitar regresiones.

**POS requiere únicamente Core**, no un catálogo de Inventario ni una mesa de Hospitality. Un plan comercial futuro podría contratar POS, Inventario, Analytics o Hospitality en combinaciones; las restricciones de uso las controla Core por producto y permiso, no una variable `businessType`.

### Pruebas de producto que determinan el diseño

| Escenario | Módulos habilitados | Flujo obligatorio | Lo que demuestra |
|---|---|---|---|
| **Zapatería** | Core + POS | Crear artículos con SKU (`ZAP-NEG-42`), precio y cantidad; vender, registrar método de pago, consultar historial. | POS no depende de Hospitality; maneja productos genéricos sin campos de gastronomía. |
| **Cafetería de mostrador** | Core + POS | Vender bebidas sin mesa y cerrar venta. | POS no requiere referencias externas ni Inventario. |
| **Servicios** | Core + POS | Registrar un servicio vendido con unidad/medida y cantidad decimal cuando aplique (p. ej. 1,5 h). | El modelo no asume que todo es una pieza física entera. |
| **Bar o restaurante** | Core + POS + Hospitality | Tocar una mesa, abrir/recuperar su venta, agregar consumos y cerrar; llamados y ventas no comparten estado. | Adaptador vertical opcional, sin lógica de mesa en POS. |
| **Tienda solo Inventario** | Core + Commerce | Gestionar artículos/stock sin registrar ventas POS ni ver sus pantallas. | Inventario también puede comercializarse por separado. |
| **POS + Inventario** | Core + POS + Commerce | Vender aunque Inventario esté caído; procesar descuento de stock asíncrono cuando esté disponible y mapeado. | Integración opcional y tolerancia a fallas. |
| **POS + Analytics** | Core + POS + Analytics | Venta normal y proyección de ventas mediante eventos. | Analytics consume datos, no gobierna la venta. |

**Límite explícito:** el escenario de zapatería valida la transversalidad del motor con SKUs simples; **no** equivale a un producto retail especializado completo. Variantes jerárquicas, cambios/devoluciones, facturación y lectores de código de barras quedan sujetos a necesidades reales y fases posteriores.

### Capacidad mínima del primer entregable

- Alta y mantenimiento de **artículos vendibles** por local: nombre, identificador, SKU/código opcional, categoría libre, precio, unidad configurable, estado, moneda.
- Apertura de venta/ticket sin contexto, líneas con cantidades **decimales exactas** y snapshots de nombre/SKU/precio/unidad; anulación auditable.
- Cálculo del total con aritmética decimal; registro **declarativo** del medio de cobro y cierre; historial paginado.
- API documentada, permisos POS, entitlements propios, aislamiento por organización/local, idempotencia, control de concurrencia, outbox y trazas.
- Interfaz POS autónoma (móvil/escritorio), catálogo y ventas; integración adicional con tablero de mesas mediante adaptador.
- Tests funcionales de los primeros cuatro escenarios y prueba de composición solo con Core + POS.

**No se incluye aún:** pasarela de pago, caja/arqueo, fiscalización electrónica, motor de impuestos, facturación, comandas, reservas, recetas, promociones, descuentos, devoluciones, multi-tender, variantes avanzadas, operación offline, integración de códigos de barras. «Cobro» solo significa que el operador **declaró** un pago; no significa que Modivara procesó dinero ni que emitió un comprobante fiscal válido. Validar requisitos fiscales de cada mercado antes de comercializarlo como sustituto de facturación.

---

## 3. Arquitectura de referencia y límites de integración

### Distribución de paquetes

```text
domains/
  core/                    # identidad, organización, permisos, entitlements
  pos/
    contracts/             # API pública y eventos de venta genéricos
    api/
      src/domain/          # SellableItem, Sale, SaleLine, Money, Quantity
      src/application/     # casos de uso, puertos, transacciones
      src/infrastructure/  # prisma, esquema pos, outbox, migraciones
      src/presentation/    # rutas y adapters de transporte
    web/                   # cliente, hooks y UI reusable de POS
  commerce/                # inventario existente (nombre técnico temporal)
  analytics/               # proyecciones y métricas
  hospitality/             # mesas, botones, espacios y llamados

apps/api/                  # composición; puede ensamblar Core + POS exclusivamente
apps/portal/               # composición UX, rutas y navegación
integrations/ o composición host
  hospitality-pos/         # traduce mesa autorizada -> referencia POS
  inventory-pos/           # consume eventos POS -> movimientos de inventario
  analytics-pos/           # consume eventos POS -> proyecciones
```

La ubicación `integrations/` es **orientativa**: se puede implementar en `apps/api` o dentro de un adaptador de borde sin abrir paquetes nuevos innecesarios. **La regla es la dirección de dependencia, no la carpeta:** ningún concepto sectorial ingresa a `pos/domain` o sus contratos comerciales genéricos.

### Modelo canónico — ninguna mesa dentro del núcleo

```ts
interface Sale {
  id: string;
  organizationId: string;
  locationId: string;
  currency: string;
  status: 'open' | 'completed' | 'voided';
  // líneas, totales, actor, timestamps, versión/revisión
}

interface SaleLine {
  sellableItemId: string;
  skuSnapshot?: string;
  nameSnapshot: string;
  unitSnapshot: string;
  unitPriceSnapshot: string; // decimal exacto
  quantity: string;          // decimal exacto y positivo
}

// Extensión opcional y genérica, FUERA de la entidad Sale:
interface ExternalSaleReference {
  provider: string;     // origen registrado: p. ej. hospitality
  resourceType: string; // p. ej. table, external_order, booking
  resourceId: string;
}
```

**Base de datos propuesta:** `pos.sellable_items`, `pos.sales`, `pos.sale_lines`, `pos.sale_external_links` (opcional), `pos.outbox_events`, claves de idempotencia. `pos.sales` **no tiene** `table_id`, `table_label`, `business_type` ni `restaurant_*`. El vínculo opcional usa columnas genéricas `(organization_id, location_id, provider, resource_type, resource_id, sale_id, active)`; un índice único parcial restringe **un vínculo activo por recurso externo** cuando la integración lo requiera. El alta/cierre de la venta y activación/desactivación del vínculo se realizan atómicamente dentro del esquema POS.

La API estándar `POST /sales` **no exige referencia externa**. Un adaptador de integración registrado puede invocar el caso de uso con una referencia ya validada, autorizada y acotada al tenant/local. No exponer una capacidad ilimitada de adjuntar identificadores arbitrarios en la API pública: cada `provider` requiere autenticación/autorización y validación del recurso. La garantía de «una cuenta abierta por mesa» se expresa como una **política del adaptador Hospitality**, soportada por la restricción genérica de vínculos activos; POS no conoce la palabra mesa.

**Prueba adversarial:** el núcleo no puede hacer consultas a `hospitality.dining_tables`, y enviar una referencia falsa/de otro local por un adaptador debe fallar antes de abrir la venta. Debe ser imposible asignar un vínculo existente a una venta de otro tenant.

### Contratos de eventos

Evento `pos.sale.completed.v1` con `sale_id`, `organization_id`, `location_id`, `currency`, `total`, `completed_at`, `lines[]` y datos mínimos de auditoría. **No requiere** `table_id`, `menu_item_id` o datos de Inventario. Una referencia externa puede acompañar el evento en una sección opcional genérica **solo si existe** y si el contrato establece su necesidad; los consumidores no pueden presuponerla.

El cierre y su evento se persisten en **una transacción**. Los suscriptores reciben eventos *at-least-once* y deben deduplicar. Fallas de Inventario/Analytics no revierten ventas ya cerradas; se observan y reconcilian. La unidad de integración del POS es el contrato público/evento, no las tablas internas.

### Interfaz transversal vs. integración vertical

- **POS autónomo:** pantalla `POS`, catálogo, ticket abierto y ventas cerradas; no necesita un módulo gastronómico ni acceso a sus componentes React.
- **Hospitality:** el tablero `Board.tsx` y `TableSheet` muestran una **acción contextual** «Abrir/Ver venta» mediante un adaptador. Si POS no está contratado, el tablero funciona sin la acción y sin llamadas a POS.
- **Inventario:** suscripciones y mapeos desde el producto Inventario (no dentro del dominio POS), vinculando artículo vendible → uno o varios consumos de stock.
- **Analytics:** suscripción a eventos y vistas propias; POS no consulta los reportes para operar.

---

## 4. Backlog ejecutable por fases

**Prioridades:** `P0` = necesario para demostrar agnosticismo, comercialización independiente y piloto por mesa; `P1` = integraciones opcionales posteriores que no bloquean POS. **Complejidad orientativa:** `S` baja, `M` media, `L` alta. Reestimar después de formalizar el ADR y revisar CI; no son compromisos de calendario.

### Fase P0 — Formalizar independencia y agnosticismo antes de implementar

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-01** | P0 | Ejecutar línea base: build, typecheck, tests, integración, E2E y separabilidad en rama existente. | Resultado reproducible; se distinguen fallas heredadas. | — | M |
| **POS-02** | P0 | Registrar en `ADR-005` que su propuesta `checks.table_id NOT NULL` queda **superada por ADR-006**; definir contratos POS horizontales en documento de diseño propio sin borrar la propuesta histórica. | La revisión documental muestra explícitamente por qué una venta no requiere mesa; sin reescritura retrospectiva. | POS-01, ADR-006 aceptado en PLAN-003 | M |
| **POS-03** | P0 | Actualizar documentación **derivada** y referencias de arquitectura a `ADR-006` aprobado; no modificar el texto histórico de ADR-001/002/003. | La documentación vigente y el contrato del quinto producto no contradicen la nueva decisión; históricos permanecen intactos. | POS-02 | S |
| **POS-04** | P0 | Especificar contratos públicos, lenguaje ubicuo, escenarios zapatería/café/servicios/bar, matriz de permisos, límites fiscales y reglas de aceptación. | Contratos y criterios no requieren `businessType`, `tableId` o `inventoryProductId` para vender; casos sectoriales documentados. | POS-02 | M |

**Puerta P0:** no iniciar migraciones hasta integrar y aprobar `ADR-006` desde PLAN-003, registrar la supersesión del diseño original de ADR-005 y validar el contrato de referencias externas. La revisión de POS no modifica los ADR históricos.

### Fase P1 — Producto SaaS independiente y composición mínima

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-05** | P0 | Crear `domains/pos/{contracts,api,web}` con scripts, exports, build y test siguiendo estructura existente. | Compilan los paquetes y `check:separability` los detecta. | POS-04 | M |
| **POS-06** | P0 | Integrar entitlement `pos`, permisos POS independientes, roles aplicables y migración incremental del enum de `core.module`. | Superadmin habilita POS en un cliente sin habilitar otros; API rechaza usuarios sin entitlement o permiso. | POS-05 | M |
| **POS-07** | P0 | Crear esquema/rol `pos_app`, `POS_DATABASE_URL`, Prisma y migraciones para instalación nueva y base existente. | `pos_app` solo accede a `pos`; no necesita esquemas de otros productos opcionales. | POS-05 | L |
| **POS-08** | P0 | Integrar `PosModule` en host/portal y crear **composición real de prueba Core + POS** sobre la composición opcional provista por PLAN-003. | API y pantalla POS arrancan solo con Core + POS; no requieren esquemas, variables, proveedores, subscribers ni imports ejecutables de otros dominios. | POS-06,07; MOD-10/12/13 integrados en `pruebas` | L |
| **POS-09** | P0 | Alta operativa y configuración propia de POS por cliente/local: moneda, catálogo, permisos y navegación. | Cliente POS-only usa el producto sin configurar plano, mesa, gateway, inventario o indicadores. | POS-06,08 | M |

**Puerta P1:** demostrar runtime Core + POS, no solo compilación estática; la composición de prueba no supone abrir otro microservicio en producción.

### Fase P2 — Núcleo POS **sin sector de negocio**

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-10** | P0 | Modelar `SellableItem`: nombre, SKU opcional, precio, moneda, unidad, estado; sin campos retail/gastronómicos obligatorios. | Se vende café, zapato SKU y servicio con el mismo objeto y validación. | POS-04,05 | M |
| **POS-11** | P0 | Implementar `Money` y `Quantity` con decimal exacto, validaciones y snapshots comerciales. | Cantidades fraccionarias válidas según unidad; ningún total usa coma flotante binaria. | POS-10 | M |
| **POS-12** | P0 | Agregado `Sale` + `SaleLine`, estados, apertura sin referencia, líneas, anulaciones, cierre y auditoría. | Puede completarse una venta sin `table`/`counter`, sin Inventario y sin Analytics. | POS-11 | L |
| **POS-13** | P0 | Puertos de repositorio/UoW específicos, inyección Core, casos de uso testeables sin Nest/Prisma. | No hay imports ajenos al dominio POS y contratos compartidos permitidos; sin UnitOfWork abstracto innecesario. | POS-12 | M |
| **POS-14** | P0 | Persistencia Prisma/SQL en `pos.sellable_items`, `pos.sales`, `pos.sale_lines`, locks, FK internas, claves compuestas y auditoría. | Tests PostgreSQL de dos organizaciones/locales, snapshots, invariantes y escrituras concurrentes. | POS-07,12 | L |
| **POS-15** | P0 | Modelar **enlace externo opcional genérico** (`provider/resourceType/resourceId`) con índice de unicidad activo y política de validación/adaptadores. | POS abierto sin enlace funciona; no aparece `table_id` en `pos.sales` ni tipo de mesa en dominio; no se acepta vínculo no autorizado. | POS-12,14 | L |

**Puerta P2:** búsqueda estática de nombres sectoriales y pruebas por tres sectores en el **mismo modelo**; el único código que puede hablar de `table` debe vivir en el adaptador vertical futuro.

### Fase P3 — API y eventos de venta neutrales

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-16** | P0 | API REST v1 de catálogo POS y ventas (crear, consultar, agregar/anular líneas, cerrar, historial). | Rutas genéricas `/pos/items` y `/pos/sales`; API no recibe `businessType`, `tableId` ni insumo de Inventario en operaciones estándar. | POS-14 | L |
| **POS-17** | P0 | Guards Core: entitlement POS, permisos por acción, tenant/local, errores de seguridad y paginación. | No filtra existencia de datos de otra organización; 401/403/404/409 consistentes. | POS-16 | M |
| **POS-18** | P0 | Idempotencia de mutaciones y concurrencia: abrir/agregar/anular/cerrar, retry de red y doble clic. | Repetir una petición no duplica venta/línea/evento; dos cierres simultáneos no generan doble cobro registrado. | POS-16 | L |
| **POS-19** | P0 | Outbox, `pos.sale.completed.v1` genérico, poller, reintentos, reader de historial y logs. | Cierre + evento atómicos; ningún campo de mesa o inventario obligatorio; fallo de consumidores no altera la venta. | POS-18 | L |
| **POS-20** | P0 | Test suite de contrato API contra **tres catálogos sectoriales distintos** usando exactamente los mismos endpoints. | Zapatería, cafetería y servicios pasan sin ramas condicionales por rubro. | POS-16,19 | M |
| **POS-21** | P0 | Tests de esquema y seguridad, payload externo manipulado, concurrencia, precios históricos, moneda/unidades y reconstrucción del historial. | No hay acceso cruzado ni ventas duplicadas; snapshots y cálculos exactos. | POS-17,18,19 | L |

**Puerta P3:** POS registra y consulta ventas mediante API neutral con Core como único producto requerido.

### Fase P4 — Experiencia autónoma y comercialización POS-only

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-22** | P0 | `pos-web`: cliente HTTP, hooks, errores e invalidaciones **sin importar** `hospitality-web`/`commerce-web`. | Componentes y hooks POS reutilizables en portal sin dominios verticales. | POS-16 | M |
| **POS-23** | P0 | Pantalla autónoma `POS`: selección de vendibles/SKU, cantidades/unidades, venta, total, cobro declarativo y cierre responsive. | Usa el mismo flujo para zapato, café y servicio; no solicita mesa o tipo de negocio. | POS-22 | L |
| **POS-24** | P0 | Catálogo POS y listado/historial de ventas propio, configuración mínima por local. | Un cliente POS-only puede operar todo sin habilitar Inventario ni Hospitality. | POS-22,23 | L |
| **POS-25** | P0 | Activación/desactivación comercial del producto desde Core; navegación y guards consistentes; permisos por local. | Contratar POS no concede acceso a Inventario/Analytics/Hospitality; revocar POS bloquea API, no solo el menú. | POS-09,24 | M |
| **POS-26** | P0 | E2E de onboarding POS-only, venta retail, venta cafetería y venta servicio, tanto móvil como escritorio. | Pantalla/ruta/API funcionan con composición Core + POS y sin esquema de dominios opcionales. | POS-20,24,25 | L |

**Puerta P4 (hito del producto autónomo):** POS ya es viable como producto SaaS independiente para registro básico de ventas. **Recién aquí** comenzar la integración con mesas.

### Fase P5 — Adaptador gastronómico opcional (sin contaminar POS)

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-27** | P0 | Contrato/adaptador `Hospitality → POS` en la composición host: resolver y validar mesa por organización/local, estado y entitlement. | Mesa inexistente, inactiva o de otro local rechazada antes de crear vínculo; `pos/domain` no importa Hospitality. | POS-15,26 | L |
| **POS-28** | P0 | Vincular mesa a venta mediante `ExternalSaleReference` genérico; imponer una venta abierta por recurso externo de tipo mesa mediante la política del adaptador. | Dos usuarios no abren dos cuentas para la misma mesa; POS genérico sigue aceptando ventas sin vínculo. | POS-27 | L |
| **POS-29** | P0 | Integrar acción «Abrir/Ver venta» en `Board.tsx`/`TableSheet`; estado de atención separado del de venta. | Completar un llamado no cierra venta y cerrar venta no finaliza el llamado; Hospitality-only no llama a POS. | POS-28 | L |
| **POS-30** | P0 | UX móvil, acceso a mesas sin plano y recuperación de conflictos tras edición por dos meseros. | Se puede operar una venta por mesa desde móvil aun sin llamado activo ni plano publicado. | POS-29 | L |
| **POS-31** | P0 | E2E bar + POS + Hospitality y regresión Hospitality-only. | Funcionalidad de mesas funciona con POS habilitado o deshabilitado; no aparece código gastronómico en el núcleo POS. | POS-29,30 | M |

**Nota de tiempo real:** inicialmente invalidación/refetch por mutación y al volver a foco; agregar un evento de cambio POS si el piloto exige sincronización inmediata. No reutilizar eventos `service_call.changed` para representar ventas.

### Fases P6 y P7 — Contratos previstos, implementación fuera de este PR

**No ejecutar POS-32…POS-38 en `pos/mesas` para cerrar esta rama.** Se conservan como backlog de evolución, para **ramas posteriores derivadas de `pruebas` una vez que POS esté integrado**:

| ID conservados | Futura rama orientativa | Entregable | Condición de entrada |
|---|---|---|---|
| POS-32…35 (corresponden a MOD-40…44, MOD-46 y MOD-64) | `feature/pos-inventory` | Política de stock insuficiente, mapeo de vendibles→consumos, suscriptor idempotente, reconciliación y UI de asociación. | POS autónomo en `pruebas`; decisión expresa sobre `stock >= 0` sin afectar la confirmación POS. |
| POS-36…38 (corresponden a MOD-50…54) | `feature/pos-analytics` | Ingesta de `pos.sale.completed.v1`, proyecciones, rebuild y métricas de ventas por fuente. | POS autónomo en `pruebas`; base de Analytics separable validada por PLAN-003. |

POS conserva desde ahora el contrato neutro `pos.sale.completed.v1` y el outbox; **no instala consumidores** que conviertan Inventory/Analytics en requisitos del flujo de ventas. Las pruebas de integración diferidas se ejecutan en los respectivos PR futuros, no se marcan como aprobadas en esta rama.

### Fase P8 — Fitness tests arquitectónicos, seguridad y salida de la rama

| ID | Prio. | Tarea | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **POS-39** | P0 | **Fitness test de agnosticismo**: análisis de imports, dependencias y modelo de POS buscando referencias a Hospitality, Commerce, Analytics y tipos de negocio. | Falla CI si núcleo/contrato POS incorpora campos/imports sectoriales o un requerimiento obligatorio de mesa. | POS-15,20 | L |
| **POS-40** | P0 | **Fitness test de independencia desplegable**: arrancar Core + POS y ejecutar smoke API/E2E sin dominios opcionales ni sus esquemas. | No falla el arranque, API de venta, UI ni outbox; la prueba se ejecuta en CI. | POS-08,26 | L |
| **POS-41** | P0 | **Fitness test SaaS**: matriz de entitlements y permisos por organización/local, URLs forzadas, cambios de módulo, clientes sin POS. | Ningún acceso cruzado ni requisito indirecto de otro producto. | POS-25,31 | L |
| **POS-42** | P0 | Robustez: reintentos/timeout, concurrentes, fallo de outbox, cierre y enlace externo atómico, migraciones en base nueva/existente. | Sin dobles ventas ni enlaces huérfanos; recovery y observabilidad documentados. | POS-19,28 | L |
| **POS-43** | P0 | Ejecutar `pnpm build`, `typecheck`, `test`, `check:separability`, `test:integration`, `test:e2e`; documentar API, despliegue, limitaciones y PR de rama. | Evidencia adjunta al PR; ADR coherente; no prometer capacidad fiscal no implementada. | POS-39,40,41,42 | M |

---

## 5. Matriz de compatibilidad y pruebas de no-acoplamiento

| Configuración real | Resultado esperado | Prueba de falla que debe pasar |
|---|---|---|
| Core + POS | Catálogo, venta, cierre, historial. | Hospitality/Commerce/Analytics ausentes **del host y de la BD**; venta correcta. |
| Core + Hospitality | Mesas, botones y tablero. | No hay llamadas obligatorias a POS; las rutas POS rechazan. |
| Core + Commerce | Inventario y movimientos. | No depende de POS ni ofrece ventas. |
| Core + POS + Hospitality | Cuenta vinculada a mesa en tablero. | Completar llamado no cierra venta; no hay acceso cruzado entre locales. |
| Core + POS + Commerce | Venta y descuento de stock asincrónico cuando se haya implementado P6. | Inventario caído no revierte POS; evento se reconcilia. |
| Core + POS + Analytics | Venta y métricas derivadas cuando se haya implementado P7. | Analytics caído no bloquea POS. |
| Core + POS; sector zapatería | Venta SKU `ZAP-NEG-42`. | Sin `businessType`, tabla ni adaptación especializada en endpoint de venta. |
| Core + POS; sector servicios | Venta con cantidad decimal. | No se asume inventario físico ni cantidad entera. |
| Core + POS; sector cafetería | Venta de bebidas en mostrador. | No hay `table_id` ni dependencia de `menu` gastronómico. |

**Estas pruebas deben ejecutarse, no limitarse a documentación o inspección manual.** Para comprobar independencia técnica no basta con deshabilitar pantallas: se necesita un host de prueba capaz de ejecutar solamente los paquetes Core + POS, aun cuando el despliegue habitual siga usando un monolito modular.

### Criterios de aceptación estrictos (Definition of Done)

- [ ] `domains/pos` construye su modelo sin nociones de `table`, `restaurant`, `waiter`, `menu_item`, `commerce_stock` o `businessType`.
- [ ] `pos.sales` no tiene `table_id` ni exige un contexto externo de venta.
- [ ] `pos.sellable_items` no necesita `commerce.products`; admite SKU, unidad y cantidades decimales.
- [ ] La API genérica registra sin modificación ventas de zapatería, cafetería y servicios.
- [ ] POS funciona en un host Core + POS sin importar o provisionar esquemas de Hospitality, Commerce ni Analytics.
- [ ] POS se contrata y autoriza independientemente; el backend verifica entitlement y permisos de cada local.
- [ ] `pos-api/domain` es testeable sin NestJS ni Prisma; `pos-web` se usa sin `hospitality-web`.
- [ ] La integración de mesas es **adaptador separado**, con validación backend; no se acepta una referencia externa falsa o intertenant.
- [ ] Hay una venta activa por mesa cuando aplica Hospitality, garantizada bajo concurrencia, sin hacer de «mesa» una entidad POS.
- [ ] Crear/agregar/cerrar respeta idempotencia y auditoría; cierre + outbox atómicos.
- [ ] El catálogo de ventas y el de inventario son independientes; el descuento de existencias es consumidor opcional.
- [ ] POS confirma ventas y produce su evento sin exigir Analytics instalado; la implementación del consumidor queda para POS-36…38, fuera de este PR.
- [ ] `pnpm check:separability`, build, typecheck, unit/integration/E2E completan con evidencias.
- [ ] Se explicitan límites fiscales y operativos del primer entregable; no se comercializa como facturador completo por defecto.

---

## 6. Hitos y orden de ejecución

**H0 — Decisión fijada:** POS-01…04. ADR-006 integrado y aceptado desde PLAN-003; ADR-005 documentado como propuesta superada en su acoplamiento a mesas; ADR históricos intactos. El modelo ya no parte de mesas.

**H1 — Independencia SaaS y técnica comprobable:** POS-05…09. Core + POS inicia de forma autónoma y puede habilitarse comercialmente.

**H2 — Motor transversal de ventas:** POS-10…21. Una venta genérica sin contexto externo funciona por API; escenarios de zapatería, café y servicios pasan.

**H3 — POS autónomo utilizable:** POS-22…26. Interfaz, permisos, onboarding e historial sin otros productos opcionales.

**H4 — Piloto de mesas integrado:** POS-27…31. Adaptador Hospitality con el tablero y flujo móvil.

**H5 — Rama lista para PR:** POS-39…43. Seguridad, pruebas de agnosticismo, Core+POS sin dominios opcionales, concurrencia y regresión. **Este es el corte de entrega recomendado para la rama `pos/mesas`.**

**H6 — Fuera de `pos/mesas`, posterior a su integración:** POS-32…38 en PR futuros sobre `pruebas`, sin alterar el core POS.

### Commits/PRs sugeridos

1. `docs(pos): make standalone sector-agnostic POS the architecture decision`
2. `feat(pos): scaffold independent product and core entitlement`
3. `feat(pos): implement sector-neutral sale catalog and persistence`
4. `feat(pos): expose generic sales API and transactional outbox`
5. `feat(pos): add standalone POS screens and SaaS onboarding`
6. `feat(integration): connect hospitality tables through external reference adapter`
7. `test(pos): enforce sector agnosticism and core-pos-only runtime`

No abrir cinco repositorios ni introducir microservicios por adelantado. **Sí mantener desde ahora las dependencias, contratos, datos y pruebas necesarias para separar POS más adelante sin reescribirlo.**

---

## 7. Decisiones abiertas que deben quedar resueltas en P0

1. **Nombre público del agregado:** `Sale`/`SaleLine` o `Ticket`/`TicketLine`; ambos pueden ser neutrales. Elegir uno y mantenerlo consistente en contratos/eventos/UX.
2. **Cantidad y unidades:** admitir valores decimales precisos con unidad explícita desde el principio; definir precisión, redondeos y unidades permitidas sin codificar un sector.
3. **Método de pago anotado:** definir catálogo neutral/configurable y si una venta inicial admite un único pago. No diseñar multi-tender avanzado sin caso de negocio.
4. **Referencias externas:** decidir dónde se registra el adaptador autorizado y cómo se impide reutilización simultánea o enlaces entre tenants; evitar SQL cruzado.
5. **Moneda, precios y posibles impuestos:** almacenar moneda/snapshots y delimitar que impuestos complejos/factura fiscal no forman parte del primer entregable.
6. **Nomenclatura `inventory` vs `commerce`:** en el negocio, producto «Inventario»; en esta rama, el dominio técnico actual `commerce` permanece hasta una migración específica.
7. **Integración en despliegue futuro:** fijar contratos mínimos de Core y de eventos para que el POS funcione como proceso/repositorio separado, aunque el piloto use composición modular.

---

## 8. Referencias del código existente y cambios localizados

- `docs/ADR-005_propuesta_pos_cuentas_por_mesa.md`: **anotar expresamente la supersesión** de su propuesta `menu_items`, `checks.table_id NOT NULL` y payload gastronómico; redactar la especificación POS horizontal como documento sucesor bajo ADR-006, sin reescribir el histórico.
- `domains/core/contracts/src/identity.ts`: actualmente `MODULES` no incluye `pos`.
- `domains/core/contracts/src/permissions.ts`: agregar permisos POS propios, sin presuponer rol «mesero».
- `apps/api/src/app.module.ts`: agregar composición de POS y construir un host de prueba Core + POS.
- `apps/api/src/integration-subscribers.module.ts`: registrar outbox/historial POS y consumidores opcionales sin acoplar el motor.
- `apps/portal/src/routes/AppShell.tsx`: ruta POS independiente filtrada por entitlement y permisos.
- `apps/portal/src/app/Board.tsx`: integración UI vertical con el POS, después de lograr pantalla autónoma; resolver móvil.
- `infra/postgres/init-schemas.sh`: esquema/rol POS, migración correcta para bases existentes.
- `scripts/check-separability.mjs`: conservar controles de independencia e **incorporar** verificación Core + POS-only y test sector-neutral.
- `domains/commerce/api/src/application/use-cases/register-movement.ts`: **no modificar en `pos/mesas`**; reutilizar `MovementRecorder` únicamente en PR futuro de integración Inventario (POS-32…35).
- `domains/commerce/api/src/domain/stock-balance.ts`: **no modificar en `pos/mesas`**; resolver política de stock insuficiente por separado al implementar POS-32…35.

**No se ha modificado el código remoto ni se han ejecutado las pruebas del repositorio durante la elaboración de este documento.** El backlog define trabajo pendiente y aceptación medible, no funcionalidad ya implementada.

---

## 9. Trazabilidad cruzada con PLAN-003 y autorización de merge

| Requisito de PLAN-003 | Propietario real / resultado en esta rama | Estado esperado al cerrar `pos/mesas` |
|---|---|---|
| MOD-00…05 | ADR-006 acordado por PLAN-003; POS-02…04 aplican la decisión | Incorporado como requisito previo, sin editar históricos. |
| MOD-10…15 | PLAN-003 corrige Core, composición y listeners | Consumido desde `pruebas` antes de POS-08/40. |
| MOD-20…22 | **POS-06 / POS-17 / POS-25** implementa `pos` en Core, permisos y roles necesarios | POS-only autorizable en API; sin permisos de Hospitality/Commerce. |
| MOD-23…26 | PLAN-003 gestiona capacidad transversal; POS-09/25 agrega UX y comportamiento propios de POS | No crear segundo onboarding o política transversal. |
| MOD-30…36 | **POS-10…26** | Modelo, API, UI, cobro declarativo e historial neutrales por sector. |
| MOD-45 | **POS-27…31** | Mesa autorizada se vincula mediante adaptador; Hospitality-only sigue operando. |
| MOD-40…44/46/51/64 | POS-32…38 / futuras integraciones | **Fuera del PR**; evento neutro disponible, consumidores diferidos. |
| MOD-50/52…54 | PLAN-003 corrige métricas/fuentes existentes | POS no modifica estos consumidores en este PR. |
| MOD-55 | Futuro Analytics con fuente externa | Fuera de ambas ramas actuales. |
| MOD-60…63 | PLAN-003 | No alterar comportamiento de Inventory desde POS. |
| MOD-70…75 | PLAN-003 certifica lo existente; POS-39…43 añade T02/T08 y negativos POS | Evidencia del nuevo producto anexada al PR. |

**Pruebas de PLAN-003 que esta rama debe ejecutar:** T02 (POS solo), T07 (regresión Hospitality solo), T08 (Hospitality+POS), T09 (regresión piloto sin POS), T11 (activación tardía de POS), T12 (revocación), T13 (cierre con consumidores opcionales ausentes), T14 (otros tenants/locales). T03/T04/T06/T10 se **difieren** hasta existir integración POS→Inventory y/o POS→Analytics.

**Checklist de PR `pos/mesas → pruebas`:**

- [ ] Base `pruebas` actualizada, ADR-006 integrado y conflictos de host resueltos.
- [ ] Ningún `table_id` obligatorio en `pos.sales`, DTO/evento genérico ni núcleo del dominio.
- [ ] Core + POS arranca sin esquemas/variables de productos opcionales; T02 comprobada.
- [ ] Venta de zapatería, café y servicios utiliza el mismo API y motor.
- [ ] Mesa válida se vincula mediante adaptador; una cuenta abierta por mesa bajo concurrencia; mesa falsa/ajena rechazada.
- [ ] Hospitality-only no necesita POS; llamado y venta no se cierran mutuamente.
- [ ] Guards y permisos POS por tenant/local, idempotencia, exactitud decimal, snapshots, outbox y recuperación probados.
- [ ] `pnpm build && pnpm typecheck && pnpm check:separability && pnpm test && pnpm test:integration` más E2E correspondientes, con SHA y entorno registrados.
- [ ] Sin promesas de factura electrónica, pago procesado ni descuentos automáticos de inventario.

**Estado:** plan de trabajo/documentación; no se han aplicado cambios ni ejecutado tests en el repo a partir de esta revisión.

---

## Estado (13/11/2026, rama `pos/mesas`)

Decisión del responsable (13/11): solo lo desbloqueado mientras no existan ADR-006 ni MOD-10/12/13 en `pruebas`; agregado `Sale`/`SaleLine`.

| ID | Estado |
|---|---|
| POS-01 | Hecho. Línea base sobre `130eadb`: `pnpm build`, `typecheck`, `test` y `check:separability` en verde. `test:integration` y `test:e2e` no se corrieron (sin cambios de BD ni pantallas). |
| POS-02, POS-03 | Bloqueados: esperan ADR-006. `ADR-005` sin anotar. |
| POS-04 | Borrador en `docs/POS-001_especificacion_pos_horizontal.md` (decisiones §7 provisionales, matriz de permisos propuesta). |
| POS-05 | Hecho: `domains/pos/contracts` y `domains/pos/api`; `check:separability` los detecta. `domains/pos/web` se crea con POS-22 (no hay API que consumir aún). |
| POS-10, POS-11 | Hechos: `SellableItem`, precios NUMERIC(14,2) y cantidades NUMERIC(12,3) en bigint, redondeo mitad hacia arriba. |
| POS-12 | Hecho: `Sale` abre sin contexto, agrega/anula líneas con snapshot, cierra con cobro declarado y registra `pos.sale.completed.v1`; anula ventas abiertas. |
| POS-13 | Hecho: casos de uso y puertos sin Nest ni Prisma; pruebas con repositorios en memoria (zapatería, cafetería y servicios con el mismo flujo). |
| POS-39 | Adelantado: `domains/pos/api/src/agnosticism.test.ts` falla si el código de POS menciona mesas, rubros o depende de otros productos. |
| POS-06…09, POS-14…38, POS-40…43 | Pendientes; POS-06/07/14 en adelante esperan ADR-006 y la composición de PLAN-003. |
