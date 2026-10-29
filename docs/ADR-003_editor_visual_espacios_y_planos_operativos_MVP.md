# ADR-003 — Editor visual de espacios y planos operativos para el MVP

> **Proyecto:** Emprendimiento — Modivara / Modivara Atención  
> **Fecha:** 28 de octubre de 2026  
> **Estado:** **Ampliación funcional solicitada y confirmada por el responsable del producto**. Este documento recoge la decisión de incluirla en el MVP; el modelo técnico, los detalles de interacción y las preguntas abiertas son **propuestas pendientes de revisión** antes de su implementación.  
> **Tipo:** Decisión de producto y requisitos funcionales, con propuesta arquitectónica.  
> **Dominio propietario:** `hospitality-ops` (`domains/hospitality` en el monorepo del MVP).  
> **Documentos relacionados:** `ADR-001_arquitectura_saas_multiproducto_mvp.md`, `ADR-002_cuentas_por_negocio_superadmin_y_ajustes_mvp.md`, `DATA-001_modelo_de_datos_mvp.md`, `TECH-001_propuesta_arquitectura_MVP_revisada.md`, `PLAN-001_plan_de_trabajo_mvp.md`, `BRAND-002_MODIVARA_LABS_identidad_corporativa_y_MVP.md`.  
> **Regla de cambios:** No sobrescribir documentos históricos. Este ADR documenta una nueva necesidad del MVP; una vez aceptado formalmente el detalle, actualizar derivados (`DATA`, `TECH` y `PLAN`) o crear sus sucesores.

---

## 1. Contexto y motivación

El MVP de Modivara Atención ya contempla **mesas, zonas opcionales, botones físicos, llamados, estados y notificaciones en tiempo real**. El diseño inicial del tablero consistía principalmente en una cuadrícula de mesas y una lista de solicitudes.

El responsable del producto pidió expresamente **añadir al MVP la creación visual de espacios para cada establecimiento**. Se busca una interfaz más intuitiva, con focos de atención claros y elementos gráficos que permitan reconocer dónde se requiere servicio, evitando un panel genérico de tarjetas y métricas.

No es aceptable que la operación de cada cliente requiera encargar a un diseñador un render personalizado del bar o restaurante. El sistema debe proporcionar un **editor visual 2D reutilizable** que el propio administrador pueda configurar y mantener.

### Problema que resuelve

- Un local puede tener salón, terraza, barra, zona VIP o más de un piso; una lista plana pierde contexto espacial.
- El personal necesita identificar **qué mesa solicita atención, dónde está y cuánto lleva esperando**, incluso desde una tableta en un ambiente oscuro.
- El administrador debe poder reorganizar mesas sin solicitar desarrollos, renders o despliegues particulares.
- El plano no es ilustración independiente: **cada mesa dibujada representa una entidad operativa real** y conserva sus vínculos con botones, llamados e historial.

### Objetivo

**Permitir que cada negocio construya y publique un plano esquemático 2D de sus espacios y lo utilice como tablero operativo vivo, sincronizado con los llamados de las mesas.**

El nuevo módulo es parte de **Modivara Atención** y **del MVP del piloto gastronómico**. No constituye otro producto, dominio ni repositorio.

## 2. Decisión de alcance

1. Incluir en el MVP un **Editor Visual de Espacios** para administradores de locales y superadmins.
2. Representar cada espacio de manera **2D esquemática**, sin crear renders fotorrealistas por cliente ni incorporar 3D.
3. Ofrecer un **modo de edición** de distribución y un **modo operativo** con llamados en tiempo real sobre las mesas.
4. Mantener una **cola de solicitudes activas** accesible aunque el usuario esté viendo otro espacio, para que el plano nunca oculte llamados.
5. Conservar la propiedad del dominio en `hospitality-ops`; los permisos y la identidad continúan en `platform-core`.
6. Mantener el alcance anterior del MVP: portal, gestión de mesas, botones, notificaciones, inventario básico y métricas básicas. El POS continúa fuera de alcance.
7. Registrar y revisar el diseño antes de construir pantallas reales, según las tareas `[DISEÑO]` de `PLAN-001`.

### Conceptos del módulo

```text
Organización (negocio)                  [core]
└── Local / sede física                 [core.locations]
    ├── Espacio: Salón principal        [hospitality.zones]
    │   └── Plano 2D publicado          [nuevo]
    │       ├── Mesa 01 ── botón físico [dining_tables + device_assignments]
    │       ├── Mesa 02 ── botón físico
    │       ├── Barra                    [elemento visual]
    │       └── Puerta / pared / planta [elementos visuales]
    ├── Espacio: Terraza
    │   └── Plano 2D publicado
    └── Espacio: Segundo piso
        └── Plano 2D publicado
```

