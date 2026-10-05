import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { isMobile, login, RETIRO_NAME } from './helpers';

/**
 * Numeración reutilizable, salida, archivo y auditoría (M4c) en la Finca El Retiro del seed
 * (08 §3.5), en móvil y escritorio, con axe en cada pantalla nueva.
 *
 * Cada proyecto usa números propios de esta corrida, así las pruebas se pueden repetir sin
 * resembrar y no tocan las cifras de El Retiro que afirma la prueba del seed.
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now() % 100_000}`.padStart(5, '0');

type Numbers = {
  reused: string;
  renamed: string;
  archived: string;
  tagged: string;
  tagHolder: string;
};
/** Números de este proyecto; solo dígitos, como los numera la finca. */
function numbers(testInfo: TestInfo): Numbers {
  const project = isMobile(testInfo) ? '1' : '2';
  return {
    reused: `9${project}${run}1`,
    renamed: `9${project}${run}2`,
    archived: `9${project}${run}3`,
    tagged: `9${project}${run}4`,
    tagHolder: `9${project}${run}5`,
  };
}

/** Animal vendido del primer paso, para revertir su salida después. */
const soldIds = new Map<string, string>();

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

async function registerAnimal(page: Page, code: string, visualTag?: string): Promise<string> {
  await page.goto('/animals/new');
  await page.getByRole('radio', { name: 'Nació en la finca' }).click();
  await page.getByRole('radio', { name: 'Hembra' }).click();
  await page.getByLabel('Raza').selectOption({ label: 'Brahman' });
  await page.getByLabel('Fecha de nacimiento').fill('2025-06-10');
  await page.getByLabel('Código').fill(code);
  if (visualTag !== undefined) await page.getByLabel('Chapeta').fill(visualTag);
  await page.getByRole('button', { name: 'Registrar animal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: code })).toBeVisible();
  const id = /\/animals\/([^/?]+)/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`No se abrió la ficha de ${code}.`);
  return id;
}

async function search(page: Page, testInfo: TestInfo, q: string): Promise<void> {
  await page.goto(isMobile(testInfo) ? '/animals' : '/');
  await page.getByRole('searchbox', { name: 'Buscar animal' }).fill(q);
  await page.getByRole('searchbox', { name: 'Buscar animal' }).press('Enter');
}

test.describe.serial('numeración reutilizable (El Retiro)', () => {
  test('vende un animal y le da su número a otro; la búsqueda abre el activo (ANI-04, ANI-10, ANI-11)', async ({
    page,
  }, testInfo) => {
    const { reused } = numbers(testInfo);
    await login(page, 'retiro.admin', RETIRO_NAME);
    const soldId = await registerAnimal(page, reused);
    soldIds.set(testInfo.project.name, soldId);

    await page.getByRole('button', { name: 'Registrar salida' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Precio de venta').fill('3200000');
    await dialog.getByLabel('Comprador').fill('Comprador de prueba');
    await expectNoViolations(page);
    await capture(page, testInfo, 'salida-animal');
    await dialog.getByRole('button', { name: 'Registrar salida' }).click();
    await expect(page.getByText(`Salida de ${reused} registrada.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revertir salida' })).toBeVisible();

    // El mismo número, ahora para un animal nuevo.
    const freshId = await registerAnimal(page, reused);
    await expect(
      page.getByText(new RegExp(`Este número lo tuvo antes ${reused} · vendido el`)),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: `Abrir la ficha de ${reused}` })).toHaveAttribute(
      'href',
      `/animals/${soldId}`,
    );
    await expectNoViolations(page);
    await capture(page, testInfo, 'numero-anterior');

    // La búsqueda exacta del número abre la ficha del activo, no la del vendido.
    await search(page, testInfo, reused);
    await expect(page).toHaveURL(new RegExp(`/animals/${freshId}`));
    await expect(page.getByText(new RegExp(`Este número lo tuvo antes ${reused}`))).toBeVisible();
  });

  test('revertir la salida con el número ocupado pide un código nuevo (IDN-06 CA3)', async ({
    page,
  }, testInfo) => {
    const { reused, renamed } = numbers(testInfo);
    const soldId = soldIds.get(testInfo.project.name);
    test.skip(soldId === undefined, 'Depende de la prueba anterior.');
    await login(page, 'retiro.admin', RETIRO_NAME);
    await page.goto(`/animals/${soldId}`);
    await expect(page.getByText(`Su número ${reused} lo tiene hoy otro animal`)).toBeVisible();

    await page.getByRole('button', { name: 'Revertir salida' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Revertir salida' }).click();
    await expect(
      dialog.getByText(new RegExp(`El código ${reused} ya lo tiene el animal activo`)),
    ).toBeVisible();
    await expect(dialog.getByRole('link', { name: `Abrir la ficha de ${reused}` })).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'revertir-conflicto');

    await dialog.getByLabel('Código nuevo').fill(renamed);
    await dialog.getByRole('button', { name: 'Revertir salida' }).click();
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
    await expect(page.getByText(`${reused} volvió al inventario.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar salida' })).toBeVisible();
  });

  test('archiva con motivo y restaura desde Configuración → Archivados (ANI-03)', async ({
    page,
  }, testInfo) => {
    const { archived } = numbers(testInfo);
    await login(page, 'retiro.admin', RETIRO_NAME);
    await registerAnimal(page, archived);

    await page.getByRole('button', { name: 'Archivar' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo').fill('Registro duplicado por error');
    await expectNoViolations(page);
    await dialog.getByRole('button', { name: 'Archivar animal' }).click();
    await expect(page.getByText(`${archived} quedó archivado.`)).toBeVisible();
    await expect(page.getByText('Registro duplicado por error')).toBeVisible();

    await page.goto('/settings/archived');
    await expect(page.getByRole('heading', { level: 1, name: 'Archivados' })).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'archivados');
    await page.getByRole('link', { name: new RegExp(`^${archived}`) }).click();

    await page.getByRole('button', { name: 'Restaurar animal' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar animal' }).click();
    await expect(page.getByText(`${archived} quedó restaurado.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archivar' })).toBeVisible();
  });

  test('la pestaña «Cambios» cuenta la salida y la reversión en lenguaje de finca (AUD-01)', async ({
    page,
  }, testInfo) => {
    const { renamed } = numbers(testInfo);
    const soldId = soldIds.get(testInfo.project.name);
    test.skip(soldId === undefined, 'Depende de la primera prueba.');
    await login(page, 'retiro.admin', RETIRO_NAME);
    await page.goto(`/animals/${soldId}?tab=cambios`);

    const panel = page.getByRole('tabpanel');
    await expect(
      panel.getByText(`Administración El Retiro revirtió la salida del animal ${renamed}`),
    ).toBeVisible();
    await expect(
      panel.getByText(`Administración El Retiro registró la salida del animal ${renamed}`),
    ).toBeVisible();
    await expect(panel.getByText('Tipo de salida: Venta', { exact: true })).toBeVisible();
    await expect(panel.getByText('Tipo de salida: Venta → —', { exact: true })).toBeVisible();
    await expect(panel.getByText(/Administración El Retiro/).first()).toBeVisible();
    await expect(panel).not.toContainText('3200000');
    await expect(panel).not.toContainText('3.200.000');
    await expectNoViolations(page);
    await capture(page, testInfo, 'cambios');
  });
  test('revertir con el número libre pero la chapeta ocupada: revierte y avisa (IDN-06 CA3)', async ({
    page,
  }, testInfo) => {
    const { tagged, tagHolder } = numbers(testInfo);
    await login(page, 'retiro.admin', RETIRO_NAME);
    const soldId = await registerAnimal(page, tagged, tagged);
    await page.getByRole('button', { name: 'Registrar salida' }).click();
    const exitDialog = page.getByRole('dialog');
    await exitDialog.getByLabel('Precio de venta').fill('2500000');
    await exitDialog.getByRole('button', { name: 'Registrar salida' }).click();
    await expect(page.getByText(`Salida de ${tagged} registrada.`)).toBeVisible();

    // Otro animal, con otro número, recibe la chapeta liberada.
    await registerAnimal(page, tagHolder, tagged);

    await page.goto(`/animals/${soldId}`);
    await page.getByRole('button', { name: 'Revertir salida' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revertir salida' }).click();
    await expect(page.getByText(`${tagged} volvió al inventario.`)).toBeVisible();
    await expect(
      page.getByText(
        `El identificador ${tagged} ya lo tiene el animal ${tagHolder}: quedó retirado en este animal.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: tagged })).toBeVisible();
    await expectNoViolations(page);
  });
});
