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
    { name: 'movil', use: { ...devices['Pixel 7'] } },
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
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
  ],
});
