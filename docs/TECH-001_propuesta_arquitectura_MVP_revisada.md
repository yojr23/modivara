# TECH-001 — Propuesta de arquitectura de implementación del MVP (revisada)

> **Proyecto:** Emprendimiento — SaaS multiproducto  
> **Fecha:** 19 de octubre de 2026  
> **Estado:** propuesta técnica para revisión; **no es un ADR aprobado**. **v1.1:** stack de frontend **congelado** (§10.1); backend, autenticación e infraestructura elegidos dentro del stack de referencia de ADR-001 (§10.2–10.3). **v1.2:** bases de implementación acordadas (§16), con `ADR-002` y `DATA-001`. **v1.3:** Clean Architecture completa dentro de cada dominio, con repositorios como puertos (§5). **v1.4:** puerto transaccional acotado, kernel compartido y correcciones de consistencia (§5, §16). **v1.5:** rutas implementadas en §7 y catálogo por local en §16.7. **v1.6:** rutas de planos de espacios (ADR-003). **v1.7:** el tablero de barra pasa a ser plano operativo + cola global (§10.1).  
> **Precedencia:** `ADR-001_arquitectura_saas_multiproducto_mvp.md` y `ADR-002_cuentas_por_negocio_superadmin_y_ajustes_mvp.md` gobiernan el alcance y los límites de dominio. **v1.7:** `ADR-003_editor_visual_espacios_y_planos_operativos_MVP.md` amplía el MVP con planos 2D y prevalece sobre la descripción del tablero de este documento. `BRAND-001` es antecedente estratégico y `BRAND-002` es una propuesta de identidad comercial.  
> **Objetivo:** definir una base implementable para el piloto gastronómico sin sacrificar trazabilidad, testabilidad, modularidad ni capacidad de evolución.

## 1. Fuentes y jerarquía

1. `documentos/ADR-001_arquitectura_saas_multiproducto_mvp.md`: autoridad sobre arquitectura objetivo, cuatro repositorios, límites de datos y alcance del MVP.
2. `documentos/ADR-002_cuentas_por_negocio_superadmin_y_ajustes_mvp.md`: cuentas por negocio, superadmin de plataforma, una solicitud activa por mesa y tipo, repositorio único transitorio con separabilidad verificada. Prevalece sobre ADR-001 en esos puntos.
3. `BRAND-001_identidad_estrategia_multiproducto.md`: antecedente de oferta SaaS multiproducto y especialización comercial inicial gastronómica. **No está en `documentos/`.**
4. `documentos/BRAND-002_MODIVARA_LABS_identidad_corporativa_y_MVP.md`: propuesta de marca **Modivara Labs / Modivara**, pendiente de adopción y validación legal/comercial; detalla el piloto y las precauciones de medición.
5. `documentos/DATA-001_modelo_de_datos_mvp.md`: modelo de datos por esquema, pendiente de revisión antes de la primera migración.

**Regla:** ninguna recomendación de este documento modifica ADR-001 ni ADR-002. Si se cambia el alcance o un límite de dominio, crear un ADR posterior.

## 2. Qué está acordado y qué sigue abierto

**Acordado por ADR-001:**
- Arquitectura objetivo con `platform-core`, `hospitality-ops`, `commerce` y `analytics`. Los cuatro son propietarios de sus dominios; repositorio no equivale a microservicio.
- MVP en un bar: portal y acceso por local, gestión de mesas, botones físicos, llamados y notificaciones en tiempo real, inventario básico y métricas básicas.
- Sin POS completo, pagos, facturación, recetas, compras avanzadas, analítica predictiva ni despliegue distribuido excesivo.
- Un PostgreSQL inicial con esquemas y permisos por dominio, tenant genérico `organization` / `location`, integraciones por REST/eventos versionados, Outbox e idempotencia.
- El componente `analytics` no debe bloquear la operación de Hospitality ni Commerce; no debe depender permanentemente de consultas directas a tablas ajenas.
- Reglas operativas de llamadas: estados `pending` → `in_progress` → `completed`; una solicitud activa por mesa y por tipo de llamado (ADR-002 D4); persistir evento físico, solicitud y transiciones; asignaciones históricas botón-mesa.

**Decidido en v1.1 (19/10/2026), dentro de lo que ADR-001 deja abierto:**
- Frontend congelado: React + TypeScript + Vite + Tailwind + shadcn/ui (§10.1).
- Backend: TypeScript de punta a punta con NestJS (§10.2).
- Identidad: login propio, sin servicios de terceros pagos (§10.2).
- Todo dockerizado; sin servicios administrados pagos durante el piloto (§10.3).
- Demo sin hardware mediante adaptador simulado de pulsación (§12, fase 2).

**Decidido en v1.2 (19/10/2026):** ver §16 y ADR-002. Incluye repositorio único transitorio, despliegue opción A para el piloto, cuentas por negocio sin correo ni SMTP, superadmin de plataforma, permisos, eventos y Outbox, simulador independiente HTTP/MQTT, zonas, tipos de llamado, inventario y métricas del piloto, y el modelo de datos (DATA-001).

**Abierto (no debe presentarse como aprobado):**
- Calendario de separación en cuatro repositorios.
- Proveedor de VPS/hosting (solo necesario para mostrar la demo en un bar).
- Contratos detallados de API y Socket.IO.
- Protocolo exacto de botones, gateway y comportamiento sin conectividad.
- Políticas de retención, SLO/umbrales del piloto, número definitivo de botones.
- Nombre comercial **Modivara**: propuesta, no registro aprobado.

## 3. Correcciones a la propuesta técnica anterior

