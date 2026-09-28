import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import ExcelJS from 'exceljs';

import { isMobile, login, seedPassword, submitLogin } from './helpers';

/**
 * M4d en móvil y escritorio, con axe en cada pantalla nueva: importar el inventario (ANI-09),
 * exportar el listado (ANI-06 CA4), la hoja de etiquetas con QR (IDN-03) y las sesiones
 * activas (AUT-11).
 *
 * La importación de verdad de la plantilla corre solo en escritorio (06 §5.6 la diseña para
 * escritorio) y en la Finca La Nueva del seed (08 §3.7), que está vacía: sus códigos chocarían
 * con los de La Esperanza. Como las demás pruebas de la finca de referencia, pide el seed recién
 * cargado (`test:e2e:seed`).
 */

const NUEVA_NAME = 'Finca La Nueva';
const TEMPLATE = fileURLToPath(
  new URL('../../../docs/referencia/plantilla-importacion.xlsx', import.meta.url),
);
const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));

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

/** Abre Configuración → Importar inventario. */
async function openImport(page: Page): Promise<void> {
  await page.goto('/settings/import');
  await expect(page.getByRole('heading', { level: 1, name: 'Importar inventario' })).toBeVisible();
}

test.describe('importar inventario (ANI-09)', () => {
  test('la plantilla de referencia: 11 filas entran y la 13 muestra su error', async ({
    page,
  }, testInfo) => {
    await login(page, 'nueva.admin', NUEVA_NAME);
    await openImport(page);
    await expectNoViolations(page);

    await page.getByLabel('Archivo (.xlsx o .csv, hasta 5 MB)').setInputFiles(TEMPLATE);
    await expect(
      page.getByRole('heading', { name: '3. Revisa la simulación de plantilla-importacion.xlsx' }),
    ).toBeVisible();
    const problems = page.getByRole('list', { name: 'Filas con problemas' });
    await expect(problems.getByText('Código madre: La madre 012 es macho.')).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'importar-simulacion');

    // En móvil solo la simulación: la importación de verdad se hace una vez, en escritorio.
    if (isMobile(testInfo)) return;
    await expect(page.getByText('Listas para importar').locator('..')).toContainText('7');
    await expect(page.getByText('Con advertencias').locator('..')).toContainText('4');
    await expect(page.getByText('Con errores').locator('..')).toContainText('1');

    await page.getByRole('radio', { name: 'Errores (1)' }).click();
    await expect(problems.getByRole('listitem').filter({ hasText: /^Fila/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Importar 11 animales' }).click();
    await expect(page.getByText('11 animales importados · 1 fila por corregir')).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'importar-resultado');

    // Los animales quedaron en la finca, con lo del archivo.
    await page.getByRole('link', { name: 'Ver los animales' }).click();
    await expect(page.getByText('11 animales')).toBeVisible();
  });

  test('un archivo con un código repetido dentro del mismo archivo', async ({ page }, testInfo) => {
    const file = testInfo.outputPath('repetidos.csv');
    await writeFile(
      file,
      [
        'Código;Nombre;Sexo;Raza;Fecha de nacimiento;Lote',
        `R${testInfo.project.name}-5;Uno;Hembra;Brahman;01/02/2023;Paridas`,
        `r${testInfo.project.name}-5 ;Dos;Macho;Brahman;01/03/2023;Levante`,
      ].join('\n'),
      'utf8',
    );
    await login(page, 'nueva.admin', NUEVA_NAME);
    await openImport(page);
    await page.getByLabel('Archivo (.xlsx o .csv, hasta 5 MB)').setInputFiles(file);

    const problems = page.getByRole('list', { name: 'Filas con problemas' });
    await expect(problems.getByText(/está repetido en la fila 3 de este archivo/)).toBeVisible();
    await expect(problems.getByText(/está repetido en la fila 2 de este archivo/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar 0 animales' })).toBeDisabled();
    await expectNoViolations(page);
    await capture(page, testInfo, 'importar-repetidos');
  });
});

test.describe('exportar el listado (ANI-06 CA4)', () => {
  /** Pulsa «Excel» y lee el archivo que baja. */
  async function exportList(page: Page, testInfo: TestInfo): Promise<ExcelJS.Worksheet> {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^animales-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readFile(path)).buffer);
    const sheet = workbook.getWorksheet('Animales');
    if (sheet === undefined) throw new Error('El archivo no tiene la hoja «Animales».');
    return sheet;
  }

  const header = (sheet: ExcelJS.Worksheet): string[] =>
    (sheet.getRow(1).values as unknown[]).slice(1) as string[];

  test('con filtros, y sin el valor de compra para OPERATOR', async ({ page }, testInfo) => {
    await login(page, 'wilmer');
    await page.goto('/animals?sex=FEMALE&category=COW');
    const total = page.getByText(/^\d+ animales$/);
    await expect(total).toBeVisible();
    const count = Number((await total.textContent())?.split(' ')[0]?.replace('.', ''));

    const sheet = await exportList(page, testInfo);
    expect(header(sheet)).not.toContain('Valor de compra');
    expect(sheet.rowCount - 1).toBe(count);
    const names = header(sheet);
    const sex = names.indexOf('Sexo') + 1;
    const category = names.indexOf('Categoría') + 1;
    const birth = names.indexOf('Fecha de nacimiento') + 1;
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      expect(sheet.getRow(row).getCell(sex).value).toBe('Hembra');
      expect(sheet.getRow(row).getCell(category).value).toBe('Vaca');
      expect(sheet.getRow(row).getCell(birth).value).toBeInstanceOf(Date);
    }
  });

  test('el ADMIN sí recibe el valor de compra', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/animals');
    const sheet = await exportList(page, testInfo);
    expect(header(sheet)).toContain('Valor de compra');
  });
});

