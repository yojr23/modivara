# PLAN-003 v2 — Verificación y corrección de modularidad existente (`test/plan-003-modularidad`)

> **Proyecto:** Modivara Labs — SaaS multiproducto.
> **Fecha:** 11 de noviembre de 2026.
> **Estado:** plan propuesto, exclusivo para una rama creada desde `pruebas`. No es ADR aprobado ni constancia de tests ejecutados.
> **Rama de origen:** `pruebas` (`18289d6` en la revisión). **Rama de trabajo nueva:** `test/plan-003-modularidad`. **PR:** `test/plan-003-modularidad → pruebas`.
> **Plan complementario independiente:** `PLAN-POS-001_pos_mesas_por_rama_v3.md`, ejecutado en la rama existente `pos/mesas`.
> **Documento de origen:** `PLAN-003_modularidad_productos_agnosticismo_sectorial.md` (versión de 11/11/2026). Se conservan los identificadores `MOD-*` para trazabilidad y se explicitan las tareas transferidas a POS.

---

## 0. Regla de separación entre ambas ramas

**Esta rama verifica y corrige la independencia de los productos que ya existen (`core`, `hospitality`, `commerce`/Inventario y `analytics`) y prepara una composición extensible. No desarrolla el POS.** El POS neutral, su base de datos, contratos, pantallas, permisos e integración de mesas pertenecen exclusivamente a `pos/mesas`.

| Responsabilidad | Esta rama: `test/plan-003-modularidad` | Otra rama: `pos/mesas` |
|---|---|---|
| Decisiones | Formalizar ADR-006 sobre 5 dominios y separación POS/Inventario; preservar histórico ADR-001/002/003. | Marcar orientación por mesa de ADR-005 como superada; aplicar ADR-006 al diseño POS. |
| Core | Quitar dependencia inversa `core-api → hospitality-contracts`; revisar provisioning genérico, entitlements y auditoría. | Agregar `pos` a `MODULES`, enum de BD, guards y permisos específicos del nuevo producto. |
| API host | Hacer seleccionables módulos/consumidores; probar **Core + Commerce** sin Hospitality/Analytics. | Incorporar `PosModule` y probar **Core + POS** reutilizando el host ya modular. |
| Portal | Navigation/guards transversales, desacoplar métricas de hooks obligatorios; UX de inventario genérica. | Pantallas POS-only y acción de venta en el tablero Hospitality por adaptador opcional. |
| Pruebas | T01/T05/T07/T09/T11(Commerce)/T12/T14 del PLAN-003; suites actuales y regresión piloto. | T02/T08/T11(POS)/T12/T13/T14 de POS; concurrencia e independencia sectorial de ventas. |
| Después del POS | Certificación combinada sobre `pruebas` tras PR de POS; no desarrollar conexiones POS en esta rama. | POS→Inventario y POS→Analytics son P1 posteriores, no bloquean los dos PR iniciales. |

**Criterio de propiedad de archivos para evitar conflictos:**
- Esta rama posee los cambios de base en `domains/core/api/src/presentation/platform-action.subscriber.ts`, `domains/core/api/package.json`, `apps/api/src/app.module.ts`, `apps/api/src/integration-subscribers.module.ts`, `scripts/check-separability.mjs`, `apps/portal/src/app/Metrics.tsx`, `apps/portal/src/app/Inventory.tsx`, infraestructura de pruebas y cualquier contrato de plataforma **neutro** necesario.
- La rama POS posee la incorporación de `pos` en `domains/core/contracts/src/identity.ts`/`permissions.ts`, la migración `core.module`, `domains/pos`, `pos` en esquema/variables, ruta/pantalla POS e integración contextual `Board.tsx`.
- `apps/portal/src/routes/AppShell.tsx` puede requerir ambos trabajos: aquí mejorar el mecanismo general de navegación condicional; en POS añadir su ruta. No editar la ruta POS antes de que exista.
- **No hacer merges directos entre ramas de trabajo.** Primero PR de esta rama a `pruebas`; luego actualizar `pos/mesas` desde `pruebas`, resolver conflictos y abrir su PR a `pruebas`. `main` solo recibe `pruebas` según el CI vigente.

