import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { isMobile, login, mainNav } from './helpers';

/** Enlaces de navegación visibles donde cada tamaño los muestra. */
async function navigationLinks(page: Page, testInfo: TestInfo) {
  if (isMobile(testInfo)) {
    await mainNav(page).getByRole('link', { name: 'Más' }).click();
    return page.getByRole('navigation', { name: 'Más opciones' }).getByRole('link');
  }
  return mainNav(page).getByRole('link');
}

test.describe('navegación por rol (RN-20)', () => {
  test('wilmer (operario) no ve Finanzas ni Configuración', async ({ page }, testInfo) => {
    await login(page, 'wilmer');

    const links = await navigationLinks(page, testInfo);
    await expect(links.first()).toBeVisible();
    await expect(links.filter({ hasText: 'Finanzas' })).toHaveCount(0);
    await expect(links.filter({ hasText: 'Configuración' })).toHaveCount(0);

    // Por URL tampoco: ve el aviso en lugar de la sección.
    await page.goto('/finance');
    await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
  });

  test('alvaro (administrador) sí ve Finanzas y Configuración', async ({ page }, testInfo) => {
    await login(page, 'alvaro');

    const links = await navigationLinks(page, testInfo);
    await expect(links.filter({ hasText: 'Finanzas' })).toHaveCount(1);
    await expect(links.filter({ hasText: 'Configuración' })).toHaveCount(1);

    await links.filter({ hasText: 'Finanzas' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Finanzas' })).toBeVisible();
    await expect(page.getByText('Esta sección es solo para administradores.')).toHaveCount(0);
  });
});
