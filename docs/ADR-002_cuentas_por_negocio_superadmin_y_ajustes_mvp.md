# ADR-002 — Cuentas por negocio, superadmin de plataforma y ajustes al MVP

> **Proyecto:** Emprendimiento — plataforma SaaS modular (Modivara, nombre candidato)  
> **Fecha:** 19 de octubre de 2026  
> **Estado:** Aceptado.  
> **Relación:** complementa `ADR-001_arquitectura_saas_multiproducto_mvp.md`. ADR-001 no se modifica; donde este documento lo contradice, **prevalece ADR-002** en los puntos indicados.  
> **Documentos derivados:** `TECH-001` v1.2 (§16) y `DATA-001_modelo_de_datos_mvp.md`.

## 1. Contexto

Durante la preparación del MVP se revisaron con el responsable del producto las bases de implementación. Cuatro decisiones contradicen o precisan reglas congeladas en ADR-001 y, según su §10, deben registrarse en un ADR nuevo:

1. Cómo se organiza el código mientras existe un solo desarrollador, sin perder el destino de cuatro repositorios.
2. A quién pertenecen las cuentas de usuario.
3. Dónde vive el operador de la plataforma (instalación y soporte técnico).
4. La invariante de "una solicitud activa por mesa" frente a botones con varios tipos de llamado.

## 2. Decisiones

### D1 — Repositorio único transitorio con separabilidad verificada

**Precisa ADR-001 §4 y §8 (no cambia el destino).**

- El destino sigue siendo **cuatro repositorios**: `platform-core`, `hospitality-ops`, `commerce`, `analytics`.
- Durante el MVP el código vive en **un solo repositorio** (pnpm workspaces) para reducir complejidad operativa.
- Cada dominio es un paquete autónomo en `domains/<dominio>/{api,web,contracts}`, con su propio esquema PostgreSQL, su propio cliente Prisma y sus propias migraciones.
- Cada paquete expone solo su `index.ts` público mediante el campo `exports` de `package.json`; ningún dominio puede importar código interno de otro.
- Las llamadas entre dominios pasan por puertos definidos en el `contracts` del dominio que responde (por ejemplo, `CoreAccessPort`). Hoy su implementación es en proceso; al separar repositorios será un cliente HTTP, sin cambiar el código consumidor.
- **Prueba de separabilidad obligatoria:** cada `domains/<x>` debe compilar y pasar sus pruebas de forma aislada (`pnpm --filter`), dependiendo únicamente de los `contracts` de otros dominios. Un fallo de esta prueba bloquea el cambio.

### D2 — Cuentas de usuario por negocio

**Reemplaza ADR-001 §5, regla 2** ("Un usuario puede pertenecer a varias organizaciones/ubicaciones").

- Cada usuario pertenece a **una sola organización**. Una persona que trabaja en dos negocios tiene dos cuentas independientes.
- Cada negocio es dueño exclusivo de sus cuentas: darlo de baja no afecta cuentas de otros negocios.
- El inicio de sesión identifica el negocio por la ruta (`/<slug-del-negocio>`), con evolución prevista a subdominio (`<slug>.dominio`) cuando haya más clientes, sin cambios en el modelo de datos.
- Credenciales: **nombre de usuario + contraseña**, únicos por organización. No se almacena correo ni se usa SMTP en el MVP; el restablecimiento de contraseña lo hace un administrador.
- Dentro de su organización, un usuario puede acceder a uno o varios locales según sus membresías y roles.

### D3 — Organización de plataforma y superadmin

**Nueva regla; no contradice ADR-001, precisa §9.3 (modelo de permisos).**

- Existe una única organización marcada como de plataforma ("Modivara Labs", ruta `/labs`).
- **Todo usuario activo de la organización de plataforma es superadmin.** No existe una columna o rol que un negocio cliente pueda asignar para obtener ese nivel de acceso.
- El superadmin gestiona todo en todos los negocios: organizaciones, locales, módulos habilitados, usuarios, instalación y configuración técnica de gateways y botones, además de cualquier operación disponible para un administrador de local.
- El administrador de local (rol `admin`) es el dueño o administrador del negocio. No ve ni gestiona información técnica de gateways y dispositivos; solo si una mesa tiene botón y si los botones están conectados.
- Toda acción del superadmin sobre un negocio queda registrada con su usuario.

### D4 — Una solicitud activa por mesa y por tipo de llamado

**Reemplaza la invariante de ADR-001 §5** ("solo una solicitud activa por mesa").

- Las solicitudes tienen un `call_type`. En el MVP existe un único tipo: `attention`.
- La invariante pasa a ser: **solo una solicitud activa (`pending` o `in_progress`) por mesa y por tipo de llamado**, garantizada con índice único parcial sobre `(table_id, call_type)`.
- Con un solo tipo, el comportamiento del MVP es idéntico al de ADR-001. La regla nueva permite que, si el hardware elegido tiene varias teclas (por ejemplo, "atención" y "cuenta"), una mesa pueda tener una solicitud activa de cada tipo.
- La traducción de "tecla física" a tipo de llamado es responsabilidad del adaptador de hardware, no del dominio.
- Los estados siguen siendo `pending → in_progress → completed`. Un estado de cancelación (por ejemplo, `dismissed`) requeriría un ADR nuevo.

## 3. Aclaraciones sin cambio de decisión

- **PostgreSQL:** ADR-001 §5 permite ("puede utilizarse") una instancia administrada. Durante el piloto se usa PostgreSQL en Docker, sin servicios administrados pagos (TECH-001 §10.3). La separación por esquemas y propiedad de datos se mantiene.
- **Roles extensibles:** los permisos se verifican por permiso, no por rol. Los roles de local del MVP (`admin`, `staff`, `inventory`) pueden dividirse (por ejemplo, `waiter`, `cashier`) sin cambiar rutas ni guards.

## 4. Alternativas consideradas

| Decisión | Alternativa | Motivo del rechazo |
|---|---|---|
| D1 | Cuatro repositorios desde el día uno | Costo operativo (CI, versiones, releases) desproporcionado para un desarrollador y un piloto. |
| D2 | Identidad global con membresías por organización | Más simple para quien trabaja en varios negocios, pero el negocio no sería dueño exclusivo de sus cuentas. Se prioriza la propiedad del negocio. |
| D2 | Correo como identificador | El personal operativo no siempre quiere o usa correo, y sin SMTP no aporta funcionalidad. |
| D3 | Tabla y login separados para administradores de plataforma | Duplica sesiones y login, y obliga a distinguir tipos de actor en todas las columnas de auditoría. |
| D4 | Mantener "una por mesa" e ignorar el tipo | Obligaría a migrar la invariante si el hardware final tiene varias teclas. |

## 5. Consecuencias

- El login requiere el slug del negocio; los slugs reservados (`labs`, `api`, `sim`, etc.) no pueden asignarse a clientes.
- La auditoría usa siempre `app_users.id` como actor, incluido el superadmin.
- Separar un dominio a su propio repositorio consiste en mover `domains/<x>`, publicar los `contracts` como paquete versionado y cambiar la implementación conectada de sus puertos.
- La prueba de separabilidad debe existir desde el primer commit con código de dominio.
