# BACKLOG-001 — Mejoras técnicas priorizadas del repositorio Modivara

**Fecha:** 2026-11-03  
**Base:** `yojr23/modivara`, rama `main`, commit `db11844be64b7fd41a6126f62d05b724d8555a29` (30/10/2026).  
**Fuentes:** revisión estática del código y documentos ADR-001/002/003, TECH-001, DATA-001, PLAN-001, BRAND-002, así como auditorías AUDITORIA-001 y AUDITORIA-002.  
**Alcance:** backlog propuesto; **no** se modificó el repositorio ni se ejecutaron pruebas, escaneos de seguridad, servidores o hardware en esta revisión. `docs/E2E-HALLAZGOS.md` reporta 15 E2E verdes el 30/10, sin validación independiente en este turno.

## Lectura y criterios

- **P0:** requisito para despliegue público o tratamiento de datos reales (a veces condicionado a usar el simulador/MQTT). **P1:** necesario para un piloto físicamente confiable. **P2:** mantener y escalar con menor riesgo. **P3:** considerar solo al aparecer un disparador medible.
- **C:** situación confirmada por inspección estática. **R:** riesgo plausible; requiere reproducción o prueba. **E:** evolución/recomendación de diseño, no defecto demostrado.
- **Aceptación:** comportamiento observable o prueba que permite cerrar la tarea; no basta con «refactor realizado».
- **Corte:** no se debe inferir que todo el repositorio presenta el mismo problema; las observaciones se limitan a los archivos y flujos inspeccionados.

## A. Seguridad y control de acceso (SEC)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| SEC-01 | P0 · C | Eliminar `/sim` del proxy público de producción; si se necesita demo, proteger por autenticación y separarla de negocios reales. | `infra/caddy/Caddyfile`, `apps/button-sim/src/main.ts` | Un cliente no autenticado no puede provocar una llamada de mesa; la demo no comparte credenciales/datos de producción. |
| SEC-02 | P0 · C | Crear Caddyfile y Compose de producción con FQDN, HTTPS, redirección HTTP→HTTPS y WebSocket verificado. | `infra/caddy/Caddyfile`, `docker-compose.yml`, cookies de Core | TLS válido; login y Socket.IO funcionan sobre HTTPS con cookies `Secure`. |
| SEC-03 | P0 · C | Backups cifrados, fuera de VPS, con retención, monitorización y **restauración real ensayada**. | `docker-compose.yml`, PLAN-001 F6-06 | Restauración documentada en base desechable y verificación de cuentas, planos, llamados, stock y auditoría. |
| SEC-04 | P0 para IoT remoto · C | Elegir transporte seguro del gateway: HTTPS con identidad de gateway o MQTTS/VPN + usuarios y ACL; no publicar TCP/1883 sin protección. | `infra/mosquitto/mosquitto.conf`, `docker-compose.yml` | El gateway físico autentica, cifra y solo puede publicar en el ámbito autorizado; ensayos negativos. |
| SEC-05 | P1 · C | Reemplazar o ajustar limitador de login que cuenta también éxitos por IP compartida. Revisar reglas por cuenta/IP, fallos, recuperación y alcance multiinstancia. | `domains/core/api/src/presentation/login-rate-limiter.ts` | Múltiples usuarios de un bar pueden iniciar sesión sin bloqueo por actividad legítima; ataques repetidos siguen limitados. |
| SEC-06 | P1 · C | Registrar acciones del superadmin sobre gateway, dispositivo y asignación mediante contrato de auditoría asíncrona o puerto autorizado. | `domains/hospitality/api/src/presentation/platform.controller.ts`, ADR-002 D3 | Cada operación administrativa queda atribuida al actor/negocio/recurso, con resultado y fecha consultables. |
| SEC-07 | P1 · R | Ejecutar batería negativa de autenticación, permisos, entitlements, aislamiento tenant y acceso Socket.IO/API para **todas** las rutas. | Guards Core, controladores por dominio y realtime | Matriz `rol × endpoint × negocio/local`: accesos indebidos 401/403/404 y sin filtración cruzada. |
| SEC-08 | P1 · E | Automatizar SCA y escaneo de secretos (`pnpm audit`, Dependabot/Renovate, Gitleaks o equivalentes) en PR; definir política de severidad. | CI inexistente; `pnpm-lock.yaml` | Pull request bloqueado por hallazgos críticos verificables; excepciones documentadas y con vencimiento. |
| SEC-09 | P2 · C | Endurecer contenedor: etapas runtime mínimas, dependencias de producción, usuario no privilegiado (ya existe), y separar rol migrador del rol runtime. | `Dockerfile`, `infra/postgres/init-schemas.sh` | Contenedor final contiene solo lo requerido; runtime no puede crear/modificar esquemas. |
| SEC-10 | P2 · E | Verificar cabeceras HTTP, CSP apropiada, HSTS en HTTPS, límites de payload, políticas de origen y logs sin secretos. | Caddy, `apps/api`, `button-sim` | Pruebas de cabeceras/orígenes, límites, redacción de credenciales y ausencia de fuga en errores. |

