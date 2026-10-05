import { formatDate, formatWeight, type AnimalDetail, type WeightView } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { useRequiredSession } from '../../lib/auth/context';
import { gainText } from '../animals/detail/banners';
import { VoidEventDialog } from '../health/VoidEventDialog';
import { useAnimalWeights, useVoidWeight } from './api';
import { IDENTIFIED_BY_LABEL, WEIGHT_METHOD_LABEL, WEIGHT_SOURCE_LABEL } from './labels';
import { WeightChart } from './WeightChart';

const LINK =
  'inline-flex min-h-touch items-center justify-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-cerca pb-5 last:border-b-0">
      <h2 className="text-md font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Pestaña Pesos de la ficha (PES-02, PES-05): gráfica de la evolución, ganancias diarias (entre los
 * dos últimos, en 90 días y desde el nacimiento), las alertas y la tabla de pesajes. Se carga solo
 * al abrir la pestaña (`React.lazy`): la gráfica no pesa en el paquete principal.
 */
export default function WeightsTab({ animal }: { animal: AnimalDetail }) {
  const session = useRequiredSession();
  const weights = useAnimalWeights(animal.id);
  const voidWeight = useVoidWeight(animal.id);
  const [voiding, setVoiding] = useState<WeightView | null>(null);

  if (weights.isPending) return <p className="text-texto-2">Cargando…</p>;
  if (weights.isError) {
    return (
      <FormError
        message={
          isApiError(weights.error) ? weights.error.detail : 'No pudimos cargar los pesajes.'
        }
      />
    );
  }
  const { items, summary } = weights.data;
  const valid = items.filter((item) => item.voided === null);
  const gains: [string, number | null][] = [
    ['Entre los dos últimos pesajes', summary.gains.lastTwo],
    ['En los últimos 90 días', summary.gains.last90Days],
    ['Desde el nacimiento', summary.gains.sinceBirth],
  ];
  // Quien lo registró lo anula en las 24 horas siguientes; después, el ADMIN. La API aplica el
  // límite de tiempo y, si pasó, responde con el mensaje para pedírselo al administrador.
  const canVoid = (item: WeightView) =>
    item.voided === null && (session.role === 'ADMIN' || item.createdById === session.user.id);

  return (
    <div className="flex flex-col gap-5">
      <Section title="Evolución del peso">
        {valid.length === 0 ? (
          <p className="text-texto-2">
            Todavía no hay pesajes. Registra el primero para ver la curva de crecimiento.
          </p>
        ) : (
          <WeightChart
            points={valid.map((item) => ({ id: item.id, date: item.weighedOn, kg: item.weightKg }))}
          />
        )}
        {animal.status === 'ACTIVE' ? (
          <div className="flex flex-wrap gap-2">
            <Link to="/animals/$id/weight" params={{ id: animal.id }} className={LINK}>
              Registrar peso
            </Link>
          </div>
        ) : null}
      </Section>

      <Section title="Ganancia diaria">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
          {gains.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-bold text-texto-2">{label}</dt>
              <dd className="-mt-2 sm:mt-0">{value === null ? 'Sin dato' : gainText(value)}</dd>
            </div>
          ))}
        </dl>
        {summary.lowGain ? (
          <p className="rounded-control bg-aviso-claro p-3 font-bold text-aviso-intenso">
            Ganancia baja: lo esperado para su categoría es al menos{' '}
            {gainText(summary.gainThreshold ?? 0)}.
          </p>
        ) : null}
        {summary.weightLoss && summary.lossPercent !== null ? (
          <p className="rounded-control bg-alerta-claro p-3 font-bold text-alerta-intenso">
            Perdió peso: el último pesaje bajó {String(summary.lossPercent).replace('.', ',')} %
            respecto al anterior.
          </p>
        ) : null}
        <p className="text-texto-2">
          La de 90 días usa los pesajes de esa ventana y el último anterior, si no tiene más de 180
          días; hacen falta dos pesajes separados al menos 30 días.
        </p>
      </Section>

      <Section title="Pesajes">
        {items.length === 0 ? (
          <p className="text-texto-2">Sin pesajes registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">
                Pesajes del animal, del más reciente al más antiguo
              </caption>
              <thead>
                <tr className="border-b-2 border-cerca">
                  <th scope="col" className="p-2">
                    Fecha
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Peso
                  </th>
                  <th scope="col" className="p-2">
                    Cómo
                  </th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...items].reverse().map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-cerca ${item.voided === null ? '' : 'text-texto-2 line-through'}`}
                  >
                    <td className="p-2">
                      {formatDate(item.weighedOn)}
                      {item.isBirthWeight ? ' (al nacer)' : ''}
                    </td>
                    <td className="p-2 text-right font-bold">{formatWeight(item.weightKg)}</td>
                    <td className="p-2">
                      {[
                        WEIGHT_METHOD_LABEL[item.method],
                        WEIGHT_SOURCE_LABEL[item.weightSource],
                        item.identifiedBy === null ? null : IDENTIFIED_BY_LABEL[item.identifiedBy],
                        item.voided === null ? null : `Anulado: ${item.voided.reason ?? ''}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="p-2">
                      {canVoid(item) ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setVoiding(item);
                          }}
                        >
                          Anular
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {voiding === null ? null : (
        <VoidEventDialog
          title="Anular pesaje"
          description={`${formatWeight(voiding.weightKg)} del ${formatDate(voiding.weighedOn)}. Deja de contar para la ganancia y las alertas.`}
          animalId={animal.id}
          error={voidWeight.error}
          pending={voidWeight.isPending}
          onVoid={(body) => voidWeight.mutateAsync({ id: voiding.id, body })}
          onClose={() => {
            setVoiding(null);
            voidWeight.reset();
          }}
        />
      )}
    </div>
  );
}
