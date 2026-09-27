import { expect, type Page, type TestInfo } from '@playwright/test';

/** Finca de referencia del seed (08 §3). */
export const FARM_NAME = 'Finca La Esperanza';

/**
 * Contraseña de los usuarios de demostración. Sale de `SEED_PASSWORD`, la misma que usó
 * `pnpm db:seed`; nunca se escribe en el código.
 */
export function seedPassword(): string {
  const value = process.env.SEED_PASSWORD;
  if (value === undefined || value === '') {
    throw new Error('Define SEED_PASSWORD (la del seed) para las pruebas de extremo a extremo.');
  }
  return value;
}

/** ¿El proyecto es el de móvil? La navegación cambia: barra inferior en lugar de lateral. */
export function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'movil';
}

/** Llena el formulario de inicio de sesión y pulsa Entrar. */
export async function submitLogin(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Usuario').fill(login);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Inicia sesión desde cero y espera el Inicio. */
export async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await submitLogin(page, username, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: FARM_NAME })).toBeVisible();
}

/** Navegación principal visible: la barra inferior en móvil o la lateral en escritorio. */
export function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Principal' });
}

/** Sale por el camino de cada tamaño: «Más → Salir» en móvil, «Salir» en la barra lateral. */
export async function logout(page: Page, testInfo: TestInfo): Promise<void> {
  if (isMobile(testInfo)) {
    await mainNav(page).getByRole('link', { name: 'Más' }).click();
    await page
      .getByRole('navigation', { name: 'Más opciones' })
      .getByRole('button', { name: 'Salir' })
      .click();
  } else {
    await page.getByRole('button', { name: 'Salir' }).click();
  }
  await expect(page).toHaveURL(/\/login/);
}
