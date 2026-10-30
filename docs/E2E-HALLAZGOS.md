# E2E — hallazgos y siguiente paso (30/10/2026)

> Informe de la primera suite de pruebas de punta a punta con Playwright (rama `e2e/playwright`, commit 15b0683). Cómo correrla: `e2e/README.md`. Estado por tarea: PLAN-001. Mapa del frontend: `docs/PORTAL.md`.

## 1. Qué se probó y con qué resultado

Navegador real (el Chrome instalado), API real, Socket.IO y la base de demo sembrada (`docker compose up --build -d` + `pnpm seed`). **15 pruebas, 15 en verde en dos corridas seguidas** (~1,3 min cada una).

| Archivo | Tarea | Qué comprueba |
|---|---|---|
| `auth.spec.ts` | F1-16 | Login correcto y con clave errada; bloqueo de la cuenta a los 5 fallos (con el mismo mensaje que una clave errada); «Salir» cierra la sesión; la URL de otro negocio no muestra sus datos; la API rechaza leer el local de otro negocio (mesas, llamados, planos, productos, métricas). |
| `service-call.spec.ts` | F3-16, L-07 | Pulsación por HTTP → mesa resaltada en el plano y en la cola → «Marcar en atención» → «Finalizar», visto en vivo en dos tableros de usuarios distintos; el historial queda con quién tomó y quién cerró; una pulsación dentro de 3 s se descarta y la siguiente suma pulsaciones; tras `docker compose restart api` el tablero se reconecta solo y sigue recibiendo llamados. |
| `inventory.spec.ts` | F4-11 | `inventario1` crea un producto y registra entrada, salida (y ve el aviso de saldo insuficiente) y ajuste por conteo; saldo, historial del día y API coinciden; el personal de barra no ve inventario ni por menú ni por URL. |
| `metrics.spec.ts` | F5-13 | El total de llamados de «Hoy» en pantalla es igual al historial de llamados; el saldo de un producto en métricas es igual al de inventario. |
| `spaces.spec.ts` | L-05, L-07 | Publicar un área en el editor mientras otra persona mira el tablero (aparece sin recargar); un conflicto de edición (409) no pisa el borrador de la otra persona y permite recargar la versión vigente. |

## 2. Lo que encontró y ya quedó arreglado

| # | Hallazgo | Impacto | Arreglo |
|---|---|---|---|
| 1 | **El personal (rol staff) no podía leer mesas ni zonas** (`GET` exigía `hospitality.tables.manage`). Su tablero mostraba todas las mesas como «Mesa», sin número, y los pisos sin nombre. Con admin no se notaba. | Alto: el tablero de la barra era ilegible para quien más lo usa. | `GET` de mesas y zonas acepta `hospitality.calls.read`; crear, editar y desactivar siguen exigiendo `tables.manage`. Pruebas unitarias y de integración actualizadas (commit c758393). |
| 2 | El nombre accesible de la tarjeta de la cola ponía en minúsculas el nombre de quien tomó el llamado («la tomó barra»). | Bajo: lo que oye un lector de pantalla. | Solo baja la primera letra («la tomó Barra»). |
| 3 | Las cifras de métricas y las tarjetas de la cola no tenían un nombre accesible estable. | Bajo, pero las pruebas dependían de clases o textos sueltos. | `Figure` es un grupo con su rótulo («Llamados: 181») y cada tarjeta de la cola se anuncia «Mesa 7, esperando 0 min 05 s, Primer piso, Zona A». Las pruebas usan solo roles y nombres. |

Antes de la suite, la verificación manual en el navegador (la misma sesión) ya había corregido: la URL de otro negocio mostraba los datos de la sesión con el nombre equivocado; los rótulos de fecha de métricas salían en ISO («2026…»); el editor se quedaba en modo revisión después de publicar; el orden de los pisos en el tablero no era estable.

## 3. Lo que encontró y queda abierto (decisiones o trabajo pendiente)

