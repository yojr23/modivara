# ADR-004 — Transporte del gateway, auditoría cross-domain, áreas históricas y compatibilidad de contratos

> **Estado: Propuesto.** No está aceptado: decide el responsable. Nada aquí cambia código ni modifica ADR-001/002/003 ni TECH-001; si se acepta, esos documentos se enmiendan con una nueva revisión que apunte a este.
> **Fecha:** 03/11/2026 (commit `197b260`). **Cubre:** BACKLOG-001 DOC-04, ARC-10 y los puntos de decisión de SEC-04, ARC-06 y DAT-08.
> **Convención:** «Hoy» = lo que el repo hace y se puede comprobar; «Propuesta» = lo que se recomienda; lo que no se pudo comprobar lo dice.

## (a) Transporte físico del gateway

### Hoy

- **HTTP.** `POST /api/v1/device-events` y `POST /api/v1/gateways/heartbeat` se autentican solo con la cabecera de clave del gateway (`GATEWAY_KEY_HEADER`, `domains/hospitality/api/src/presentation/gateway-key.guard.ts`); la API guarda únicamente `gateways.key_hash` (`bytea`, único). Clave ausente, desconocida o de gateway desactivado: 401 igual. Límite por gateway de 20/s con ráfaga de 100 (`gateway-rate-limiter.ts`; en memoria, marcado `OPEN`).
- **MQTT.** Mosquitto con `allow_anonymous false`, contraseñas por usuario y ACL (`infra/mosquitto/mosquitto.conf`, `acl`): usuario `api` lee `modivara/gw/#`; cada gateway (usuario = id del gateway) solo escribe en `modivara/gw/<su id>/#`. La API deduce el gateway del tópico (`mqtt.adapter.ts`). Tamaño máximo 4096 bytes. La ACL se verifica con `scripts/mqtt-acl-check.sh`; el alta de usuarios con `scripts/mqtt-user.sh`.
- **Sin cifrado MQTT.** El único `listener` es `1883` sin TLS. En `docker-compose.yml` el servicio `mqtt` **no publica puertos**: solo es alcanzable dentro de la red de Compose (el simulador y la API). `docker-compose.prod.yml` solo publica 80 y 443 (Caddy), así que **hoy un gateway físico fuera del VPS solo puede usar HTTPS** a través de `/api/*` (`infra/caddy/Caddyfile.prod`).
- El simulador (`apps/button-sim/src/transports.ts`) implementa ambos transportes con el mismo contrato (TECH-001 §16.6).
- No comprobable en el repo: qué hardware se elegirá (Q-01), si soporta TLS con certificados propios, si el bar tiene VPN o IP fija.

### Alternativas