**Criterio de modelado propuesto:** reutilizar `hospitality.zones` como **espacios operativos**; no introducir en el MVP una jerarquía extra de edificios/pisos/habitaciones. La relación exacta entre zonas opcionales y un plano inicial debe cerrarse antes de migrar (véase §11).

## 3. Usuarios y permisos

| Actor | Diseña espacios y planos | Consulta plano operativo | Reconoce / finaliza llamados | Configura gateways y botones |
|---|---|---|---|---|
| `admin` del local | Sí | Sí | Sí | **No** |
| `staff` del local | No | Sí | Sí | **No** |
| `inventory` únicamente | No | No | No | **No** |
| Superadmin de la organización de plataforma (`labs`) | Sí, en cualquier negocio autorizado | Sí | Sí | **Sí** |

- Estos permisos se aplican **en el backend** mediante guardas del Core; no basta ocultar botones de la UI.
- Nuevos permisos sugeridos: `hospitality.layouts.read` y `hospitality.layouts.manage`, mapeados en los contratos de `core` según la matriz de roles. El código actual ya contempla `hospitality.tables.manage` para mesas/zonas; se debe decidir si `layouts.manage` permanece separado o se incluye como parte de él.
- El propietario del negocio mantiene control de la distribución visual **sin ver** identificadores, claves, tópicos ni parámetros técnicos del hardware.
- Las cuentas siguen siendo **por organización** y el acceso al negocio sigue usando su `slug`, conforme a ADR-002.

## 4. Requisitos funcionales — administración de espacios

| ID | Requisito | Criterio funcional |
|---|---|---|
| **ESP-01** | Crear espacios | El administrador puede crear espacios con nombre (p. ej., Salón principal, Terraza, VIP, Segundo piso). |
| **ESP-02** | Editar espacios | Puede editar nombre, orden de visualización y tamaño lógico del lienzo. |
| **ESP-03** | Desactivar espacios | Desactivar sin borrar físicamente mesas, asignaciones ni historial; evitar hacerlo cuando existan condiciones operativas incompatibles. |
| **ESP-04** | Lienzo propio | Cada espacio dispone de su propio lienzo 2D editable. |
| **ESP-05** | Navegación multiespacio | Seleccionar espacios mediante pestañas, selector o mecanismo equivalente, con señalización de solicitudes pendientes por espacio. |
| **ESP-06** | Inicio rápido | Crear espacio vacío o basado en una distribución sencilla predeterminada. La plantilla es comodidad de UI, no un render personalizado. |

**Reglas complementarias:** nombres de espacios claros para el personal; prohibir duplicados activos por local según la política vigente de `zones`; preservar sus IDs al cambiar el nombre; si se mantiene el modelo de zonas opcionales, presentar una opción simple de «Salón principal» por defecto cuando haga falta un plano.

## 5. Requisitos funcionales — editor visual 2D

| ID | Requisito | Criterio funcional |
|---|---|---|
| **ESP-07** | Formas de mesas | Añadir mesas circulares, cuadradas o rectangulares, con etiqueta identificable. |
| **ESP-08** | Arrastrar y soltar | Mover elementos visuales con puntero o gesto táctil y mantener su posición al guardar. |
| **ESP-09** | Transformaciones | Cambiar tamaño y rotación de mesas y de elementos que lo admitan. |
| **ESP-10** | Elementos del local | Incluir elementos esquemáticos básicos: pared, puerta, barra y obstáculos. Plantas/decoración sencilla pueden añadirse sin lógica operativa. |
| **ESP-11** | Texto y orientación | Incorporar rótulos sencillos para identificar accesos, sectores o referencias útiles. |
| **ESP-12** | Cuadrícula y ajuste | Guiar el movimiento con cuadrícula, alineación o encaje; permitir disposición libre sin exigir escala arquitectónica. |
| **ESP-13** | Zoom y desplazamiento | Ampliar y navegar por el lienzo, incluyendo gestos apropiados en tablet. |
| **ESP-14** | Edición rápida | Duplicar elementos decorativos y deshacer/rehacer cambios recientes. **Deseable**, no bloqueante del primer piloto. |
| **ESP-15** | Guardar y publicar | Guardar un borrador sin alterar el plano operativo y publicar explícitamente una versión validada. |
| **ESP-16** | Reabrir y editar | Recuperar el diseño persistido y generar un nuevo borrador a partir del publicado, sin perderlo. |

### Experiencia mínima del editor

- **Lienzo central** con distribución de mesas y referencias espaciales básicas.
- **Barra lateral de herramientas**: mesa, pared, puerta, barra, texto/etiqueta y elementos decorativos básicos.
- **Panel contextual** de propiedades del elemento seleccionado: nombre, forma, tamaño, rotación, ubicación y visibilidad.
- **Bandeja «Mesas sin ubicar»**: mesas existentes que todavía no aparecen en el plano.
- **Acciones claras**: guardar borrador, descartar cambios, previsualizar y publicar.
- Estado de guardado visible; mensajes de error recuperables, sin perder silenciosamente el trabajo.