1. **No fijar como hecho una latencia p95 inferior a 2 s.** Definir objetivos con el bar antes de probar; medir pulsación, recepción, persistencia, publicación y presentación cuando existan timestamps fiables.
2. **No confundir notificación emitida con notificación vista.** El servidor puede medir emisión; la recepción y visualización requieren instrumentación/confirmación explícita en el cliente, si se implementa.
3. **No imponer `analytics.event_inbox` como tabla inicial obligatoria.** Para el MVP, proyecciones o agregaciones simples son válidas; el esquema exacto depende del contrato de datos sin acoplamiento a tablas ajenas.
4. **No congelar OpenTelemetry, DDD o arquitectura hexagonal como decisiones del ADR.** Se proponen como prácticas técnicas proporcionadas a la complejidad del producto.
5. **No asumir un protocolo IoT ni exactamente 20 dispositivos:** la investigación y la cantidad del piloto deben confirmarse.
6. **No equiparar cuatro repositorios con cuatro despliegues ni con cuatro marcas comerciales.** Mantener límites de dominio y decidir empaquetado por costo de operación.
7. **No describir `completed` como evidencia física de atención.** Es cierre registrado por personal autorizado.
8. **No reducir inventario ni métricas a “futuro”:** son entregables básicos obligatorios de este piloto.

## 4. Arquitectura lógica propuesta

```text
  Usuario / personal                         Cliente en mesa
          |                                         |
  React + TypeScript                            Botón físico
  Portal operativo                              (por validar)
          |                                         |
       REST / Socket.IO                   Gateway / adaptador IoT
          |                                         |
          +--------------+--------------------------+
                         |
               Casos de uso de dominio
                         |
          +--------------+------------------------------+
          |              |                |            |
    platform-core   hospitality-ops     commerce     analytics
     Identidad       Mesas/llamados     Inventario   Métricas
     Entitlements    Dispositivos       Movimientos  Consultas
          |              |                |            |
          +--------------+----------------+------------+
                         |
               PostgreSQL (Docker en el piloto)
               Schemas core, hospitality,
                    commerce, analytics
```

Las flechas son lógicas y no autorizan acceso SQL entre propietarios distintos. REST versionada para comandos/consultas directas; eventos versionados para hechos persistidos. La UI puede presentar una navegación unificada, pero habilitación y autorización se verifican en backend.

**Propuesta de decisión de despliegue pendiente:** comparar dos opciones en una prueba de construcción:
- **A. Despliegue modular compacto:** módulos empaquetados con contratos versionados; uno o pocos procesos, evitando imports de lógica interna entre dominios. Menor operación, mayor necesidad de disciplina de empaquetado.
- **B. APIs pequeñas por dominio:** cuatro aplicaciones ligeras en Docker/servicios administrados, sin Kubernetes ni broker obligatorio. Límites de despliegue más claros, mayor costo operativo y de observabilidad.

No elegir por moda. Decidir después de evaluar costo, complejidad de builds/releases y necesidad real de aislamiento, sin cambiar el alcance funcional. El repositorio objetivo continúa siendo de cuatro dominios.

**v1.2:** para el piloto se adopta la **opción A** dentro de un repositorio único (ADR-002 D1). La opción B se reevalúa al separar repositorios.

## 5. Estructura interna y SOLID (recomendación nueva)

Patrón recomendado: **DDD pragmático + puertos/adaptadores en los bordes + casos de uso explícitos**. Aplicar solo abstracciones necesarias.

**v1.2 — estructura del repositorio único** (ADR-002 D1):

```text
apps/
  api/              # host NestJS: solo arranca y conecta los módulos de dominio
  portal/           # shell React: login, layout, navegación por entitlements
  button-sim/       # simulador de gateway, proceso y contenedor aparte (§16.6)
domains/
  core/             api/ web/ contracts/
  hospitality/      api/ web/ contracts/
  commerce/         api/ web/ contracts/
  analytics/        api/ web/ contracts/
docker-compose.yml
```

**v1.3 — Clean Architecture dentro de cada dominio** (ejemplo `domains/hospitality/api/src/`). Reemplaza el criterio de interfaces de v1.2:

```text
domain/                      # entidades y reglas puras: sin NestJS, sin Prisma, sin Zod de transporte
  service-call.ts            # entidad ServiceCall (fábrica estática create/restore, eventos pendientes)
  transitions.ts             # tabla TRANSITIONS + función transition() (pura)
  errors.ts                  # errores de dominio
application/                 # casos de uso; dependen solo de domain/ y de puertos
  register-button-press.use-case.ts
  acknowledge-call.use-case.ts
  complete-call.use-case.ts
  ports/
    service-call.repository.ts   # puerto Repository por agregado
    notification.port.ts
infrastructure/              # adaptadores: Prisma, MQTT, HTTP de gateway, Socket.IO, outbox
  prisma/
    schema.prisma            # ?schema=hospitality
    migrations/
  prisma-service-call.repository.ts
  iot/http.adapter.ts        # IoTInputPort ← HTTP
  iot/mqtt.adapter.ts        # IoTInputPort ← MQTT
  realtime/socket.gateway.ts # NotificationPort → Socket.IO
presentation/                # controladores NestJS y DTOs de borde
hospitality.module.ts        # composición: conecta puertos con adaptadores (inyección de dependencias de Nest)
index.ts                     # única superficie pública del paquete
```

**Regla de dependencias (v1.3):** `presentation` e `infrastructure` → `application` → `domain`. Nunca al revés. `domain/` y `application/` no importan NestJS, Prisma, Socket.IO ni MQTT; se prueban sin base de datos ni framework.

