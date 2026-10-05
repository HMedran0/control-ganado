import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page, type TestInfo } from '@playwright/test';

import { isMobile, login, seedPassword } from './helpers';

/**
 * Sanidad, pesos y alertas en la web (M6) contra la API y `hato_test` sembrada, en móvil y
 * escritorio, con axe en cada pantalla.
 *
 * Cada prueba crea sus propios animales (y su lote) por la API, con códigos únicos por corrida y
 * por proyecto: las cifras del seed que afirman otras pruebas no cambian y se pueden repetir sin
 * volver a sembrar. El archivo de la báscula es sintético, con el formato provisional de la
 * plantilla Tru-Test (`EID,VID,Weight,Date,Time`).
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;

type Animal = { id: string; code: string };
type Api = Awaited<ReturnType<typeof adminApi>>;

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
async function adminApi(testInfo: TestInfo) {
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

/** Un animal nuevo con código único de esta corrida y este proyecto. */
async function newAnimal(
  api: Api,
  testInfo: TestInfo,
  suffix: string,
  extra: Record<string, unknown> = {},
): Promise<Animal> {
  const breeds = await api.get<{ items: { id: string; name: string }[] }>('/breeds');
  const breedId = breeds.items.find((breed) => breed.name === 'Brahman')?.id;
  const code = `S${isMobile(testInfo) ? 'M' : 'E'}${run}${suffix}`.slice(0, 30);
  const animal = await api.post<Animal>('/animals', {
    code,
    sex: 'FEMALE',
    breedId,
    birthDate: '2021-03-01',
    origin: 'BORN_ON_FARM',
    ...extra,
  });
  return { id: animal.id, code };
}