---

## 1. Objetivo y límite de la prueba

**Invariante:** cada producto puede estar contratado y operar en su núcleo sin otro producto opcional. Se distinguen: (a) **dependencia del código**, (b) **capacidad real de arranque sin el otro dominio**, (c) **entitlement comercial**, (d) **permisos/tenancy**, (e) **integraciones asíncronas opcionales**. Ocultar menús o ejecutar `check:separability` no demuestra por sí solo (b).

**Salida obligatoria de esta rama:** una instalación de prueba **Core + Commerce** con PostgreSQL real, sin exigir esquemas, URL de BD o providers de Hospitality, Analytics ni POS; operación de inventario completa, auditoría y autorización intactas, y regresión del piloto gastronómico en composición completa. Debe quedar establecida la infraestructura que `pos/mesas` reutilizará para Core + POS.

**No se incluye aquí:** construir `domains/pos`; actualizar el enum de módulos con `pos` antes del PR de POS; consumos de stock por venta; métricas de venta POS; microservicios/repo físico por producto; checkout o facturación de suscripciones. Esos trabajos están asignados a POS o etapas posteriores.

### Arquitectura y propiedad de datos que se deben proteger

| Producto | Función fundamental autónoma | Puede integrar opcionalmente, pero no requerir |
|---|---|---|
| Core | Organizaciones, locales, usuarios por negocio, sesiones, permisos, entitlements, auditoría | Ningún producto vertical ni sus contratos internos |
| Hospitality | Espacios/mesas, botones/gateways, llamados, notificaciones | POS, Inventory, Analytics |
| Inventory (`commerce` técnico) | Catálogo SKU por local, unidades, lugares de stock, entradas/salidas/ajustes, saldo | POS, Hospitality, Analytics |
| Analytics | Proyecciones de fuentes contratadas/disponibles, vistas y reconstrucción | Presencia simultánea de todas las fuentes; fuente externa todavía no implementada |
| POS (futuro de esta línea base) | Venta y catálogo comercial sin mesa | Se verifica/implementa **en la otra rama** |

Los dominios conservan API/contratos web, esquema SQL, migraciones y permisos propios. No introducir FKs/consultas SQL entre esquemas; cada mutación obtiene `organization_id`/`location_id` del contexto autorizado del servidor.

---

## 2. Estado inicial observable en código (lectura estática, no tests ejecutados)

- `pruebas` revisada: `18289d6`. `pos/mesas` difiere en dos commits y agrega solo `docs/ADR-005_propuesta_pos_cuentas_por_mesa.md`; no existe `domains/pos`.
- `domains/core/api/src/presentation/platform-action.subscriber.ts` importa `platformActionRecordedEventSchema` de `@modivara/hospitality-contracts`; `core-api/package.json` declara esa dependencia. Contradice la dirección esperada.
- `apps/api/src/app.module.ts` construye de forma obligatoria `HospitalityModule`, `CommerceModule`, `AnalyticsModule`; `IntegrationSubscribersModule.forDomains()` inyecta los tres. El host Core + Commerce **no está demostrado**.
- `commerce` suscribe a `core.location.created` y siembra datos incluso cuando Commerce podría no estar habilitado. La inicialización tardía desde entitlement no está cerrada.
- `apps/portal/src/app/Metrics.tsx` importa hooks de `@modivara/hospitality-web` y `@modivara/commerce-web`; la independencia de vistas por fuente necesita pruebas y corrección.
- `domains/commerce/contracts/src/catalog.ts` admite la unidad genérica `unit`; el frontend de inventario da protagonismo a `bottle`/botellas. Hay que ajustar UX, no reconstruir el modelo por sector.
- `scripts/check-separability.mjs` compila/testea dominios y verifica imports/capas, pero no certifica ausencia real de otros módulos durante el arranque.
- `main` y `pruebas` habían divergido en el corte; existe un PR de sincronización. Verificar su estado antes de construir la rama; no cambiar de base silenciosamente.