## B. Arquitectura, dominio y consistencia (ARC)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| ARC-01 | P1 · C | Validar **semántica de áreas** en backend: no pueden superponerse si la pertenencia de mesa al área deja de ser unívoca; definir política de intersección explícita. | `domains/hospitality/api/src/domain/layouts/space-layout.ts`, `apps/portal/src/app/editor-kit.tsx` | API directa rechaza layouts incompatibles con áreas; test de frontera y publicación. |
| ARC-02 | P1 · C | Validar límites reales de elementos dimensionados, no solo coordenada de anclaje; considerar rotación y caja de contorno según regla acordada. | `validateLayoutContent` en `space-layout.ts` | Un elemento no queda fuera de lienzo al guardar/publicar, salvo regla explícita que lo permita. |
| ARC-03 | P1 · C/R | Hacer atómica la desactivación de mesa respecto de asignaciones y llamadas entrantes; bloquear mesa/comprobaciones y formalizar comportamiento con señal simultánea. | `domains/hospitality/api/src/application/zones-and-tables.ts` | Prueba PostgreSQL concurrente: no quedan llamadas activas nuevas para una mesa ya desactivada. |
| ARC-04 | P1 · C | Evitar que una falla de publicación realtime se pierda silenciosamente: logging estructurado, correlación y reintento/reconciliación. | `notifyAfterSave` en `application/support.ts`, `PublishLayout` | Fallas de notificación visibles en monitorización; tablero converge por snapshot/reconexión. |
| ARC-05 | P1 · C | Alinear contrato analítico con dimensiones físicas: no devolver `total_delta` mezclando botellas, kg, litros y unidades. | `domains/analytics/api/src/domain/inventory-metrics.ts` | Totales globales solo conteos; magnitudes por producto/unidad, con tests heterogéneos. |
| ARC-06 | P1 · C | Formalizar semántica de métricas históricas por área: **actual** o **histórica**, con copy fiel; decidir temporalidad de asignación antes de diseñarla. | `plan.tsx`, `editor-kit.tsx`, `Metrics.tsx` | Usuario sabe a qué plano corresponden cifras; tests con mesa movida de área. |
| ARC-07 | P2 · R | Fortalecer atomicidad de proyección analítica (`apply` y marcar `processed_event`) y documentar deduplicación con entregas concurrentes. | `domains/analytics/api/src/application/project-event.ts` | Replay, paralelismo y caída entre pasos no producen inconsistencias ni doble recuento. |
| ARC-08 | P2 · R | Revisar duración de transacción del OutboxPoller: ejecuta suscriptores bajo lock; timeout con `Promise.race` no cancela operaciones. | `domains/core/contracts/src/outbox-poller.ts` | Pruebas con suscriptor lento/colgado, reinicios y varios workers; tiempos y reintentos controlados. |
| ARC-09 | P2 · C | Fortalecer separabilidad de frontend por dominio: código de pantallas Hospitality/Commerce/Analytics aún está centralizado en `apps/portal/src/app`. Mover gradualmente componentes de negocio al `web` propio cuando cambien. | `apps/portal/src/app/Board.tsx`, `Spaces.tsx`, `Inventory.tsx`, `Metrics.tsx` | `apps/portal` compone rutas/layout; componentes y hooks específicos viven en paquetes de dominio sin importaciones prohibidas. |
| ARC-10 | P2 · E | Definir reglas explícitas de propiedad de datos, eventos y compatibilidad de contratos v1 para cambios futuros. No añadir bus nuevo ahora. | ADR-001/002/003, `domains/*/contracts` | PR que cambia evento/DTO incluye versión, compatibilidad y prueba consumidor-emisor. |

## C. POO, SOLID y diseño de código (OBJ)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| OBJ-01 | P1 · C | Reparar encapsulación de `SpaceLayout`: `get elements()` devuelve referencia mutable, y `createDraft`/`restore`/`toProps()` hacen copias superficiales. Evitar aliasing de elementos anidados y fechas. | `domains/hospitality/api/src/domain/layouts/space-layout.ts` | Alterar el array/objeto recibido de un getter/DTO no cambia el agregado sin `replaceContent` ni revisión. |
| OBJ-02 | P1 · C | Centralizar invariantes geométricas dentro del dominio (funciones puras `LayoutPolicy`/`GeometryRules`), compartiendo criterios con validación anticipada UI sin convertir UI en autoridad. | `space-layout.ts`, `editor-kit.tsx` | Pruebas unitarias para solape de áreas, límites, elementos rotados, duplicados y publicabilidad. |
| OBJ-03 | P1 · C | Definir una operación transaccional de caso de uso para desactivar mesa (puerto `TableDeactivationUnitOfWork` o equivalente) en lugar de un conjunto de consultas sueltas. | `DeactivateTable` | Contrato de transacción y test de carrera; no exigir un UnitOfWork genérico a los cuatro dominios. |
| OBJ-04 | P2 · E | Reforzar tipos que impidan combinaciones físicamente inválidas (ej. `Quantity` con unidad, o DTOs parametrizados por producto) donde el bug de métricas lo justifique. | Commerce/Analytics contracts | El compilador/validador impide interpretar una suma de cantidades heterogéneas como magnitud agregada. |
| OBJ-05 | P2 · E | Inyectar `Clock`/`TimeProvider` en casos de uso donde se necesita tiempo determinista; mantener `Date` directa si no afecta reglas o pruebas. | `new Date()` en casos de uso y métricas | Tests de límites de día, vencimiento, orden de eventos y cambios de huso sin esperas reales. |
| OBJ-06 | P2 · R | Revisar aliasing en otros agregados (`ServiceCall` expone `Date` por getter) y fijar política de snapshots inmutables, **solo si** se confirma efecto en invariantes. | `domains/hospitality/api/src/domain/service-calls/service-call.ts` | Tests de mutación externa de propiedades temporales y serialización; eliminar referencias vulnerables. |
| OBJ-07 | P2 · E | Mantener casos de uso cohesivos (una intención de negocio) y evitar servicios «god object» y utilitarios genéricos; extraer solo por responsabilidades observables. | `zones-and-tables.ts`, `layouts.ts`, `editor-kit.tsx` | Módulos pueden evolucionar y probarse por separado; no se crean abstracciones sin dos necesidades concretas. |

## D. Patrones de diseño y comunicación (PAT)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| PAT-01 | P1 · C | Completar patrón **Transactional Outbox** con monitoreo de `failed_at`, atraso, reproceso y reconciliación; hoy existe poller y comando de retry, no alarmas operativas. | `domains/core/contracts/src/outbox-poller.ts`, `apps/api/src/outbox-retry.ts` | Evento fallido genera alerta; reintento seguro sin duplicar efectos. |
| PAT-02 | P1 · C | Introducir puerto de auditoría **solo** en frontera necesaria (ideal evento de Hospitality consumido por Core). Evitar dependencia directa de DB/schemas. | `platform.controller.ts` y ADR-002 | Auditoría cross-domain funcionando sin `hospitality` escribiendo SQL en `core`. |
| PAT-03 | P1 · E | Para IoT, concretar **idempotent consumer** con clave estable por pulsación y acuse/reenvío; la protección existente contra duplicados no sustituye entrega offline fiable. | GatewayIngest, `PrismaButtonPressStore`, transportes IoT | Una señal repetida por red se refleja una sola vez, y una pendiente se recupera al reconectar. |
| PAT-04 | P2 · E | Reutilizar el patrón **Strategy** que ya existe para HTTP/MQTT (`GatewayTransport`); no añadir `if` por tipo de hardware en casos de uso. | `apps/button-sim/src/transports.ts`, `gateway-ingest.ts` | Transportes alternativos pasan las mismas pruebas de contrato y conservan lógica de negocio única. |
| PAT-05 | P2 · E | Mantener **State Machine + Optimistic Concurrency** existente en `ServiceCall` y `SpaceLayout`; expandir pruebas de transiciones ilegales, doble ack y conflicto 409. | `service-call.ts`, `layouts.ts` | Transiciones solo a estados permitidos; simultaneidad retorna estado vigente o conflicto estable. |
| PAT-06 | P2 · E | No instalar CQRS completo/Event Sourcing. Las proyecciones analíticas actuales son suficientes; añadir snapshots o jobs solo ante métricas de crecimiento. | Arquitectura actual | Existe umbral medido antes de nueva infraestructura; ningún nuevo servicio distribuido sin beneficio cuantificado. |

