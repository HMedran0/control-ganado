import { formatDate } from '@hato/shared';
import { Link } from '@tanstack/react-router';

import { useCycleProgress } from './api';

const STATE_LABEL = { CURRENT: 'En curso', CLOSED: 'Cerrado', UPCOMING: 'Por empezar' } as const;

/**
 * Avance de un ciclo oficial (SAN-06 CA2): por vacuna, cuántos se vacunaron de los que podían
 * (ADR-004: no cuentan los que llegaron a la finca después del cierre), y la vacunación por lote
 * con esa vacuna para los pendientes (CA3), que omite a los que ya la tienen en el ciclo.
 */
export function CycleProgress({ cycleId }: { cycleId: string }) {
  const progress = useCycleProgress(cycleId);
  if (progress.data === undefined) return null;
  const { cycle, state, vaccines } = progress.data;
  return (
    <section aria-labelledby="avance-ciclo" className="flex max-w-xl flex-col gap-3">
      <h2 id="avance-ciclo" className="text-md font-bold">
        Avance del ciclo {cycle.name} · {STATE_LABEL[state]}
      </h2>
      <p className="text-texto-2">
        Del {formatDate(cycle.startsOn)} al {formatDate(cycle.endsOn)}.
      </p>
      <ul className="flex flex-col gap-2">
        {vaccines.map((vaccine) => (
          <li
            key={vaccine.vaccineId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-control border-2 border-cerca p-3"
          >
            <span>
              <strong>{vaccine.name}</strong>: {vaccine.vaccinated} de {vaccine.eligible} vacunados
              · {vaccine.pending} pendientes
            </span>
            {state !== 'CLOSED' && vaccine.pending > 0 ? (
              <Link
                to="/vaccinations/bulk"
                search={{ vaccineId: vaccine.vaccineId }}
                className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
              >
                Vacunar pendientes
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