El editor **no debe exigir** a la persona conocer CAD, hacer planos métricos ni editar coordenadas manualmente. Un lienzo con formas predefinidas es suficiente.

## 6. Requisitos funcionales — vínculo entre plano, mesas y hardware

| ID | Requisito | Criterio funcional |
|---|---|---|
| **ESP-17** | Crear o reutilizar mesas | Desde el editor puede crearse una nueva mesa mediante el caso de uso de Hospitality o posicionarse una ya existente. |
| **ESP-18** | Identidad estable | Cada objeto de tipo mesa referencia el `id` persistente de `hospitality.dining_tables`, nunca solamente su etiqueta ni su coordenada. |
| **ESP-19** | Sin duplicados operativos | Una mesa no puede figurar dos veces en un mismo plano publicado ni en dos planos operativos incompatibles del mismo local. |
| **ESP-20** | Mesas sin ubicar | Listar y ubicar mesas activas que aún no aparezcan en el plano; su ausencia gráfica no las elimina del sistema. |
| **ESP-21** | Reorganizar sin alterar operación | Mover, girar o reubicar una mesa no modifica su ID, sus llamados, su historial ni las asignaciones de botones. |
| **ESP-22** | Estado de botón | Mostrar si la mesa tiene botón asignado y el estado de conectividad que pueda sustentarse técnicamente; no exponer identificadores ni claves de hardware al negocio. |

**Separación de responsabilidades:** el administrador organiza mesas y espacios; el **superadmin** sigue registrando, diagnosticando y vinculando dispositivos/gateways. La UI de edición no se convierte en consola IoT.

**Integridad:** el servidor valida organización/local/espacio/mesa con el contexto autorizado; no confía en `organization_id` ni `location_id` enviados arbitrariamente por el navegador. Se mantienen las restricciones de negocio de `DATA-001` para etiquetas de mesas y pertenencia a zonas.

## 7. Requisitos funcionales — plano operativo y llamados en vivo

| ID | Requisito | Criterio funcional |
|---|---|---|
| **ESP-23** | Mostrar llamados sobre mesas | Al recibir una solicitud, destacar la representación de la mesa correcta dentro del plano publicado. |
| **ESP-24** | Focos de atención | Destacar solicitudes pendientes y su espera; referencias actuales: ámbar a los **2 min** y rojo a los **5 min** (umbrales visuales, no garantías ni SLO). |
| **ESP-25** | Estado distinto de urgencia | Representar por separado el estado real de la solicitud (`pending`, `in_progress`, `completed`) y la prioridad visual por antigüedad. Nunca solo mediante color. |
| **ESP-26** | Acciones inmediatas | Seleccionar una mesa para **reconocer** el llamado o **marcarlo como atendido**, con confirmación de estado y tratamiento de conflictos. |
| **ESP-27** | Cola global de llamados | Mantener lista visible/accesible de solicitudes activas, ordenada por antigüedad, además del plano. |
| **ESP-28** | Avisos entre espacios | Si llega una solicitud en otro espacio, señalarla y permitir ir a él sin perder la vista actual ni ocultar la cola. |
| **ESP-29** | Reconexión y consistencia | Al reconectar Socket.IO, releer el estado autoritativo por REST y actualizar plano y cola. |
| **ESP-30** | Responsive | Vista útil en tablet —dispositivo prioritario de barra—, escritorio y móvil, sin disminuir ilegiblemente los identificadores de mesas. |

### Estados y terminología

| Concepto | Representación correcta | Precaución |
|---|---|---|
| Mesa sin solicitud activa | **Sin llamados** | No decir «Disponible» si el producto no conoce ocupación/reservas. |
| `pending` | **Pendiente** + icono/etiqueta + espera | Ámbar/rojo según antigüedad solo como énfasis visual. |
| `in_progress` | **En atención** + icono/etiqueta + usuario si aplica | Reconocimiento registrado, no evidencia de llegada física del mesero. |
| `completed` | Sale de la cola activa y queda en historial | Significa **finalización registrada por personal**, no garantía de servicio real. |
| Problema de conectividad | **Sin conexión** / **Botones desconectados**, según origen comprobado | No confundir conexión del navegador con estado de cada botón físico. |

El piloto mantiene un único `call_type`: **`attention`**. No incorporar a la interfaz tipos «Cuenta» u «Otro» hasta que se decida y modele una ampliación explícita. Según ADR-002, existe como invariante **una solicitud activa por mesa y por tipo de llamado**.

### Jerarquía visual y comportamiento de la pantalla

