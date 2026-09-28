import type { SessionView } from '@hato/shared';
import { CircleCheck, MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { useToday } from '../../lib/clock';
import { formatLastUse, formatSessionStart, useSessionMutations, useSessions } from './sessions';

/** Qué se va a cerrar: una sesión concreta o todas las demás. */
type Pending = { kind: 'one'; session: SessionView } | { kind: 'others' };

/**
 * Mi cuenta → Sesiones (AUT-11, 06 §5.9): los equipos con sesión abierta, con «Cerrar sesión en
 * este equipo» en cada uno y «Cerrar las demás sesiones». La sesión actual dice «Este equipo» y
 * no tiene botón propio: para cerrarla está Salir.
 */
export function SessionsSection() {
  const today = useToday();
  const sessions = useSessions();
  const { revoke, revokeOthers } = useSessionMutations();
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const items = sessions.data?.items ?? [];
  const others = items.filter((item) => !item.current);
  const mutation = pending?.kind === 'others' ? revokeOthers : revoke;

  const confirm = async (): Promise<void> => {
    if (pending === null) return;
    setMessage(null);
    try {
      if (pending.kind === 'one') {
        await revoke.mutateAsync(pending.session.id);
        setMessage(`Se cerró la sesión en ${pending.session.device}.`);
      } else {
        const { revoked } = await revokeOthers.mutateAsync();
        setMessage(revoked === 1 ? 'Se cerró 1 sesión.' : `Se cerraron ${revoked} sesiones.`);
      }
      setPending(null);
    } catch {
      // El diálogo muestra el error y queda abierto para reintentar.
    }
  };

  return (
    <section aria-labelledby="sesiones" className="mb-8 max-w-prose">
      <h2 id="sesiones" className="mb-2 text-lg font-bold">
        Sesiones
      </h2>
      <p className="mb-4 text-texto-2">
        Equipos donde tu cuenta está abierta. Si perdiste o prestaste uno, cierra su sesión.
      </p>

      {sessions.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : sessions.isError ? (
        <FormError
          message={
            isApiError(sessions.error) ? sessions.error.detail : 'No pudimos cargar las sesiones.'
          }
        />
      ) : (
        <ul aria-label="Sesiones abiertas" className="mb-4 flex flex-col gap-2">
          {items.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-3 rounded-panel border border-cerca bg-superficie p-4 sm:flex-row sm:items-center"
            >
              <MonitorSmartphone aria-hidden="true" className="size-6 shrink-0 text-texto-2" />
              <div className="flex flex-1 flex-col">
                <span className="font-bold">
                  {session.device}
                  {session.current ? (
                    <span className="ml-2 font-normal text-potrero">Este equipo</span>
                  ) : null}
                </span>
                <span className="text-aux text-texto-2">
                  {formatSessionStart(session.startedAt)} ·{' '}
                  {formatLastUse(session.lastUsedAt, today)}
                </span>
              </div>
              {session.current ? null : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    revoke.reset();
                    setPending({ kind: 'one', session });
                  }}
                >
                  Cerrar sesión en este equipo
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 ? (
        <Button
          variant="secondary"
          onClick={() => {
            revokeOthers.reset();
            setPending({ kind: 'others' });
          }}
        >
          Cerrar las demás sesiones
        </Button>
      ) : null}

      <div role="status" className="mt-3">
        {message === null ? null : (
          <p className="flex items-center gap-2 font-bold text-potrero">
            <CircleCheck aria-hidden="true" className="size-5" />
            {message}
          </p>
        )}
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === 'one'
            ? `¿Cerrar la sesión en ${pending.session.device}?`
            : '¿Cerrar las demás sesiones?'
        }
        description={
          pending?.kind === 'one'
            ? 'Tendrás que volver a entrar en ese equipo.'
            : `Se cierra tu sesión en ${others.length === 1 ? 'el otro equipo' : `los otros ${others.length} equipos`}; tendrás que volver a entrar en ellos. Este equipo sigue abierto.`
        }
      >
        <div className="flex flex-col gap-4">
          <FormError
            message={
              mutation.error === null
                ? null
                : isApiError(mutation.error)
                  ? mutation.error.detail
                  : 'Ocurrió un error inesperado.'
            }
          />
          <Button block disabled={mutation.isPending} onClick={() => void confirm()}>
            {mutation.isPending
              ? 'Cerrando…'
              : pending?.kind === 'one'
                ? 'Cerrar sesión'
                : 'Cerrar las demás sesiones'}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