**No se ha confirmado que estas anomalías sigan presentes en commits posteriores ni se han corrido tests en esta revisión.** La primera tarea toma snapshot del estado real.

---

## 3. Backlog exclusivo de `test/plan-003-modularidad`

Las referencias entre paréntesis conservan el identificador del PLAN-003 original. Prioridades: **P0** = necesario para cerrar esta rama; **P1** = mejora transversal recomendable antes de ofrecer nuevos paquetes; **P2** = no construir en este PR. Tamaños: S/M/L son relativos, no fechas.

### Fase A0 — Baseline y arquitectura de productos (MOD-00…05)

| ID | Prio. | Trabajo en esta rama | Aceptación verificable |
|---|---|---|---|
| **MOD-00** | P0 | Aprobar `docs/ADR-006` que convierte POS en quinto dominio independiente; explicitar que el POS original de ADR-005 es solo propuesta, y que el alcance histórico del piloto no cambia automáticamente. | La decisión tiene estado aprobado por el responsable antes de migraciones POS; referencia a ADR-001/002/003 sin reescribirlos. |
| **MOD-01** | P0 | Congelar `inventory` (nombre comercial) ↔ `commerce` (nombre técnico existente), `pos` como identificador distinto; prohibir renombre masivo ahora. | Contratos y diagrama distinguen ownership y nombres visibles. |
| **MOD-02** | P0 | Aprobar matriz de productos, operaciones fundamentales e integraciones opcionales vs prohibidas. | Ningún `core-api` depende de módulo vertical; Inventory no requiere mesas ni precios POS. |
| **MOD-03** | P0 documental | Invariantes de venta transversal para consumo por la otra rama: venta sin mesa, sin inventario ni analítica; vínculo opcional validado por adaptador. | `pos/mesas` puede implementar sin ambigüedad; **no crear código de venta aquí**. |
| **MOD-04** | P0 documental | Delimitar cobro declarado vs pago electrónico/facturación fiscal e impuestos. | No se promete sustituir facturación; se transfiere a POS-04. |
| **MOD-05** | P0 documental | Especificar activación posterior al alta, suspensión, retención y política de replay/backfill. | No reaprovechar indiscriminadamente `location.created` para activar un producto a posteriori. |
| **MOD-09** | P0 añadido | Registrar SHA/estado git, comparar con `main` y confirmar estado PR de sincronización; ejecutar baseline reproducible. | Log `build`, `typecheck`, `check:separability`, unit, integration, E2E cuando sea posible, con `PASS/FAIL/BLOCKED` y fallas heredadas. |

**Puerta A0:** gobernanza acordada, línea base reconocida y no se ha tocado `pos` en contratos, BD ni UI.

### Fase A1 — Core y runtime realmente separables (MOD-10…15)

