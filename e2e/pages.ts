import { expect, type Browser, type Page } from '@playwright/test';
import { authFile, seedPassword, type User } from './support/env';

// Page objects del portal, con selectores por rol y nombre accesible (lo mismo que usa un lector de pantalla).

/** Página nueva con la sesión preparada en global-setup para ese usuario (varios usuarios a la vez en una prueba). */
export async function pageAs(browser: Browser, user: User): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(user) });
  return ctx.newPage();
}

export class LoginPage {
  constructor(readonly page: Page) {}
  readonly alert = () => this.page.getByRole('alert');

  async goto(slug: string) {
    await this.page.goto(`/${slug}`);
    await expect(this.page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  }

  async login(username: string, password = seedPassword()) {
    await this.page.getByLabel('Usuario').fill(username);
    await this.page.getByLabel('Contraseña').fill(password);
    await this.page.getByRole('button', { name: 'Entrar' }).click();
  }
}

export class BoardPage {
  constructor(readonly page: Page) {}
  readonly queue = () => this.page.getByRole('region', { name: 'Cola de llamados' });
  /** Tarjeta de la cola: «Mesa 7, esperando 0 min 05 s, Salón principal, Salón». */
  readonly queueCard = (table: string) => this.queue().getByRole('button', { name: new RegExp(`^${table},`) });
  /** Mesa dibujada en el plano: «Mesa 7: Pendiente, esperando…». */
  readonly planTable = (table: string) => this.page.getByRole('button', { name: new RegExp(`^${table}: `) });

  async goto(slug: string) {
    await this.page.goto(`/${slug}/app/tablero`);
    await expect(this.page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
  }

  async open(table: string) {
    await this.queueCard(table).click();
    await expect(this.page.getByText(table, { exact: true })).toBeVisible(); // hoja de la mesa
  }
}

export class InventoryPage {
  constructor(readonly page: Page) {}
  readonly type = (name: 'Salida' | 'Entrada' | 'Ajuste por conteo') => this.page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name });
  readonly product = (name: string) => this.page.getByRole('radio', { name: new RegExp(`^${name}`) });
  readonly today = () => this.page.getByRole('complementary', { name: 'Hoy' });

  async goto() {
    await this.page.goto('/bar-demo/app/inventario');
    await expect(this.page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
  }

  async createProduct(name: string) {
    await this.page.getByRole('button', { name: 'Nuevo producto' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Nuevo producto' });
    await dialog.getByLabel('Nombre').fill(name);
    await dialog.getByLabel('Unidad').selectOption('bottle');
    await dialog.getByRole('button', { name: 'Crear producto' }).click();
    await expect(dialog).toBeHidden();
  }

  async register(quantity: string, button: RegExp | string) {
    await this.page.getByRole('spinbutton', { name: /^Cantidad/ }).fill(quantity);
    await this.page.getByRole('button', { name: button }).click();
  }
}

export class SpacesPage {
  constructor(readonly page: Page) {}
  readonly status = () => this.page.getByRole('main').getByRole('status');

  async goto(slug: string) {
    await this.page.goto(`/${slug}/app/espacios`);
    await expect(this.page.getByRole('button', { name: 'Revisar y publicar' })).toBeVisible();
  }

  async openSpace(name: string) {
    await this.page.getByRole('navigation', { name: 'Espacios' }).getByRole('button', { name, exact: true }).click();
    await expect(this.page.getByRole('heading', { level: 1, name: new RegExp(name) })).toBeVisible();
  }

  async drawArea(name: string) {
    await this.page.getByRole('complementary', { name: 'Paleta' }).getByRole('button', { name: 'Dibujar área' }).click();
    await this.page.getByLabel('Nombre del área').fill(name);
  }

  async publish(space: string) {
    await this.page.getByRole('button', { name: 'Revisar y publicar' }).click();
    await this.page.getByRole('heading', { name: `Revisar ${space}` }).waitFor();
    await this.page.getByRole('button', { name: 'Publicar plano' }).click();
    await this.page.getByRole('dialog', { name: `Publicar el plano de ${space}` }).getByRole('button', { name: 'Publicar plano' }).click();
    await expect(this.status()).toContainText('Plano publicado');
  }
}
