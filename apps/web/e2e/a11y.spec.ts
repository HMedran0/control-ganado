import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { isMobile, login, mainNav } from './helpers';

/** WCAG 2.1 A y AA, el mínimo de 06-ux-ui.md §8. */
async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('accesibilidad con axe-core (06 §8)', () => {
  test('inicio de sesión', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await expectNoViolations(page);
  });

  test('inicio de sesión con un error visible', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('Escribe tu usuario o correo.')).toBeVisible();
    await expectNoViolations(page);
  });

  test('layout con sesión: Inicio, Más y Mi cuenta', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await expectNoViolations(page);

    if (isMobile(testInfo)) {
      await mainNav(page).getByRole('link', { name: 'Más' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Más' })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('link', { name: 'Mi cuenta' }).click();
    } else {
      await page.getByRole('link', { name: 'Mi cuenta' }).click();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
    await expectNoViolations(page);
  });

  test('los destinos de la navegación miden al menos 48 px', async ({ page }) => {
    await login(page, 'alvaro');
    const boxes = await mainNav(page)
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect()));
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
  });
});
