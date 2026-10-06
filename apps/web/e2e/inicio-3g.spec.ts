import { appendFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { login } from './helpers';

/**
 * Inicio en un celular de gama baja con 3G (M8a): cuánto tarda la primera cifra del tablero y qué
 * carga antes. La meta es 4 s.
 *
 * Perfil «Fast 3G» de Chrome DevTools —1,44 Mbps de bajada, 675 kbps de subida y 562,5 ms de
 * latencia— y la CPU cuatro veces más lenta, con la caché vacía. La sesión ya está iniciada (la
 * cookie del refresco existe, como en el celular del vaquero que vuelve a abrir la app): se mide
 * desde la navegación a «/» hasta que se ve la cifra de «¿Cuántos animales hay?».
 *
 * **Solo reporta, no falla por el tiempo.** `vite preview` sirve HTTP/1.1 (tiene proxy, y con
 * proxy Vite no usa HTTP/2): el navegador abre 6 conexiones y las peticiones van de a 6, a medio
 * segundo cada tanda. En M8a eran ~60 peticiones y 8,1 a 8,6 s; en M8b, con los chunks agrupados y
 * precargados desde `index.html` (`vite.config.ts`, ADR-017 decisión 8), 10 peticiones y 4,1 a
 * 4,3 s. En producción Caddy sirve HTTP/2; se confirma en M10b (07). La lista dice qué terminó
 * antes de la primera cifra, en orden, para ver qué se puede adelantar o juntar.
 */

const GOAL_MS = 4_000;
/** «Fast 3G» de Chrome DevTools, en bytes por segundo y milisegundos. */
const FAST_3G = {
  offline: false,
  downloadThroughput: (1.6 * 1_000_000 * 0.9) / 8,
  uploadThroughput: (750 * 1_000 * 0.9) / 8,
  latency: 150 * 3.75,
};

type Loaded = {
  readonly path: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly bytes: number;
};

test('Inicio con 3G y CPU ×4: tiempo hasta la primera cifra', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'movil', 'Se mide en el celular.');
  test.setTimeout(90_000);
  await login(page, 'alvaro');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', FAST_3G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const loaded: Promise<Loaded>[] = [];
  let started = 0;
  page.on('requestfinished', (request) => {
    loaded.push(
      request.sizes().then((sizes) => ({
        path: new URL(request.url()).pathname,
        startMs: Math.round(request.timing().startTime - started),
        endMs: Math.round(request.timing().startTime - started + request.timing().responseEnd),
        bytes: sizes.responseBodySize,
      })),
    );
  });
  started = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await expect(
    page.getByRole('link', { name: /¿Cuántos animales hay\?/ }).getByText(/^\d[\d.]*$/),
  ).toBeVisible({ timeout: 60_000 });
  const elapsed = Date.now() - started;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const before = (await Promise.all(loaded))
    // Solo lo de esta navegación: lo que pidió la página anterior no cuenta.
    .filter((item) => item.startMs >= 0 && item.endMs <= elapsed)
    .sort((a, b) => a.endMs - b.endMs);
  const kb = Math.round(before.reduce((sum, item) => sum + item.bytes, 0) / 1024);
  const milestone = (path: string) => before.find((item) => item.path === path)?.endMs ?? '—';
  const line =
    `Inicio con Fast 3G y CPU ×4: primera cifra en ${elapsed} ms (meta ${GOAL_MS} ms). ` +
    `${before.length} peticiones y ${kb} KB antes; refresco listo a los ${milestone('/api/v1/auth/refresh')} ms, ` +
    `tablero a los ${milestone('/api/v1/dashboard')} ms.`;
  const order = before
    .map((item) => `${String(item.endMs).padStart(6)} ms  ${item.path}`)
    .join('\n');
  process.stdout.write(`\n${line}\nOrden de llegada:\n${order}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') appendFileSync(summary, `### ${line}\n`);
  if (process.env.CI !== undefined) {
    process.stdout.write(`::notice title=Inicio en 3G::${elapsed} ms (meta ${GOAL_MS} ms)\n`);
  }
  // Lo único que se exige aquí: que Inicio llegue a mostrar sus cifras con esta red.
  expect(before.some((item) => item.path === '/api/v1/dashboard')).toBe(true);
});
