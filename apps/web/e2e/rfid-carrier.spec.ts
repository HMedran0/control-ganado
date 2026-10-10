import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { isMobile, login } from './helpers';

/**
 * Dónde va el chip (IDN-01, ajuste previo de M9), en móvil y escritorio con axe: se elige al
 * registrar el animal, la ficha lo muestra («Chip inyectable 982 …») y el diálogo de agregar
 * identificador solo lo pregunta para un chip. El prefijo 982 es de fabricante (ISO 11784): sin
 * advertencia.
 */

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('registrar un animal con chip inyectable y verlo en la ficha', async ({ page }, testInfo) => {
  const project = isMobile(testInfo) ? '1' : '2';
  const stamp = `${Date.now()}`.slice(-10);
  const code = `CHIP-${project}${stamp.slice(-6)}`;
  const chip = `982${project}${stamp}`.slice(0, 15).padEnd(15, '0');

  await login(page, 'alvaro');
  await page.goto('/animals/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Registrar animal' })).toBeVisible();
  await page.getByLabel('Código').fill(code);
  await page.getByRole('radio', { name: 'Hembra' }).click();
  await page.getByLabel('Raza').selectOption({ label: 'Brahman' });
  await page.getByLabel('Fecha de nacimiento').fill('2025-03-15');
  await page.getByLabel('Chip', { exact: true }).fill(chip);
  const carrier = page.getByRole('radiogroup', { name: 'Dónde va el chip' });
  await expect(carrier).toBeVisible();
  await carrier.getByRole('radio', { name: 'Inyectable' }).click();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Registrar animal' }).click();

  await expect(page.getByRole('heading', { level: 1, name: code })).toBeVisible();
  await expect(
    page.getByText(`Chip inyectable ${chip.slice(0, 3)} ${chip.slice(3)}`),
  ).toBeVisible();
  // Prefijo de fabricante: ninguna advertencia de prefijo.
  await expect(page.getByText('Prefijo poco común')).toHaveCount(0);
  await expectNoViolations(page);

  // Al agregar otro identificador, «Dónde va el chip» solo aparece si el tipo es Chip.
  await page.getByRole('button', { name: 'Agregar identificador' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar identificador' });
  await dialog.getByLabel('Tipo').selectOption({ label: 'Chip' });
  await expect(dialog.getByRole('radiogroup', { name: 'Dónde va el chip' })).toBeVisible();
  await dialog.getByLabel('Tipo').selectOption({ label: 'DIN' });
  await expect(dialog.getByRole('radiogroup', { name: 'Dónde va el chip' })).toHaveCount(0);
  await expectNoViolations(page);
});
