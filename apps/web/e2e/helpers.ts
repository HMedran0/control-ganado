import { execSync } from 'node:child_process';

import { expect, type Page, type TestInfo } from '@playwright/test';

import { e2eDatabaseUrl } from '../e2e-database.mjs';

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

/** Segunda finca del seed, con numeración reutilizable (08 §3.5). */
export const RETIRO_NAME = 'Finca El Retiro';

/** Inicia sesión desde cero y espera el Inicio de la finca. */
export async function login(page: Page, username: string, farmName = FARM_NAME): Promise<void> {
  await page.goto('/login');
  await submitLogin(page, username, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: farmName })).toBeVisible();
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

/** Tercera finca del seed, vacía, para importar la plantilla (08 §3.8). */
export const NUEVA_NAME = 'Finca La Nueva';

/**
 * Deja La Nueva vacía, como la siembra el seed, para que la importación de la plantilla se pueda
 * repetir sin volver a sembrar toda la base. Solo contra la base de pruebas: `e2eDatabaseUrl` y el
 * propio script exigen que el nombre termine en `_test`.
 */
export function resetNuevaFarm(): void {
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl(process.env) };
  // Una sola cadena: en Windows `pnpm` es un .cmd y solo arranca con `shell` (ver e2e-seed.mjs).
  execSync('pnpm --filter @hato/api run db:seed:nueva:test', { env, stdio: 'pipe' });
}
