import { formatAge, toIsoDate } from '@hato/shared';

/**
 * Punto de entrada de la web.
 *
 * En M2 se reemplaza por el arranque de React + TanStack Router sobre Vite, con el sistema
 * de diseño de `06-ux-ui.md`.
 *
 * Por ahora solo comprueba que el enlace del workspace con `@hato/shared` funciona y que las
 * funciones de formato en español se resuelven desde el navegador.
 */
export function mountPlaceholder(root: HTMLElement): void {
  const edad = formatAge({ birthDate: toIsoDate('2026-01-15'), today: toIsoDate('2026-09-25') });
  root.textContent = `Hato — web pendiente del hito M2 (edad de ejemplo: ${edad})`;
}
