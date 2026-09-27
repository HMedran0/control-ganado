import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Pruebas unitarias de la web: componentes y cliente de la API en jsdom.
 *
 * Aparte de `vite.config.ts` para no arrastrar a las pruebas el plugin del router (el árbol de
 * rutas ya está generado) ni Tailwind. Las pruebas de extremo a extremo van con Playwright.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Vitest cambia el CSS por texto vacío; tokens.test.ts lee los colores de tokens.css.
    css: { include: [/tokens\.css/] },
  },
});
