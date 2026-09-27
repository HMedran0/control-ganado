import { Outlet } from '@tanstack/react-router';

import { ConnectionBanner } from '../ui/ConnectionBanner';
import { UndoToastProvider } from '../ui/UndoToast';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';

/**
 * Estructura de las pantallas con sesión (06-ux-ui.md §4 y §9).
 *
 * - Menos de 1024 px: una columna y barra inferior fija, con los controles al alcance del
 *   pulgar (06 §8).
 * - Desde 1024 px: barra lateral izquierda.
 *
 * El proveedor de avisos «Deshacer» vive aquí y no en la raíz: así Radix Toast se descarga con
 * las pantallas con sesión y no pesa en el inicio de sesión (RNF-02).
 */
export function AppShell() {
  return (
    <UndoToastProvider>
      <div className="min-h-dvh lg:flex">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-superficie focus:p-3 focus:font-bold focus:text-potrero"
        >
          Saltar al contenido
        </a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <ConnectionBanner />
          <main
            id="contenido"
            tabIndex={-1}
            // Espacio abajo para que la barra inferior no tape el final de la página.
            className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-32 focus:outline-none lg:px-8 lg:pb-10"
          >
            <Outlet />
          </main>
        </div>
        <BottomNav />
      </div>
    </UndoToastProvider>
  );
}