## E. Datos, consultas y rendimiento (DAT)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| DAT-01 | P1 · R | Verificar índices/constraints de unicidad tenant-local en DB, no solo `findActiveByName/Label` antes de guardar. Corregir solo lo ausente. | `zones-and-tables.ts`, migraciones Hospitality | Dos altas concurrentes del mismo nombre/mesa no crean duplicados; prueba real PostgreSQL. |
| DAT-02 | P1 · C | Corregir unidades de métricas e incluir casos de stock con productos de distintas unidades. | `inventory-metrics.ts` | Conteos/magnitudes no confunden volumen, peso y número de botellas. |
| DAT-03 | P2 · C | Hacer filtros y paginación de movimientos en servidor (hoy `HistoryView` filtra máximo 100 registros en cliente). | `apps/portal/src/app/Inventory.tsx` | Historial navega más de 100 movimientos, filtra por producto/tipo/fecha de forma consistente. |
| DAT-04 | P2 · C | Incorporar nombre de actor (snapshot o batch de resolución a Core) sin FK cruzada; controlar acceso a PII. | Commerce movimiento API/DTO, `Inventory.tsx` | Una salida identifica responsable autorizado; usuarios desactivados siguen auditables. |
| DAT-05 | P2 · C | Eliminar N+1 de métricas de inventario: añadir `by_product`/endpoint agrupado cuando volumen lo requiera. | `apps/portal/src/app/Metrics.tsx` (`useQueries`) | Peticiones no crecen linealmente con el número de productos; comparar perfiles antes/después. |
| DAT-06 | P2 · C | Poner límites a la lectura en memoria de facts y migrar consultas de alta cardinalidad a agregados SQL al superar presupuesto medido. | `GetInventoryMetrics`, repositorios Analytics | Rangos grandes no agotan memoria ni disparan latencia fuera del objetivo. |
| DAT-07 | P2 · C | Usar explícitamente zona horaria del **local**, no del navegador, para «hoy/ayer» y fecha de movimientos. | `apps/portal/src/app/format.ts` y `Inventory.tsx` | Administración remota con TZ distinta presenta día comercial del local. |
| DAT-08 | P2 · E | Diseñar captura histórica de área solo si se requiere comparación longitudinal real; capturar versión del plano/área al crear evento, con migración del contrato. | Evento `service_call.created`, Analytics | Mover mesa no reasigna eventos antiguos a un área nueva; reconstrucción preserva historia. |

## F. UX, UI y accesibilidad (UX)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| UX-01 | P1 · C | Bloquear navegación con plano sucio: salir a otra ruta, logout, cambio de local y cierre/recarga de pestaña. | `useLayoutEditor`, `Spaces.tsx` | Usuario puede guardar/descartar/cancelar; no pierde trabajo sin aviso. |
| UX-02 | P1 · C | Replantear editor de **cuatro columnas rígidas** para tablet y móvil: vista desktop o drawers; no comprimir el lienzo. | `Spaces.tsx` grid `196+272+auto+312px` | 390/768/1024/1366 px sin controles inaccesibles; screenshot + test operable. |
| UX-03 | P1 · C | Corregir copy falso «métricas pasadas conservan el área que tenían». Mostrar «áreas según plano actual» hasta tener temporalidad. | `editor-kit.tsx` `AreaInspector`, `Metrics.tsx` | Textos coherentes con cálculo real; ningún estado muestra una promesa falsa. |
| UX-04 | P1 · C | Usar diálogo accesible nativo o Radix para producto y editor, con trampa de foco, Escape, retorno al disparador y `aria-labelledby` único. | `ProductDialog`, `EditorDialogs`, `useEscape` | Ciclo `Tab/Shift+Tab/Escape` con teclado y lector de pantalla. |
| UX-05 | P1 · E | Validar flujo de tablero con personal real: acceso a acción de reconocer/finalizar, jerarquía de cola por prioridad y visibilidad al estar desconectado. | `Board.tsx` | Tareas clave pueden completarse con número de pulsaciones y tiempo aceptables en condiciones del local. |
| UX-06 | P2 · C | Evitar descarte silencioso al renombrar espacio: `onBlur` actualmente sale de edición sin persistir. | `Spaces.tsx` `SpaceTitle` | Enter/Guardar confirma; Escape cancela; blur no pierde cambios inadvertidamente. |
| UX-07 | P2 · C | Corregir roles de selección de producto: varios `radiogroup` anidados semánticamente respecto de una elección global sin teclado tipo radio. | `Inventory.tsx` | Patrón `aria-pressed` o radio correcto; navegación por teclado y anuncio consistente. |
| UX-08 | P2 · C | Visibilizar historial completo, autor de cambios y filtros sin ocultar el límite actual de 100 movimientos. | `Inventory.tsx` | Usuario localiza un ajuste anterior por fecha, motivo y responsable. |
| UX-09 | P2 · C | Mejorar mensajes de error según origen (401/403/409/5xx/offline), sin afirmar siempre «el servidor no respondió». | `apps/portal/src/app/ui.tsx` `ErrorState` | Copy específico, acción de recuperación pertinente, sin pérdida de información. |
| UX-10 | P2 · R | Auditar foco, orden tabular y lector de pantalla en SVG de planos, colas y gráficas; conservar icono+texto y reduced-motion existentes. | `Board.tsx`, `Metrics.tsx`, `charts.tsx`, `index.css` | Auditoría axe + manual de los flujos; defectos reales registrados y corregidos. |
| UX-11 | P2 · R | Probar paleta clara/oscura y tokens con estados (pendiente, retrasado, deshabilitado, foco) incluyendo contraste de texto pequeño. | `index.css`, BRAND-002 | Estados principales alcanzan objetivo de accesibilidad y son distinguibles sin color. |
| UX-12 | P2 · R | Corregir/ensayar ruta canónica `/sim` ↔ `/sim/` y `fetch('press')`; mantener simulador separado de producción. | `apps/button-sim/src/page.ts`, Caddyfile | Ambas URLs resuelven llamadas previstas o una redirige; test de transporte. |