**Puertos (v1.3):**
1. **Repository por agregado** (`ServiceCallRepository`, `DiningTableRepository`, `StockMovementRepository`, …), definido en `application/ports` e implementado con Prisma en `infrastructure/`. El repositorio persiste el agregado, sus transiciones y sus eventos pendientes (Outbox) **en una sola transacción**, de modo que no se necesita un `UnitOfWork` aparte. Las invariantes de concurrencia siguen en la base (índices parciales, `CHECK`).
2. **Entre dominios:** `CoreAccessPort` y equivalentes, en el `contracts` del dominio que responde; hoy en proceso, mañana cliente HTTP.
3. **Piezas reemplazables:** `IoTInputPort`, `IdentityPort`, `EventPublisherPort`, `NotificationPort`.

**Operaciones que abarcan varios agregados o necesitan bloqueo (v1.4):** se usa un **puerto transaccional acotado** por operación crítica, nunca un UnitOfWork genérico. El adaptador abre la transacción y el bloqueo y ofrece operaciones atómicas; el caso de uso decide dentro, de modo que la regla de negocio vive en un solo lugar. Casos actuales: la pulsación (`withDeviceLock`: `device_event` + llamado con `press_count` atómico + transición + outbox, DATA-001 §3), el movimiento de stock (`withLockedBalance`, DATA-001 §4) y el contador de intentos de login.

**Kernel compartido (v1.4):** `core-contracts` contiene las piezas comunes a los 4 dominios (`DomainError` y errores comunes con `code`, `AggregateRoot` + `pullEvents()`, `toEventEnvelope`, `findActiveLocation`, `newId()` UUIDv7). Convenciones: contexto del actor `{ organizationId, locationId?, actorUserId }`; búsquedas por id con parámetro objeto y siempre acotadas por tenant; eventos internos en camelCase con un único mapeo al sobre snake_case.

Clean Architecture es decisión de este documento, no del ADR (§3.4 sigue vigente: ADR-001 no la congela).

Sin `Clock`: el tiempo se controla en pruebas con los temporizadores falsos de Vitest. La separabilidad entre dominios la garantizan los `exports` de cada paquete y la prueba de separabilidad (ADR-002 D1); las capas internas garantizan que las reglas de negocio no dependan del framework ni de la base.

- **S:** la recepción de pulsación, la transición de estados y el envío de notificaciones se implementan como responsabilidades distintas.
- **O/D:** añadir adaptadores para MQTT, HTTP u otra tecnología sin alterar las reglas de `ServiceCall`; los casos de uso dependen de `IoTInputPort` y `NotificationPort`, no de Socket.IO ni del transporte.
- **L/I:** contratos pequeños y comprobables; no crear una interfaz genérica universal para todos los repositorios.
- **Patrones justificables:** entidades como clases con fábricas estáticas (`create` para nacer con invariantes válidas, `restore` para reconstruir desde persistencia), Repository por agregado (v1.3), Adapter para hardware, máquina de estados por tabla de transiciones para `ServiceCall`, Transactional Outbox para eventos, idempotent consumer en los suscriptores, Strategy mínima (`CALL_TYPE_POLICY`) solo cuando un tipo de llamado se comporte distinto. No construir event sourcing completo.

El dominio debe poder probarse sin iniciar NestJS ni PostgreSQL; las restricciones de concurrencia se prueban adicionalmente contra PostgreSQL real.

## 6. Modelo de dominio mínimo

### Core (propietario: `platform-core`)
`organizations`, `locations`, `app_users`, `memberships`, `location_memberships`, `entitlements` (y suscripciones si se necesitan para el piloto).

- `Location` es genérico, no asume mesas.
- Autorizar organización y local en cada comando y consulta; el frontend no es fuente de permisos.
- El acceso a un módulo requiere autenticación, membresía/rol y habilitación del producto. Separar roles de derechos contratados.

### Hospitality (propietario: `hospitality-ops`)
- `dining_tables`: mesa lógica del local, identificador visible, estado de activación.
- `devices`: identidad técnica, proveedor/protocolo y metadatos necesarios.
- `device_assignments`: `device_id`, `table_id`, período de vigencia, actor; se preservan reemplazos.
- `device_events`: un registro por señal recibida, identidad del origen, `received_at`, resultado de procesamiento, referencias de correlación; conservar duplicados observados según la política.
- `service_calls`: `id`, tenant/local/mesa, estado actual, fechas de creación/reconocimiento/cierre, actor de reconocimiento/cierre.
- `service_call_transitions`: `call_id`, estado anterior/nuevo, actor, fecha, motivo/origen si aplica.
- `outbox_events`: evento de integración y estado de despacho.

**Invariantes:**
- una sola llamada activa (`pending` o `in_progress`) por mesa **y por tipo de llamado** (ADR-002 D4) con **índice único parcial**;
- transiciones explícitas y autorizadas, sin saltos implícitos;
- eventos repetidos no generan automáticamente nuevos llamados activos;
- cambios de estado e historial se registran de forma consistente;
- una asignación dispositivo-mesa debe resolverse según su vigencia en el momento relevante, sin suponer que siempre habrá reloj confiable en el botón.

**Propuesta SQL ilustrativa** (no es migración aprobada; versión completa en DATA-001 §3):
```sql
CREATE UNIQUE INDEX uq_service_calls_active
ON hospitality.service_calls (table_id, call_type)
WHERE status IN ('pending', 'in_progress');
```

La deduplicación exacta exige validar qué identificador o secuencia puede suministrar el botón/gateway. No suponer garantías imposibles del hardware barato.

### Commerce (propietario: `commerce`)
`products`, `stock_locations`, `stock_movements`, `stock_balances`; `product_variants` opcional. Movimientos con cantidad, tipo (entrada/salida/ajuste), motivo, actor, timestamp e idempotencia; saldos actualizados transaccionalmente. Validar en el piloto la política de saldos negativos. **No hay descuento automático por ventas.**

