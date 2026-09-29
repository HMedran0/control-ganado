import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { isMobile, login, seedPassword } from './helpers';

/**
 * Reproducción en la web (M5: REP-01 a REP-05, NAC-01, CU-01) contra la API y `hato_test`
 * sembrada, en móvil y escritorio, con axe en cada pantalla.
 *
 * Cada prueba crea sus propios animales por la API, con códigos únicos por corrida y por
 * proyecto, y termina sin preñeces abiertas nuevas: las cifras que afirman las demás pruebas
 * (71 preñadas) no cambian y las pruebas se pueden repetir sin volver a sembrar.
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;

type Animal = { id: string; code: string };

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${capturas}${testInfo.project.name}-${screen}.png`,
    fullPage: true,
  });
}

/** Cliente de la API con la sesión de alvaro (ADMIN), para preparar y comprobar datos. */
async function adminApi(testInfo: TestInfo): Promise<{
  context: APIRequestContext;
  post: <T>(path: string, body: object) => Promise<T>;
  get: <T>(path: string) => Promise<T>;
}> {
  const baseURL = testInfo.project.use.baseURL;
  const context = await request.newContext({ ...(baseURL === undefined ? {} : { baseURL }) });
  const session = await context.post('/api/v1/auth/login', {
    data: { login: 'alvaro', password: seedPassword() },
  });
  expect(session.ok()).toBe(true);
  const { accessToken } = (await session.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  return {
    context,
    post: async <T>(path: string, body: object) => {
      const response = await context.post(`/api/v1${path}`, { data: body, headers });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as T;
    },
    get: async <T>(path: string) => {
      const response = await context.get(`/api/v1${path}`, { headers });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as T;
    },
  };
}

/** Una hembra nueva de la finca, con un código único de esta corrida y este proyecto. */
async function newFemale(
  api: Awaited<ReturnType<typeof adminApi>>,
  testInfo: TestInfo,
  suffix: string,
  birthDate = '2021-03-01',
): Promise<Animal> {
  const breeds = await api.get<{ items: { id: string; name: string }[] }>('/breeds');
  const breedId = breeds.items.find((breed) => breed.name === 'Brahman')?.id;
  const code = `R${isMobile(testInfo) ? 'M' : 'E'}${run}${suffix}`.slice(0, 30);
  const animal = await api.post<Animal>('/animals', {
    code,
    sex: 'FEMALE',
    breedId,
    birthDate,
    origin: 'BORN_ON_FARM',
  });
  return { id: animal.id, code };
}

async function openReproduction(page: Page, animal: Animal): Promise<void> {
  await page.goto(`/animals/${animal.id}?tab=reproduccion`);
  await expect(page.getByRole('heading', { level: 1, name: animal.code })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reproducción' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

test.describe.serial('reproducción', () => {
  test('servicio → palpación positiva → parto con cría; el reintento con la misma clave no duplica (CU-01, ADR-012)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const heifer = await newFemale(api, testInfo, 'S', '2024-01-10');
    await login(page, 'wilmer');

    // Servicio (REP-01).
    await openReproduction(page, heifer);
    await expect(page.getByText('No tiene una preñez abierta.')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('link', { name: 'Registrar servicio' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Registrar servicio/ })).toBeVisible();
    await page.getByRole('radio', { name: 'Monta natural' }).click();
    await expect(page.getByText(/Parto estimado:/)).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'servicio');
    await page.getByRole('button', { name: 'Guardar servicio' }).click();
    await expect(page.getByText('Servicio registrado.')).toBeVisible();
    await expect(page.getByText('Servida', { exact: true }).first()).toBeVisible();

    // Palpación positiva (REP-02).
    await page.getByRole('link', { name: 'Registrar palpación' }).click();
    await page.getByRole('radio', { name: 'Preñada' }).click();
    await page.getByLabel('Quién palpó').fill('Dra. Paola');
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Guardar palpación' }).click();
    await expect(page.getByText('Palpación guardada: preñada.')).toBeVisible();
    await expect(page.getByText(/Preñez confirmada el .* · Dra\. Paola/)).toBeVisible();

    // Parto con una cría; la primera respuesta «se pierde» en el camino (sin señal) y el
    // reintento con la misma Idempotency-Key devuelve el mismo parto sin crear otra cría.
    await page.getByRole('link', { name: 'Registrar parto' }).click();
    await expect(page.getByLabel('Código')).not.toHaveValue('');
    const suggested = await page.getByLabel('Código').inputValue();
    await page.getByRole('radio', { name: 'Hembra' }).click();
    await page.getByLabel('Peso al nacer').fill('31');
    await expectNoViolations(page);
    await capture(page, testInfo, 'parto');

    let lost = true;
    const keys: string[] = [];
    await page.route('**/api/v1/calvings', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (lost) {
        lost = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Guardar parto' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar parto' }).click();
    await expect(page.getByText(`Parto guardado · ${suggested} creado`)).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);

    // CA6: la ficha de la madre con la cría enlazada; la cría quedó una sola vez.
    await expect(page.getByRole('link', { name: suggested })).toBeVisible();
    const births = await api.get<{ items: { calf: { code: string } }[] }>(
      '/reports/births?from=2020-01-01&to=2099-12-31',
    );
    expect(births.items.filter((item) => item.calf.code === suggested)).toHaveLength(1);
    await api.context.dispose();
  });

  test('parto gemelar con una cría muerta al nacer, sin preñez registrada, y reporte de nacimientos (REP-04 CA3, CA4, NAC-01)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const cow = await newFemale(api, testInfo, 'G');
    await login(page, 'paola.vet');

    await page.goto(`/animals/${cow.id}/calving`);
    await expect(
      page.getByText('Sin preñez registrada: el parto quedará con fecha de servicio estimada.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Agregar uno (Crías)' }).click();
    await page.getByRole('button', { name: 'Agregar uno (Crías)' }).click();
    const codes = page.getByLabel('Código');
    await expect(codes).toHaveCount(3);
    await expect(codes.nth(2)).not.toHaveValue('');
    await page.getByRole('radio', { name: 'Hembra' }).nth(0).click();
    await page.getByRole('radio', { name: 'Macho' }).nth(1).click();
    await page.getByRole('radio', { name: 'Débil' }).nth(1).click();
    await page.getByRole('radio', { name: 'Macho' }).nth(2).click();
    await page.getByRole('radio', { name: 'Muerta' }).nth(2).click();
    await expect(codes).toHaveCount(2);
    const first = await codes.nth(0).inputValue();
    const second = await codes.nth(1).inputValue();
    expect(first).not.toBe(second);
    await page.getByRole('radio', { name: 'Asistido' }).click();
    await expectNoViolations(page);
    await capture(page, testInfo, 'parto-gemelar');
    await page.getByRole('button', { name: 'Guardar parto' }).click();

    await expect(page.getByText(`Parto guardado · ${first} y ${second} creados`)).toBeVisible();
    await expect(page.getByText('1 muerta al nacer')).toBeVisible();
    await expect(page.getByText(/sin servicio conocido/)).toBeVisible();
    await expect(page.getByText('Vaca', { exact: true })).toBeVisible();

    // NAC-01: las dos crías vivas en el reporte, con su madre.
    await page.goto('/reports/births');
    await expect(page.getByRole('heading', { level: 1, name: 'Nacimientos' })).toBeVisible();
    await expect(page.getByRole('link', { name: first })).toBeVisible();
    await expect(page.getByRole('link', { name: second })).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'nacimientos');
    await api.context.dispose();
  });

  test('aborto: cierra la preñez sin crías ni parto (REP-03)', async ({ page }, testInfo) => {
    const api = await adminApi(testInfo);
    const cow = await newFemale(api, testInfo, 'A');
    await api.post('/pregnancies', { damId: cow.id, serviceDate: '2026-05-01', method: 'AI' });
    await login(page, 'yeison');

    await openReproduction(page, cow);
    await page.getByRole('link', { name: 'Registrar aborto' }).click();
    await page.getByLabel('Observaciones').fill('Encontrado en el potrero');
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Registrar aborto' }).click();
    await expect(page.getByText('Aborto registrado.')).toBeVisible();
    await expect(page.getByText('No tiene una preñez abierta.')).toBeVisible();
    await expect(page.getByText(/^Aborto · /)).toBeVisible();
    await api.context.dispose();
  });

  test('una vaca horra vuelve a servicio: pasa de Horra a Servida', async ({ page }, testInfo) => {
    const api = await adminApi(testInfo);
    const cow = await newFemale(api, testInfo, 'H');
    // Parió hace más de 7 meses (destete) y no tiene preñez: Horra (RN-25).
    await api.post('/calvings', {
      damId: cow.id,
      date: '2025-12-01',
      calvingType: 'NORMAL',
      calves: [{ sex: 'MALE', health: 'ALIVE' }],
    });
    await login(page, 'wilmer');

    await openReproduction(page, cow);
    await expect(page.getByText('Horra', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Registrar servicio' }).click();
    await page.getByRole('radio', { name: 'Monta natural' }).click();
    await page.getByRole('button', { name: 'Guardar servicio' }).click();
    await expect(page.getByText('Servicio registrado.')).toBeVisible();
    await expect(page.getByText('Servida', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Horra', { exact: true })).toHaveCount(0);

    // Limpieza: el ADMIN anula el servicio para no dejar una servida más en la finca.
    const detail = await api.get<{ reproduction: { openPregnancy: { id: string } } }>(
      `/animals/${cow.id}`,
    );
    await api.post(`/pregnancies/${detail.reproduction.openPregnancy.id}/void`, {
      reason: 'Prueba de extremo a extremo',
    });
    await api.context.dispose();
  });

  test('alertas: «Parto vencido sin registrar» en el listado con su filtro y en la ficha con su acción', async ({
    page,
  }, testInfo) => {
    await login(page, 'alvaro');
    await page.goto('/animals?alerts=calving_overdue');
    const rows = page.getByText('Parto vencido sin registrar');
    await expect(rows.first()).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'listado-parto-vencido');

    // La primera fila (tarjeta en móvil, fila de tabla en escritorio) con la alerta.
    const href = await page
      .locator('main li, main tr')
      .filter({ hasText: 'Parto vencido sin registrar' })
      .first()
      .locator('a[href^="/animals/"]')
      .first()
      .getAttribute('href');
    expect(href).not.toBeNull();
    await page.goto(href ?? '/animals');
    await expect(
      page.getByText('Pasó la fecha de parto: registra el parto o el aborto'),
    ).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'ficha-parto-vencido');
    await page.getByRole('button', { name: 'Registrar parto' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: /Registrar parto/ })).toBeVisible();
  });
});
