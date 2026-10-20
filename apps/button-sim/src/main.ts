import { createServer } from 'node:http';

// Simulador de gateway (TECH-001 §16.6). Proceso aparte: habla con la API solo por HTTP/MQTT, como un gateway real.
const port = Number(process.env.SIM_PORT ?? 4000);

const page = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulador</title>
<h1>Simulador</h1>
</html>`;

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(port, () => console.log(`button-sim escuchando en :${port}`));