### Analytics (propietario: `analytics`)
Métricas básicas de llamados (conteos, estados, tiempos registrados y repeticiones) e inventario (movimientos/saldos). Preferir APIs de lectura y eventos desde propietarios, con agregaciones/proyecciones propias. No exigir pipeline separado, BI ni consultas SQL cruzadas permanentes. Definir cómo se sincronizan y reconstituirán las proyecciones si se usa un consumidor.

## 7. Contratos mínimos propuestos

### REST (versionado, ejemplos no aprobados)
- `GET/POST/PATCH /api/v1/locations/:locationId/tables`
- `POST /api/v1/device-events` **solo** a través de adaptador autenticado o gateway adecuado; este endpoint no debe confiar en `organization_id` enviado por el cliente. **v1.2:** autenticado con la clave del gateway en un header; organización, local y gateway se deducen de la clave. Equivalente MQTT: tópico `modivara/gw/<gateway_id>/press`.
- `POST /api/v1/gateways/heartbeat`: señal de vida del gateway cada 30 s (MQTT: `modivara/gw/<gateway_id>/heartbeat`).
- `GET /api/v1/locations/:locationId/service-calls?status=active`
- `POST /api/v1/service-calls/:id/acknowledge`
- `POST /api/v1/service-calls/:id/complete`
- `GET/POST /api/v1/inventory/products`
- `POST /api/v1/inventory/stock-movements`
- `GET /api/v1/metrics/service-calls?...`

**v1.5 — rutas implementadas** (prefijo `/api/v1`; la fuente de verdad son las constantes de rutas de cada `contracts`):
- Llamados: `GET /locations/:locationId/service-calls` (activos o historial con cursor), `GET /locations/:locationId/service-calls/:callId` (detalle con transiciones y nombres de actores), `POST …/:callId/acknowledge`, `POST …/:callId/complete`.
- Inventario: `/locations/:locationId/products`, `/locations/:locationId/stock-locations`, `GET /locations/:locationId/stock/balances`, `GET|POST /locations/:locationId/stock/movements`, `POST /locations/:locationId/stock/count-adjustments`, `/commerce/movement-reasons` (por negocio). `Idempotency-Key` en el header.
- Planos (v1.6, ADR-003 §17):
  - `GET /locations/:locationId/layouts` devuelve los publicados y exige `hospitality.calls.read`.
  - `GET|PUT /locations/:locationId/layouts/draft` (`?zone_id=`; sin él, el espacio único) y `POST /locations/:locationId/layouts/publish` exigen `hospitality.tables.manage`.
  - Si `revision` no coincide, responden 409 `revision_conflict` con el borrador vigente.
  - Al publicar se emite el evento Socket.IO `layout.published` a la sala del local.
- Métricas: `GET /locations/:locationId/metrics/service-calls` y `GET /locations/:locationId/metrics/inventory`. Parámetros: `range` (atajos o `custom` con `from`/`to` locales, hasta 366 días, o 31 con `group_by=hour`), `group_by`, y filtros. `by_period` trae en 0 los periodos sin datos hasta el actual.

AuthN/AuthZ, tenant y entitlements aplican a todos los recursos. Para mutaciones que puedan repetirse, admitir `Idempotency-Key` y política de respuesta determinística cuando corresponda. Versionar DTOs en los bordes, no exportar tipos internos de Prisma.

### Eventos (nombres derivados de ADR-001)
- `hospitality.service_call.created.v1`
- `hospitality.service_call.acknowledged.v1`
- `hospitality.service_call.completed.v1`
- `commerce.stock.adjusted.v1`, `commerce.stock.received.v1`, `commerce.stock.issued.v1`

Envelope propuesto: `event_id`, `event_type`, `event_version`, `occurred_at`, `organization_id`, `location_id`, `aggregate_id`, `correlation_id`, `causation_id`, `payload` limitado y versionado.

### Flujo fiable de pulsación
1. Adaptador de hardware recibe y normaliza señal, valida origen.
2. Caso de uso resuelve asignación de dispositivo y local, aplica política de duplicados.
3. Transacción escribe evento físico, crea/reutiliza la solicitud activa si procede y registra transición + Outbox cuando hay nuevo hecho de negocio.
4. Worker publica **después del commit**, con reintentos y control de duplicados por destinatario.
5. Portal recibe notificación y reconsulta estado autoritativo si procede.
6. Reconexion de Socket.IO → consulta estado actual por REST.
7. Analytics procesa eventos o consume API autorizada sin bloquear a Hospitality.

**Importante:** emitir por Socket.IO ≠ navegador recibió ≠ usuario vio ≠ empleado atendió. Si se necesitan dichas mediciones, implementar ACK cliente y medición de visibilidad por separado.

## 8. Auditoría, trazas y observabilidad

Tres conceptos distintos:

1. **Auditoría operativa persistente**: `device_events`, `service_calls`, `service_call_transitions` y `stock_movements`; quién, qué, cuándo, desde dónde y qué resultado registrado. No se puede reconstruir solo desde logs.
2. **Trazas técnicas correlacionadas**: `trace_id`/`span_id` y `correlation_id` propagados en API, adaptador, base y publicación (instrumentación con OpenTelemetry **recomendada**, no congelada).
3. **Métricas de plataforma**: errores, disponibilidad de la API, tiempos de transacción, eventos pendientes en Outbox, reintentos, reconexiones, fallos de ingestión.

Campos temporales:
- `received_at` = hora del backend cuando ingresa señal;
- `created_at` = creación persistida del llamado;
- `acknowledged_at` y `completed_at` = acciones registradas por personal;
- `published_at` = salida de notificación cuando es instrumentable;
- `delivered_at` y `visible_at` = solo si hay ACK/medición real del cliente;
- `pressed_at` = solo si dispositivo/gateway entrega una hora calibrada y comparable; de lo contrario usar `received_at` como inicio medible y declararlo.

