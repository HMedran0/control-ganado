import { expect, test } from '@playwright/test';

import { FARM_NAME, login, logout, seedPassword, submitLogin } from './helpers';

test.describe('sesión (AUT-01, AUT-02)', () => {
  test('alvaro entra, recarga y sigue dentro, sale y queda fuera', async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await expect(page.getByText('Hola, Álvaro.')).toBeVisible();

    // El token de acceso vivía solo en memoria: al recargar se recupera con la cookie.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: FARM_NAME })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // Nada de la sesión queda en el almacenamiento del navegador.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toContain('eyJ');

    await logout(page, testInfo);

    // Tras salir, la cookie ya no sirve: recargar deja en el inicio de sesión.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('una contraseña incorrecta muestra el mensaje del catálogo', async ({ page }) => {
    await page.goto('/login');
    await submitLogin(page, 'yeison', 'contraseña-equivocada');

    await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');

    // Un inicio correcto reinicia el conteo de intentos: repetir la suite no bloquea a yeison.
    await submitLogin(page, 'yeison', seedPassword());
    await expect(page.getByRole('heading', { level: 1, name: FARM_NAME })).toBeVisible();
  });

  test('sin sesión, una ruta protegida lleva al inicio de sesión y luego de vuelta', async ({
    page,
  }) => {
    await page.goto('/alerts');
    await expect(page).toHaveURL(/\/login\?redirect=/);

    await submitLogin(page, 'alvaro', seedPassword());
    await expect(page.getByRole('heading', { level: 1, name: 'Alertas' })).toBeVisible();
  });
});