test.describe.serial('sanidad, pesos y alertas', () => {
  test('vacunar un lote con omitidos: brucelosis no se aplica a los machos (SAN-03, RN-26)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const lot = await api.post<{ id: string; name: string }>('/lots', {
      name: `Terneras ${isMobile(testInfo) ? 'M' : 'E'}${run}`,
    });
    const female = await newAnimal(api, testInfo, 'TF', {
      birthDate: '2026-05-01',
      lotId: lot.id,
    });
    const male = await newAnimal(api, testInfo, 'TM', {
      sex: 'MALE',
      birthDate: '2026-05-01',
      lotId: lot.id,
    });
    await login(page, 'paola.vet');

    await page.goto('/vaccinations/bulk');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Vacunación por lote' }),
    ).toBeVisible();
    await page
      .getByLabel('Vacuna', { exact: true })
      .selectOption({ label: 'Brucelosis RB51 · Brucelosis bovina' });
    await page.getByRole('radio', { name: 'Un lote' }).click();
    await page.getByLabel('Lote', { exact: true }).selectOption({ label: lot.name });
    await page.getByRole('button', { name: 'Revisar la selección' }).click();

    await expect(page.getByText('Se omite 1 animal')).toBeVisible();
    await expect(page.getByText(`${male.code}`, { exact: false })).toBeVisible();
    await expect(page.getByText('La vacuna no se aplica a su sexo')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: female.code })).toBeChecked();
    await expectNoViolations(page);
    await capture(page, testInfo, 'vacunacion-lote');

    await page.getByRole('button', { name: 'Registrar 1 vacunación' }).click();
    await expect(page.getByText('1 vacunación registrada · 1 animal omitido.')).toBeVisible();

    const vaccinations = await api.get<{ items: { animal: { code: string } }[] }>(
      `/vaccinations?animalId=${female.id}`,
    );
    expect(vaccinations.items).toHaveLength(1);
    const none = await api.get<{ items: unknown[] }>(`/vaccinations?animalId=${male.id}`);
    expect(none.items).toEqual([]);
    await api.context.dispose();
  });

  test('tratamiento con retiro de carne y leche, y la advertencia al vender (SAN-05, RN-22)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const cow = await newAnimal(api, testInfo, 'RT');
    await login(page, 'alvaro');

    await page.goto(`/animals/${cow.id}`);
    await page.getByRole('link', { name: 'Tratamiento', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /Registrar tratamiento/ }),
    ).toBeVisible();
    await page.getByLabel('Diagnóstico o motivo').fill('Mastitis clínica');
    await page.getByLabel('Medicamento').fill('Oxitetraciclina');
    await page.getByLabel('Retiro de carne').fill('20');
    await page.getByLabel('Retiro de leche').fill('5');
    await expect(
      page.getByText(/Queda en retiro: carne hasta el .* · leche hasta el/),
    ).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'tratamiento');
    await page.getByRole('button', { name: 'Registrar tratamiento' }).click();

    await expect(page.getByText('Tratamiento registrado: Oxitetraciclina.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sanidad' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(/Carne hasta el .* · Leche hasta el/).first()).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Registrar salida' }).first().click();
    await page.getByLabel('Tipo de salida').selectOption({ label: 'Venta' });
    await expect(page.getByText(/Está en retiro de carne hasta el/)).toBeVisible();
    await expect(page.getByLabel('Confirmo la salida aunque esté en retiro')).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'salida-en-retiro');
    await api.context.dispose();
  });

  test('registrar un peso atípico: avisa antes y después de guardar (PES-01 CA2)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const steer = await newAnimal(api, testInfo, 'PA', {
      sex: 'MALE',
      birthDate: '2025-06-01',
      initialWeight: { weightKg: 250, method: 'TAPE', weighedOn: '2026-08-01' },
    });
    await login(page, 'yeison');

    await page.goto(`/animals/${steer.id}/weight`);
    await expect(page.getByText(/Último peso: 250 kg/)).toBeVisible();
    await page.getByLabel('Peso').fill('400');
    await expect(page.getByText(/El peso se aleja más del 30 % del último/)).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'peso-atipico');
    await page.getByRole('button', { name: 'Guardar peso' }).click();

    await expect(page.getByText(/Peso registrado: 400 kg/)).toBeVisible();
    await expect(
      page.getByText('El peso 400 kg se aleja mucho del último registrado. Verifícalo.'),
    ).toBeVisible();
    await api.context.dispose();
  });

  test('ver la evolución del peso: gráfica, ganancias y tabla (PES-02, PES-05)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const steer = await newAnimal(api, testInfo, 'EV', { sex: 'MALE', birthDate: '2025-03-01' });
    for (const [date, weightKg] of [
      ['2026-03-15', 200],
      ['2026-06-15', 240],
      ['2026-09-15', 255],
    ] as const) {
      await api.post('/weights', { animalId: steer.id, date, weightKg, method: 'TAPE' });
    }
    await login(page, 'wilmer');

    await page.goto(`/animals/${steer.id}?tab=pesos`);
    const chart = page.getByRole('group', { name: /Evolución del peso: de 200 kg .* 3 pesajes\./ });
    await expect(chart).toBeVisible();
    await chart.getByLabel(/15\/06\/2026: 240 kg/).focus();
    await expect(page.getByText('15/06/2026 · 240 kg')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('255 kg');
    // 15 kg en 92 días: 0,163 kg/día, menos que 0,3 en Levante (PES-05 CA2).
    await expect(
      page.getByText(/Ganancia baja: lo esperado para su categoría es al menos 0,3 kg\/día/),
    ).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'evolucion-peso');
    await api.context.dispose();
  });

  test('importar una sesión de báscula con un chip desconocido (PES-04)', async ({
    page,
  }, testInfo) => {
    const api = await adminApi(testInfo);
    const tagged = await newAnimal(api, testInfo, 'BA', {
      sex: 'MALE',
      birthDate: '2025-02-01',
      identifiers: [{ type: 'VISUAL_TAG', value: `V${isMobile(testInfo) ? 'M' : 'E'}${run}` }],
    });
    const chipless = await newAnimal(api, testInfo, 'BB', { sex: 'MALE', birthDate: '2025-02-01' });
    const chip = `982${String(Date.now()).slice(-11)}${isMobile(testInfo) ? '1' : '2'}`;
    const csv = [
      'EID,VID,Weight,Date,Time',
      `,V${isMobile(testInfo) ? 'M' : 'E'}${run},312.5,15/09/2026,08:01`,
      `${chip},,298,15/09/2026,08:03`,
    ].join('\r\n');
    await login(page, 'wilmer');

    await page.goto('/weights/import');
    await expect(page.getByLabel('Perfil de báscula')).toHaveValue('tru-test');
    await page.getByLabel(/Archivo de la báscula/).setInputFiles({
      name: 'sesion-xr5000.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await expect(page.getByRole('heading', { name: '2. Revisa antes de guardar' })).toBeVisible();
    await expect(page.getByText('Por chapeta')).toBeVisible();
    await expect(page.getByText(`Chip ${chip}`, { exact: false }).first()).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'bascula-simulacion');

    await page
      .getByRole('combobox', { name: `Asociar el chip ${chip} a un animal` })
      .fill(chipless.code);
    await page.getByRole('option', { name: new RegExp(chipless.code) }).click();
    await expect(page.getByLabel('Guardar este chip como RFID del animal')).toBeChecked();
    await expect(page.getByText('Asociado a mano')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Guardar 2 pesajes' }).click();

    await expect(page.getByText('2 pesajes guardados.')).toBeVisible();
    const detail = await api.get<{ identifiers: { type: string; value: string }[] }>(
      `/animals/${chipless.id}`,
    );
    expect(detail.identifiers).toContainEqual(
      expect.objectContaining({ type: 'RFID', value: chip }),
    );
    const weights = await api.get<{ items: { weightKg: number; weightSource: string }[] }>(
      `/animals/${tagged.id}/weights`,
    );
    expect(weights.items).toContainEqual(
      expect.objectContaining({ weightKg: 312.5, weightSource: 'SCALE_FILE' }),
    );
    await api.context.dispose();
  });

  test('la página de Alertas con filtros por tipo y lote', async ({ page }, testInfo) => {
    await login(page, 'wilmer');
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { level: 1, name: 'Alertas' })).toBeVisible();
    await expect(page.getByText(/animales con alertas/)).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'alertas');

    const lowGain = page.getByRole('button', { name: /Ganancia baja/ });
    await lowGain.click();
    await expect(lowGain).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/types=low_gain/);
    await expect(page.getByRole('link', { name: 'Registrar peso' }).first()).toBeVisible();

    await page.getByLabel('Lote').selectOption({ label: 'Levante' });
    await expect(page).toHaveURL(/lotId=/);
    await expect(page.getByText('Lote Levante').first()).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'alertas-filtradas');

    await page.getByRole('button', { name: 'Quitar los filtros' }).click();
    await expect(lowGain).toHaveAttribute('aria-pressed', 'false');
  });
});