Las métricas **no** demuestran por sí solas que un mesero llegó físicamente ni que la pantalla fue vista. No usar IDs de alta cardinalidad como etiquetas de métricas; sí en registros/trazas con controles de privacidad y retención.

## 9. Mecanismos de resiliencia e integridad

- Confirmar transacción antes de notificar. `outbox_events` con estado, intentos, errores y reintentos controlados.
- El consumidor deduplica por `event_id`; tratar publicación como *at-least-once*, no prometer *exactly-once*.
- En concurrencia simultánea por mesa, resolver con restricción SQL y resultado de negocio idempotente; probar carreras con PostgreSQL real.
- Sección de inventario: bloquear/coordinar saldo por producto+ubicación, persistir movimiento y saldo en una transacción, probar doble ajuste concurrente.
- Socket.IO: autenticar conexión y autorizar sala por `organization_id/location_id` obtenidos del servidor; el cliente no decide el tenant. Al reconectar, recargar pendientes.
- Hardware: definir la semántica real cuando gateway o internet no estén disponibles. Si el dispositivo no mantiene cola, **no prometer recuperación de pulsaciones perdidas**. Prever señal clara de desconexión cuando sea detectable y procedimiento manual.
- Aislamiento: esquema propio por dominio, roles SQL limitados, sin lecturas/escrituras directas entre propietarios; multi-tenant también validado en API y, si se justifica, RLS como defensa adicional.
- Timestamps `TIMESTAMPTZ`, zona horaria por local; UUID para IDs públicos. No borrar físicamente historial crítico.

## 10. Stack tecnológico

**Criterio de selección:** la mayor parte del código será escrito con asistencia de IA (Claude) y auditado por el equipo. Se elige el stack donde esa generación es más fiable y donde el front puede ser dinámico y atractivo: **TypeScript de punta a punta**. Un solo lenguaje para revisar, contratos compartidos entre front y back, y el ecosistema de UI más maduro.

La elección coincide con el stack de referencia de ADR-001 §7 (React + TypeScript + Vite; NestJS + TypeScript; PostgreSQL; Prisma; REST; Socket.IO; Docker). No modifica alcance ni límites de dominio, por lo que no requiere un nuevo ADR.

### 10.1 Frontend — CONGELADO

| Capa | Elección | Motivo / regla |
|---|---|---|
| Lenguaje | TypeScript en modo `strict` | Errores de tipos detectados antes de ejecutar. |
| UI | React 19 | Ecosistema más amplio para interfaces dinámicas. |
| Build | Vite, aplicación SPA | Portal detrás de login: no necesita SSR ni SEO. Se sirve como archivos estáticos. |
| Estilos | Tailwind CSS v4 | Tokens de marca de BRAND-002 definidos como variables CSS del tema. |
| Componentes | shadcn/ui (sobre Radix) | El código se copia al repositorio y se personaliza; **no** se usa con su tema por defecto. Radix aporta accesibilidad de teclado y lectores de pantalla. |
| Iconos | lucide-react | Línea simple y consistente (BRAND-002 §9). |
| Rutas | React Router (modo SPA) | — |
| Estado de servidor | TanStack Query | Caché, reintentos y re-consulta. Sin Redux ni Zustand mientras el estado sea de servidor. |
| Formularios | React Hook Form + Zod | Esquemas Zod compartidos con el backend en `domains/<d>/contracts` (ADR-002 D1). |
| Tiempo real | `socket.io-client` | Al reconectar, invalidar consultas y re-leer el estado autoritativo por REST (§7). |
| Animación | Motion | Solo para cambios con significado (llegada de un llamado, cambio de estado), no decoración. |
| Gráficos | Recharts | Base de los gráficos de shadcn/ui; para métricas básicas. |
| Tipografía | Manrope (títulos) + Inter (interfaz y cifras tabulares) | Ambas con licencia SIL OFL; autoalojadas con Fontsource, sin depender de servicios externos en tiempo de ejecución. |
| Pruebas | Vitest + Testing Library; Playwright para E2E | Ver §11. |

**Organización:** una sola SPA `portal` para el MVP, con carpetas por dominio (`features/core`, `features/hospitality`, `features/commerce`, `features/analytics`) y una carpeta `ui/` con el sistema de diseño. Cada carpeta consume únicamente la API de su dominio. La navegación se arma con los entitlements que devuelve el backend: la UI oculta lo no contratado, pero **la autorización siempre la decide el backend**. Una única app no transfiere propiedad de dominio. Puede dividirse en apps por repositorio cuando se materialicen los cuatro repositorios. Sin microfrontends (ADR-001 §3).

**Principios de diseño (evitar la apariencia de plantilla genérica):**

1. Ningún componente sale con el estilo de fábrica: primero se aplican los tokens de BRAND-002 (azul tinta `#101E33`, verde conexión `#1BAA95`, ámbar operacional `#E6A03D`, etc.).
2. **Pantalla principal diseñada a propósito: el tablero de barra.** **v1.7, ADR-003:** el tablero es el **plano 2D publicado** de cada espacio, con las mesas reales encima, más una **cola global de llamados** siempre visible y ordenada por antigüedad. La cuadrícula de mesas ya no es el diseño principal: queda solo como alternativa en lista cuando no hay plano publicado o no carga (ADR-003 CU-07, RNF-03). Se mantienen el llamado pendiente destacado con su tiempo transcurrido, reconocer y finalizar con un toque, y el estado de conexión siempre visible. Además hay aviso de llamados en otros espacios (ESP-28).
3. El estado nunca se comunica solo con color: color + icono + texto, con contraste WCAG validado.
4. Tema oscuro para el tablero de barra (locales con poca luz) y tema claro para administración.
5. Tablet primero para la barra, escritorio para administración, y usable en móvil.
6. Lenguaje operativo (BRAND-002 §5): «Mesa 5 necesita atención», no «Evento recibido».
7. Movimiento con propósito, respetando `prefers-reduced-motion`.
8. Alerta sonora opcional al llegar un llamado. La activa el usuario, por las políticas de reproducción automática de los navegadores.

