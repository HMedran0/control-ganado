import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

/** Raíz del monorepo: allí vive el `.env` que comparten la API y la web. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Destino por defecto del proxy: la API de `pnpm dev` (`PORT=3000`). */
const DEFAULT_API_TARGET = 'http://localhost:3000';

/**
 * Chunks de la carga de Inicio (M8b, ADR-017 decisión 8). Sin agrupar, el layout de `_app` y la
 * ruta de Inicio llegaban en unos 37 archivos de pocos KB, pedidos en cascada después del refresco
 * de sesión; en HTTP/1.1 van de a 6 y cada tanda paga la latencia completa.
 *
 * - `inicial`: lo que `index.html` ya cargaba (etiqueta `$initial`), en un archivo. Los mismos
 *   bytes; sale primero porque tiene la prioridad más alta y nadie más se lo lleva.
 * - `app-shell`: el layout (`routes/_app.tsx` y `components/layout`) con todo lo que usa y no está
 *   en la carga inicial. Lo necesita cualquier pantalla después del login.
 * - `inicio`: la ruta de Inicio y el tablero, sin lo que ya está en los dos anteriores.
 *
 * Cada módulo queda en un solo chunk: si otra ruta usa algo de `app-shell`, lo importa de allí, y
 * ese archivo ya está cargado.
 */
const CHUNK_GROUPS = [
  { name: 'inicial', tags: ['$initial' as const], priority: 3 },
  {
    name: 'app-shell',
    test: /[\\/]src[\\/](routes[\\/]_app\.tsx|components[\\/]layout[\\/])/,
    priority: 2,
  },
  {
    name: 'inicio',
    test: /[\\/]src[\\/](routes[\\/]_app[\\/]index\.tsx|features[\\/]dashboard[\\/])/,
    priority: 1,
  },
];

/** Chunks que `index.html` precarga sin esperar al refresco de sesión. */
const PRELOADED_CHUNKS = new Set(['app-shell', 'inicio']);

/**
 * Agrega a `index.html` un `<link rel="modulepreload" data-precarga>` por cada chunk de
 * `PRELOADED_CHUNKS` y los que importan (salvo los de la carga inicial, que ya están). Así bajan en
 * paralelo con la carga inicial y el refresco, y el layout y el tablero están listos cuando llega
 * la sesión. `data-precarga` le dice a `check-bundle-size.mjs` que los mida con su propio tope
 * (`hato.preloadBudgetKb`): no bloquean el arranque, pero sí gastan datos.
 *
 * Costo aceptado: quien abre directamente otra ruta también baja Inicio (06 §5.1, la app abre en
 * Inicio).
 */
function preloadHomeChunks(): Plugin {
  return {
    name: 'hato:preload-home-chunks',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const bundle = context.bundle;
        if (bundle === undefined) return [];
        const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
        const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const initial = new Set<string>();
        const visitInitial = (fileName: string) => {
          if (initial.has(fileName)) return;
          initial.add(fileName);
          for (const imported of byFile.get(fileName)?.imports ?? []) visitInitial(imported);
        };
        for (const chunk of chunks) if (chunk.isEntry) visitInitial(chunk.fileName);

        const files = new Set<string>();
        const visit = (fileName: string) => {
          if (initial.has(fileName) || files.has(fileName)) return;
          files.add(fileName);
          for (const imported of byFile.get(fileName)?.imports ?? []) visit(imported);
        };
        for (const chunk of chunks) if (PRELOADED_CHUNKS.has(chunk.name)) visit(chunk.fileName);
        if (![...PRELOADED_CHUNKS].every((name) => chunks.some((chunk) => chunk.name === name))) {
          throw new Error(`Faltan chunks para precargar: ${[...PRELOADED_CHUNKS].join(', ')}.`);
        }
        return [...files].sort().map((fileName) => ({
          tag: 'link',
          attrs: {
            rel: 'modulepreload',
            crossorigin: true,
            href: `/${fileName}`,
            'data-precarga': 'inicio',
          },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

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
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      preloadHomeChunks(),
    ],
    build: { rolldownOptions: { output: { codeSplitting: { groups: CHUNK_GROUPS } } } },
    server: { port: 5173, strictPort: true, proxy: apiProxy },
    preview: { port: 4173, strictPort: true, proxy: apiProxy },
  };
});