| ID | Prio. | Trabajo en esta rama | Aceptación verificable |
|---|---|---|---|
| **MOD-10** | P0 | Sacar `@modivara/hospitality-contracts` de `core-api`: mover el esquema de auditoría a contrato neutral de plataforma **o** validar el evento en el adaptador de composición; preservar semántica, idempotencia `event_id` y actor. | `core-api` compila sin Hospitality y conserva registro de acciones de superadmin sobre gateway/dispositivos en host completo. |
| **MOD-11** | P0 | Extender `check:separability` para dependencias inversas Core, import privado, capas, schema/migraciones y composición; agregar caso de regresión que falle si se reintroduce el import. | CI falla ante `core-api → hospitality-contracts`; sigue pasando con dependencias públicas legítimas. |
| **MOD-12** | P0 | Crear host/composición de **Core + Commerce** en tests con PostgreSQL real y solo esquemas `core` y `commerce`. | Login y sesión, crear producto SKU, saldos/movimientos, permisos y auditoría OK; sin `HOSPITALITY_DATABASE_URL`/`ANALYTICS_DATABASE_URL`, sin necesidad de tablas de estos. |
| **MOD-13** | P0 | Refactor mínimo de `AppModule`/`IntegrationSubscribersModule`: módulos y subscribers incluidos por composición; providers e historial opcionales, no arrays rígidos. | Core+Commerce y host completo arrancan; no instancian consumidores/lectores ausentes ni fallan en `health/ready`. No crear framework/plugin loader. |
| **MOD-14** | P0 | Activación tardía de Commerce: inicializar local existente y razones/default stock idempotentemente sin depender solo de evento viejo; no crear datos Commerce para un negocio sin entitlement. | Alta local antes de activar `commerce` → después de activar, stock `Principal` y motivos correctos una vez; desactivado no se provisiona. |
| **MOD-15** | P0 | Corregir semántica de consumidores ausentes, retry/outbox y replay de activaciones; registrar estado de integración fallida. | Un evento operativo confirmado no se pierde ni bloquea por fallo de consumidor; reintentos/deduplicación probados; replay retrospectivo solo cuando una política lo requiere. |

**Cuidado:** no se exige que un host dinámico cargue paquetes en caliente. Puede compilarse una composición mínima de prueba de NestJS. Lo que importa es **ausencia de dependencias obligatorias al arrancar y operar**, no cambiar producción a cinco procesos.

**Puerta A1:** se ejecuta Core+Commerce sin esquemas ajenos, se mantiene el host completo y la auditoría de plataforma intacta. Esta es la dependencia externa que POS-08 necesita de la otra rama.

### Fase A2 — Comercialización transversal existente, no la implementación POS (MOD-23…26)

| ID | Prio. | Trabajo en esta rama | Aceptación verificable |
|---|---|---|---|
| **MOD-23** | P1 | Consola/API general de superadmin para alta clientes/locales/entitlements sin seeds (si es necesaria para el primer cliente real). Reutilizar `ProvisionOrganization` y casos Core, con guards y auditoría; no crear lógica POS. | Crear zapatería y habilitar Commerce sin seed ni acceso a otros tenants. Si no entra en este PR, documentar bloqueo comercial. |
| **MOD-24** | P2 | Paquetes/ofertas comerciales como configuración externa de entitlements, **sin implementar facturación ni checkout**. | Diseño acotado y diferido; nunca se usa `businessType` para habilitar dominios. |
| **MOD-25** | P0 | Composición general de navegación según entitlement + permisos + fuente disponible; evitar consultas obligatorias a productos no instalados. | Inventario-only no muestra ni solicita información de mesas o POS, ni puede entrar a rutas no autorizadas. POS concreta su ruta después. |
| **MOD-26** | P0 | Definir y probar suspensión/reactivación para **Commerce/Hospitality existentes**: bloquear acceso sin borrar histórico, restablecer sin duplicar defaults. | API 403 para módulo no contratado, UI oculta, otros productos intactos, datos al reactivar preservados. Política POS la implementa `pos/mesas`. |

**Los ID MOD-20/21/22 pertenecen a `pos/mesas` (POS-06/17/25).** Esta rama no debe agregar `'pos'` a Core ni migrar el enum para evitar duplicación y conflictos de merge.

### Fase A3 — Inventario neutral y Analytics sin supuestos de otras fuentes (MOD-50…63)