1. **Primer foco:** la mesa con solicitud pendiente más antigua, con etiqueta y minutos transcurridos.
2. **Segundo foco:** la localización de esa mesa en el plano esquemático.
3. **Tercer foco:** llamadas adicionales y mesas que ya estén `in_progress`.
4. Las mesas sin llamados deben permanecer **visibles pero discretas**: no competir con las urgencias.
5. Usar **formas, iconos, textos, tamaños, contraste y posición**, no únicamente estados cromáticos; las señales deben entenderse a distancia.
6. El modo operativo **no muestra** controles de edición ni botones de «simular pulsación». El simulador sigue siendo una herramienta independiente (`apps/button-sim`).
7. El tablero debe conservar la cola de llamados accesible si el plano falla, está vacío o todavía no fue publicado.

### Flujo extremo a extremo

```text
Cliente pulsa botón
    → gateway / adaptador IoT existente
    → hospitality registra evento, crea o reutiliza llamado activo
    → transacción confirmada + emisión Socket.IO
    → cola global de llamados se actualiza
    → mesa correspondiente del plano publicado se destaca
    → staff reconoce → in_progress
    → staff finaliza → completed
    → historial y métricas existentes
```

El editor no reemplaza el servicio de llamados, ni su Outbox, ni la lógica de deduplicación. Es una **capa de configuración y representación visual** sobre entidades existentes.

## 8. Diseño técnico y persistencia — propuesta para revisión

### 8.1 Mantener los dominios existentes

- `core`: autenticación, membresías, locales, permisos y entitlements.
- `hospitality`: zonas/espacios, mesas, diseños de plano, botones, llamados y notificaciones.
- `commerce`: inventario básico, sin cambio de alcance por este módulo.
- `analytics`: métricas básicas, sin dependencia directa de nuevas tablas de Hospitality.

Arquitectura física del MVP: **un repositorio pnpm**, con carpetas independientes por dominio, conforme ADR-002. La arquitectura objetivo sigue siendo de cuatro repositorios.

### 8.2 Tablas propuestas

```text
hospitality.zones                   [existente]
hospitality.dining_tables           [existente]
hospitality.service_calls           [existente]
hospitality.devices                 [existente]
hospitality.device_assignments      [existente]

hospitality.space_layouts           [nueva: versiones del diseño]
  id                 UUID, PK
  organization_id    UUID, tenant
  location_id        UUID, local
  zone_id            UUID, espacio propietario
  version            integer
  status             draft | published | archived   (propuesto)
  canvas_width       numeric / integer positivo
  canvas_height      numeric / integer positivo
  revision           integer, para concurrencia optimista
  created_at / updated_at / created_by / updated_by
  published_at / published_by (nulos hasta publicación)

hospitality.layout_elements         [nueva: geometría por versión]
  id                 UUID, PK
  layout_id          UUID, FK dentro de Hospitality
  organization_id    UUID
  location_id        UUID
  type               table | wall | door | bar | label | decoration
  table_id           UUID NULL, solo cuando type = table
  x, y               numeric (coordenadas del lienzo)
  width, height      numeric positivo
  rotation           numeric (grados)
  z_index            integer
  properties         JSONB limitado y validado por tipo
  created_at / updated_at
```

**Importante:** esta es una **estructura conceptual, no SQL de migración aprobado**. Los tipos finales, índices, `CHECK`, FKs compuestas y restricciones de publicación se revisan junto con `DATA-001` antes de la primera migración, como exige `PLAN-001` (`P0-01`).

### 8.3 Invariantes de consistencia

- Como máximo **un plano `published` por espacio**, y una política explícita de borradores/versiones.
- La publicación se ejecuta transaccionalmente: valida la versión y **archiva la anterior** antes de activar la nueva.
- `table_id` solo aparece en elementos de tipo `table`, debe existir, pertenecer al local y corresponder a la zona del plano, si así se confirma el modelo de espacios.
- No puede haber dos representaciones publicadas de una misma mesa en una configuración operativa del local. La protección debe diseñarse para que sea robusta frente a publicaciones concurrentes.
- Elementos decorativos no generan mesas, solicitudes, botones ni eventos de negocio.
- Coordenadas y tamaños válidos; normalizar unidades relativas al lienzo, no metros reales.
- La desactivación o eliminación visual **no borra** eventos, llamados, dispositivos ni auditoría histórica.
- El guardado usa **control de revisión** (p. ej. ETag o `revision`) para evitar que dos editores sobrescriban cambios sin aviso.
- Cada mutación y publicación registra el actor (`core.app_users.id`) y fecha; acciones del superadmin también quedan auditadas.
- No se hacen consultas/escrituras directas desde `core` u `analytics` a tablas de otro dominio; los contratos siguen públicos y versionados.

### 8.4 Contratos API sugeridos (no aprobados)

```http
GET    /api/v1/locations/:locationId/spaces
POST   /api/v1/locations/:locationId/spaces
PATCH  /api/v1/locations/:locationId/spaces/:spaceId

GET    /api/v1/locations/:locationId/spaces/:spaceId/layout
GET    /api/v1/locations/:locationId/spaces/:spaceId/layout/draft
PUT    /api/v1/locations/:locationId/spaces/:spaceId/layout/draft
POST   /api/v1/locations/:locationId/spaces/:spaceId/layout/publish

GET    /api/v1/locations/:locationId/tables?unplaced=true
```

