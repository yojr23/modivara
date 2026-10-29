# HANDOFF — Sesión nocturna: esqueleto del monorepo y plan de trabajo

> **Para:** la sesión de Claude Code que trabajará sin supervisión mientras el responsable duerme.  
> **Fecha de entrega:** 19/10/2026.  
> **Directorio:** `/Users/j.rinconc/Desktop/JUNIOR/trabajo/emprendimiento`

## 0. Reglas de esta sesión (leer primero)

1. **Nadie va a responder preguntas.** No uses AskUserQuestion. Si una decisión no está cubierta por los documentos, elige la opción más conservadora y fácil de revertir, y regístrala en `NOCHE-LOG.md` (§6).
2. **No hacer migraciones.** Prohibido `prisma migrate`, `prisma db push` o aplicar SQL a cualquier base. Tampoco escribir modelos en `schema.prisma`: DATA-001 está **pendiente de revisión**. Cada `schema.prisma` lleva solo `generator` y `datasource` (con `?schema=<dominio>`).
3. **Nada hacia afuera.** No crear el repositorio en GitHub, no `git push`, no desplegar, no contratar ni registrar servicios. Git solo local.
4. **No modificar documentos aprobados:** `documentos/ADR-001*`, `ADR-002*`, `BRAND-002*`, `DATA-001*`, `TECH-001*`. Si encuentras una contradicción o un error, anótalo en `NOCHE-LOG.md`.
5. **Sin servicios pagos** ni dependencias que los requieran.
6. **Idioma:** identificadores y código en inglés; textos de interfaz, documentos y mensajes de commit en español (con prefijo Conventional Commits: `feat:`, `chore:`, …).
7. Lo mínimo que funcione. Nada de pantallas reales todavía: el diseño de UI se revisa con el responsable.

## 1. Contexto obligatorio (leer en este orden)

1. `documentos/ADR-001_arquitectura_saas_multiproducto_mvp.md`
2. `documentos/ADR-002_cuentas_por_negocio_superadmin_y_ajustes_mvp.md` (prevalece sobre ADR-001 donde lo indica)
3. `documentos/TECH-001_propuesta_arquitectura_MVP_revisada.md`, sobre todo §5, §10 y **§16**
4. `documentos/DATA-001_modelo_de_datos_mvp.md` (solo como referencia; no implementar tablas)
5. `documentos/BRAND-002_MODIVARA_LABS_identidad_corporativa_y_MVP.md` §9 (paleta y tipografía)

Responsable: maneja bien Django y Laravel; el frontend es su punto débil y no quiere una UI de plantilla genérica. Prefiere recomendaciones claras y puntos de extensión baratos antes que funcionalidades construidas por adelantado.

## 2. Objetivo de la noche

Dejar un **monorepo que compila, pasa sus pruebas y demuestra separabilidad**, más un **plan de trabajo** detallado para las fases siguientes. Sin base de datos aplicada.

## 3. Tareas (en orden; commit al terminar cada una)

### T1 — Repositorio
- `git init`, rama `main` vacía con un commit inicial de `documentos/` y este archivo; trabajar en la rama `fase-0/esqueleto`.
- `.gitignore` (node_modules, dist, .env, coverage, .DS_Store).
- `.env.example` con las variables necesarias (sin secretos reales).

### T2 — Workspace y herramientas
- pnpm workspaces. Verifica las versiones: Node 24 LTS (si no está instalado, regístralo en el log y usa la LTS disponible), pnpm vía `corepack`.
- Fija **versiones exactas** en `package.json` (sin `^`). Usa versiones estables actuales.
- `tsconfig.base.json` con `strict: true`; Vitest en la raíz.
- Scripts raíz: `build`, `typecheck`, `test`, `check:separability`.

### T3 — Estructura (TECH-001 §5 v1.2)
```text
apps/api/          host NestJS: solo importa los módulos de dominio desde sus index.ts
apps/portal/       Vite + React 19 + TS + Tailwind v4 + shadcn/ui (sin tema por defecto)
apps/button-sim/   proceso Node mínimo: servidor HTTP que responde una página "Simulador" vacía
domains/{core,hospitality,commerce,analytics}/
  api/        módulo Nest del dominio + prisma/schema.prisma (solo generator + datasource)
  web/        paquete React del dominio (vacío salvo un index.ts)
  contracts/  Zod + tipos públicos
```
- Cada paquete con `name` `@modivara/<dominio>-<api|web|contracts>` y `exports` que solo exponga `./src/index.ts` (o su build).
- `domains/<x>/api` puede depender **solo** de los `contracts` de otros dominios, nunca de su `api` ni de su `web`.