| ID | Prio. | Trabajo en esta rama | Aceptación verificable |
|---|---|---|---|
| **MOD-50** | P1 de diseño | Definir contratos mínimos de fuente/métrica para Hospitality e Inventory, sin anticipar todo un BI ni exigir fuente POS. | Las fuentes actuales pueden figurar por separado en la UI; la proyección POS futura se integra con contrato versionado. |
| **MOD-52** | P0 | Quitar dependencia **obligatoria en la vista** de `Metrics.tsx` de hooks Hospitality/Commerce cuando esas fuentes no están habilitadas; render condicional o DTOs autosuficientes. | Core+Commerce+Analytics no dispara solicitudes Hospitality; no se muestran llamados si no hay fuente. |
| **MOD-53** | P0 | Menús, pestañas y permisos Analytics según fuentes disponibles (no pestañas rígidas). | Inventory+Analytics muestra stock, Hospitality+Analytics muestra llamados; sin fuentes, no se vende/representa tablero vacío como útil. |
| **MOD-54** | P0 | Pruebas de proyecciones existentes: deduplicación, reconstrucción y fallo Analytics sin bloquear Hospitality/Commerce. | Eventos repetidos no duplican hechos; fallo de Analytics no revierte movimiento o llamado. |
| **MOD-60** | P0 | Cambiar valor inicial visual a `unit`, remover terminología fija de licores/botellas del inventario. | Zapatería puede registrar SKU como unidad; `bottle` continúa disponible para bar. |
| **MOD-61** | P0 | E2E inventario de zapatería (`ZAP-NEG-40`), 15 entradas, 2 salidas, saldo 13, historiales y permisos con Core+Commerce solamente. | Ninguna mesa, botón, Hospitality ni Analytics requerida en API/BD. |
| **MOD-62** | P2 | Tallas/colores como SKUs simples inicialmente; decidir variantes estructuradas solo tras piloto retail. | No rehacer catálogo por hipótesis. |
| **MOD-63** | P2 | Evaluar catálogo por organización vs por local (hoy por local); cambiar solo con ADR y migración. | La prueba usa catálogo por local sin mezclar tenants. |

**MOD-51** (métricas de ventas POS) corresponde a POS-36…38 **futuro**, no a esta rama. **MOD-55** (Analytics-only externo), **MOD-64** (mapeo masivo POS+Inventory) también quedan fuera.

### Fase A4 — Regresión, permisos y salida de rama (MOD-70…75)

| ID | Prio. | Trabajo en esta rama | Aceptación verificable |
|---|---|---|---|
| **MOD-70** | P0 parcial | Ejecutar matriz de escenarios **existentes**: T01, T05, T07, T09 (regresión), T11 Commerce, T12, T14, más arranques en hosts mínimos. | Evidencias por escenario y SHA; los casos POS se declaran `PENDIENTE (otra rama)`, no `PASS`. |
| **MOD-71** | P0 | Pruebas negativas multi-tenant/local, membresía, roles, entitlement, URL forzada y permiso en backend. | Ningún usuario de otra organización/local lee o escribe catálogo, stock, mesa o métricas ajenas. |
| **MOD-72** | P0 para componentes existentes | Inyectar fallos de Analytics, reintentos de outbox y reinicio durante operación de Commerce/Hospitality. | Confirmación del hecho original sin consumidor; deduplicación y recuperación observable. POS cae fuera hasta su implementación. |
| **MOD-73** | P1 | Diagnóstico de integraciones: producto, correlación, lag, fallos y reintento, evitando datos sensibles. | Incidente reproducible investigable sin acceso cross-SQL. |
| **MOD-74** | P1 | E2E de alta de zapatería Inventory-only y restaurante Hospitality-only sobre misma instalación. | Paquetes aislados en el portal, mismas reglas Core, sin código por sector. |
| **MOD-75** | P1 | Runbook de activación y suspensión, restauración, replay e integración opcional. | Operación documentada y pasos verificables. |

**Puerta A4:** las correcciones de modularidad existente tienen regresión y evidencia; PR hacia `pruebas`, sin archivos propios del dominio POS.

---

## 4. Matriz de PLAN-003: quién la comprueba y cuándo

