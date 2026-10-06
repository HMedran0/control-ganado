import { expect, test, type Locator } from '@playwright/test';

import { isMobile, login } from './helpers';

/**
 * Marca: el producto se llama Arreo (antes «Hato»). Solo se revisan los lugares de la marca —el
 * título de la página, la pantalla de inicio de sesión y el logo de la barra lateral—, nunca el
 * resto de la pantalla: «hato» sigue siendo la palabra común para el conjunto de animales
 * («Inversión del hato activo», «El hato»).
 */

async function saysArreo(place: Locator): Promise<void> {
  await expect(place).toContainText('Arreo');
  await expect(place).not.toContainText('Hato');
}

test('la marca dice Arreo en el título, el inicio de sesión y el logo', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await expect(page).toHaveTitle('Iniciar sesión · Arreo');
  await saysArreo(page.getByRole('main'));

  await login(page, 'alvaro');
  await expect(page).toHaveTitle('Inicio · Arreo');
  if (!isMobile(testInfo)) {
    // En escritorio el logo va arriba de la barra lateral; en el celular no hay barra lateral.
    const sidebar = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('navigation', { name: 'Principal' }) });
    await saysArreo(sidebar.locator('div').first());
  }
});
