import { formatDate, formatWeight, isIsoDate, isoDateFromParts, isoDateParts } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Baby } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { TextField } from '../../components/ui/TextField';
import { isApiError } from '../../lib/api/errors';
import { useToday } from '../../lib/clock';
import { SEX_LABEL } from '../animals/labels';
import { useBirthsReport } from './api';

const CONDITION_LABEL = { HEALTHY: 'Sana', WEAK: 'Débil' } as const;

/**
 * Reporte de nacimientos por período (NAC-01): totales por sexo, débiles y muertos al nacer
 * (CA1) y el detalle de cada cría con su madre, padre, raza, peso y estado (CA2). La madre enlaza
 * a su ficha (CA3). Por defecto, del 1.º de enero a hoy.
 */
export function BirthsReportPage() {
  const today = useToday();
  const [from, setFrom] = useState<string>(isoDateFromParts(isoDateParts(today).year, 1, 1));
  const [to, setTo] = useState<string>(today);
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to;
  const report = useBirthsReport(valid ? from : today, valid ? to : today);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-4">
        <TextField
          label="Desde"
          type="date"
          value={from}
          max={today}
          onChange={(event) => {
            setFrom(event.target.value);
          }}
        />
        <TextField
          label="Hasta"
          type="date"
          value={to}
          max={today}
          onChange={(event) => {
            setTo(event.target.value);
          }}
          error={valid ? undefined : 'La fecha final no puede ser anterior a la inicial.'}
        />
      </div>

      {report.isPending ? <p className="text-texto-2">Cargando nacimientos…</p> : null}
      {report.isError ? (
        <FormError
          message={isApiError(report.error) ? report.error.detail : 'No pudimos cargar el reporte.'}
        />
      ) : null}
      {report.data === undefined ? null : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Totales del período">
            {(
              [
                ['Nacidos vivos', report.data.totals.live],
                ['Machos', report.data.totals.males],
                ['Hembras', report.data.totals.females],
                ['Débiles', report.data.totals.weak],
                ['Muertos al nacer', report.data.totals.stillborn],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-control border-2 border-cerca p-3">
                <dt className="text-texto-2">{label}</dt>
                <dd className="font-display text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>

          {report.data.items.length === 0 ? (
            <EmptyState
              icon={Baby}
              title="No hubo nacimientos en este período"
              description="Los partos que se registren con sus crías aparecen aquí."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">Crías nacidas en el período</caption>
                <thead>
                  <tr className="border-b-2 border-cerca">
                    {['Cría', 'Sexo', 'Nacimiento', 'Madre', 'Padre', 'Raza', 'Peso', 'Estado'].map(
                      (header) => (
                        <th key={header} scope="col" className="p-2 font-bold">
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.data.items.map((item) => (
                    <tr key={item.calf.id} className="border-b border-cerca">
                      <td className="p-2">
                        <Link
                          to="/animals/$id"
                          params={{ id: item.calf.id }}
                          className="font-bold text-potrero underline underline-offset-4"
                        >
                          {item.calf.code}
                        </Link>
                      </td>
                      <td className="p-2">{SEX_LABEL[item.calf.sex]}</td>
                      <td className="p-2">{formatDate(item.birthDate)}</td>
                      <td className="p-2">
                        {item.dam === null ? (
                          '—'
                        ) : (
                          <Link
                            to="/animals/$id"
                            params={{ id: item.dam.id }}
                            className="font-bold text-potrero underline underline-offset-4"
                          >
                            {item.dam.code}
                          </Link>
                        )}
                      </td>
                      <td className="p-2">{item.sire?.code ?? item.sireExternalRef ?? '—'}</td>
                      <td className="p-2">{item.breed}</td>
                      <td className="p-2">
                        {item.birthWeightKg === null ? '—' : formatWeight(item.birthWeightKg)}
                      </td>
                      <td className="p-2">
                        {item.birthCondition === null ? '—' : CONDITION_LABEL[item.birthCondition]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.data.stillbirths.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h2 className="text-md font-bold">Muertos al nacer</h2>
              <ul className="flex flex-col gap-1">
                {report.data.stillbirths.map((row) => (
                  <li key={row.pregnancyId}>
                    {formatDate(row.date)} · madre{' '}
                    <Link
                      to="/animals/$id"
                      params={{ id: row.dam.id }}
                      className="font-bold text-potrero underline underline-offset-4"
                    >
                      {row.dam.code}
                    </Link>{' '}
                    · {row.count === 1 ? '1 cría' : `${row.count} crías`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
