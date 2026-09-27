import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { isMobile, login, mainNav } from './helpers';

/**
 * Configuración (M3) contra la API y la base sembrada.
 *
 * Estas pruebas escriben en la base: usan nombres únicos por corrida y crean su propio lote y
 * su propia vacuna antes de modificarlos, para poder repetirse sin tocar los datos del seed.
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
/** Sufijo único de la corrida. */
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000).toString(36)}`;

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function openSettings(page: Page, isMobileProject: boolean): Promise<void> {
  if (isMobileProject) {
    await mainNav(page).getByRole('link', { name: 'Más' }).click();
    await page
      .getByRole('navigation', { name: 'Más opciones' })
      .getByRole('link', { name: 'Configuración' })
      .click();
  } else {
    await mainNav(page).getByRole('link', { name: 'Configuración' }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
}

test.describe('Configuración como administrador', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, 'alvaro');
    await openSettings(page, isMobile(testInfo));
  });

  test('crea una raza: la gestación se propone según el grupo', async ({ page }) => {
    await page.getByRole('link', { name: /Razas/ }).click();
    await page.getByRole('link', { name: 'Nueva raza' }).click();

    const name = `Raza e2e ${run}`;
    await page.getByLabel('Nombre').fill(name);
    await page.getByRole('radio', { name: 'Cebuino' }).click();
    await expect(page.getByLabel('Gestación (días)')).toHaveValue('293');
    await page.getByRole('radio', { name: 'Europeo' }).click();
    await expect(page.getByLabel('Gestación (días)')).toHaveValue('283');
    await page.getByRole('button', { name: 'Guardar raza' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Razas' })).toBeVisible();
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('283 días').filter({ visible: true }).first()).toBeVisible();
  });

  test('crea un ciclo de vacunación con sus vacunas', async ({ page }) => {
    await page.getByRole('link', { name: /Ciclos de vacunación/ }).click();
    await page.getByRole('link', { name: 'Nuevo ciclo' }).click();

    const name = `Ciclo e2e ${run}`;
    await page.getByLabel('Nombre').fill(name);
    // Un año distinto por corrida (2030–2089) para no cruzarse con las corridas anteriores.
    const year = 2030 + (Date.now() % 60);
    await page.getByLabel('Inicio').fill(`${year}-05-03`);
    await page.getByLabel('Fin').fill(`${year}-06-21`);
    await page.getByRole('checkbox', { name: 'Aftosa' }).check();
    await page.getByRole('checkbox', { name: 'Rabia silvestre' }).check();
    await page.getByRole('button', { name: 'Guardar ciclo' }).click();

    // Si aun así se cruza con otro ciclo, se guarda igual y lo advierte.
    const back = page.getByRole('link', { name: 'Volver a ciclos' });
    const list = page.getByRole('heading', { level: 1, name: 'Ciclos de vacunación' });
    await expect(back.or(list)).toBeVisible();
    if (await back.isVisible()) await back.click();

    await expect(list).toBeVisible();
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
  });

  test('desactiva un lote y lo puede deshacer', async ({ page }) => {
    await page.getByRole('link', { name: /Lotes/ }).click();
    await page.getByRole('link', { name: 'Nuevo lote' }).click();
    const name = `Lote e2e ${run}`;
    await page.getByLabel('Nombre').fill(name);
    await page.getByRole('button', { name: 'Guardar lote' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lotes' })).toBeVisible();

    // Un lote recién creado no tiene animales: se desactiva de una vez, con «Deshacer».
    await page
      .getByRole('button', { name: `Desactivar ${name}` })
      .first()
      .click();
    await expect(page.getByText('Lote desactivado').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deshacer' })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Mostrar desactivados' }).check();
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: `Activar ${name}` }).first()).toBeVisible();
  });

  test('un lote con animales advierte antes de desactivarlo', async ({ page }) => {
    await page.getByRole('link', { name: /Lotes/ }).click();
    // «Paridas» es un lote del seed con animales activos: se cancela para no tocarlo.
    await page.getByRole('button', { name: 'Desactivar Paridas' }).first().click();
    await expect(page.getByText(/animales siguen en este lote/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Desactivar de todos modos' })).toHaveCount(0);
  });

  test('axe sin violaciones en Configuración y capturas', async ({ page }, testInfo) => {
    const shot = async (screen: string) => {
      await page.screenshot({
        path: `${capturas}${testInfo.project.name}-configuracion-${screen}.png`,
        fullPage: true,
      });
    };
    await expectNoViolations(page);
    await shot('indice');

    const pages: [RegExp, string, string][] = [
      [/Finca y parámetros/, 'Finca y parámetros', 'finca'],
      [/Razas/, 'Razas', 'razas'],
      [/Vacunas/, 'Vacunas', 'vacunas'],
      [/Ciclos de vacunación/, 'Ciclos de vacunación', 'ciclos'],
      [/Lotes/, 'Lotes', 'lotes'],
      [/Etiquetas/, 'Etiquetas', 'etiquetas'],
      [/Usuarios/, 'Usuarios', 'usuarios'],
    ];
    for (const [link, heading, screen] of pages) {
      await page.getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText('Cargando…')).toHaveCount(0);
      await expectNoViolations(page);
      await shot(screen);
      await page.getByRole('link', { name: 'Configuración', exact: true }).first().click();
    }

    // Formularios nuevos.
    for (const [path, heading, screen] of [
      ['/settings/breeds/new', 'Nueva raza', 'nueva-raza'],
      ['/settings/vaccines/new', 'Nueva vacuna', 'nueva-vacuna'],
      ['/settings/cycles/new', 'Nuevo ciclo', 'nuevo-ciclo'],
      ['/settings/users/new', 'Nuevo usuario', 'nuevo-usuario'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expectNoViolations(page);
      await shot(screen);
    }
  });
});

test.describe('Configuración como veterinaria', () => {
  test('paola.vet solo ve Vacunas, y crea y edita una vacuna', async ({ page }, testInfo) => {
    await login(page, 'paola.vet');
    await openSettings(page, isMobile(testInfo));

    const sections = page.getByRole('navigation', { name: 'Secciones de Configuración' });
    await expect(sections.getByRole('link')).toHaveCount(1);
    await sections.getByRole('link', { name: /Vacunas/ }).click();

    await page.getByRole('link', { name: 'Nueva vacuna' }).click();
    const name = `Vacuna e2e ${run}`;
    await page.getByLabel('Nombre comercial').fill(name);
    await page.getByLabel('Enfermedad o propósito').fill('Carbón sintomático');
    await page.getByRole('radio', { name: 'Por intervalo' }).click();
    await page.getByLabel('Repetir cada (días)').fill('365');
    await page.getByRole('button', { name: 'Guardar vacuna' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vacunas' })).toBeVisible();

    await page
      .getByRole('link', { name: `Editar ${name}` })
      .first()
      .click();
    await page.getByLabel('Dosis por defecto').fill('5 ml');
    await page.getByRole('button', { name: 'Guardar vacuna' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vacunas' })).toBeVisible();

    await page
      .getByRole('link', { name: `Editar ${name}` })
      .first()
      .click();
    await expect(page.getByLabel('Dosis por defecto')).toHaveValue('5 ml');

    // Por URL, las demás secciones le muestran el aviso.
    await page.goto('/settings/breeds');
    await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
  });
});

test('wilmer (operario) no ve Configuración ni entra por URL', async ({ page }, testInfo) => {
  await login(page, 'wilmer');
  if (isMobile(testInfo)) {
    await mainNav(page).getByRole('link', { name: 'Más' }).click();
    await expect(
      page
        .getByRole('navigation', { name: 'Más opciones' })
        .getByRole('link', { name: 'Configuración' }),
    ).toHaveCount(0);
  } else {
    await expect(mainNav(page).getByRole('link', { name: 'Configuración' })).toHaveCount(0);
  }
  await page.goto('/settings');
  await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
});