Los endpoints de espacios pueden reutilizar los controladores de `zones` ya previstos; **no duplicar recursos lógicos** por elegir nombres de UI diferentes. El contrato final debe distinguir claramente **borrador** de **publicado**, permisos y resolución de conflictos (`409`). Los DTOs se definen con Zod en `domains/hospitality/contracts` según ADR-002 / TECH-001.

### 8.5 Frontend propuesto

- Mantener el stack **congelado** en TECH-001: React 19, TypeScript, Vite, Tailwind v4, shadcn/ui/Radix, TanStack Query y Socket.IO client.
- Desarrollar componentes de **lienzo 2D** separados del estado de negocio; evaluar SVG o elementos DOM transformables antes de elegir librerías. No congelar una biblioteca de diagramación hasta validar gestos táctiles, accesibilidad y rendimiento.
- Renderizar la distribución publicada como **vista de solo lectura**, con los estados superpuestos desde el feed autoritativo de llamados.
- No persistir imágenes rasterizadas como fuente de verdad; persistir **geometría estructurada**.
- El plano debe tolerar cambios de tamaño de pantalla; preservar distribución relativa y ajustar zoom/viewport por dispositivo.
- Respetar tema oscuro del tablero de barra, claro para administración; aplicar tokens de marca de BRAND-002 (azul tinta `#101E33`, verde `#1BAA95`, ámbar `#E6A03D`, etc.) y validar contrastes reales.
- Respetar `prefers-reduced-motion`; usar animaciones solo para informar llegada o transición de llamados.

## 9. Requisitos no funcionales

| ID | Atributo | Exigencia para MVP |
|---|---|---|
| RNF-01 | Aislamiento multi-tenant | Ningún usuario de una organización puede leer o modificar diseños de otra ni de un local no autorizado. |
| RNF-02 | Legibilidad | Identificación de mesas, estado e iconografía comprensibles en tablet, incluso con iluminación reducida. |
| RNF-03 | Accesibilidad | Estados con texto + color + icono, acciones accesibles por teclado en funciones esenciales; alternativa en lista para operar sin usar plano. |
| RNF-04 | Robustez | Un error de carga o publicación del plano no interrumpe el registro de llamadas ni la cola operativa. |
| RNF-05 | Consistencia tiempo real | La presentación del plano y la cola reflejan el mismo estado autoritativo del backend; REST al reconectar. |
| RNF-06 | Trazabilidad | Cambios de planos/publicaciones con actor, momento y revisión; no sustituir auditoría de llamadas. |
| RNF-07 | Rendimiento | Probar con la cantidad real de mesas del piloto y con una configuración de referencia de hasta 40 mesas; **los umbrales numéricos** deben acordarse antes de aceptación. |
| RNF-08 | Seguridad | Permisos en cada endpoint; validación estricta del JSON de geometría y límites de tamaño/cantidad; no exponer credenciales IoT. |
| RNF-09 | Mantenimiento | Añadir una nueva planta o local es configuración, no código especial, render externo ni despliegue exclusivo. |
| RNF-10 | Respaldo | Los planos están incluidos en la misma estrategia de backup/restauración de PostgreSQL que los demás datos de negocio. |

## 10. Casos de uso y pruebas de aceptación

| Caso | Dado / cuando | Entonces |
|---|---|---|
| **CU-01: Nuevo local** | Admin crea Salón principal y Terraza, añade mesas y publica sus planos. | Ambos aparecen en el tablero operativo sin intervención de diseño o desarrollo. |
| **CU-02: Reorganización** | Admin mueve Mesa 05, guarda borrador y lo publica. | La mesa aparece en su nueva posición, conservando ID, botón y llamados previos. |
| **CU-03: Plano no publicado** | Admin modifica el borrador mientras `staff` usa el sistema. | `staff` continúa viendo la última versión publicada; los cambios no aparecen hasta publicar. |
| **CU-04: Llamado en otro espacio** | Usuario observa Salón principal y el botón de Mesa 12, ubicada en Terraza, genera una solicitud. | La cola global muestra Mesa 12, Terraza presenta indicador de alerta y el usuario puede navegar a esa mesa. |
| **CU-05: Reconocer** | Dos empleados intentan reconocer el mismo llamado pendiente. | Uno tiene éxito; el otro ve el estado actualizado/conflicto, de acuerdo con la lógica existente. |
| **CU-06: Reconexión** | Se cae temporalmente la conexión de Socket.IO y vuelve. | El tablero vuelve a consultar por REST y coincide con la lista de llamados persistidos. |
| **CU-07: Sin plano** | Un local aún no tiene diseño publicado o su diseño no carga. | La cola/lista de mesas sigue operativa; los llamados no se pierden ni quedan ocultos. |
| **CU-08: Permisos** | `staff` o usuario `inventory` sin permisos intenta editar un plano por URL o API. | El backend deniega acceso (`403` o respuesta de ocultamiento apropiada). |
| **CU-09: Aislamiento** | Admin de negocio A intenta acceder al plano de negocio B. | No obtiene datos ni puede modificarlo. |
| **CU-10: Publicación concurrente** | Dos admins editan desde versiones distintas. | El sistema detecta revisión obsoleta y exige resolver/reintentar; no sobrescribe silenciosamente. |
| **CU-11: Mesa sin ubicar** | Mesa 07 está activa pero no aparece en el plano. | Se muestra como «Sin ubicar» en edición y sigue recibiendo llamados en la cola operativa. |
| **CU-12: Sin falso estado de ocupación** | Mesa 03 no tiene llamados activos. | El tablero indica «Sin llamados», nunca «Libre»/«Disponible» sin fuente de ocupación. |
| **CU-13: Conectividad** | El gateway no reporta heartbeat por más del umbral previsto. | Se presenta aviso de botones desconectados sin afirmar que la conexión del navegador también cayó. |

