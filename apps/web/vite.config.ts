import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

/** Raíz del monorepo: allí vive el `.env` que comparten la API y la web. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Destino por defecto del proxy: la API de `pnpm dev` (`PORT=3000`). */
const DEFAULT_API_TARGET = 'http://localhost:3000';

/**
 * Vite para la web (ADR-06 de 04-arquitectura.md y ADR-008).
 *
 * `/api` pasa por un proxy hacia la API tanto en `vite` (desarrollo) como en `vite preview`
 * (las pruebas de extremo a extremo). Así la página y la API comparten origen y la cookie
 * del token de refresco (`SameSite=Strict`, `Path=/api/v1/auth`) viaja sin CORS, igual que
 * en producción detrás de Caddy.
 *
 * El destino sale de `API_PROXY_TARGET` (ver `.env.example`). No lleva el prefijo `VITE_`
 * a propósito: es configuración del servidor de desarrollo y no debe quedar en el paquete
 * que se sirve al navegador.
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const apiProxy: Record<string, ProxyOptions> = {
    '/api': { target: env.API_PROXY_TARGET ?? DEFAULT_API_TARGET, changeOrigin: false },
  };

  return {
    // El plugin del router va antes que el de React: genera `routeTree.gen.ts` y divide
    // el código por ruta.
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    server: { port: 5173, strictPort: true, proxy: apiProxy },
    preview: { port: 4173, strictPort: true, proxy: apiProxy },
  };
});
