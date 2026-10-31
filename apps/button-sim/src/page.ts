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
    .map((d) => `<button class="press" data-code="${escape(d.code)}"><b>${escape(d.code)}</b>${d.label === d.code ? '' : `<span>${escape(d.label)}</span>`}</button>`)
    .join('');
  const options = TRANSPORTS.map((t) => `<option value="${t}"${t === transport ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulador de botones</title>
<style>
  :root { --bg: #f6f7f9; --surface: #fff; --ink: #1b2430; --muted: #5b6676; --line: #d9dee5; --accent: #0f7b6c; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem; }
  h1 { font-size: 1.15rem; margin: 0; }
  select { font-size: 1rem; min-height: 48px; padding: 0 .6rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--surface); color: var(--ink); }
  #status { min-height: 1.5rem; margin: 0; padding: 0 1rem .75rem; color: var(--muted); }
  #status.error { color: #b42318; }
  main { display: grid; grid-template-columns: 1fr; gap: .75rem; padding: 0 1rem 1.5rem; }
  @media (min-width: 600px) { main { grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); } }
  .press { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: .15rem; width: 100%; min-height: 4.5rem; padding: .75rem 1rem; font: inherit; text-align: left; border: 1px solid var(--line); border-left: 6px solid var(--accent); border-radius: .75rem; background: var(--surface); color: var(--ink); touch-action: manipulation; }
  .press b { font-size: 1.25rem; }
  .press span { color: var(--muted); }
  .press:active { background: #e6f2ef; }
  .press:focus-visible, select:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
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
    b.addEventListener('click', () => post('press', { device_code: b.dataset.code }, b.dataset.code + ' enviado'));
  }
  async function post(path, body, ok) {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      status.className = res.ok ? '' : 'error';
      status.textContent = res.ok ? ok : 'Error: ' + data.error;
    } catch (e) {
      status.className = 'error';
      status.textContent = 'Error: ' + e.message;
    }
  }
</script>
</body>
</html>`;
}