**Criterios de cierre:** implementar pruebas de dominio, persistencia, permisos, edición, publicación, E2E y recuperación; revisar visualmente la UI con el responsable según las reglas de `[DISEÑO]` de PLAN-001. No declarar aceptado el piloto hasta que el bar acuerde y valide umbrales de usabilidad y confiabilidad.

## 11. Decisiones abiertas antes de implementar

| ID | Pregunta | Propuesta inicial / efecto |
|---|---|---|
| **E-01** | Si el local no usa zonas, ¿se crea automáticamente «Salón principal» al abrir el editor? | **Sí, como espacio por defecto**, pero revisar comportamiento con tablas existentes cuyo `zone_id` sea `NULL` y reglas de unicidad. |
| **E-02** | ¿Una mesa puede cambiar de zona mediante arrastrar entre espacios? | Permitir mediante caso de uso explícito, conservando su identidad y validando duplicados, asignaciones y llamados activos. |
| **E-03** | ¿Qué ocurre si se desactiva una mesa con llamados activos o botones asignados? | Sigue abierto en PLAN-001 **Q-15**. Bloquear la operación hasta definir política; no cerrar llamados silenciosamente. |
| **E-04** | ¿Qué hacer con una solicitud `pending` antigua que nunca fue finalizada? | Sigue abierto en PLAN-001 **Q-16**. No crear cancelaciones automáticas sin decisión de negocio/ADR. |
| **E-05** | ¿Qué elementos de mobiliario se incluyen exactamente en el primer piloto? | Mínimo: mesa (3 formas), pared, puerta, barra, texto. Decoración sencilla si no compromete la entrega. |
| **E-06** | ¿Se permiten varios borradores o un solo borrador editable por espacio? | Recomendar **un borrador activo** y versiones publicadas históricas; facilita el MVP. |
| **E-07** | ¿Cómo se validan colisiones entre mesas, paredes y objetos? | Como mínimo advertir superposiciones y evitar duplicados de mesa; decidir si se bloquean colisiones geométricas. |
| **E-08** | ¿Qué se muestra en móvil cuando el plano no cabe en pantalla? | Priorizar cola global y selector de espacios, con plano navegable mediante zoom; validar con personal real. |
| **E-09** | ¿Qué cambio concreto de permisos se aprueba? | Decidir `hospitality.layouts.manage/read` vs ampliar `hospitality.tables.manage`. Revisar matriz antes de API. |
| **E-10** | ¿Se requiere historial completo de edición o solo versiones publicadas? | Propuesta: conservar versiones publicadas y auditoría de acciones; no implementar edición colaborativa ni event sourcing. |
| **E-11** | ¿Cómo mantener unicidad global de ubicación de una mesa entre planos publicados con concurrencia? | Diseñar restricción/transacción al revisar DATA-001; no confiar solo en el frontend. |
| **E-12** | ¿Qué tecnología de lienzo supera pruebas táctiles y accesibilidad? | Evaluar SVG/DOM y librerías compatibles con React; no decidir por apariencia o moda. |

Estas preguntas no revierten la decisión de incluir el editor en el MVP; determinan **cómo implementarlo con seguridad y alcance controlado**.

## 12. Impacto en el plan de trabajo

`PLAN-001` fue redactado antes de esta ampliación, por lo que sus **86 tareas y su camino crítico** ya no son una estimación completa del MVP actualizado. Se debe publicar una revisión del plan, sin afirmar que el alcance nuevo está cubierto por las tareas previas.

