import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import ExcelJS from 'exceljs';

import { RETIRO_NAME, login } from './helpers';

/**
 * Reportes (RPT-02) y gráficas (RPT-03), M8b, en móvil y escritorio con axe:
 *
 * - la lista va en el orden del sistema productivo, y se descarga en Excel el primer reporte de
 *   cada uno: Partos próximos en La Esperanza (doble propósito) e Inventario en El Retiro (ceba);
 * - el reporte de grupos de edad en formato ICA, en pantalla y en Excel;
 * - las gráficas, con su tabla de datos.
 *
 * La API de las pruebas usa la fecha real y el seed el 25/09/2026 (ver la memoria del proyecto):
 * no se afirman cifras que dependan de «hoy», solo la forma y lo que no cambia.
 */

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Títulos de la lista de reportes, en orden. */
async function reportTitles(page: Page): Promise<string[]> {
  const list = page.getByRole('list', { name: 'Reportes disponibles' });
  await expect(list).toBeVisible();
  return list.locator('a .font-bold').allTextContents();
}

/** Descarga con el botón de la página y abre el Excel. */
async function downloadWorkbook(
  page: Page,
  testInfo: TestInfo,
): Promise<{ name: string; book: ExcelJS.Workbook }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar en Excel' }).click(),
  ]);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await readFile(path)).buffer);
  return { name: download.suggestedFilename(), book };
}

/** Filas de una hoja como texto. */
function rowsOf(sheet: ExcelJS.Worksheet | undefined): string[][] {
  const rows: string[][] = [];
  sheet?.eachRow((row) => {
    rows.push(
      (row.values as unknown[])
        .slice(1)
        .map((value) =>
          value === undefined || value === null
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value as string | number),
        ),
    );
  });
  return rows;
}

test.describe('Reportes por sistema productivo (RPT-02, CFG-03 CA1)', () => {
  test('doble propósito: partos próximos primero, y su Excel', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/reports');
    await expect(page.getByText(/finca de doble propósito/i)).toBeVisible();
    const titles = await reportTitles(page);
    expect(titles.slice(0, 3)).toEqual(['Gráficas', 'Partos próximos', 'Nacimientos']);
    expect(titles).toContain('Reporte económico');
    await expectNoViolations(page);

    await page.getByRole('link', { name: /Partos próximos/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Partos próximos' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Partos próximos' })).toBeVisible();
    await expectNoViolations(page);
    const { name, book } = await downloadWorkbook(page, testInfo);
    expect(name).toMatch(/^partos-proximos-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const rows = rowsOf(book.getWorksheet('Partos próximos'));
    expect(rows[0]?.[0]).toBe('Partos próximos');
    expect(rows.find((row) => row[0] === 'Hembra')).toEqual([
      'Hembra',
      'Lote',
      'Servicio',
      'Padre',
      'Parto estimado',
      'Días',
    ]);
  });

  test('ceba: inventario primero, y su Excel', async ({ page }, testInfo) => {
    await login(page, 'retiro.admin', RETIRO_NAME);
    await page.goto('/reports');
    await expect(page.getByText(/finca de levante y ceba/i)).toBeVisible();
    const titles = await reportTitles(page);
    expect(titles.slice(1, 4)).toEqual(['Inventario', 'Vendidos y retirados', 'Reporte económico']);

    await page.getByRole('link', { name: /^Inventario/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inventario' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Por categoría' })).toBeVisible();
    await expectNoViolations(page);
    const { name, book } = await downloadWorkbook(page, testInfo);
    expect(name).toMatch(/^inventario-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Por categoría',
      'Por raza',
      'Por lote',
    ]);
    const rows = rowsOf(book.getWorksheet('Por categoría'));
    expect(rows.find((row) => row[0] === 'Categoría')).toEqual([
      'Categoría',
      'Machos',
      'Hembras',
      'Total',
    ]);
    expect(rows.at(-1)?.[0]).toBe('Total');
  });
});

test.describe('Grupos de edad en formato ICA (08 §2.2)', () => {
  test('en pantalla y en Excel, con la finca y los totales', async ({ page }, testInfo) => {
    await login(page, 'wilmer');
    await page.goto('/reports/inventory-ica');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Grupos de edad (formato ICA)' }),
    ).toBeVisible();
    await expect(page.getByText('Código de predio ICA')).toBeVisible();
    const females = page.getByRole('table', { name: 'Hembras' });
    const males = page.getByRole('table', { name: 'Machos' });
    await expect(females.getByRole('row')).toHaveCount(9); // encabezado, 7 grupos y total
    await expect(males.getByRole('row')).toHaveCount(8); // encabezado, 6 grupos y total
    await expect(males.getByRole('cell', { name: 'Más de 3 años' })).toBeVisible();
    await expectNoViolations(page);

    const { name, book } = await downloadWorkbook(page, testInfo);
    expect(name).toMatch(/^grupos-de-edad-ica-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const rows = rowsOf(book.getWorksheet('Grupos de edad ICA'));
    expect(rows[0]?.[0]).toBe('Inventario por grupos de edad (formato ICA) — Finca La Esperanza');
    expect(rows.find((row) => row[0] === 'Sexo')).toEqual(['Sexo', 'Grupo de edad', 'Animales']);
    expect(rows.at(-1)?.[0]).toBe('Total');
  });
});

test.describe('Gráficas (RPT-03)', () => {
  test('tres gráficas en SVG con su tabla de datos', async ({ page }) => {
    await login(page, 'alvaro');
    await page.goto('/reports');
    await page.getByRole('link', { name: /Gráficas/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Gráficas' })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Evolución del inventario/ })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Nacimientos por mes y sexo/ })).toBeVisible();
    await expect(
      page.getByRole('group', { name: /^Animales activos por categoría/ }),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Leyenda' })).toContainText('Hembras');

    // Con el teclado: el primer mes de la línea dice su cifra debajo.
    await page
      .getByRole('img', { name: /animales \(/ })
      .first()
      .focus();
    await expect(page.getByText(/^\w{3} \d{4}: \d+ animales · /)).toBeVisible();

    await page.getByText('Ver los datos').first().click();
    await expect(page.getByRole('table', { name: 'Animales al cierre de cada mes' })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Animales al cierre de cada mes' }).getByRole('row'),
    ).toHaveCount(13);
    await expectNoViolations(page);
  });
});
