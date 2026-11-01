# Pruebas E2E (Playwright)

Prueban el portal de punta a punta contra la demo de Docker: navegador real (el Chrome instalado, `channel: 'chrome'`), API real, Socket.IO y base sembrada.

```bash
docker compose up --build -d   # stack completo en http://localhost
pnpm seed                      # o el comando de seed del README dentro del contenedor api
pnpm test:e2e                  # informe en e2e/report (pnpm exec playwright show-report e2e/report)
```

- **Credenciales:** `SEED_PASSWORD` del entorno o de `.env` (la misma del seed). Otra URL: `E2E_BASE_URL=http://... pnpm test:e2e`.
- **Sesiones:** `global-setup.ts` inicia sesión una vez por usuario y guarda las cookies en `e2e/.auth/` (fuera de git). La API limita a 30 logins por IP cada 15 min; una corrida usa unos 13. Si se agota: esperar o `docker compose restart api`.
- **Pulsaciones:** la primera corrida crea, como superadmin, un «Gateway E2E» en Bar Demo y guarda su id y clave en `e2e/.auth/`; los botones `btn-NN` del seed se pulsan por `POST /api/v1/device-events`.
- **Datos:** las pruebas usan la base de demo. Cierran los llamados que abren, desactivan el producto y el usuario que crean y republican los planos sin las áreas de prueba; los llamados y movimientos de prueba quedan en el historial.
- **Un solo worker:** comparten la base y una prueba reinicia la API (`docker compose restart api`).

| Archivo | Cubre (PLAN-001) |
|---|---|
| `auth.spec.ts` | F1-16: login correcto y erróneo, bloqueo a los 5 fallos, salir, aislamiento entre negocios (UI y API) |
| `service-call.spec.ts` | F3-16 / L-07: pulsación → plano y cola → reconocer → finalizar en dos tableros a la vez → historial; pulsación repetida; reconexión tras reiniciar la API; interruptor «Sonido» (F3-13) |
| `inventory.spec.ts` | F4-11: alta de producto, entrada, salida (y saldo insuficiente), ajuste por conteo, historial y API coherentes; staff sin inventario |
| `inventory-settings.spec.ts` | F4-10: crear lugar y motivo «E2E …», verlo en el registro rápido, desactivarlo y comprobar que ya no se ofrece (el lugar no se puede borrar y queda en la demo) |
| `history.spec.ts` | F3-14 / F3-16 «→ historial»: llamado tomado y cerrado por Barra → fila con quién tomó y cerró → detalle con línea de tiempo |
| `users.spec.ts` | F1-15: admin crea un usuario «E2E …» con local y rol, lo ve en la lista, le cambia el rol y lo desactiva (sin iniciar sesión con él) |
| `metrics.spec.ts` | F5-13: total de llamados de hoy en pantalla = historial; saldo en métricas = inventario |
| `mqtt.spec.ts` | Q-01: pulsación publicada por MQTT con el usuario del gateway (`scripts/mqtt-user.sh`, `mosquitto_pub` dentro del contenedor) → tablero → cerrar |
| `spaces.spec.ts` | L-05 / L-07: publicar un área mientras otro mira el tablero; conflicto de edición (409) sin pisar el borrador ajeno; desactivar una mesa (sale del borrador) y 409 si tiene botón |

Fuera por ahora: la consola de superadmin (F2-15, sin pantalla) y el historial de llamados en pantalla (F3-14).
