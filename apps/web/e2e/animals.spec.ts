import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { isMobile, login } from './helpers';

/**
 * Animales en la web (M4b) contra la API y `hato_test` sembrada, en móvil y escritorio.
 *
 * Las pruebas escriben en la base: el animal de la prueba lleva un código único por corrida y
 * por proyecto, y el cambio de lote en lote alterna el destino según el proyecto para poder
 * repetirse sin tocar las cifras que afirman las demás pruebas (71 preñadas).
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;
/** Lectura del lector RFID en modo teclado: dígitos seguidos, sin pausa, y Enter. */
const READER = { delay: 0 };

type Created = { id: string; code: string; chip: string; tag: string };
const created = new Map<string, Created>();

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

/** Datos únicos del animal de este proyecto. */
function sample(testInfo: TestInfo): Omit<Created, 'id'> {
  const project = isMobile(testInfo) ? 'M' : 'E';
  const digits = `${Date.now()}`.slice(-9);
  return {
    code: `E2E-${project}${run}`.slice(0, 30),
    chip: `170${project === 'M' ? '1' : '2'}${digits}${Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0')}`.slice(0, 15),
    tag: `CH${project}${run}`,
  };
}

async function readChip(page: Page, chip: string): Promise<void> {
  // Sin foco en ningún campo: la lectura la atiende el lector global.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.type(chip, READER);
  await page.keyboard.press('Enter');
}