## G. Módulos funcionales y experiencia de cliente (MOD)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| MOD-01 | P1 · C | Portal de **usuarios y roles** para dueño/admin: altas, permisos locales, desactivación y reset de contraseña. | Backend `domains/core/api/src/presentation/users.controller.ts`; UI pendiente | Dueño gestiona equipo sin operador de base de datos; tests por rol. |
| MOD-02 | P1 · C | Consola de **superadmin**: negocios, gateways, dispositivos detectados, asignaciones y estado de conectividad. | `domains/hospitality/api/src/presentation/platform.controller.ts`; UI pendiente | Alta y asignación de dispositivo físico desde UI; cambios auditados. |
| MOD-03 | P1 · C | **Historial de llamados** y trazabilidad por mesa/operador/fecha con estados y tiempos correctos. | Hospitality backend, UI pendiente | Propietario ve llamado completo y quién lo tomó/cerró; controles de acceso. |
| MOD-04 | P1 · E | Gestión de **mesas/zonas** fuera del lienzo para desactivar/mover de forma explícita y segura. | `zones-and-tables.ts`, `Spaces.tsx` | Administrador distingue «quitar del plano» de «desactivar mesa»; sin pérdida de registros. |
| MOD-05 | P1 · E | Diagnóstico operacional visible: botones/gateways desconectados, último heartbeat, fallos de entrega y causa probable. | `GetConnectivity`, `Board.tsx` | Operador detecta falla de un equipo sin revisar logs de servidor. |
| MOD-06 | P2 · C | UI para **motivos, lugares de stock** y administración básica de catálogo, conservando permisos. | Commerce API, `Inventory.tsx` | No requiere seed/manual SQL para nuevos negocios, stock locations o razones. |
| MOD-07 | P2 · E | Definir comportamiento de llamadas repetidas, prioridad y sonido opcional basado en pruebas reales de barra; control de volumen y silencio. | `Board.tsx`, ADR-002 D4 | Alertas perceptibles, sin tormenta sonora ni pérdida de prioridad. |
| MOD-08 | P3 · E | Inventario/POS/métricas ampliadas como módulos comerciales separados, solo tras validar ventas del MVP y demanda concreta. | ADR-001 | Posibilidad de habilitar Commerce/Analytics sin Hospitality y sin reescribir Core. |

## H. Calidad, pruebas, operación y DevEx (QA)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| QA-01 | P1 · C | GitHub Actions en PR: `pnpm typecheck`, `test`, `build`, `check:separability`, integración PostgreSQL. | `.github/workflows/` ausente; scripts `package.json` existentes | Fallo bloquea merge de PR; `main` tiene checks obligatorios. |
| QA-02 | P1 · C | E2E aislados por ejecución, en contenedores/base desechables, sin alterar la demo ni depender de sesiones anteriores. | `playwright.config.ts`, `e2e/global-setup.ts` | Repetición limpia 2 veces obtiene mismos resultados, sin registros residuales ni bloqueo de login. |
| QA-03 | P1 · C/R | E2E de IoT por HTTP **y MQTT**, gateway físico, reconexión, caídas, duplicados y concurrencia bajo carga de piloto. | `e2e/service-call.spec.ts`, IoT | Evento de botón termina en UI y DB dentro de umbral medido; pruebas de red y colas. |
| QA-04 | P1 · C | Separar `/health/live` y `/health/ready` con DB/outbox/MQTT; readiness no equivale a HTTP levantado. | `apps/api/src/app.module.ts` | Readiness falla al perder dependencia crítica; liveness no reinicia por falla recuperable ajena al proceso. |
| QA-05 | P1 · C | Logs estructurados con `correlation_id`, `organization_id`, `location_id`, `gateway_id` sin exponer secretos; métricas de outbox/cola/reconexión. | `notifyAfterSave`, `OutboxPoller`, PLAN-001 F6 | Traza de pulsación desde ingreso hasta actualización de tablero; alerta por backlog o errores persistentes. |
| QA-06 | P1 · E | Guardias de seguridad en E2E: acceso anónimo, autorización cruzada, expiración y revocación con socket, cookie/origen. | Core auth + Hospitality realtime | Pruebas negativas específicas para rutas y conexiones. |
| QA-07 | P2 · E | Tests de arquitectura estática en CI: dependencias entre capas y contratos, no solo paquetes/dominos. | `scripts/check-separability.mjs` | `domain` no importa Prisma/Nest/React; `apps/api` no implementa negocio. |
| QA-08 | P2 · E | Calidad de frontend: `eslint`/reglas React hooks, tests componentes y chequeo accesibilidad; capturas por viewport en PR. | `apps/portal`, E2E | Regresión de foco, navegación y responsive detectable automáticamente. |
| QA-09 | P2 · E | Documentar pipeline de migraciones/rollback, seed reproducible, control de variables y procedimiento de incidente. | `scripts/api-start.sh`, migraciones, README | Despliegue y restauración repetibles, sin scripts manuales improvisados. |
| QA-10 | P2 · E | Presupuesto básico de rendimiento medido: latencia de pulsación→UI, RPS, consultas por producto, memoria Analytics, reinicio/proyección. | Analytics y Board | Perfil de carga guardado, umbrales de alerta y optimizaciones ligadas a evidencia. |

## I. Gobernanza de repositorio y documentación (DOC)

| ID | Prioridad / base | Mejora concreta | Evidencia / zona | Criterio de aceptación |
|---|---|---|---|---|
| DOC-01 | P1 · C | Decidir si `yojr23/modivara` debe ser público o privado: TECH-001 indica privado, GitHub era público en este corte. | TECH-001 §16.1, GitHub repository metadata | Política consistente; inspección de historial si la visibilidad fue accidental. |
| DOC-02 | P2 · C | Crear `DATA-002` o documento as-built contra las migraciones SQL reales; mantener DATA-001 como decisión histórica. | DATA-001, `domains/*/api/src/infrastructure/prisma/migrations` | Diccionario de datos vigente con índices, roles, FKs por dominio y entidades actuales. |
| DOC-03 | P2 · C | `STATUS-001`: fuente única de estado actual, evidencias y pendientes; conservar `HANDOFF`, `NOCHE-LOG` y `E2E-HALLAZGOS` como históricos. | README, PLAN-001, PORTAL, E2E-HALLAZGOS | No hay contradicciones en «hecho», «en curso», «próximo» entre documentos activos. |
| DOC-04 | P2 · E | ADR nuevo para **transporte físico**, auditoría cross-domain y semántica histórica de áreas; no editar decisiones congeladas sin nueva revisión. | ADR-001/002/003 y TECH-001 | Decision records contienen alternativas, trade-offs y criterios de cambio. |
| DOC-05 | P2 · E | Plantillas de PR/issue con riesgos, tests, migraciones, seguridad y consecuencias de interfaz; etiquetas por dominio y prioridad. | GitHub repo | Mejoras trazables y verificables; los PR importantes vinculan issue, aceptación y evidencia. |

## J. Orden de implementación recomendado (PRs de extremo a extremo)

