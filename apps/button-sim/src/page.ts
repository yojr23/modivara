import { TRANSPORTS, type TransportName } from './transports.ts';

export interface SimDevice {
  code: string;
  label: string;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Página para el celular: un botón por dispositivo y el selector de canal.
 * Rutas relativas: Caddy la publica bajo /sim.
 */
export function renderPage(devices: readonly SimDevice[], transport: TransportName): string {
  const buttons = devices
    .map((d) => `<button class="press" data-code="${escape(d.code)}">${escape(d.label)}</button>`)
    .join('');
  const options = TRANSPORTS.map((t) => `<option value="${t}"${t === transport ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulador de botones</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #101e33; color: #f7fafc; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem; }
  h1 { font-size: 1.1rem; margin: 0; }
  select { font-size: 1rem; padding: .4rem; border-radius: .5rem; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: .75rem; padding: 0 1rem 1rem; }
  .press { min-height: 5.5rem; font-size: 1.05rem; font-weight: 600; border: 0; border-radius: 1rem; background: #1baa95; color: #101e33; }
  .press:active { transform: scale(.97); }
  .press:focus-visible { outline: 3px solid #f7fafc; outline-offset: 2px; }
  #status { min-height: 1.5rem; padding: 0 1rem 1rem; }
</style>
</head>
<body>
<header>
  <h1>Simulador de botones</h1>
  <label>Canal <select id="transport">${options}</select></label>
</header>
<p id="status" role="status" aria-live="polite"></p>
<main>${buttons}</main>
<script>
  const status = document.getElementById('status');
  const select = document.getElementById('transport');
  select.addEventListener('change', () => post('transport', { transport: select.value }, 'Canal: ' + select.value.toUpperCase()));
  for (const b of document.querySelectorAll('.press')) {
    b.addEventListener('click', () => post('press', { device_code: b.dataset.code }, b.textContent + ' enviado'));
  }
  async function post(path, body, ok) {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      status.textContent = res.ok ? ok : 'Error: ' + data.error;
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  }
</script>
</body>
</html>`;
}