### T4 — Prueba de separabilidad (ADR-002 D1)
- Script `check:separability` que falle si:
  - un `package.json` de `domains/<x>` depende de un paquete `@modivara/<y>-api` o `@modivara/<y>-web` con `y ≠ x`;
  - algún archivo importa una ruta interna de otro paquete (`@modivara/.../src/...`) o usa rutas relativas que salgan de su dominio (`../../<otro-dominio>`);
  - algún dominio no compila o no pasa sus pruebas de forma aislada (`pnpm --filter`).
- Incluir una prueba que demuestre que el script detecta una violación (fixture temporal o caso unitario).

### T5 — Primeras piezas puras (sin base de datos), con pruebas
- `domains/hospitality/api`: `transitions.ts`, con la tabla `TRANSITIONS` y la función `transition(call, action, actorId)` (TECH-001 §16.4). Pruebas: transiciones válidas, saltos rechazados, `completed` como estado final.
- `domains/core/contracts`: `ROLE_PERMISSIONS` y los permisos de DATA-001 §2; la función `permissionsFor(roles, { isOwner, isPlatform })`; esquema Zod de contraseña (mínimo 8 caracteres, 1 mayúscula, 1 número), de `username` y de `slug`, incluidos los slugs reservados. Pruebas de cada uno.
- `domains/core/contracts`: la interfaz `CoreAccessPort` (solo el tipo).
- `domains/hospitality/contracts`: tipos Zod de los eventos v1 (DATA-001 §6) y del mensaje del gateway (`device_code`, `button_key?`, `sent_at?`).

### T6 — Portal: solo la base visual
- Tokens de BRAND-002 §9 como variables CSS del tema de Tailwind v4, en tema claro y tema oscuro (este para el tablero de barra).
- Manrope e Inter autoalojadas con Fontsource.
- Una única página de muestra **interna** (`/_tokens`) que enseñe colores, tipografía, un botón y una tarjeta de estado (color + ícono + texto). Nada de login ni tablero todavía.
- `pnpm --filter portal build` debe pasar.

### T7 — Docker
- `docker-compose.yml` con `db` (postgres:18), `mqtt` (eclipse-mosquitto:2), `api`, `web`, `button-sim` y `caddy`, con versiones de imagen fijas.
- Dockerfiles mínimos y multietapa para `api`, `portal` y `button-sim`.
- Verificación: `docker compose config` sin errores. Si Docker está disponible, `docker compose build`. **No** ejecutar migraciones aunque la base levante. Si Docker no está instalado, regístralo en el log y sigue.

### T8 — Plan de trabajo
Crear `documentos/PLAN-001_plan_de_trabajo_mvp.md`, en español, con:
- Las fases de TECH-001 §12, con el hito "demo mostrable" (§12 v1.2), divididas en tareas pequeñas (de medio día a un día). Cada tarea con archivos afectados, criterio de aceptación verificable y dependencias.
- La revisión de DATA-001 como **primera tarea bloqueante** antes de cualquier migración, con las 3 preguntas de DATA-001 §8.
- Las tareas de UI marcadas como "requiere revisión de diseño con el responsable".
- Riesgos y preguntas abiertas que hayas detectado.

## 4. Verificación antes de dar por terminada cada tarea

Ejecutar y que pasen: `pnpm install --frozen-lockfile` (después del primer install), `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm check:separability`. No marques nada como hecho sin ver la salida. Si algo falla y no puedes arreglarlo en un tiempo razonable, déjalo documentado en el log con la línea de error exacta y sigue con la siguiente tarea independiente.

## 5. Fuera de alcance esta noche

Migraciones, modelos Prisma, endpoints con base de datos, login, sesiones, Socket.IO, pantallas reales, CI en GitHub, push y despliegue.

## 6. Entregable final: `NOCHE-LOG.md` (en la raíz)

Para que el responsable lo lea por la mañana, breve:
1. **Hecho:** cada tarea T1–T8 con su estado (hecha / parcial / bloqueada) y el commit.
2. **Decisiones que tomé sin consultar:** cada una con su motivo y cómo revertirla.
3. **Contradicciones o errores** encontrados en los documentos.
4. **Comandos para comprobarlo** (`pnpm test`, etc.).
5. **Qué necesito del responsable** para seguir.