1. **PR-01 «Producción segura»**: SEC-01, SEC-02, SEC-04, UX-12 si se mantiene demo. Mantener el simulador fuera de producción.
2. **PR-02 «Respaldo y recuperación»**: SEC-03, QA-09, prueba de restauración.
3. **PR-03 «Pipeline»**: QA-01, QA-02, SEC-08, QA-07: bloquear regressiones antes de ampliar funcionalidades.
4. **PR-04 «Invariantes del plano»**: OBJ-01/02, ARC-01/02 con pruebas API y de estado mutable; corregir UX-03.
5. **PR-05 «Concurrencia de mesa»**: ARC-03, OBJ-03, DAT-01 tras comprobar constraints.
6. **PR-06 «Seguridad de identidad y auditoría»**: SEC-05/06/07, PAT-02, pruebas de aislamiento.
7. **PR-07 «Fiabilidad de eventos»**: ARC-04/07/08, PAT-01/03, QA-05, con hipótesis reproducidas antes de cambiar diseño.
8. **PR-08 «Editor utilizable»**: UX-01/02/04/06/10 y revisión responsive real.
9. **PR-09 «Módulos de operación»**: MOD-01/02/03/05, según dependencia de hardware, completando rutas sin SQL manual.
10. **PR-10 «Datos correctos»**: ARC-05/06, DAT-02/07, UX-08/09; dejar DAT-08 para decisión comercial.
11. **PR-11 «Pruebas del piloto»**: QA-03/04/06/10, pruebas de botones y capacidad de recuperación medible.
12. **PR-12 «Optimización selectiva»**: ARC-09/10, DAT-03/04/05/06 y DOC-02/03/04 cuando resultados de campo o volumen lo justifiquen.

## K. Patrones existentes que **no** deben sustituirse indiscriminadamente

- **Monolito modular, puertos/adaptadores y DIP**: conservar dominio/aplicación aislados de Nest, Prisma, MQTT y React.
- **Strategy para transportes HTTP/MQTT**: ya existe; agregar implementaciones por contrato, no `switch` dispersos.
- **Agregados con transiciones explícitas, validación de estado y concurrencia optimista**: ya existen en llamadas y planos; corregir encapsulación y validar reglas faltantes, no crear una clase por cada estado.
- **Transactional Outbox y consumidores idempotentes**: mecanismos presentes; instrumentar, comprobar concurrencia y automatizar recuperación.
- **Esquemas PostgreSQL por dominio**: conservar; el aislamiento no exige bases/microservicios distintos en esta fase.
- **No añadir** Kafka, Kubernetes, Redis, microservicios, CQRS completo, Event Sourcing integral o base repositories genéricos sin resultados que demuestren la necesidad.

## L. Puertas de aceptación

**Demo remota pública:** SEC-01/02/03, QA-01/02, rutas de simulador verificadas y sin acceso accidental a negocio real.

**Piloto con botones físicos:** además SEC-04/05/06, ARC-01/02/03/04/05, UX-01/02/03/04, MOD-02/05, QA-03/04/05 y recuperación real ante fallo.

**Primer cliente de pago:** además autogestión básica (MOD-01/03/06), historial confiable, soporte de incidentes, permisos completos, política de retención, costos operativos medidos y documentación as-built.

**Advertencia:** estas son puertas propuestas, no una certificación. No se ha ejecutado pentest, auditoría de dependencias, test de carga, ensayo de restauración, prueba real de hardware, auditoría visual de UI ni auditoría WCAG integral.

## M. Traza de trabajo

Registro de lo hecho sobre este backlog, en orden. Cada entrada: rama, commits, verificación.

### M.1 Verificación puntual (03/11/2026)

Contraste rápido de algunas afirmaciones «C» con el código de `main` (`db11844`). Todas se confirman:

| ID | Confirmado en |
|---|---|
| SEC-01 | `infra/caddy/Caddyfile`: `handle_path /sim*` → `button-sim:4000`, sin autenticación; el bloque escucha en `:80` (sin HTTPS, SEC-02). |
| SEC-05 | `login-rate-limiter.ts`: ventana fija por IP, 30 intentos / 15 min, en memoria; `auth.controller.ts:34` llama `hit()` antes del login, así que cuenta éxitos también. |
| ARC-03 | `zones-and-tables.ts:159`: el propio código marca la carrera (`ponytail: comprobación sin bloqueo…`). |
| ARC-05 / DAT-02 | `inventory-metrics.ts:72,80`: `total_delta` suma deltas sin distinguir unidad. |
| OBJ-01 | `space-layout.ts:96`: `get elements()` devuelve el array interno; `:86` y `:120` copian de forma superficial. |
| UX-03 | `editor-kit.tsx:560` y `Spaces.tsx:133` prometen que las métricas pasadas conservan el área, pero `Metrics.tsx` calcula `areaTotals` con la geometría del plano actual. |
| QA-01 | No existe `.github/`. |
| QA-04 | Un solo `@Controller('health')` en `apps/api/src/app.module.ts`. |

DOC-01 (visibilidad del repo) no se pudo comprobar: `gh` sin sesión.

### M.2 Cruce con ramas sin integrar y decisiones del responsable

El backlog solo miró `main`. En `api/huecos` → `pantallas/pendientes` (empujadas, esperan revisión, ver `MEMORY.md` 31/10) ya hay trabajo que cubre o adelanta:

| ID | Estado fuera de `main` |
|---|---|
| DAT-04 | `dbcda78` nombre de quien registró en movimientos (`actor_name`). |
| DAT-05 | `fb6f843` `by_product` en una sola consulta. |
| QA-03 (parcial) | `b3a019c` E2E de pulsación por MQTT. |
| MOD-01 | `97655fd`, `eb26bc6` pantalla de usuarios con roles por local. |
| MOD-02 | `bcdf27d` consola de superadmin; `00a079f` desactivar gateways; `6b8ab0c` listado de negocios. |
| MOD-03 | `067e5a9` historial de llamados. |
| MOD-04 (parcial) | `1f6b04d` desactivar mesas y espacios. |
| MOD-06 | `ef81b6f` lugares de stock y motivos. |
| MOD-07 (parcial) | `476286a` alerta sonora opcional. |

Chocan con decisiones ya tomadas (requieren que el responsable las reabra):

- **QA-01 / QA-02:** 31/10 «sin base E2E desechable ni GitHub Actions por ahora».
- **OBJ-05:** TECH-001 §5 v1.3 decide «sin `Clock`» (`vi.setSystemTime` en pruebas).
- **OBJ-03:** compatible con la decisión del 20/10 (puerto transaccional acotado tipo `withDeviceLock`, sin UnitOfWork genérico).
- **UX-03, ARC-01 (parte UI), OBJ-02 (parte UI):** tocan `editor-kit.tsx`/`plan.tsx`, que construye el responsable.

### M.3 Ronda 1 — fallos confirmados (03/11/2026, rama `backlog/fallos-confirmados`)

