import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo: la web compilada (`vite preview`) contra la API compilada y la
 * base con la finca de referencia sembrada (`pnpm db:seed`).
 *
 * La web y la API comparten origen a través del proxy de `vite preview` (ADR-008), así que la
 * cookie del refresco se comporta como en producción detrás de Caddy.
 */

// Localmente, el mismo `.env` de la raíz que usan la API y el seed. En la integración continua
// las variables ya vienen del job y el archivo no existe.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const CI = process.env.CI !== undefined;
const WEB_URL = 'http://localhost:4173';
/** Servidor de desarrollo: solo ahí existe la muestra de componentes (`/dev/ui`). */
const DEV_URL = 'http://localhost:5173';
const DEV_UI_SPEC = /dev-ui\.spec\.ts$/;
const API_URL = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Una sola base y un solo límite de peticiones por IP: en serie, sin sorpresas.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  // En CI, `github` convierte cada fallo en una anotación del job, legible sin permisos.
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  // Tope para toda la corrida: si algo se cuelga, falla con un mensaje en vez de esperar.
  globalTimeout: CI ? 8 * 60_000 : 0,
  use: {
    baseURL: WEB_URL,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
  },
  // Solo Chromium: la cookie del refresco es `Secure` y WebKit no la acepta en
  // http://localhost (ADR-008). Los tamaños son los de 06-ux-ui.md §9.
  projects: [
    { name: 'movil', testIgnore: DEV_UI_SPEC, use: { ...devices['Pixel 7'] } },
    {
      name: 'escritorio',
      testIgnore: DEV_UI_SPEC,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    // La muestra de componentes se prueba contra `vite` en modo desarrollo, porque el paquete
    // de producción no la incluye (lo comprueba produccion.spec.ts).
    {
      name: 'dev-ui-movil',
      testMatch: DEV_UI_SPEC,
      use: { ...devices['Pixel 7'], baseURL: DEV_URL },
    },
    {
      name: 'dev-ui-escritorio',
      testMatch: DEV_UI_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: DEV_URL,
      },
    },
  ],
  // Los servidores se lanzan con `node` directamente, sin `pnpm` de por medio. En Linux, pnpm
  // deja el proceso de Node fuera del grupo que Playwright detiene al terminar, y la corrida se
  // quedaba esperando el cierre hasta agotar el tiempo aunque todas las pruebas hubieran pasado.
  // Se detienen con SIGTERM: la API cierra ordenadamente (`enableShutdownHooks`).
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: fileURLToPath(new URL('../api', import.meta.url)),
      // Todas las pruebas salen de una IP y cada carga de página restaura la sesión: con el
      // límite real de 60 por minuto sin sesión, la suite se estrangularía a sí misma. El
      // límite tiene su propia prueba de integración en la API.
      env: { RATE_LIMIT_PER_IP: '1000' },
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview',
      url: WEB_URL,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js',
      url: DEV_URL,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