| Fase / tarea existente | Ajuste requerido |
|---|---|
| **P0-01 (revisión de DATA-001)** | Incorporar modelo de planos, estrategias de versionado, zonas opcionales, restricciones y migraciones antes de escribir modelos Prisma. |
| **F1 — Core / permisos** | Incluir el permiso de edición/publicación y las pruebas de autorización por negocio/local. |
| **F2-01 / F2-02** | Incorporar tablas de planos y casos de uso de espacios, con validaciones de integridad y local. |
| **F2-12 / F2-13 `[DISEÑO]`** | Ampliar la UI de administración de mesas/zonas a **editor visual de espacios**, gestión de borradores y publicación. |
| **F3-12 / F3-13 `[DISEÑO]`** | Convertir el tablero principal en **plano operativo visual con focos de atención** + cola de llamados, con consistencia por Socket.IO y REST. |
| **F3-16** | E2E: botón de mesa situada en plano → indicación visual → reconocimiento → finalización; probar cambios de plano y reconexión. |
| **F5 — Analytics** | Mantener métricas por zona y mesa; no trasladar dominio analítico a Hospitality ni añadir analítica avanzada por este cambio. |
| **F6 — Piloto** | Evaluar construcción del plano por el administrador, reubicación de mesas sin soporte y legibilidad/eficacia operativa. |
| **Hito «demo mostrable»** | Añadir como condición **crear, guardar, publicar y utilizar al menos un plano 2D con llamados en tiempo real**. |

### Orden recomendado de implementación (nueva propuesta)

1. Revisar diseño funcional y decisiones E-01 a E-12 que bloqueen datos/UX.
2. Actualizar modelo `hospitality` y migraciones; pruebas de integridad y versiones.
3. API de borrador/publicación y permisos.
4. Editor 2D de administración con persistencia; revisión visual.
5. Tablero operativo sobre plano publicado con cola global siempre accesible.
6. Integración con el flujo de llamados ya existente, simulador y pruebas de reconexión.
7. Pruebas E2E y usabilidad con el bar; después hardware real.

**No** se debe interpretar este módulo como una razón para agregar Kafka, Kubernetes, 3D, un servicio de mapas externo o infraestructura adicional al MVP.

## 13. Alcance negativo explícito

**Fuera del MVP de este módulo:**

- Modelos o renders 3D/fotorrealistas de cada establecimiento.
- Importación automática o trazado preciso de planos CAD/BIM.
- Medición arquitectónica en metros, rutas de evacuación certificadas o gestión de normativas de seguridad física.
- Reconocimiento fotográfico del espacio, realidad aumentada o gemelos digitales.
- Reservas, ocupación real, disponibilidad comercial de una mesa o asignación automática de meseros.
- Editor colaborativo simultáneo, cursores en vivo, diseño paramétrico avanzado o catálogo amplio de mobiliario.
- Nuevos tipos de llamado (`bill`, `other`, etc.) no aprobados; el piloto continúa con `attention`.
- Modificar el módulo de inventario, construir POS o incorporar métricas avanzadas por efecto de este módulo.

## 14. Consecuencias y riesgos

### Consecuencias positivas esperadas (a comprobar)

- Configuración visual de nuevos establecimientos **sin render individual por cliente**.
- Mayor contexto espacial para priorizar solicitudes en barra.
- Cambio de distribución física sin alterar registros de atención ni asignaciones hardware.
- Una experiencia comercial más distinguible que una cuadrícula genérica, siempre que el piloto valide su usabilidad.

### Costos y riesgos introducidos

- **Más alcance y camino crítico** en Fase 2/3; el editor debe diseñarse y probarse, no improvisarse como decoración.
- Gestos de arrastre, zoom y transformación pueden ser difíciles de operar en tablet; validar temprano con personal del local.
- Estado publicado vs. borrador requiere controles de versiones, conflictos y migraciones adicionales.
- Planos con demasiados detalles pueden reducir la legibilidad de llamados; priorizar contraste, foco y jerarquía visual sobre realismo.
- Datos obsoletos de plano no deben producir pérdida de llamados: cola operativa independiente y REST de recuperación.

## 15. Decisiones fijadas vs. propuestas abiertas

**Confirmado por el responsable del producto en esta conversación:**

- El **editor visual de espacios debe estar incluido en el MVP**.
- La UI debe ser **más intuitiva y visual**, con focos de atención claros, no un dashboard genérico de tarjetas.
- Debe evitarse depender de crear un render personalizado por local; la propia plataforma debe permitir configurar la distribución.

**Propuesta de este documento, aún por validar técnicamente:**

- Reutilizar `zones` como espacios del editor y crear un espacio por defecto si hace falta.
- Persistir versiones de `space_layouts` y objetos `layout_elements` con geometría estructurada.
- Flujo borrador → publicación, control optimista de cambios y reglas exactas de unicidad.
- Alcance de objetos visuales del editor, contratos API y librería/capa de renderizado 2D.
- Ajuste completo de estimaciones, dependencias y criterios cuantitativos del piloto.