| ID | Commit | Qué se hizo | Verificación |
|---|---|---|---|
| ARC-03 | `541427f` | `DeactivateTable` bajo `SELECT … FOR UPDATE` de la mesa (`DiningTableRepository.withLock`); la pulsación toma `FOR SHARE` (`lockActiveTable`) y, si la mesa ya está desactivada, registra `unassigned_device` sin crear llamado. | `concurrency.int.test.ts` «ARC-03…»: falla sin el arreglo. |
| OBJ-01 | `1d8b686` | `SpaceLayout` copia en profundidad (`structuredClone`) al construir, al leer `elements`, en `replaceContent` y en `toProps()`. | Prueba de aliasing en `space-layout.test.ts`. |
| ARC-05 / DAT-02 | `a9c0b4c` | `total_delta`, `in/out/adjust_delta` son `null` si el resultado mezcla productos; con un solo producto siguen siendo cantidad. | `domain.test.ts`, `metrics.int.test.ts`. |
| SEC-05 | `e565e05`, `9e1843b` | El limitador reserva el intento antes del login y lo devuelve (`refund`) si el login funciona: solo cuentan los fallos; sin carrera entre peticiones paralelas. | `auth.int.test.ts`: 40 fallos paralelos dan 10 × 429; 35 logins correctos seguidos dan 200. |
| UX-03 | `2d18836` | Copy: «Las métricas por área se calculan con el plano actual». | Revisión de texto. |
| QA-04 | `a826434` | `/health/live` (proceso) y `/health/ready` (`SELECT 1`, 503 si la base no responde). | `health.int.test.ts`. |
| SEC-01 / SEC-02 | `244fbeb` | `infra/caddy/Caddyfile.prod` con `{$DOMAIN}` (HTTPS automático, sin `/sim`) y `docker-compose.prod.yml`; el simulador queda en el perfil `demo`. | `caddy validate`, `docker compose config`. |
| QA-01 | `ddd4bcd` | `.github/workflows/ci.yml`: build, typecheck, separabilidad, unitarias e integración en PR y en `main`. | Pendiente de su primera corrida en GitHub. |

### M.4 Pantallazos E2E (03/11/2026, rama `e2e/pantallazos`)

- `c00726a`: `e2e/screens.spec.ts` recorre el menú de cada usuario de demo y guarda capturas en `docs/pantallazos/`.
- `98c5dcc`: merge de `backlog/fallos-confirmados`.
- `225c7da`: la pestaña de inventario dice «Lugares de stock» al rol `inventory` (gestiona lugares y productos, no motivos; DATA-001 §2).
- `ce03e7b`: capturas regeneradas sobre la demo recién sembrada.

### M.5 Ronda 2 (03/11/2026, rama de integración `backlog/ronda-2`)

Cada grupo de tickets lo hace un subagente en su propia rama (`ronda2/<tema>`) y worktree; se audita (diff, pruebas unitarias, integración y E2E) antes de fusionarlo en `backlog/ronda-2`. Al final `backlog/ronda-2` pasa a `main` con el visto bueno del responsable (03/11). Requisito transversal: las pantallas usan la API real, sin datos simulados en el front.