| # | Hallazgo | Por qué importa | Propuesta |
|---|---|---|---|
| A | **Al conectar el editor a la API, el mapa diseñado (Primer y Segundo piso con sus áreas) desapareció**: el prototipo traía esa escena escrita a mano y la base solo tenía la cuadrícula del seed. | El responsable lo detectó; la demo se veía peor que el diseño aprobado. | Resuelto con `pnpm seed:planos-demo` (opcional, por la API, idempotente). Abierto: ¿se cambia DATA-001 §7 para que el seed base ya tenga los dos pisos? Hoy no, para no romper lo acordado ni las pruebas del seed. |
| B | **Límite de login por IP: 30 intentos cada 15 min, en memoria.** La suite lo agotaba al iniciar sesión en cada prueba. | En un bar real, la tablet y los celulares comparten la IP del local: un turno con muchos inicios de sesión (o un error de clave repetido) puede dejar a todos fuera 15 min. | La suite inicia sesión una vez por usuario. Para producto: decidir cifras y almacenamiento (ya figura como `OPEN` en MEMORY y TECH-001 §16.3), y quizás contar solo los fallos. |
| C | **Un admin que no es dueño no puede desactivar un usuario sin local asignado** (404). | Regla conocida y conservadora, pero se ve como error: el usuario existe y el admin lo creó. | Decidir si quien crea un usuario puede administrarlo aunque todavía no tenga local, o si crear un usuario exige asignarle uno. |
| D | **En el tablero «todo el local a la vista», la acción aparece solo al tocar la mesa o su tarjeta.** El llamado más antiguo no tiene botón visible sin ese toque (en celular sí, en la fila). | Un toque más en el caso más frecuente. La prueba lo refleja (toca la tarjeta antes de «Marcar en atención»). | Probarlo con el personal en el piloto; si molesta, poner «Marcar en atención» directo en la tarjeta del primer pendiente. |
| E | **No hay forma de borrar un gateway.** Cada base nueva de prueba suma un «Gateway E2E» (y quedó un «Gateway de prueba» de la verificación manual). Un gateway sin señal de vida cuenta para «Botones desconectados». | Ensucia la demo y puede encender la alerta de botones sin motivo. | Pantalla o comando para desactivar gateways (va con la consola de superadmin, F2-14/F3-15). |
| F | **Los datos de prueba se acumulan** en la base de demo: llamados y movimientos en el historial, productos y usuarios desactivados, versiones de planos. | La demo se va llenando de «E2E …» y las métricas suman esos llamados. | Correr los E2E contra una base desechable (otro proyecto de Compose con su volumen) en vez de la de demo. |
| G | **El envío por MQTT no tiene E2E** (solo HTTP). | El hardware real probablemente usará MQTT (Q-01). | Agregar la prueba cuando el broker tenga credenciales de prueba (`scripts/mqtt-user.sh`) en el stack de E2E. |
| H | **El historial de llamados solo se verifica por API**; no hay pantalla (F3-14). | El criterio de F3-16 («→ historial») queda cubierto a medias. | Construir F3-14 y extender la prueba. |
| I | **Movimientos de stock sin nombre de quien registró**: la API devuelve `actor_user_id` y la pantalla solo puede decir «tú» o nada. | El historial de inventario no sirve para saber quién hizo un ajuste. | Agregar `actor_name` a `GET …/movements` (como ya hace hospitality con los llamados). |
| J | **Métricas por área usan la geometría actual del plano**: si una mesa cambia de área, sus llamados pasados cuentan en la nueva. | Aceptado el 30/10 como límite del modelo «área = elemento del plano». | Revisar si el piloto necesita el área histórica (implicaría área = zona real). |
| K | **Ningún E2E corre automáticamente.** | Los errores 1 y A se habrían visto antes con una corrida automática por cada cambio. | Ver «Siguiente paso». |

## 4. Cómo cuida la suite los datos y el límite de logins

- `global-setup.ts` inicia sesión una vez por usuario (unos 13 intentos por corrida en total) y guarda las cookies en `e2e/.auth/` (fuera de git).
- Las pulsaciones usan un gateway de prueba que se crea una vez como superadmin.
- Cada prueba cierra los llamados que abre, desactiva el producto y el usuario que crea y republica los planos sin las áreas de prueba.
- Corre con un solo worker: comparte la base de demo y una prueba reinicia la API.

## 5. Siguiente paso recomendado

**1. Pasar `e2e/playwright` a `main`**: arreglo de permisos de staff, mapa de demo y suite; todo verificado.

**2. Hacer que los E2E corran solos y sobre una base desechable (hallazgos F y K)**, antes de seguir agregando pantallas:
- un `docker-compose.e2e.yml` (o un proyecto de Compose aparte) con su propia base, que se levanta, siembra (`pnpm seed` + `pnpm seed:planos-demo`), corre `pnpm test:e2e` y se apaga;
- un workflow de GitHub Actions que haga eso en cada push a `main` y en cada PR, junto con typecheck, pruebas unitarias, integración y separabilidad.

Es poco trabajo (la suite ya existe) y protege todo lo que viene; el error de permisos de staff es el tipo de regresión que atraparía.

**3. Después, cerrar el hito «demo mostrable»** con lo que le falta, cada pantalla con su E2E desde el principio:
- **F3-14 Historial de llamados (H5)**: el backend y los hooks (`useCallHistory`, `useCallDetail`) ya existen; completa el criterio de F3-16.
- **F2-14 / F3-15 Consola de superadmin (H3)**: gateways (incluido desactivarlos, hallazgo E), botones, «detectados sin asignar» y vinculación botón–mesa; con eso entra F2-15.
- **F2-10 Simulador para celular (H8)** y el E2E por MQTT (hallazgo G).

Decisiones que conviene tomar en paralelo, porque bloquean el piloto y no dependen del código: hardware real (Q-01), criterios medibles del piloto (Q-03) y los hallazgos B y C (límite de logins y administración de usuarios sin local).
