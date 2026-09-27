import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Muestra de componentes (`/dev/ui`) contra el servidor de desarrollo de Vite, en móvil y
 * escritorio: axe sin violaciones, el lector RFID simulado y las capturas.
 */

const CHIP = '170000123456789';

/**
 * Ritmo del lector simulado. Sin retardo, Chrome recibe las teclas a 1-8 ms entre sí. Con
 * `delay: 20` no se obtienen 20 ms: el temporizador de Node en Windows y el protocolo de
 * depuración suman 12 ms de media y picos de 65 ms, y la prueba fallaba 1 de cada 50 veces por
 * el arnés, no por el hook. Los límites exactos (25 ms sí, 120 ms no, pausa de 80 ms no) los
 * cubren las pruebas unitarias con un reloj controlado.
 */
const READER = { delay: 0 };
const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/ui');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Muestra de componentes' }),
  ).toBeVisible();
});

test('axe sin violaciones (WCAG 2.1 A y AA)', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('una ráfaga del lector se busca aunque nada tenga el foco', async ({ page }) => {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.type(CHIP, READER);
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('ultima-busqueda')).toHaveText(`Última búsqueda: ${CHIP} (lector)`);
});

test('una persona tecleando despacio no dispara la búsqueda', async ({ page }) => {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.type(CHIP, { delay: 120 });
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('ultima-busqueda')).toHaveText('Todavía no has buscado.');
});

test('en «Identificador» la lectura queda escrita, no envía el formulario y pasa a «Nombre»', async ({
  page,
}) => {
  const identifier = page.getByLabel('Identificador');
  await identifier.focus();
  await page.keyboard.type(CHIP, READER);
  await page.keyboard.press('Enter');

  await expect(identifier).toHaveValue(CHIP);
  await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
  await expect(page.getByText(/Animal guardado/)).toHaveCount(0);
});

test('captura de la muestra completa', async ({ page }, testInfo) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${capturas}${testInfo.project.name}.png`,
    fullPage: true,
  });
});
