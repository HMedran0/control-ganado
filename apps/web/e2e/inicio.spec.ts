import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page, type TestInfo } from '@playwright/test';

import { RETIRO_NAME, isMobile, login, seedPassword } from './helpers';

/**
 * Inicio — tablero por sistema productivo (M8a: RPT-01, CFG-03, PES-05, PES-06) en móvil y
 * escritorio, con axe, contra `hato_test` sembrada.
 *
 * Las cifras exactas de `expected.ts` las afirma la prueba de integración de la API
 * (`apps/api/test/dashboard.e2e-spec.ts`), sobre una base recién sembrada. Aquí no se puede: el
 * seed se siembra con «hoy» = 25/09/2026 pero la API de las pruebas usa la fecha real (ADR-010), y
 * las specs que corren antes (y el otro proyecto) registran animales, partos y gastos en La
 * Esperanza. Por eso la pantalla se compara con lo que responde `GET /dashboard` en ese momento,
 * cada indicador con el listado al que enlaza, y el caso de «alcanzan el peso de venta este mes» se
 * prepara por la API con fechas relativas a hoy.
 */

const capturas = fileURLToPath(new URL('./capturas/', import.meta.url));
const run = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;
const tag = (testInfo: TestInfo) => `${isMobile(testInfo) ? 'M' : 'E'}${run}`;

/** Lo que la pantalla necesita de `GET /dashboard` para compararse. */
type Board = {
  herd: { total: number; males: number; females: number };
  reproduction: { pregnant: number; served: number };
  forSale: { count: number };
  investment?: string;
};

/** Entero con puntos de miles, como la pantalla (`groupThousands`). */
const thousands = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

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

