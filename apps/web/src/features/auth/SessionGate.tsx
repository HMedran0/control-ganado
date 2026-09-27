import { WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '../../components/ui/Button';
import { isApiError, NETWORK_ERROR_DETAIL } from '../../lib/api/errors';

type GateState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Restaura la sesión antes de mostrar la aplicación.
 *
 * - Mientras tanto, un estado de carga sobrio.
 * - Con sesión, o con un 401 (no hay sesión), muestra la aplicación: el router decide si va
 *   al inicio de sesión.
 * - Sin respuesta (red o tiempo agotado) **no** manda al inicio de sesión: no se sabe si hay
 *   sesión, y pedirle la contraseña a quien solo perdió la señal no ayuda. Ofrece reintentar.
 */
export function SessionGate({
  restore,
  children,
}: {
  restore: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    restore().then(
      () => {
        if (active) setState({ status: 'ready' });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          status: 'failed',
          message:
            isApiError(error) && error.code !== 'NETWORK_ERROR'
              ? error.detail
              : NETWORK_ERROR_DETAIL,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [restore, attempt]);

  if (state.status === 'ready') return children;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="font-cifras text-cifra text-potrero" aria-hidden="true">
        Hato
      </p>
      {state.status === 'loading' ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <WifiOff aria-hidden="true" className="size-8 text-texto-2" />
          <h1 className="text-md font-bold">{state.message}</h1>
          <Button
            block
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((current) => current + 1);
            }}
          >
            Reintentar
          </Button>
        </div>
      )}
    </main>
  );
}