| ID | Escenario del plan original | Responsable y estado de certificación |
|---|---|---|
| T01 | Core + Inventory, zapatería sin otros productos | **Esta rama / P0** (`MOD-12/60/61/70`). |
| T02 | Core + POS en zapatería | **`pos/mesas`**, POS-20/26/40. |
| T03 | POS + Inventory, descuento de stock reconciliable | **Posterior a POS** (`feature/pos-inventory`), POS-32…35. |
| T04 | POS + Analytics de ventas | **Posterior a POS** (`feature/pos-analytics`), POS-36…38. |
| T05 | Inventory + Analytics sin Hospitality | **Esta rama / P0** (`MOD-52/53/70`). |
| T06 | POS + Inventory + Analytics sin Hospitality | **Posterior a POS e integraciones**. |
| T07 | Hospitality-only (mesas/botones/llamados) | **Esta rama / P0** + regresión en POS. |
| T08 | Hospitality + POS, cuenta por mesa | **`pos/mesas`**, POS-27…31. |
| T09 | Piloto Hospitality + Inventory + Analytics sin POS | **Esta rama / P0** + regresión en POS. |
| T10 | Suite de cuatro productos sobre Core | **Posterior a POS e integraciones**. |
| T11 | Habilitación tardía | **Esta rama: Commerce / P0**; `pos/mesas`: POS; replay entre productos posterior. |
| T12 | Entitlement revocado | **Esta rama** para productos existentes; **POS** para el nuevo. |
| T13 | Caída de integración | **Esta rama** outbox existente; **POS** cierre sin consumidores; stock/analytics combinados después. |
| T14 | Otro tenant/local | **Ambas ramas**, cada una sobre los módulos que introduce/modifica. |
| T15 | Analytics-only | **No certificar comercialmente** hasta habilitar fuente externa real. |

**Criterio de rigor:** no marcar un escenario como verificado únicamente por esconder una pantalla, mockear todo Core o pasar un test estático. La composición mínima usa PostgreSQL real, autenticación/entitlements reales, y no crea esquemas ajenos en sus bases de prueba.

---

## 5. Comandos y protocolo de verificación

```bash
# Preparación: comprobar el estado real y no mezclar cambios sin integrar.
git fetch origin
git switch pruebas
git pull --ff-only origin pruebas
git switch -c test/plan-003-modularidad

git status --short
git rev-parse HEAD
node --version       # proyecto: Node 24
pnpm --version       # packageManager: pnpm 10.18.3 en el corte
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm check:separability
pnpm test
cp -n .env.example .env    # solo variables locales, jamás versionar secretos
pnpm test:integration
# Revisar e2e/README.md y levantamiento real del stack antes de Playwright.
pnpm test:e2e
```

Añadir **tareas explícitas de Compose/host minimal** con scripts reproducibles, p. ej. `test:composition:core-commerce`, que migren solo Core+Commerce y prueben login, stock y guard de módulo. El nombre es sugerido, **no un script existente**. Complementar con test de arranque Core-only si ayuda a demostrar independencia.

Para cada fase, adjuntar: SHA, comando, entorno, resultado `PASS/FAIL/BLOCKED`, migraciones usadas, errores encontrados, cambios realizados y pruebas de no regresión. El CI visible ejecuta build/typecheck/separability/unit/integration, **no Playwright**: E2E requiere ejecución registrada aparte o un job añadido expresamente. Antes de tocar migraciones existentes, respaldar base y comprobar actualización desde BD ya poblada; scripts de inicialización Docker corren una sola vez sobre volumen nuevo.

**No reemplazar pruebas realistas por mock:** los tests de dominio pueden usar dobles, pero el hito de composición necesita DB/guards/rutas reales. No declarar cumplimiento de T02/T08 porque el POS todavía no existe en esta rama.

---

## 6. Secuencia de PR, dependencia hacia POS y Definition of Done