test.describe('hoja de etiquetas con QR (IDN-03)', () => {
  test('desde el listado, con la vista de impresión', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/animals?category=COW&tags=PREGNANT');
    await page.getByRole('link', { name: 'Etiquetas' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Etiquetas con QR' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /etiquetas? · \d+ hojas?/ }),
    ).toBeVisible();
    const first = page.getByRole('article').first();
    await expect(first.getByRole('img', { name: /^QR de la ficha de / })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('radio', { name: 'A4' }).click();
    await page.getByRole('radio', { name: 'Tarjetas (2 × 4)' }).click();
    await expect(page).toHaveURL(/paper=a4/);
    await expect(page).toHaveURL(/format=card/);

    // Vista de impresión: solo las hojas, sin la navegación ni los controles.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Etiquetas con QR' })).toBeHidden();
    await expect(first).toBeVisible();
    await capture(page, testInfo, 'etiquetas-impresion');
    await page.emulateMedia({ media: 'screen' });
  });

  test('el QR de la ficha abre la ficha con su ruta corta', async ({ page }) => {
    await login(page, 'wilmer');
    await page.goto('/animals?category=COW');
    // Los ids son UUIDv7: empiezan por «0» hasta dentro de muchos años. Así no se toma
    // «Nuevo animal» ni otro enlace de la pantalla.
    await page.locator('main a[href^="/animals/0"]').filter({ visible: true }).first().click();
    const qr = page.getByRole('img', { name: /^QR de la ficha de / });
    await expect(qr).toBeVisible();
    const id = /\/animals\/([^/?]+)/.exec(page.url())?.[1];
    // El operario ve el QR pero no imprime etiquetas (solo ADMIN).
    await expect(page.getByRole('link', { name: 'Imprimir etiqueta' })).toHaveCount(0);

    await page.goto(`/a/${id}`);
    await expect(page).toHaveURL(new RegExp(`/animals/${id}$`));
  });
});

test.describe('sesiones activas (AUT-11)', () => {
  test('cerrar las demás sesiones saca al otro equipo', async ({ browser, page }, testInfo) => {
    // Otro equipo: un contexto aparte tiene su propia cookie de refresco.
    const other = await browser.newContext({ ...testInfo.project.use });
    const otherPage = await other.newPage();
    await login(otherPage, 'yeison');

    await login(page, 'yeison');
    await page.goto('/account');
    const sessions = page.getByRole('list', { name: 'Sesiones abiertas' });
    await expect(sessions.getByText('Este equipo', { exact: true })).toBeVisible();
    await expect(sessions.getByRole('listitem')).not.toHaveCount(1);
    await expectNoViolations(page);
    await capture(page, testInfo, 'mi-cuenta-sesiones');

    await page.getByRole('button', { name: 'Cerrar las demás sesiones' }).click();
    const dialog = page.getByRole('dialog', { name: '¿Cerrar las demás sesiones?' });
    await expectNoViolations(page);
    await dialog.getByRole('button', { name: 'Cerrar las demás sesiones' }).click();
    await expect(page.getByText(/^Se cerr(ó|aron) \d+ sesi(ón|ones)\.$/)).toBeVisible();
    await expect(sessions.getByRole('listitem')).toHaveCount(1);

    // El otro equipo pierde el acceso: al volver a cargar, pide iniciar sesión.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/);
    await submitLogin(otherPage, 'yeison', seedPassword());
    await expect(otherPage).not.toHaveURL(/\/login/);
    await other.close();
  });
});
