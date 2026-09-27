import { Link } from '@tanstack/react-router';

import { BOTTOM_NAV, NAV } from './nav-items';

/**
 * Barra inferior en móvil (06 §4): Inicio · Animales · Registrar · Alertas · Más.
 * Registrar es el botón central destacado. Cada destino mide al menos 56 px de alto.
 */
export function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-cerca bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {BOTTOM_NAV.map((item) => {
          const Icon = item.icon;
          const isRecord = item.to === NAV.record.to;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                className="group flex min-h-touch-primary flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-aux text-texto-2 aria-[current=page]:font-bold aria-[current=page]:text-potrero"
              >
                {isRecord ? (
                  <span className="-mt-5 flex size-14 items-center justify-center rounded-full border-4 border-sabana bg-potrero text-white group-hover:bg-monte">
                    <Icon aria-hidden="true" className="size-7" strokeWidth={2.5} />
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="size-6" />
                )}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