| Rama | Tickets | Merge | Qué se hizo | Verificación (auditoría) |
|---|---|---|---|---|
| `ronda2/plano` | ARC-01, ARC-02, OBJ-02, DAT-01 | `644b5a3` | `domain/layouts/layout-geometry.ts`: funciones puras `overlappingAreas`, `elementsOutsideCanvas`, `assertPublishable`, llamadas en `PublishLayout`. Áreas solapadas y elementos con caja fuera del lienzo se rechazan al **publicar** (el borrador se guarda incompleto, como en el editor). Mismo criterio que `editor-kit.tsx` (sin rotación). DAT-01: índices únicos y `P2002`→409 ya existían; se añadió la prueba concurrente. | Criterio comparado línea a línea con `outside`/`areaOverlap` del editor; unitarias; integración de hospitality 112/112. |
| `ronda2/seguridad` | SEC-08, SEC-10, QA-07, DOC-05 | `fadee90` | Cabeceras (HSTS, CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`) en `Caddyfile.prod`; JSON de la API limitado a 256 kb; `dependabot.yml` y `pnpm audit --audit-level=critical` en CI; reglas de capas en `check:separability` (domain sin Nest/Prisma/Zod/React; application sin Prisma; `apps/api` sin `domain/`); plantillas de PR e issues. | `check:separability` OK; prueba del script; en la demo un cuerpo de 300 kb da 413. |
| `ronda2/portal` | UX-01, UX-06, UX-09, UX-12, portada | `8ecb2cc` | Aviso de cambios sin guardar en Espacios (`useBlocker` + `beforeunload`; guardar/descartar/seguir); título del espacio confirma con blur/Enter y cancela con Escape; `ErrorState` distingue sin conexión/401/403/404/409/5xx (`error-copy.ts`); `/sim` → `/sim/`; `/` con formulario «¿Cuál es tu negocio?» validado con `slugSchema`. | Unitarias del portal 47/47; en la demo `/sim` da 302 a `/sim/` y `/sim/` 200; E2E. |
| `ronda2/inventario` | DAT-03, UX-08, UX-07, UX-04, DAT-07 | `482ee5a` | Historial de movimientos con filtros de tipo y rango y paginación por cursor `(occurred_at, id)` en servidor; «Cargar más» con autor, motivo y fecha; selector de producto accesible; `Modal` devuelve el foco y admite `aria-labelledby`; fechas de inventario en la zona horaria del local. | Integración de commerce 43/43 (más de 100 movimientos, sin repetir ni saltar). ponytail: el cursor usa milisegundos; filas con microsegundos (`now()` de SQL) podrían repetirse en el borde de página. |
| `ronda2/eventos` | ARC-04, PAT-01, OBJ-06 | `e215a62` | Fallas del aviso realtime registradas como JSON (`realtime.*.notify_failed`) sin romper el caso de uso; el outbox registra `outbox.event_failed` al detener un evento; `ServiceCall` devuelve copias de sus fechas. | Hallazgo de la revisión de seguridad: la primera versión publicaba el recuento de fallidos en `/health/ready` (sonda pública). Corregido por el auditor: la respuesta vuelve a `status`/`database` y el recuento va al log `outbox.failed_pending`. Integración 301/301. |
| `ronda2/auditoria` | SEC-06, PAT-02 | `d6e7394` | Hospitality guarda `hospitality.platform_action.recorded` en su outbox en la misma transacción que el cambio (gateway creado/desactivado, botón creado/asignado/desasignado); core se suscribe y escribe `core.audit_log` de forma idempotente (id = `event_id`). Sin SQL entre esquemas. | Primera entrega con 4 pruebas de integración rotas (conteos de outbox que no esperaban los eventos nuevos); devueltas al subagente y corregidas. Integración 303/303; en la demo, tras los E2E, `audit_log` tiene `gateway.*` y `device.*`. |

**Integración de `backlog/ronda-2`:** `pnpm build`, `typecheck`, `check:separability`, unitarias, integración 306/306 y E2E 24/24 sobre la demo recreada (`docker compose down -v`, seeds). Pantallazos regenerados con la portada y el historial de inventario (`875723a`).

**Pendiente (fuera de esta ronda):** SEC-03 (backups y restauración), SEC-04 (transporte seguro del gateway físico), SEC-07/QA-06 (matriz negativa completa), SEC-09 (imagen mínima y rol migrador separado: requiere rediseñar migraciones), ARC-06/DAT-08 (temporalidad de áreas: decisión de producto), ARC-07/08, PAT-03, QA-02/03/05/08/09/10, UX-02/UX-10/UX-11 (UX-02 toca `editor-kit.tsx`, que construye el responsable), MOD-05/07, DOC-01..04. OPEN dejados en código: política de áreas solapadas y si las cajas deben considerar rotación (`layout-geometry.ts`).

### M.6 Ronda 3 (04/11/2026, rama de integración `backlog/ronda-3`)

Mismo método que la ronda 2: 7 subagentes (Sonnet), uno por rama `ronda3/<tema>` y worktree; el auditor revisa el diff, corre integración y E2E (base compartida, un agente a la vez) y fusiona.

| Rama | Tickets | Merge | Qué se hizo | Verificación (auditoría) |
|---|---|---|---|---|
| `ronda3/analytics` | ARC-07, DAT-06, PAT-05 | `31e1b1f` | ARC-07 **no era atómico** (`has` → `apply` → `add` sin transacción): ahora el suscriptor reclama el `event_id` (`INSERT … ON CONFLICT DO NOTHING`) y aplica dentro de `ProjectionTransaction.run`; si `apply` falla se revierte también el reclamo. DAT-06 ya estaba (tope 366 días): solo se documentó el techo. PAT-05: pruebas de transiciones ilegales y doble ack (sin bugs); `ServiceCall.restore` copia sus fechas. | Semántica de `ON CONFLICT` revisada (espera al reclamo concurrente). Integración 308/308: el mismo evento en paralelo da `applied` + `duplicate` con 1 fact. |
| `ronda3/permisos` | SEC-07, QA-06 | `47ec548` | Matriz negativa `apps/api/src/e2e/permissions-matrix.int.test.ts`: 49 rutas con sesión × anónimo/cookie falsa (401), rol sin permiso (403), local de otro negocio (404), superadmin sin negocio, Origin ajeno, ids de otro tenant, rutas de gateway; prueba de deriva que falla si aparece una ruta no declarada; Socket.IO (local ajeno, sesión vencida/cerrada tras el handshake). | Primera entrega no cargaba (ids leídos antes de `beforeAll`); corregido por el auditor. **463/463, sin fugas.** Pendiente: «otro local del mismo negocio» (el seed tiene uno por negocio). |
| `ronda3/ops` | SEC-03 (local), QA-09, SEC-08, SEC-09 (plan) | `44afcc3` | `scripts/backup.sh` (pg_dump cifrado con `openssl aes-256-cbc -pbkdf2`, retención) y `scripts/restore-check.sh` (restaura en contenedor desechable y compara conteos); `docs/OPERACION-001_despliegue_y_recuperacion.md`; overrides `body-parser` 2.4.0 y `multer` 2.5.0; plan de rol migrador e imagen mínima. | Ensayo repetido por el auditor contra la demo: 6 cuentas, 3 negocios, 5 planos, 586 llamados, 495 movimientos, 76 auditorías → **restore-check OK**. `pnpm audit`: sin vulnerabilidades. Subida fuera del VPS y alertas: pasos del operador. |
| `ronda3/iot` | PAT-03, ARC-08, QA-05 | `417201c` | `press_id` opcional en el contrato del gateway; dedupe dentro de `withDeviceLock` (ventana 24 h, `// ponytail:` índice único si hace falta garantía dura); el simulador lo envía. ARC-08 reproducido (el `Promise.race` no cancelaba): `AbortSignal` al suscriptor y rechazo tardío absorbido. `correlation_id` nace en la ingesta y llega a outbox y logs. | Integración 310/310 (reenvío HTTP y MQTT de la misma pulsación cuenta una vez). |
| `ronda3/a11y` | UX-10, UX-11, MOD-05 | `1258168` | Prueba de contraste WCAG de 52 pares de tokens (claro/oscuro); `--pending-line` más oscuro para trazos de «pendiente» (2,2:1 → 3,8:1). Acciones de la cola con la mesa en el nombre accesible, foco a la hoja de la mesa, Escape, `role="img"` y foco visible en gráficas. MOD-05: `device-status` trae nombre y última señal de cada gateway; franja «Sin señal de botones» en el tablero. | Revisión de accesibilidad (WCAG 2.1 AA) del diff; E2E nuevo `e2e/diagnostics.spec.ts` (3/3 repetido). **La franja detectó un fallo real** durante la verificación: el simulador tenía una clave vieja (401). OPEN: `plan.tsx` usa `stroke-pending` (se sobrescribe en `index.css` hasta que el responsable lo cambie). |
| `ronda3/seguimiento` | UX-09, DAT-03, DAT-07, UX-01 (cabos de la ronda 2) | `7f643da` | `ErrorState` recibe el error real en tablero, inventario, consola y usuarios; «Cargar más» pide `limit + 1` (sin página vacía); «Guardar y salir» fallido deja descartar; historial de llamados y consola en la zona horaria del local. | Unitarias del portal 108/108. |
| `ronda3/docs` | DOC-02, DOC-03, DOC-04, ARC-10 | `3ce683e` | `docs/DATA-002_modelo_de_datos_as_built.md` (28 tablas desde las migraciones), `docs/STATUS-001_estado_actual.md` (estado vigente y 13 contradicciones entre documentos), `docs/ADR-004_propuesta_transporte_auditoria_areas.md` (**Propuesto**: transporte del gateway, auditoría vía outbox, áreas históricas, compatibilidad de contratos v1). | El auditor corrigió las contradicciones que tocaban README, PORTAL y e2e/README (`6a4ce35`). |

**Además, del auditor:** `Caddyfile.prod` validado con `caddy validate` y servido de verdad delante de la demo (HTTPS local): cabeceras presentes, **sin violaciones de CSP**, Socket.IO conecta por WSS y la cookie va `Secure`/`HttpOnly` (cierra la verificación pendiente de SEC-02/SEC-10; las respuestas 502 de Caddy no llevan las cabeceras). Revisión de sobreingeniería: `ServiceCall.restore` pasa a `structuredClone` (`0f23b5f`).

**Integración de `backlog/ronda-3`:** install, build, typecheck, `check:separability`, unitarias, **integración 775/775**, `pnpm audit` limpio, **E2E 24/24** + MOD-05 sobre la demo recreada; pantallazos regenerados (`20a2833`).

**Pendiente tras la ronda 3:** SEC-04 (transporte físico: decidir ADR-004), SEC-09 (aplicar el plan de OPERACION-001 §8), copia de backups fuera del VPS y alertas, QA-02 (E2E en base desechable), QA-03 (hardware), QA-08 (eslint/componentes), QA-10 (carga), UX-02/UX-05 (editor responsive y prueba con personal), ARC-06/DAT-08 (decidir en ADR-004), MOD-07, DOC-01 (visibilidad del repo), botones sin batería/RSSI (no existe el dato).


### M.7 Auditoría visual de capturas por rol (04/11/2026, rama `ronda4/auditoria-visual` desde `main`)

Fuente: auditoría externa sobre `docs/pantallazos/` (V01…V12). La auditoría dice «43 capturas» y luego «34 PNG»: en el repo había 34.

| ID | Resultado | Commit | Qué se hizo / por qué no |
|---|---|---|---|
| V01 | Cubierto | `2cb422d` | `screens.spec.ts` pulsa los 15 botones de Bar Demo, Barra toma 3 y captura el tablero recién pulsado y con el reloj del navegador adelantado 6 min (`docs/pantallazos/llamados/`). Falta 409, desconexión y dos personas a la vez en pantalla (los cubren `service-call.spec.ts` y `diagnostics.spec.ts`, sin captura). |
| V02 | Cubierto (decisión vigente) | `2cb422d` | Barra y mesero comparten el rol `staff`: misma pantalla por diseño. Captura 390×844 del mesero: sin plano, cada llamado con su botón en la cola. Falta la prueba con teléfono real y personal (UX-05). |
| V03 | Arreglado | `6c8559d` | Registro e historial se desplazan por separado en pantallas anchas; filtros fijos. Causa extra: los `sr-only` (absolutos) de cada fila escapaban del contenedor con scroll y estiraban la página. Captura: 4843 → 864 px. |
| V04 | Arreglado | `6c8559d` | Íconos +/− (`CirclePlus`/`CircleMinus`) en vez de flechas; el motivo sigue escrito al lado. |
| V05 | Arreglado | `6c8559d` | Sin motivo preelegido en entradas y salidas («Elige el motivo»; con un solo motivo se preelige). `inventory.spec.ts` comprueba el aviso. |
| V06 | Arreglado en parte | `930035a` | «¿Qué falta?» dice «Nada pendiente de guardar». La cabecera («Sin borrador» / «Borrador guardado (revisión n)») sale de `editor-kit.tsx`, que construye el responsable. |
| V07 | Arreglado | `930035a` | Con varios espacios el resumen dice «…, todos los espacios». |
| V08 | Arreglado | `930035a` | Cada mediana y el % de pulsaciones repetidas llevan su definición y denominador; la nota al pie sigue aclarando que no miden la llegada a la mesa. |
| V09 | Pendiente | — | Editor en tablet: toca `editor-kit.tsx` (UX-02). |
| V10 | Arreglado | `6c8559d` | Con más de un lugar activo, el subtítulo es un selector y el registro, los saldos y el historial usan el lugar elegido. |
| V11 | Arreglado | `930035a` | «Identificador de tu negocio», con dónde aparece. |
| V12 | No se hace | — | La propia auditoría lo deja para cuando haya volumen (20 botones en el piloto). |

**Verificación:** `pnpm typecheck`, `check:separability`, unitarias del portal 108/108, E2E de inventario, lugares, métricas, espacios, login y pantallazos 23/23 sobre la demo con el `web` de esta rama.

**Siembra y corrida completa (`7ab5c7f`, `a1c9b54`):** `scripts/demo-reset.sh` recrea la demo (base nueva, cuatro seeds, clave del simulador en `.env`, planos de demo); el tablero de Bar Demo ya no avisa «Sin señal» (Pisos sí: su gateway no tiene simulador, a propósito). Sobre la demo recién sembrada: pantallazos 8/8 primero (capturas sin datos «E2E …») y luego el resto de los E2E, **33/33**.

### M.8 Corte del 09/11/2026 (integración de la ronda 4, CI, Dependabot y auditoría)

**Integración:** `ronda4/auditoria-visual` (M.7) entró en `main` por fast-forward (`0349945`). Se creó `pruebas`; `main` y `pruebas` quedan protegidas por ruleset (solo PR).

**CI (QA-01):** nunca había pasado en GitHub. Causa: `docker compose` interpola todo el archivo y sin `.env` falla `SIM_GATEWAY_KEY:?` de `button-sim`, aunque `test:integration` solo levanta `db-test`. Arreglo: `cp .env.example .env` en el workflow (`3bf5633`). Reproducido y verificado en un clon limpio: 775/775.

**Dependabot (SEC-08):** aplicadas a mano en un solo commit con el lockfile regenerado (`0349945`): `@nestjs/core` y `platform-express` 12.3.2, `@tanstack/react-query` 5.105.0, `vite` 8.3.5; acciones `checkout` 7, `setup-node` 7, `pnpm/action-setup` 5 (`3bf5633`). Descartadas: `node` 26 (Dockerfile) y `@types/node` 26, porque Node va fijo a 24 en CI, `.nvmrc` y `Dockerfile`; sus mayores quedan ignoradas (`723ffbd`).

**Auditoría (seguridad, bugs silenciosos, diseño, ponytail):**

| # | Hallazgo | Resultado |
|---|---|---|
| A1 | `bucketLabel` rotulaba las cubetas de métricas en la zona del navegador, mientras la API agrupa en la del local: desde otra zona, días y horas corridos sin aviso. | Arreglado: usa `location.timezone` (`format.ts`, `Metrics.tsx`) con prueba en `format.test.ts`. |
| A2 | La misma `idempotency_key` de stock con otra cantidad, dirección o motivo devolvía el movimiento original como repetición, en silencio. | Arreglado: `StockMovement.isReplayOf` y 409 `idempotency_key_reused` si los datos difieren (`count` se compara por lo contado = `balance_after`). El formulario de inventario genera una clave por intención (producto, tipo, motivo y cantidad) y explica el 409. |
| A3 | El commit `00a079f` dice «409 si tiene botones», pero solo bloquea el último gateway activo del local con botones asignados. | Decisión del responsable (`OPEN` en `gateways.ts`); anotado en STATUS-001 §3. |
| A4 | `RealtimeBroadcaster` revalida sesión y permisos por token en cada aviso (varias consultas por evento). | Sin cambio: suficiente para el piloto; cachear si crece. STATUS-001 §3. |
| A5 | Unas 30 ramas locales y 10 worktrees sin commits fuera de `main`. | Borrados en local. |
| A6 | Revisado sin hallazgos: sesión y bloqueo de login, límite por IP detrás de Caddy (`trust proxy`), CSRF por `Origin`, Socket.IO (handshake y revalidación), SQL crudo (todo parametrizado), XSS (sin `innerHTML`; el simulador escapa), outbox (`SKIP LOCKED`, tope de intentos, timeout con `AbortSignal`), libro de stock (bloqueo de saldo y comprobación contra el dominio), ingesta de pulsaciones (bloqueo por botón y mesa, debounce, `press_id`). `pnpm audit`: sin vulnerabilidades. | — |

**Verificación:** unitarias de commerce y portal, typecheck; CI del PR.