## 16. Relación con fuentes y precedencia

- **ADR-001 §8:** fijó el alcance anterior del MVP; este ADR documenta la **ampliación solicitada** sin editar el registro histórico.
- **ADR-002 D2 y D3:** mantiene cuentas por negocio y límites de superadmin / administrador de local.
- **ADR-002 D4:** mantiene una solicitud activa por mesa **y tipo**, y solo `attention` durante el MVP.
- **DATA-001 §3:** reutiliza `zones`, `dining_tables`, `devices`, `device_assignments` y `service_calls`; introduce modelos nuevos pendientes de revisión.
- **TECH-001 §§5, 10.1, 16:** conserva Clean Architecture por dominio, stack frontend y notificaciones Socket.IO, con permisos del Core.
- **PLAN-001 §§4, 5, 10, 12:** requiere revisión visual antes de código, migraciones tras `P0-01`, y resolver Q-15/Q-16.
- **BRAND-002 §9:** conserva identidad de producto Modivara y tokens propuestos; no confundir propuesta de marca con registro aprobado.

> **Nota de gobernanza:** este archivo es el documento de trabajo de la nueva decisión de alcance. No acredita por sí solo que se hayan actualizado las migraciones, el código, el plan de tareas o las pantallas existentes. Tales cambios se harán tras la revisión técnica y de diseño correspondiente.

## 17. Decisiones tomadas (28/10/2026)

El responsable aceptó, en una ronda de preguntas, estas respuestas a §11 y a los detalles técnicos de §8. Prevalecen sobre las propuestas de §8 donde las contradicen.

| ID | Decisión |
|---|---|
| Alcance | En esta tanda solo se construye el backend: datos, migración, API, permisos, hooks web, seed de demo y documentos. El editor y el tablero sobre el plano siguen siendo tareas `[DISEÑO]` que esperan la revisión del responsable. |
| E-01 | Un plano con `zone_id = NULL` es el espacio único del local, y la UI lo rotula «Salón principal». No se crea zona ni se mueven mesas. Si después el local crea zonas, cada mesa se reubica con el `PATCH` de mesas que ya existe (E-02). |
| E-02 | Para cambiar una mesa de espacio se usa el `PATCH /tables/:id` existente con `zone_id`. La mesa conserva su identidad, su botón y sus llamados. |
| E-03, E-04 | E-03 (Q-15): desactivar una mesa con botones asignados **o con un llamado activo** se bloquea con 409 `table_in_use`; nada se cierra solo. E-04 (Q-16): sin vencimiento ni cancelación automática en el MVP; si el piloto lo pide, se escribe un ADR. |
| E-05, E-07 | Tipos de elemento: `table` (`round`, `square` o `rect`, con `table_id`), `wall`, `door`, `bar` y `label`, sin decoración. El servidor valida límites del lienzo, tamaños positivos, rotación y que no haya mesas repetidas. Las superposiciones solo se avisan en la UI. |
| E-06, E-10 | Por espacio hay a lo sumo un borrador y un publicado, garantizado con índices únicos parciales. Publicar archiva la versión publicada anterior. Se conservan las versiones archivadas, pero no un historial de cada edición. |
| E-08, E-12 | Comportamiento en móvil y tecnología del lienzo: se deciden al diseñar el front. |
| E-09 | No se crean permisos `layouts.*`. Editar y publicar exige `hospitality.tables.manage`; leer el plano publicado exige `hospitality.calls.read`. |
| E-11 | Sin restricción entre planos. Basta con tres reglas: un solo plano publicado por espacio, una mesa solo puede ir en el plano de su propia zona (se valida al guardar y al publicar) y no puede repetirse dentro de un plano. Al leer el plano publicado se omiten las mesas que cambiaron de zona o se desactivaron, que pasan a «Sin ubicar». |
| §8.2 | Una sola tabla, `hospitality.space_layouts`; los elementos van en `elements jsonb`, validados con Zod (máximo 500). No se crea `layout_elements`. Se pasaría a tabla si algún día hay que consultar la geometría por SQL. |
| §8.3 / CU-10 | Concurrencia optimista: el borrador lleva `revision` en el cuerpo, y tanto guardar como publicar responden 409 con la revisión vigente si no coincide. |
| §8.4 | Rutas: `GET /locations/:locationId/layouts` (todos los publicados), `GET` y `PUT /locations/:locationId/layouts/draft` (con `?zone_id=` o sin él para el espacio único) y `POST /locations/:locationId/layouts/publish`. «Mesas sin ubicar» no tiene endpoint: el front la calcula con la lista de mesas. Al publicar se avisa por Socket.IO a la sala del local. |
| Seed | Bar Demo tiene un plano publicado del espacio único (15 mesas, barra y puerta) y Bar Demo Pisos uno por cada zona. |

Estado de la implementación: ver la nota «Estado» correspondiente en `PLAN-001`.
