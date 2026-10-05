import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page, type TestInfo } from '@playwright/test';
import ExcelJS from 'exceljs';

import { isMobile, login, seedPassword } from './helpers';

/**
 * Finanzas en la web (M7: ECO-01 a ECO-06, RN-17, RN-20) contra la API y `hato_test` sembrada, en
 * móvil y escritorio, con axe en cada pantalla.
 *
 * Cada prueba prepara sus animales, su lote y su venta por la API, con códigos únicos por corrida
 * y por proyecto: no mueve ninguna cifra del seed y se puede repetir sin volver a sembrar.
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;

type Animal = { id: string; code: string };
type Api = Awaited<ReturnType<typeof adminApi>>;

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${capturas}${testInfo.project.name}-${screen}.png`,
    fullPage: true,
  });
}

/** Cliente de la API con la sesión de alvaro (ADMIN), para preparar datos. */
async function adminApi(testInfo: TestInfo) {
  const baseURL = testInfo.project.use.baseURL;
  const context = await request.newContext({ ...(baseURL === undefined ? {} : { baseURL }) });
  const session = await context.post('/api/v1/auth/login', {
    data: { login: 'alvaro', password: seedPassword() },
  });
  expect(session.ok()).toBe(true);
  const { accessToken } = (await session.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  return {
    context,
    post: async <T>(path: string, body: object) => {
      const response = await context.post(`/api/v1${path}`, { data: body, headers });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as T;
    },
    get: async <T>(path: string) => {
      const response = await context.get(`/api/v1${path}`, { headers });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as T;
    },
  };
}

const tag = (testInfo: TestInfo) => `${isMobile(testInfo) ? 'M' : 'E'}${run}`;

/** Un animal nuevo con código único de esta corrida y este proyecto. */
async function newAnimal(
  api: Api,
  testInfo: TestInfo,
  suffix: string,
  extra: Record<string, unknown> = {},
): Promise<Animal> {
  const breeds = await api.get<{ items: { id: string; name: string }[] }>('/breeds');
  const breedId = breeds.items.find((breed) => breed.name === 'Brahman')?.id;
  const code = `F${tag(testInfo)}${suffix}`.slice(0, 30);
  const animal = await api.post<Animal>('/animals', {
    code,
    sex: 'MALE',
    breedId,
    birthDate: '2025-02-01',
    origin: 'BORN_ON_FARM',
    ...extra,
  });
  return { id: animal.id, code };
}

/** Un animal vendido por la API, para las pruebas de la venta y del OPERATOR. */
const sold = new Map<string, Animal>();

test.describe.serial('finanzas', () => {
  test('gasto por lote: reparto exacto, la parte en la ficha, y al anularlo se recalcula (ECO-02, RN-17)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const lot = await api.post<{ id: string; name: string }>('/lots', {
      name: `Lote gasto ${tag(testInfo)}`,
    });
    const animals: Animal[] = [];
    for (const suffix of ['A', 'B', 'C']) {
      animals.push(await newAnimal(api, testInfo, suffix, { lotId: lot.id }));
    }
    const description = `Sal mineralizada ${tag(testInfo)}`;
    await login(page, 'alvaro');

    await page.goto('/finance/expenses/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Registrar gasto' })).toBeVisible();
    await page.getByLabel('Tipo de gasto').selectOption({ label: 'Alimentación' });
    await page.getByLabel('Monto').fill('100001');
    await page.getByLabel('Descripción').fill(description);
    await page.getByRole('radio', { name: 'Un lote' }).click();
    await page.getByLabel('Lote', { exact: true }).selectOption({ label: lot.name });
    await page.getByRole('radio', { name: 'Partes iguales' }).click();
    await page.getByRole('button', { name: 'Ver el reparto' }).click();
    // $100.001 entre 3: 33.333 a cada uno y el residuo, 2, al primero (ADR-016).
    await expect(page.getByRole('status').filter({ hasText: '3 animales' })).toHaveText(
      `3 animales: $ 33.333 cada uno; ${animals[0]?.code ?? ''} lleva $ 33.335, con el residuo para que la suma dé exacta.`,
    );
    await expectNoViolations(page);
    await capture(page, testInfo, 'finanzas-gasto-lote');
    await page.getByRole('button', { name: 'Registrar gasto' }).click();

    await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible();
    await expect(page.getByText('Gasto registrado.')).toBeVisible();
    await expect(page.getByText(`Lote ${lot.name} · partes iguales · 3 animales`)).toBeVisible();
    const reparto = page.getByRole('table', { name: `Reparto de ${description}` });
    if (!isMobile(testInfo)) {
      await expect(reparto.getByRole('row')).toHaveCount(4);
    }
    await expectNoViolations(page);
    const expenseUrl = page.url();

    // La parte en la ficha del primer animal, pestaña Costos.
    await page
      .getByRole('link', { name: animals[0]?.code ?? '' })
      .first()
      .click();
    await expect(page.getByRole('tab', { name: 'Costos', selected: true })).toBeVisible();
    const costs = page.getByRole('tabpanel');
    await expect(costs.getByRole('link', { name: description })).toBeVisible();
    await expect(costs.getByText('Su parte de $ 100.001 entre 3', { exact: false })).toBeVisible();
    await expect(costs.getByText('$ 33.335').first()).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'finanzas-costos');

    // Anular: el reparto deja de contar y la ficha lo refleja.
    await page.goto(expenseUrl);
    await page.getByRole('button', { name: 'Anular' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo').fill('Se registró dos veces');
    await expectNoViolations(page);
    await dialog.getByRole('button', { name: 'Anular' }).click();
    await expect(page.getByText('Gasto anulado')).toBeVisible();
    await expect(page.getByRole('table', { name: `Reparto de ${description}` })).toHaveCount(0);

    await page.goto(`/animals/${animals[0]?.id ?? ''}?tab=costos`);
    await expect(
      page.getByRole('tabpanel').getByText('No tiene gastos registrados.'),
    ).toBeVisible();
    // Y en los cambios del animal, la anulación con su parte.
    await page.getByRole('tab', { name: 'Cambios' }).click();
    await expect(
      page.getByText(`Álvaro Pérez Castro anuló el gasto ${description}`, { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText('Su parte: $ 33.335 → —')).toBeVisible();
    await expectNoViolations(page);
    await api.context.dispose();
  });

  test('corregir una venta: precio y comprador, y el resultado cambia (ECO-04, ECO-05)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const steer = await newAnimal(api, testInfo, 'V');
    await api.post('/expenses', {
      type: 'VETERINARY',
      date: '2026-09-01',
      amount: '2900000',
      description: `Atención veterinaria ${tag(testInfo)}`,
      allocation: { method: 'DIRECT', animalId: steer.id },
    });
    await api.post(`/animals/${steer.id}/exit`, {
      type: 'SALE',
      date: '2026-09-20',
      sale: { amount: '3200000', buyer: 'Don Rafael' },
    });
    sold.set(testInfo.project.name, steer);
    await login(page, 'alvaro');

    await page.goto('/finance?tab=ventas');
    await expect(page.getByRole('tab', { name: 'Ventas', selected: true })).toBeVisible();
    await page.getByRole('button', { name: `Corregir la venta de ${steer.code}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: `Corregir la venta de ${steer.code}` }),
    ).toBeVisible();
    await dialog.getByLabel('Precio de venta').fill('2800000');
    await dialog.getByLabel('Comprador').fill('Subasta de San Juan');
    await expectNoViolations(page);
    await capture(page, testInfo, 'finanzas-corregir-venta');
    await dialog.getByRole('button', { name: 'Guardar corrección' }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto(`/animals/${steer.id}?tab=costos`);
    const costs = page.getByRole('tabpanel');
    await expect(costs.getByText('Pérdida')).toBeVisible();
    await expect(costs.getByText('-$ 100.000')).toBeVisible();
    await expect(costs.getByText('Subasta de San Juan', { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: 'Cambios' }).click();
    await expect(page.getByText(`Álvaro Pérez Castro corrigió la venta de ${steer.code}`)).toBeVisible();
    await expect(page.getByText('Precio: $ 3.200.000 → $ 2.800.000')).toBeVisible();
    await expectNoViolations(page);
    await api.context.dispose();
  });

  test('el reporte económico en pantalla y en Excel (ECO-06)', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/finance?tab=reporte');
    await expect(page.getByText('Gastos del período', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Inversión del hato activo: \$ / }),
    ).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'finanzas-reporte');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Descargar en Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^reporte-economico-\d{4}-01-01-a-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readFile(path)).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen',
      'Inversión por categoría',
      'Gastos por tipo',
      'Gastos por mes',
      'Ventas',
    ]);
    const sales = workbook.getWorksheet('Ventas');
    expect((sales?.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Fecha',
      'Código',
      'Nombre',
      'Comprador',
      'Precio de venta',
      'Inversión',
      'Resultado',
    ]);
    expect(sales?.rowCount ?? 0).toBeGreaterThan(1);
  });

  test('un OPERATOR no ve montos en ninguna pantalla (RN-20)', async ({ page }, testInfo) => {
    const animal = sold.get(testInfo.project.name);
    test.skip(animal === undefined, 'Depende de la prueba de la venta.');
    await login(page, 'wilmer');
    const money = /\$\s?\d/;

    const screens = [
      '/',
      '/animals?status=exited',
      `/animals/${animal?.id ?? ''}`,
      `/animals/${animal?.id ?? ''}?tab=costos`,
      `/animals/${animal?.id ?? ''}?tab=historial`,
      '/alerts',
      '/record',
      '/reports/births',
      '/finance',
      '/finance?tab=reporte',
      '/finance/expenses/new',
      '/settings/farm',
    ];
    for (const path of screens) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Cargando', { exact: false })).toHaveCount(0);
      const text = await page.locator('main').innerText();
      expect(money.test(text), `${path}: ${text.match(money)?.[0] ?? ''}`).toBe(false);
    }
    // La ficha no tiene Costos ni Cambios, ni entrando por la URL.
    await page.goto(`/animals/${animal?.id ?? ''}?tab=costos`);
    await expect(page.getByRole('tab', { name: 'Costos' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Resumen', selected: true })).toBeVisible();
    await page.goto('/finance');
    await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
    await expectNoViolations(page);
  });
});