| | A. HTTPS con clave de gateway (lo ya expuesto) | B. MQTTS (TLS en 8883) con usuarios y ACL | C. VPN (p. ej. WireGuard) entre el local y el VPS, MQTT/HTTP dentro |
|---|---|---|---|
| Qué falta construir | Casi nada: ya existe. Solo política de rotación de claves y que el firmware envíe la cabecera. | Listener TLS en `mosquitto.conf`, certificados (CA propia o Let's Encrypt), puerto 8883 publicado, rutina de alta/rotación de usuarios en producción. | Servidor VPN en el VPS, un cliente por local o por gateway, gestión de claves; el broker queda sin exposición pública. |
| Cifrado y autenticación | TLS (Caddy) + clave por gateway. | TLS + usuario/contraseña + ACL por tópico. | Los del túnel; dentro puede seguir sin TLS. |
| Alcance de un gateway comprometido | Cualquiera con su clave puede enviar pulsaciones de **cualquier** `device_code` de su local (la clave identifica gateway y local). | Solo publica en su tópico, pero el tópico no limita a qué botones. Igual que A en efecto. | Igual; además da acceso de red al interior. |
| Hardware | Cualquier dispositivo con cliente HTTPS. | Requiere cliente MQTT con TLS (memoria/CPU del gateway). | Requiere poder correr el cliente VPN, o un router en el local que lo haga. |
| Operación | Un puerto ya publicado. Latencia de una petición HTTPS por pulsación. | Un puerto nuevo expuesto a internet; el broker pasa a ser superficie de ataque. | Más piezas que operar para un piloto con un solo bar. |
| Riesgo principal | Clave en el firmware (extraíble si alguien tiene el aparato). | Mala configuración de TLS o ACL; contraseñas MQTT en el aparato. | Complejidad desproporcionada al piloto. |

### Propuesta

**A para el piloto con hardware físico** (no publicar nunca `1883`), con estos mínimos antes de la primera instalación: una clave por gateway, rotación al reemplazar o perder un aparato (crear gateway nuevo y desactivar el viejo, ya soportado), y pruebas negativas (gateway desactivado 401, tenant tomado de la clave, ráfaga 429, cuerpo grande 413, mensaje inválido 400) que ya existen en `device-events.int.test.ts` y deben quedar en la lista de aceptación del piloto. MQTT queda para el simulador y para desarrollo dentro de Compose.

**Criterio de cambio:** pasar a B si el hardware elegido solo habla MQTT o si la latencia/consumo de HTTPS por pulsación no cumple lo medido en F6-08; pasar a C solo si hay varios locales con red propia y se quiere cerrar toda exposición. En B: certificados, puerto 8883, usuario por gateway (`mqtt-user.sh`), ACL sin cambios y una prueba negativa de TLS (conexión sin TLS rechazada). Esto cierra SEC-04 cuando se implemente; este ADR no lo implementa.

## (b) Auditoría cross-domain por outbox

### Hoy

- Una acción de plataforma en hospitality (`gateway.created`, `gateway.deactivated`, `device.created`, `device.assigned`, `device.unassigned`; `PLATFORM_ACTIONS` en `domains/hospitality/contracts/src/events.ts`) escribe `hospitality.platform_action.recorded` v1 en el outbox de hospitality **en la misma transacción** que el cambio (`platformAction()` en `application/support.ts`; invocado desde `application/gateways.ts` y `application/devices.ts`).
- Core se suscribe (`domains/core/api/src/presentation/platform-action.subscriber.ts`) y escribe `core.audit_log` con `id = event_id`, por lo que la entrega al menos una vez es idempotente. El local va en `details.locationId` (la tabla no tiene columna de local). El payload no lleva claves ni hashes.
- No hay SQL entre esquemas (DATA-001 §1).

### Decisión propuesta

Mantener este patrón como **el** mecanismo de auditoría entre dominios: el dominio que ejecuta la acción la anuncia por su outbox y core la guarda. Alternativas descartadas por ahora: puerto síncrono a core (acopla la disponibilidad de hospitality a core y rompe la transacción única), tabla de auditoría en cada dominio (fragmenta la consulta del superadmin).

### Cuándo extenderla

Extender (un evento `<dominio>.<tipo>_action.recorded` por dominio o un tipo genérico) cuando se cumpla **alguno**: (1) otro dominio tenga acciones administrativas con consecuencias fuera de su esquema (hoy no se ha identificado una; ajustes de stock ya quedan en `stock_movements` con actor); (2) un requisito externo (cliente o norma) pida trazabilidad de lectura o cambios de configuración; (3) core necesite consultar auditoría de un dominio sin llamarlo. Mientras tanto no añadir acciones que ya tengan historial propio con actor (`service_call_transitions`, `device_assignments`, `stock_movements`).

Límites conocidos: la auditoría es asíncrona (puede tardar o reintentarse hasta 10 veces y quedar con `failed_at`; `pnpm outbox:retry`); si core falla, la acción **ya ocurrió**. Si se exige «sin acción sin registro», haría falta un puerto síncrono, y eso es otra decisión.

## (c) Semántica histórica de áreas en métricas

### Hoy

- Un **área** es un elemento `area` dentro de `space_layouts.elements` (jsonb), no una tabla; una mesa pertenece al área que contiene su centro (`areaAt`, `apps/portal/src/app/plan.tsx`); las métricas por área son suma en el cliente con la geometría del plano **publicado actual** (`areaTotals`; `docs/PORTAL.md`). La UI lo dice (UX-03, `2d18836`: «Las métricas por área se calculan con el plano actual»).
- `analytics.service_call_facts` conserva copia de `table_label`, `zone_id` y `zone_name` al crear el llamado (zonas = espacios), pero **nada del área**. El evento `hospitality.service_call.created` v1 tampoco la trae.
- Consecuencia: mover una mesa o redibujar un área reasigna sus llamados pasados (hallazgo J de E2E-HALLAZGOS; BACKLOG-001 ARC-06/DAT-08).

### Alternativas

| | 1. Plano actual (hoy) | 2. Captura al crear el evento | 3. Área = entidad real (zona) |
|---|---|---|---|
| Qué cambia | Nada. Texto fiel. | Hospitality calcula el área al crear el llamado y la incluye en el evento (p. ej. `area_name`, `layout_id`/`layout_version`, campos opcionales); analytics añade columnas anulables y migración. | Áreas pasan a ser tablas con historial de pertenencia de mesas. |
| Historia | Se reescribe al mover. | Se preserva desde el despliegue; lo anterior queda sin área (o se reconstruye si el outbox conserva el payload, y no lo tiene). | Preservada si se modela con vigencia. |
| Costo | Cero. | Lógica de `areaAt` en el servidor (hoy solo está en el portal), leer el plano publicado dentro de la transacción de pulsación, migración de analytics, contrato v1 ampliado. | Mayor: migración, API, editor y reportes. |
| Riesgo | Cifras históricas engañosas si el local reorganiza. | Latencia y bloqueo extra en la ruta crítica de la pulsación. | Cambia ADR-003. |

### Propuesta

**Mantener la opción 1** hasta que el piloto muestre que un local reorganiza áreas y compara periodos (criterio de cambio medible: el responsable necesita una comparación mensual por área tras un cambio de plano). Si ocurre, elegir la opción 2 como cambio **compatible** (campos opcionales en `service_call.created` v1, ver (d)), con la regla de que el cálculo se haga fuera de la transacción de la pulsación o con el plano ya cargado en memoria. No empezar a capturar «por si acaso»: capturar sin consumirlo añade costo y datos sin uso. La opción 3 solo si las áreas necesitan atributos propios (aforo, responsables).

## (d) ARC-10 — Propiedad de datos/eventos y compatibilidad de contratos

### Reglas de propiedad (ya vigentes; se formalizan)

1. **Un esquema, un dueño.** Solo el dominio dueño escribe sus tablas (rol propio, `infra/postgres/init-schemas.sh`); no hay FK ni SQL entre esquemas. Otro dominio obtiene datos del dueño por su API pública (`CoreAccessPort`, `*-contracts`) o por eventos.
2. **El emisor posee el contrato.** Un evento vive en el `contracts` del dominio que lo emite (`defineEvent` en `domains/<d>/contracts/src/events.ts`); los consumidores importan ese esquema, no copian el tipo. Convención de nombre: `<dominio>.<agregado>.<hecho>` con `event_version` aparte.
3. **Los consumidores no se acoplan a internos.** Solo dependen de `*-contracts` (`pnpm check:separability` lo verifica).
4. **Los hechos no se reescriben.** Los facts de analytics son proyecciones reconstruibles desde el historial; la fuente es el dominio emisor.

### Qué cambio es compatible en una versión (v1)

Con `z.object` por defecto los consumidores ignoran campos desconocidos (no hay `strict` ni `passthrough` en los contratos: comprobado por búsqueda en `domains/*/contracts/src`). Por eso:

| Cambio | ¿Compatible con v1? |
|---|---|
| Añadir un campo **opcional** o con valor por defecto al payload o a un DTO de respuesta | Sí. Mismo `event_version`. |
| Añadir un valor a un enum **que solo el emisor consume o que los consumidores tratan con `default`** | Solo si todos los consumidores lo toleran: verificar consumidor por consumidor. |
| Añadir un campo **obligatorio**, quitar o renombrar un campo, cambiar tipo, unidad o semántica, estrechar un enum, endurecer una validación | No. Requiere nueva versión. |
| Cambiar la regla de cuándo se emite el evento | No (cambia la semántica): nueva versión o nuevo tipo. |

### Cuándo versión nueva

Un cambio incompatible crea `event_version: 2` con su propio esquema (`…V2`) y el emisor publica **ambas** versiones mientras exista un consumidor de v1; v1 se retira cuando ningún consumidor la use, en un PR aparte. **Atención:** hoy el registro de analytics (`domains/analytics/api/src/application/event-registry.ts`) indexa por `event_type` solo y cada entrada parsea con un esquema de versión literal; un v2 bajo el mismo `event_type` fallaría el parseo y se reintentaría hasta `failed_at`. Antes del primer v2 hay que decidir entre un `event_type` nuevo o indexar el registro por `(event_type, event_version)`. Esto no se ha hecho ni probado.

### Prueba exigida en el PR (emisor–consumidor)

Todo PR que cambie un evento o un DTO de `*-contracts` debe:
1. Declarar la versión y la compatibilidad (casilla «Cambia el contrato de la API» y descripción en `.github/pull_request_template.md`; el criterio del ticket ARC-10 es exactamente esto).
2. Incluir una prueba del **emisor** que valide el sobre real contra el esquema publicado (patrón existente: `domains/hospitality/api/src/application/event-contract.test.ts` y `contracts.test.ts`) y una del **consumidor** que procese el payload (analytics: proyección de `service_call.*` y `commerce.stock.*`; core: `platform-action.subscriber.test.ts`). Si el cambio es compatible, la prueba del consumidor puede ser la existente más un caso con el campo nuevo y otro sin él.
3. Si el cambio añade columnas en la base del consumidor, la migración es compatible hacia atrás (casilla «Migraciones» de la plantilla).

No comprobado: que exista hoy una sola prueba que enlace emisor y consumidor extremo a extremo para cada evento (las pruebas existentes cubren cada lado por separado). No se añade bus nuevo ni registro de esquemas (ARC-10, PAT-06).

## Consecuencias

- Si se acepta: SEC-04 se resuelve con (a) más una lista de pruebas de aceptación; ARC-06/DAT-08 quedan cerrados como «sin cambio, con criterio de reapertura»; ARC-10 queda en este documento y en la plantilla de PR.
- Si no se acepta: los cuatro temas siguen abiertos en BACKLOG-001; la sección «Hoy» de cada punto sigue siendo una descripción válida del estado.
