import { expect, test } from '@playwright/test';
import { BoardPage, SpacesPage, pageAs } from './pages';
import { apiAs, json, locationOf, republish } from './support/api';

// L-05 y L-07: en el editor se dibuja un área y se publica mientras otra persona mira el tablero; el tablero la muestra sin recargar.
// Luego se devuelve el plano a como estaba (republicando sin el área).

test('publicar un plano con un área nueva se ve en vivo en el tablero', async ({ browser }) => {
  const area = `Área E2E ${Date.now() % 1e6}`;
  const watcher = new BoardPage(await pageAs(browser, ['bar-demo-pisos', 'admin']));
  await watcher.goto('bar-demo-pisos');
  await expect(watcher.page.getByRole('region', { name: 'Plano de 2º piso' })).toBeVisible();

  const editor = new SpacesPage(await pageAs(browser, ['bar-demo-pisos', 'admin']));
  await editor.goto('bar-demo-pisos');
  await editor.openSpace('2º piso');
  await editor.drawArea(area);
  await editor.publish('2º piso');
  await expect(editor.page.getByRole('button', { name: 'Revisar y publicar' })).toBeVisible(); // vuelve a Diseñar

  // `layout.published` por Socket.IO: el tablero relee los planos.
  await expect(watcher.page.getByRole('region', { name: 'Plano de 2º piso' }).getByText(area)).toBeVisible();

  const api = await apiAs(['bar-demo-pisos', 'admin']);
  const loc = await locationOf(api);
  const zone = (await json<any[]>(api, 'GET', `/locations/${loc}/zones`)).find((z) => z.name === '2º piso');
  await republish(api, loc, zone.id, (els) => els.filter((e) => !(e.type === 'area' && e.name === area)));
  await expect(watcher.page.getByText(area)).toBeHidden();
});

test('un conflicto de edición no pisa el borrador de otra persona', async ({ browser }) => {
  const api = await apiAs(['bar-demo-pisos', 'admin']);
  const loc = await locationOf(api);
  const zone = (await json<any[]>(api, 'GET', `/locations/${loc}/zones`)).find((z) => z.name === 'Terraza');

  const editor = new SpacesPage(await pageAs(browser, ['bar-demo-pisos', 'admin']));
  await editor.goto('bar-demo-pisos');
  await editor.openSpace('Terraza');
  // Otra persona guarda un borrador de la Terraza mientras este editor tiene el plano abierto.
  const { draft, published } = await json(api, 'GET', `/locations/${loc}/layouts/draft?zone_id=${zone.id}`);
  const base = draft ?? published;
  await json(api, 'PUT', `/locations/${loc}/layouts/draft`, { zone_id: zone.id, revision: draft?.revision ?? 0, canvas_width: base.canvas_width, canvas_height: base.canvas_height, elements: base.elements });

  await editor.drawArea('Choque');
  await editor.page.getByRole('button', { name: 'Guardar borrador' }).click();
  const dialog = editor.page.getByRole('dialog', { name: 'Conflicto de edición' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recargar versión actual' }).click();
  await expect(editor.page.getByRole('navigation', { name: 'Espacios' }).getByText('Choque')).toHaveCount(0);

  // Sin dejar borradores colgando: publicar lo vigente.
  await republish(api, loc, zone.id, (els) => els);
});
