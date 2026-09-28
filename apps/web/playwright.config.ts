import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { E2E_API_PORT, e2eDatabaseUrl } from './e2e-database.mjs';

/**
 * Pruebas de extremo a extremo: la web compilada (`vite preview`) contra la API compilada y la
 * base de pruebas (`TEST_DATABASE_URL`, `hato_test`) con la finca de referencia sembrada
 * (`pnpm --filter @hato/web test:e2e:seed`). Nunca la base de desarrollo, ni en local ni en la
 * integración continua.
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
/**
 * API propia de las pruebas, en otro puerto que la de `pnpm dev`: si se reutilizara un servidor
 * de desarrollo que ya estuviera corriendo, las pruebas escribirían en la base de desarrollo.
 */
const API_URL = `http://localhost:${E2E_API_PORT}`;
// «Hoy» de la API de las pruebas es la fecha real en Bogotá, la misma que usa el navegador:
// la API ignora `SEED_TODAY` y no se le pasa `CLOCK_FIXED_TODAY` (ADR-010).
const DATABASE_URL = e2eDatabaseUrl(process.env);

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
      env: {
        RATE_LIMIT_PER_IP: '1000',
        PORT: String(E2E_API_PORT),
        DATABASE_URL,
      },
      url: `${API_URL}/api/v1/health`,
      // Nunca se reutiliza: un servidor ya levantado podría estar conectado a otra base.
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview',
      env: { API_PROXY_TARGET: API_URL },
      url: WEB_URL,
      // Tampoco este: un `vite preview` ajeno reenviaría /api a la API de desarrollo.
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js',
      // También apunta a la API de las pruebas: /dev/ui restaura la sesión al cargar, y sin
      // una API en el destino del proxy la página no termina de pintar.
      env: { API_PROXY_TARGET: API_URL },
      url: DEV_URL,
      // Un `pnpm dev` ya levantado reenviaría /api a la API de desarrollo: no se reutiliza.
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