/** Cliente de la API con la sesión de un usuario del seed, para preparar datos. */
async function apiAs(testInfo: TestInfo, username: string) {
  const baseURL = testInfo.project.use.baseURL;
  const context = await request.newContext({ ...(baseURL === undefined ? {} : { baseURL }) });
  const session = await context.post('/api/v1/auth/login', {
    data: { login: username, password: seedPassword() },
  });
  expect(session.ok()).toBe(true);
  const { accessToken } = (await session.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const call = async <T>(method: 'get' | 'post' | 'patch', path: string, body?: object) => {
    const response = await context[method](`/api/v1${path}`, {
      headers,
      ...(body === undefined ? {} : { data: body }),
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as T;
  };
  return {
    get: <T>(path: string) => call<T>('get', path),
    post: <T>(path: string, body: object) => call<T>('post', path, body),
    patch: <T>(path: string, body: object) => call<T>('patch', path, body),
  };
}

/** Hoy en Bogotá, que es el «hoy» de la API de las pruebas (ADR-010). */
function todayInBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(Date.now());
}
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** La fila de una pregunta del día: el enlace completo. */
const row = (page: Page, question: string) =>
  page.getByRole('link', { name: new RegExp(question.replace(/[?¿]/g, '\\$&')) });

/** La cifra de una fila: el número grande, ya con separador de miles. */
async function figure(page: Page, question: string): Promise<string> {
  const text = (await row(page, question).innerText()).split('\n').map((part) => part.trim());
  const value = text.find((part) => /^[\d.]+$/.test(part));
  if (value === undefined) throw new Error(`Sin cifra en «${question}»: ${text.join(' | ')}`);
  return value;
}

/** Pone el sistema productivo de una finca por la API (para restaurarlo pase lo que pase). */
async function setSystem(testInfo: TestInfo, username: string, system: string): Promise<void> {
  const api = await apiAs(testInfo, username);
  const farm = await api.get<{ version: number }>('/farm');
  await api.patch('/farm', { version: farm.version, settings: { productionSystem: system } });
}

test.describe.serial('Inicio (M8a)', () => {
  test('La Esperanza, doble propósito: sus cifras y las preguntas de cría, con axe', async ({
    page,
  }, testInfo) => {
    const board = await (await apiAs(testInfo, 'alvaro')).get<Board>('/dashboard');
    await login(page, 'alvaro');
    const own = page.getByRole('region', { name: 'Para tu finca de doble propósito' });
    await expect(own).toBeVisible();
    await expect(own.getByText('¿Cuántos terneros se destetan este mes?')).toBeVisible();
    await expect(own.getByText('¿Cuál es el intervalo entre partos?')).toBeVisible();
    await expect(own.getByText('¿Cuántas vacas están horras?')).toBeVisible();
    await expect(own.getByText('¿Cuáles están en retiro de leche?')).toBeVisible();
    // Las de ceba no salen, y las de leche de M9b todavía no existen.
    await expect(page.getByText(/peso de venta/)).toHaveCount(0);
    await expect(page.getByText(/en ordeño/)).toHaveCount(0);
    // La referencia de UPRA es solo texto de contexto.
    await expect(page.getByText(/UPRA \(2024\) reporta de 387 a 439 días/)).toBeVisible();

    // Las cifras de la pantalla son las de la API (las de expected.ts, con la base recién sembrada).
    expect(await figure(page, '¿Cuántos animales hay?')).toBe(thousands(board.herd.total));
    await expect(row(page, '¿Cuántos animales hay?')).toContainText(
      `${thousands(board.herd.males)} machos · ${thousands(board.herd.females)} hembras`,
    );
    expect(await figure(page, '¿Cuántas están preñadas?')).toBe(
      thousands(board.reproduction.pregnant),
    );
    await expect(row(page, '¿Cuántas están preñadas?')).toContainText(
      `${thousands(board.reproduction.served)} servida`,
    );
    expect(await figure(page, '¿Cuáles están para venta?')).toBe(thousands(board.forSale.count));
    expect(board.investment).toBeDefined();
    await expect(row(page, '¿Cuánto hay invertido?')).toContainText(/\$ [\d.,]+( M)?/);

    // Las alertas por tipo, con la reproducción primero en doble propósito.
    const alerts = page.getByRole('complementary', { name: 'Alertas' });
    await expect(alerts.getByRole('heading', { level: 3 }).first()).toHaveText('Reproducción');

    await expectNoViolations(page);
    await capture(page, testInfo, 'inicio-doble-proposito');
  });

  test('cada indicador lleva al listado filtrado con la misma cifra', async ({ page }) => {
    await login(page, 'alvaro');
    const toList: [string, RegExp][] = [
      ['¿Cuántos animales hay?', /\/animals$/],
      ['¿Cuántos terneros y terneras?', /category=CALF_MALE%2CCALF_FEMALE/],
      ['¿Cuántas están preñadas?', /tags=PREGNANT/],
      ['¿Cuáles paren pronto?', /alerts=calving_soon&sort=calving/],
      ['¿Cuántos terneros se destetan este mes?', /bornFrom=.*&bornTo=/],
      ['¿Cuántas vacas están horras?', /tags=DRY/],
      ['¿Cuáles están en retiro de leche?', /milkWithdrawal=true/],
      ['¿Cuáles están para venta?', /forSale=true/],
    ];
    for (const [question, url] of toList) {
      await expect(row(page, question)).toBeVisible();
      const value = Number((await figure(page, question)).replace(/\./g, ''));
      await row(page, question).click();
      await expect(page).toHaveURL(url);
      await expect(
        page.getByText(`${value} ${value === 1 ? 'animal' : 'animales'}`, { exact: true }),
      ).toBeVisible();
      await page.goBack();
    }
    // «¿Qué falta vacunar?» abre Alertas con los dos tipos de vacuna: cada animal una vez.
    const vaccines = Number((await figure(page, '¿Qué falta vacunar?')).replace(/\./g, ''));
    await row(page, '¿Qué falta vacunar?').click();
    await expect(page).toHaveURL(/\/alerts\?types=vaccine_overdue%2Cvaccine_due/);
    await expect(page.getByText(`${vaccines} animales con alertas`)).toBeVisible();
    await page.goBack();
    // Nacidos del año: el reporte de nacimientos.
    await row(page, '¿Cuántos nacieron este año?').click();
    await expect(page).toHaveURL(/\/reports\/births/);
  });

  test('cambiar el sistema productivo cambia las preguntas, no las cifras (CFG-03 CA1)', async ({
    page,
  }, testInfo) => {
    await login(page, 'alvaro');
    const before = await figure(page, '¿Cuántos animales hay?');
    try {
      await page.goto('/settings/farm');
      await page.getByLabel('¿Qué hace la finca?').selectOption('LEVANTE_CEBA');
      await page.getByRole('button', { name: 'Guardar parámetros' }).click();
      await expect(page.getByText('Parámetros guardados.')).toBeVisible();

      await page.goto('/');
      const own = page.getByRole('region', { name: 'Para tu finca de levante y ceba' });
      await expect(own.getByText('¿Cuáles alcanzan el peso de venta este mes?')).toBeVisible();
      await expect(own.getByText('¿Qué lotes ganan menos peso de lo esperado?')).toBeVisible();
      await expect(page.getByText('¿Cuántos terneros se destetan este mes?')).toHaveCount(0);
      expect(await figure(page, '¿Cuántos animales hay?')).toBe(before);
      // En ceba, los pesos van primero en las alertas.
      const alerts = page.getByRole('complementary', { name: 'Alertas' });
      await expect(alerts.getByRole('heading', { level: 3 }).first()).toHaveText('Pesos');
      await expectNoViolations(page);
    } finally {
      await setSystem(testInfo, 'alvaro', 'DOBLE_PROPOSITO');
    }
  });

  test('El Retiro, ceba: «¿Cuáles alcanzan el peso de venta este mes?» (PES-06)', async ({
    page,
  }, testInfo) => {
    // Un novillo que gana 0,8 kg/día y llega a 450 kg hoy mismo: «este mes» cualquier día.
    const api = await apiAs(testInfo, 'retiro.admin');
    const breeds = await api.get<{ items: { id: string }[] }>('/breeds');
    const code = `V${tag(testInfo)}`.slice(0, 20);
    const animal = await api.post<{ id: string }>('/animals', {
      code,
      sex: 'MALE',
      breedId: breeds.items[0]?.id,
      birthDate: '2024-11-01',
      origin: 'BORN_ON_FARM',
    });
    const today = todayInBogota();
    for (const [date, weightKg] of [
      [addDays(today, -62), 400.4],
      [addDays(today, -1), 449.2],
    ] as const) {
      await api.post('/weights', { animalId: animal.id, date, weightKg, method: 'SCALE' });
    }

    await login(page, 'retiro.admin', RETIRO_NAME);
    const own = page.getByRole('region', { name: 'Para tu finca de levante y ceba' });
    await expect(own).toBeVisible();
    // Lo medido y lo estimado van por separado.
    await expect(row(page, '¿Cuáles ya están en el peso de venta?')).toBeVisible();
    await expect(page.getByText('¿Qué lotes ganan menos peso de lo esperado?')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ceba B:/ })).toBeVisible();
    await expectNoViolations(page);
    await capture(page, testInfo, 'inicio-ceba');

    await row(page, '¿Cuáles alcanzan el peso de venta este mes?').click();
    await expect(page).toHaveURL(/saleWeight=this_month/);
    await expect(page.getByText('Alcanzan el peso este mes')).toBeVisible();
    await page.getByRole('link', { name: code, exact: true }).first().click();
    await page.getByRole('tab', { name: 'Pesos' }).click();
    await expect(page.getByText(/Llega a 450 kg hacia el .* \(estimado\)/)).toBeVisible();
  });

  test('un OPERATOR no ve indicadores económicos (RN-20)', async ({ page }) => {
    await login(page, 'wilmer');
    await expect(row(page, '¿Cuántos animales hay?')).toBeVisible();
    await expect(page.getByText('¿Cuánto hay invertido?')).toHaveCount(0);
    await expect(page.getByText(/\$/)).toHaveCount(0);
    await expectNoViolations(page);
  });
});