test.describe.serial('animales', () => {
  test('alvaro registra un animal comprado con valor de compra, le asocia un chip y lo encuentra con el lector', async ({
    page,
  }, testInfo) => {
    const data = sample(testInfo);
    await login(page, 'alvaro');
    await page.goto('/animals/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Registrar animal' })).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel('Código').fill(data.code);
    await page.getByRole('radio', { name: 'Hembra' }).click();
    await page.getByLabel('Raza').selectOption({ label: 'Brahman' });
    await page.getByLabel('Fecha de nacimiento').fill('2024-03-15');
    await page.getByRole('radio', { name: 'Comprado' }).click();
    await page.getByLabel('Fecha de ingreso').fill('2026-08-01');
    await page.getByLabel('Valor de compra').fill('1850000');
    await page.getByLabel('Chapeta').fill(data.tag);
    await capture(page, testInfo, 'formulario-animal');
    await page.getByRole('button', { name: 'Registrar animal' }).click();

    await expect(page.getByRole('heading', { level: 1, name: data.code })).toBeVisible();
    await expect(page.getByText('Animal registrado.')).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    // Chip desde la ficha (IDN-01).
    await page.getByRole('button', { name: 'Agregar identificador' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar identificador' });
    await dialog.getByLabel('Tipo').selectOption({ label: 'Chip' });
    await dialog.getByLabel('Número').fill(data.chip);
    await dialog.getByRole('button', { name: 'Agregar identificador' }).click();
    await expect(
      page.getByText(`Chip ${data.chip.slice(0, 3)} ${data.chip.slice(3)} agregado.`),
    ).toBeVisible();

    // Costos: el valor de compra, solo para ADMIN.
    await page.getByRole('tab', { name: 'Costos' }).click();
    await expect(page.getByText('$ 1.850.000').first()).toBeVisible();

    // El lector, desde otra pantalla, abre la ficha (ANI-05 CA3).
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await readChip(page, data.chip);
    await expect(page.getByRole('heading', { level: 1, name: data.code })).toBeVisible();
    created.set(testInfo.project.name, { ...data, id });
  });

  test('wilmer ve la misma ficha sin Costos ni el valor de compra (RN-20)', async ({
    page,
  }, testInfo) => {
    const animal = created.get(testInfo.project.name);
    test.skip(animal === undefined, 'Depende del animal de la prueba anterior.');
    await login(page, 'wilmer');
    await page.goto(`/animals/${animal?.id}`);
    await expect(page.getByRole('heading', { level: 1, name: animal?.code })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Costos' })).toHaveCount(0);
    await expect(page.getByText('1.850.000')).toHaveCount(0);
    // Ni por la URL.
    await page.goto(`/animals/${animal?.id}?tab=costos`);
    await expect(page.getByRole('tab', { name: 'Resumen', selected: true })).toBeVisible();
    await expect(page.getByText('1.850.000')).toHaveCount(0);
  });

  test('reemplaza una chapeta perdida y encuentra el animal buscando la anterior (IDN-02)', async ({
    page,
  }, testInfo) => {
    const animal = created.get(testInfo.project.name);
    test.skip(animal === undefined, 'Depende del animal de la primera prueba.');
    await login(page, 'alvaro');
    await page.goto(`/animals/${animal?.id}`);
    await page.getByRole('button', { name: `Reemplazar Chapeta ${animal?.tag}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo').selectOption({ label: 'Pérdida' });
    await dialog.getByLabel('Número nuevo').fill(`${animal?.tag}N`);
    await dialog.getByRole('button', { name: 'Guardar reemplazo' }).click();
    await expect(page.getByText(`reemplazado por ${animal?.tag}N`)).toBeVisible();
    await expect(page.getByText('Identificadores anteriores')).toBeVisible();

    // Buscar la chapeta anterior abre la ficha y avisa que es un identificador anterior.
    await page.goto(isMobile(testInfo) ? '/animals' : '/');
    await page.getByRole('searchbox', { name: 'Buscar animal' }).fill(animal?.tag ?? '');
    await page.getByRole('searchbox', { name: 'Buscar animal' }).press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: animal?.code })).toBeVisible();
    await expect(page.getByText('Identificador anterior')).toBeVisible();
  });

  test('filtrar «Preñadas» muestra 71 y la URL conserva el filtro al recargar (ANI-06 CA1)', async ({
    page,
  }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/animals');
    await expect(page.getByText(/\d+ animales/)).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'listado');

    await page.getByRole('button', { name: 'Filtrar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Filtrar animales' });
    await dialog.getByRole('checkbox', { name: 'Preñadas' }).check();
    await dialog.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(page.getByText('71 animales')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('tags')).toBe('PREGNANT');
    if (!isMobile(testInfo)) {
      // La tabla cabe entera: sin desplazamiento de lado para ver el peso o las alertas.
      const overflow = await page
        .getByRole('table', { name: 'Animales' })
        .evaluate((table) => table.scrollWidth - (table.parentElement?.clientWidth ?? 0));
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.reload();
    await expect(page.getByText('71 animales')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quitar filtro Preñadas' })).toBeVisible();
    await capture(page, testInfo, 'listado-prenadas');
  });

  test('cambia de lote a 3 animales en lote (CLS-02 CA2)', async ({ page }, testInfo) => {
    // Cada proyecto mueve los mismos 3 animales de levante a un lote distinto, así la prueba
    // siempre cambia algo y se puede repetir.
    const target = isMobile(testInfo) ? 'Toros' : 'Levante';
    await login(page, 'wilmer');
    await page.goto('/animals?category=YOUNG_MALE');
    await expect(page.getByText(/\d+ animales/)).toBeVisible();
    const boxes = page.getByRole('checkbox', { name: /^Seleccionar (?!todos)/ });
    for (const index of [0, 1, 2]) await boxes.nth(index).check();
    await expect(page.getByText('3 animales seleccionados')).toBeVisible();
    await page.getByRole('button', { name: 'Cambiar de lote' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cambiar de lote' });
    await dialog.getByLabel('Lote nuevo').selectOption({ label: target });
    await dialog.getByRole('button', { name: 'Cambiar de lote' }).click();
    await expect(page.getByRole('status').filter({ hasText: `al lote ${target}` })).toBeVisible();
    await expect(page.getByText('3 animales seleccionados')).toHaveCount(0);
  });

  test('ficha: cada pestaña sin violaciones de axe, con capturas; la barra de pestañas cabe en móvil', async ({
    page,
  }, testInfo) => {
    await login(page, 'alvaro');
    // Una vaca preñada: tiene Reproducción, Genealogía con crías e Historial largo.
    await page.goto('/animals?category=COW&tags=PREGNANT');
    const first = page
      .getByRole(isMobile(testInfo) ? 'list' : 'table', { name: 'Animales' })
      .getByRole('link')
      .first();
    await first.click();
    await expect(page.getByRole('tab', { name: 'Resumen', selected: true })).toBeVisible();

    if (isMobile(testInfo)) {
      // La barra se desplaza dentro de sí misma: la página no se ensancha.
      const widths = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.page).toBeLessThanOrEqual(widths.viewport);
      for (const tab of await page.getByRole('tab').all()) {
        expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
      }
    }

    for (const [name, slug] of [
      ['Resumen', 'resumen'],
      ['Reproducción', 'reproduccion'],
      ['Genealogía', 'genealogia'],
      ['Costos', 'costos'],
      ['Historial', 'historial'],
    ] as const) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();
      if (slug === 'historial')
        await expect(page.getByRole('list', { name: /^Historial de/ })).toBeVisible();
      await expectNoViolations(page);
      await capture(page, testInfo, `ficha-${slug}`);
    }

    if (isMobile(testInfo)) {
      // Al entrar directo a la última pestaña, queda a la vista dentro de la barra.
      await page.reload();
      const tab = page.getByRole('tab', { name: 'Historial', selected: true });
      await expect(tab).toBeInViewport();
      await capture(page, testInfo, 'ficha-pestanas-movil');
    }
  });
});