**Descartado:** plantillas renderizadas en servidor (Blade/Livewire u otras), por la rigidez observada en proyectos previos; Next.js, porque SSR y SEO no aportan a un portal autenticado y agregan otro servidor; microfrontends.

### 10.2 Backend — ELEGIDO

| Capa | Elección |
|---|---|
| Runtime | Node.js LTS + TypeScript |
| Framework | NestJS; un módulo de Nest por dominio (`core`, `hospitality`, `commerce`, `analytics`) |
| Persistencia | PostgreSQL + Prisma, con SQL explícito para índices parciales y restricciones avanzadas |
| Validación / contratos | Zod en `domains/<d>/contracts` (ADR-002 D1), compartido con el frontend |
| Tiempo real | Gateway Socket.IO dentro de Hospitality |
| Outbox | Tabla `outbox_events` por dominio emisor + poller en el mismo proceso que consulta PostgreSQL; sin Redis ni broker en el piloto (§9, §16.2) |

**Autenticación: login propio** (restricción de presupuesto; sin servicios de identidad pagos):
- **v1.2:** cuentas por negocio (ADR-002 D2): slug del negocio en la ruta (`/<slug>`) + **nombre de usuario** + contraseña, con hash **Argon2id**. Sin correo ni SMTP.
- Sesión en cookie `HttpOnly`, `Secure`, `SameSite=Strict`, con las sesiones almacenadas en PostgreSQL (revocables). La misma cookie autentica la conexión Socket.IO. Detalle en §16.3.
- Protección CSRF (revisión del header `Origin` en cada mutación) y límite de intentos en el login.
- Restablecimiento de contraseña: lo hace un administrador del negocio o el superadmin.
- Encapsulado detrás de `Identity/EntitlementsPort` (§13), para migrar a un proveedor OIDC si se necesita. ADR-001 §9 deja abierto el proveedor; esta elección no cambia límites de dominio.

### 10.3 Infraestructura y entorno

- Todo dockerizado con `docker-compose`: `api` (NestJS, con worker de Outbox y Socket.IO en el mismo proceso durante el piloto), `web` (estáticos de la SPA), `db` (PostgreSQL 18), `mqtt` (Mosquitto), `button-sim` (simulador) y un proxy reverso Caddy con HTTPS automático gratuito. Versiones fijas por imagen: Node 24 LTS, PostgreSQL 18.
- Corre en cualquier VPS con Docker; el proveedor sigue pendiente.
- Sin servicios administrados pagos durante el piloto.
- Este empaquetado corresponde a la opción A de §4, recomendada para el piloto; la decisión formal A/B sigue abierta.
- Kafka, RabbitMQ, Redis y Kubernetes no son requisitos del piloto. MQTT solamente si el hardware elegido lo requiere.

OpenTelemetry, validación de contratos OpenAPI, tests de arquitectura y CI son recomendaciones adicionales; no obligan a agregar un clúster de observabilidad sofisticado. Puede comenzarse con logs JSON y trazas instrumentadas en entorno de ensayo.

## 11. Pruebas y criterios de aceptación

**Antes del piloto, acordar umbrales** de recepción de eventos, latencia de visualización, tolerancia a duplicados, disponibilidad operativa, concordancia de inventario y usabilidad; no se derivan umbrales numéricos de los documentos.

Pruebas obligatorias recomendadas:
- Unitarias: máquina de estados, políticas de duplicado, asociaciones históricas y permisos.
- Integración real: índices parciales, transacciones, saldos concurrentes, Outbox y reintentos.
- Contratos: eventos/DTOs entre los cuatro dominios y formatos hardware→adaptador.
- E2E: pulsación real→registro→notificación→reconocimiento→cierre; reconexión; cambios de botón; aislamiento entre locales.
- Fallas: caída de Analytics, error transitorio de publicación, internet/gateway desconectado, presión simultánea en varias mesas.
- Validación en bar: comparar pulsaciones de prueba con eventos recibidos; diferenciar falla del botón, RF/red, gateway, backend y navegador.

Piloto: incluir el número de mesas/botones confirmado por el establecimiento; la cifra aproximada de 20 citada como expectativa previa no está congelada por los documentos. Medir costo por mesa y recepción por el personal, sin inferir ahorro ni reducción de tiempos antes de tener evidencia.

## 12. Backlog ordenado por valor y dependencias

| Fase | Entregable demostrable | Resultado verificable |
|---|---|---|
| 0 | Contratos básicos, matriz de permisos/entitlements, selección de topología/hardware candidata | ADR respetado; riesgos abiertos visibles |
| 1 | Tenant, local, identidad, permisos y acceso al portal | Aislamiento real en backend |
| 2 | Mesas, zonas, dispositivos, asignaciones históricas, casos de uso de llamadas y **simulador independiente** de gateway (HTTP y MQTT, mismo `IoTInputPort` que usará el hardware real) | Reglas de estado y de solicitud activa probadas; flujo completo demostrable sin hardware |
| 3 | Adaptador hardware, persistencia, Outbox, tiempo real y reconexión | Pulsación real trazable de extremo a extremo |
| 4 | Catálogo, movimientos y saldos transaccionales | Inventario básico con historial auditable |
| 5 | Agregaciones/proyecciones autorizadas y tablero básico | Métricas concuerdan con registros fuente |
| 6 | Instrumentación, fallos, seguridad, entrenamiento y piloto | Evidencia de campo y criterios de aceptación |

