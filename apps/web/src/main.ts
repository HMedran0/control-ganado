import { SHARED_PACKAGE_NAME } from '@hato/shared';

/**
 * Punto de entrada de la web.
 *
 * En M2 se reemplaza por el arranque de React + TanStack Router sobre Vite,
 * con el sistema de diseño de `06-ux-ui.md`.
 *
 * Por ahora solo comprueba que el enlace del workspace con `@hato/shared` funciona.
 */
export function mountPlaceholder(root: HTMLElement): void {
  root.textContent = `Hato — web pendiente del hito M2 (usa ${SHARED_PACKAGE_NAME})`;
}