1. Confirmar si `pruebas` necesita el PR de sincronización pendiente con `main`; registrar el SHA base efectivo. Si cambia, actualizar esta rama desde `pruebas` por mecanismo acordado.
2. A0: aceptar ADR-006 y registrar baseline de fallas heredadas.
3. A1: arreglar dirección de Core; componer host Core+Commerce y listeners opcionales; cerrar habilitación tardía y outbox.
4. A2/A3: corregir navegación, inventario por defecto y métricas por fuente; correr T01/T05/T07/T09 y negativos.
5. A4: pruebas completas y PR `test/plan-003-modularidad → pruebas`; adjuntar evidencia y decisiones.
6. **Una vez fusionado:** `pos/mesas` hace `git fetch origin` y `git merge origin/pruebas` (o rebase coordinado), reutiliza las correcciones y ejecuta POS-08 y POS-39…43. No llevar commits del POS por cherry-pick a la rama de modularidad.
7. **Una vez fusionado POS a `pruebas`:** ejecutar matriz ampliada T02/T08 y su regresión en el pipeline de promoción `pruebas → main`. Las integraciones T03/T04/T06/T10 solo después de sus propios PR.

**Definition of Done de esta rama:**

- [ ] ADR-006 aceptado y referenciado; ADR-001/002/003 históricos no reescritos.
- [ ] `core-api` compila sin dependencia de `hospitality-contracts` y la auditoría de superadmin sigue funcionando.
- [ ] Host Core+Commerce con solo esquemas y variables necesarios; aplicación mínima y completa arrancan.
- [ ] Usuarios/entitlements/tenancy reales; alta, desactivación y activación tardía de Commerce sin duplicados.
- [ ] Tests T01/T05/T07/T09/T11-Commerce/T12/T14 en verde con evidencia reproducible, incluidas pruebas negativas.
- [ ] Inventario neutral para zapatería sin eliminar unidades útiles para bares; Analytics no exige hooks de fuentes ausentes.
- [ ] Outbox e integración opcional no bloquean hechos originales; fallas observables y reintentables.
- [ ] `pnpm build`, `typecheck`, `check:separability`, `test`, `test:integration` + E2E pertinentes registrados.
- [ ] PR abierto contra **`pruebas`**, no contra `main`; sin código nuevo `domains/pos` ni migraciones POS.

---

## 7. Trazabilidad de todos los `MOD-*` originales

| IDs del PLAN-003 original | Dónde se ejecutan ahora |
|---|---|
| MOD-00…05 | **Esta rama**, fase A0. |
| MOD-10…15 | **Esta rama**, fase A1. |
| MOD-20…22 | **`pos/mesas`**, POS-06/17/25 (entitlement, permisos, rol POS). |
| MOD-23…26 | **Esta rama** políticas/plataforma general; ruta y activación específicas de POS en POS-09/25. MOD-24 diferido P2. |
| MOD-30…36 | **`pos/mesas`**, POS-10…26 y diseño contractual del núcleo. |
| MOD-40…44, MOD-46 | **Posterior a POS**, POS-32…35, integración opcional de Inventory. |
| MOD-45 | **`pos/mesas`**, POS-27…31, integración de mesas. |
| MOD-50, MOD-52…54 | **Esta rama**, fase A3 para fuentes existentes y desacoplamiento de vistas. |
| MOD-51 | **Posterior a POS**, POS-36…38, fuente de ventas. |
| MOD-55 | **P2 futuro**, Analytics-only con fuente externa. |
| MOD-60/61 | **Esta rama**, fase A3. |
| MOD-62/63 | **P2 futuro** según necesidad de retail. |
| MOD-64 | **Posterior a POS**, asociación masiva POS+Inventory. |
| MOD-70…75 | **Esta rama** para módulos existentes; `pos/mesas` agrega certificación POS; T03/T04/T06/T10 posteriores. |

**Estado de este archivo:** plan de ejecución; no representa un PR, rama creada ni test aprobado todavía.