Las pruebas de dominio, contratos y persistencia se escriben desde cada fase, no al final.

**v1.2 — hito "demo mostrable"** (fases 1–5 en versión básica, sin hardware): login por negocio, mesas y zonas, consola de superadmin (gateways, botones, "detectados sin asignar", vinculación botón–mesa), tablero de barra en tiempo real con reconocer/finalizar, historial, inventario básico y métricas básicas, con el simulador en un celular. Corre localmente con `docker compose`; se despliega en un VPS solo para mostrarla en un bar.

## 13. Puertas de evolución: diseñar hoy, ejecutar cuando se justifique

- `IoTInputPort`: nuevo botón/gateway/transport sin cambiar `ServiceCall`.
- `EventPublisherPort` y Outbox: reemplazar polling por broker sin alterar eventos de negocio.
- `CoreAccessPort` (y puertos equivalentes entre dominios): separar repositorios y bases cambiando solo la implementación conectada (en proceso → HTTP). Dentro de cada dominio, `Repository` por agregado (§5, v1.3).
- `AnalyticsProjectionPort`: migrar agregaciones a worker/warehouse cuando volumen y casos de uso lo justifiquen.
- `Identity/EntitlementsPort`: evolucionar proveedor de identidad, políticas de acceso y planes.
- `NotificationPort`: escalar Socket.IO con adaptador distribuido si se necesitan réplicas.
- `Commerce` separado: introducir POS y variantes avanzadas sin alterar el modelo de mesas.

## 14. Decisiones pendientes para un nuevo documento de implementación

1. Selección verificable de hardware, recepción y capacidad de buffering.
2. Primer empaquetado físico (composición modular vs servicios por dominio), pipelines CI/CD y responsabilidades.
3. Contratos API/Socket.IO/eventos y política de versionado.
4. Modelo de permisos por local/organización y entitlements mínimos.
5. Migraciones PostgreSQL concretas y estrategias de concurrencia.
6. Semántica de hora de pulsación y de confirmación en navegador.
7. Retención de auditoría, logs y trazas; privacidad.
8. Criterios cuantificados de aceptación acordados con el bar.
9. ~~Rol de variantes e inventario negativo en el piloto.~~ **Resuelto en v1.2:** sin variantes y sin saldo negativo, ambos provisionales (§16.8).
10. Acuerdo comercial y adopción de la marca propuesta.
11. Proveedor de VPS/hosting. (SMTP descartado en v1.2: no se usa correo.)

**Resumen:** proteger el núcleo `mesa → pulsación → solicitud → seguimiento`, entregar inventario y métricas básicas desde el piloto y conservar independencia comercial/técnica de los cuatro dominios. Trazabilidad e idempotencia son fundamentos; complejidad de despliegue es optativa y debe estar justificada.

## 15. Control de cambios

- **v1.0 (19/10/2026):** propuesta técnica revisada inicial.
- **v1.1 (19/10/2026):** frontend congelado (§10.1); backend NestJS, login propio e infraestructura dockerizada sin servicios pagos (§10.2–10.3); adaptador simulado de pulsación en la fase 2 (§12); SMTP y hosting añadidos a los pendientes (§14).
- **v1.2 (19/10/2026):** bases de implementación acordadas (§16) y registradas en ADR-002 y DATA-001; corrección de rutas de fuentes (§1) y de la estructura de carpetas (§5); criterio de interfaces (§5); invariante por mesa y tipo (§6); autenticación del gateway (§7); hito de demo (§12).
- **v1.3 (19/10/2026):** a pedido del responsable, Clean Architecture completa dentro de cada dominio: capas `domain`/`application`/`infrastructure`/`presentation`, entidades como clases y `Repository` por agregado como puerto (§5). Reemplaza el criterio de interfaces de v1.2. No cambia ADR-001 ni ADR-002.
- **v1.7 (28/10/2026):** ADR-003 entra en las fuentes y en la precedencia, y §10.1 principio 2 describe el tablero como plano operativo con cola global de llamados (ya no como cuadrícula).
- **v1.6 (28/10/2026):** rutas de planos en §7 (ADR-003). No cambia el stack ni los límites de dominio.
- **v1.5 (27/10/2026):** sincronización con lo implementado. Rutas reales en §7 y catálogo de productos por local en §16.7, como decidió DATA-001 §8.3. No cambia ADR-001 ni ADR-002.
- **v1.4 (20/10/2026):** tras la auditoría de fase 0 y con decisión del responsable: puerto transaccional acotado para operaciones críticas, sin UnitOfWork genérico (§5); kernel compartido en `core-contracts` y convenciones comunes (§5); ids UUIDv7 generados en la aplicación, un rol PostgreSQL por esquema y auditoría en `core.audit_log` (§16.1, §16.3, DATA-001); correcciones de consistencia en §2 (solicitud activa por mesa y tipo), §4 (PostgreSQL en Docker) y §10.1–10.2 (`domains/<d>/contracts`).

## 16. Bases de implementación acordadas (v1.2)

Decisiones tomadas el 19/10/2026 con el responsable del producto. Las que contradicen ADR-001 están en ADR-002; el modelo de datos completo está en DATA-001.

