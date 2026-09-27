import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { isMobile, login, mainNav } from './helpers';

/**
 * Capturas del inicio de sesión y del layout en móvil y escritorio.
 *
 * Quedan en `e2e/capturas/` (ignorado por git); la integración continua las publica siempre
 * como artefacto.
 */
const dir = fileURLToPath(new URL('./capturas/', import.meta.url));

test('capturas de inicio de sesión y layout', async ({ page }, testInfo) => {
  const name = (screen: string) => `${dir}${testInfo.project.name}-${screen}.png`;

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: name('inicio-de-sesion'), fullPage: true });

  await login(page, 'alvaro');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: name('inicio'), fullPage: true });

  if (isMobile(testInfo)) {
    await mainNav(page).getByRole('link', { name: 'Más' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Más' })).toBeVisible();
    await page.screenshot({ path: name('mas'), fullPage: true });
  }
});