### 16.1 Código y separabilidad
- Repositorio único (pnpm workspaces) hacia cuatro repositorios; un paquete por dominio con su esquema, su Prisma y sus migraciones; `exports` limitado a `index.ts`; prueba de separabilidad en cada cambio (ADR-002 D1).
- **v1.3:** Clean Architecture por dominio (`domain`, `application`, `infrastructure`, `presentation`); puertos de Repository por agregado, entre dominios y en piezas reemplazables (§5).
- Repositorio privado en GitHub, Conventional Commits, una rama por fase.
- Node 24 LTS, pnpm, PostgreSQL 18, TypeScript `strict`, Vitest.
- **v1.4:** ids UUIDv7 generados en la aplicación (`newId()` de `core-contracts`): el id se necesita antes de insertar (transiciones, `aggregate_id`); `DEFAULT uuidv7()` queda como respaldo en la base.
- **v1.4:** un rol PostgreSQL por dominio, dueño solo de su esquema (`infra/postgres/init-schemas.sh`); cada servicio recibe solo sus variables de entorno.

### 16.2 Eventos
- Cada dominio emisor escribe `outbox_events` en la misma transacción del cambio. Un poller en el mismo proceso (sin Redis ni broker) entrega a suscriptores en proceso; al separar repositorios solo cambia el transporte (`EventPublisherPort`).
- Eventos versionados como tipos Zod en el `contracts` del emisor.
- El aviso al tablero por Socket.IO sale directo después del commit, sin esperar al poller.
- Analytics construye sus proyecciones solo a partir de eventos, deduplicando por `event_id`.
- Los eventos despachados no se borran durante el piloto (reconstrucción de proyecciones).

### 16.3 Identidad, sesiones y permisos
- Cuentas por negocio, usuario + contraseña, slug en la ruta; evolución a subdominio (ADR-002 D2).
- Organización de plataforma `labs`: todos sus usuarios son superadmin y gestionan todo en todos los negocios, incluida la instalación técnica de botones (ADR-002 D3).
- Roles por local (varios por persona): `admin` (dueño o administrador), `staff`, `inventory`; `is_owner` para dueños con varios locales. Los guards verifican permisos (`ROLE_PERMISSIONS`, DATA-001 §2), de modo que `staff` puede dividirse (mesero, cajero) sin tocar rutas.
- Tablet de barra con cuenta compartida `barra`; PIN por mesero como extensión, sin cambiar las tablas de llamados.
- Sesiones en PostgreSQL, 30 días deslizantes, revocables por el admin; cambiar la contraseña revoca todas las sesiones.
- Contraseña: mínimo 8 caracteres, al menos 1 mayúscula y 1 número. Bloqueo tras 5 fallos en 15 minutos por usuario y negocio, más límite por IP.
- CSRF: `SameSite=Strict` + revisión de `Origin`.
- **v1.4:** acciones administrativas y de superadmin registradas en `core.audit_log` (ADR-002 D3, DATA-001 §2). Almacenamiento del límite de intentos por IP: pendiente.
- Módulos habilitados en `core.entitlements`, con guard por módulo; el portal arma la navegación con ellos.
- Superadmin: consola en la demo para gateways, claves, botones, "detectados sin asignar" y vinculación botón–mesa. Creación de negocios, locales y módulos: por seed hasta el segundo cliente real.

### 16.4 Mesas y llamados
- Zonas opcionales; el mismo número de mesa puede repetirse en zonas distintas.
- Varios botones por mesa; un botón en una sola mesa a la vez, con historial.
- Máquina de estados como tabla de transiciones (`pending → in_progress → completed`), función pura probada sin base de datos. Sin estado de cancelación (requeriría ADR).
- `call_type` (`attention` en el piloto). La traducción tecla → tipo vive en el adaptador del hardware; Strategy (`CALL_TYPE_POLICY`) solo cuando un tipo se comporte distinto. Una solicitud activa por mesa y tipo (ADR-002 D4).
- Pulsación con solicitud activa: suma a `press_count` y vuelve a resaltar la mesa. Señales del mismo botón con menos de 3 s: `debounced`, sin sumar (constante ajustable con el hardware real).
- Visibilidad: todo `staff` ve todos los llamados del local; toda consulta y aviso pasa por `canSeeCall(user, call)`. El modo por mesero asignado (`assigned`) queda para después de la demo.
- Resaltado por espera: ámbar a los 2 min, rojo a los 5 min (constantes visuales, no criterios de aceptación).
- Botones no registrados: se guardan como `unknown_device` y aparecen solo en la consola del superadmin para vincularlos.

### 16.5 Conectividad del gateway
- Señal de vida cada 30 s; el tablero muestra "Botones desconectados" si pasan más de 90 s sin señal.

### 16.6 Simulador
- `apps/button-sim`: proceso y contenedor aparte que imita un gateway real. Sirve una página con un botón por mesa para abrir en un celular, y envía por **HTTP** (clave del gateway) o **MQTT** (Mosquitto, usuario por gateway con ACL a su tópico), seleccionable.

### 16.7 Inventario
- Productos **por local** (`products.location_id`, DATA-001 §8.3; v1.5 corrige «por negocio»): nombre, SKU y categoría opcionales, unidad (`unit`, `bottle`, `kg`, `g`, `l`, `ml`), cantidades `NUMERIC(12,3)`. Sin variantes ni precios.
- Lugar de stock "Principal" por defecto y otros creados por el admin; sin traslados (salida + entrada).
- Movimientos con dirección fija (`in`, `out`, `adjust`) y motivo de un catálogo configurable por negocio, con motivos sembrados (DATA-001 §4).

### 16.8 Provisionales
- Saldo de stock nunca negativo (`CHECK`), mientras se escala.
- Sin variantes de producto hasta el primer cliente de comercio no gastronómico.

### 16.9 Métricas
- Rangos con atajos (hoy, ayer, 7 días, 30 días, personalizado), agrupación por hora o día en la zona horaria del local, filtros por zona y mesa. Sin exportación en el MVP.

### 16.10 General y demo
- Interfaz solo en español; zona horaria por defecto `America/Bogota`.
- Seed de demo según DATA-001 §7.
- Demo local con `docker compose` durante el desarrollo; VPS solo para mostrarla en un bar.
