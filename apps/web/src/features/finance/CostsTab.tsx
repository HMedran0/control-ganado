import {
  EXPENSE_TYPE_LABEL,
  VALUATION_METHOD_LABEL,
  formatCop,
  formatDate,
  type AnimalDetail,
  type ValuationView,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { VoidEventDialog } from '../health/VoidEventDialog';
import { useAnimalFinance, useVoidValuation } from './api';
import { SaleDialog } from './SaleDialog';
import { ValuationDialog } from './ValuationDialog';

const LINK = 'font-bold text-potrero underline underline-offset-4';
const BUTTON_LINK =
  'inline-flex min-h-touch items-center justify-center gap-2 rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-panel border border-cerca bg-superficie p-4">
      <h2 className="text-md font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** «$ 4.737 de $ 180.000 entre 38» o «Todo el gasto». */
function shareText(line: { amount: string; expenseAmount: string; animalCount: number }): string {
  return line.animalCount <= 1
    ? 'Todo el gasto'
    : `Su parte de ${formatCop(line.expenseAmount)} entre ${line.animalCount}`;
}

/**
 * Pestaña Costos de la ficha (ECO-05), solo ADMIN: inversión total y por tipo de gasto (la compra
 * es un gasto más), cada gasto que le tocó con su parte, los avalúos, la venta y el resultado
 * (RN-18): venta − inversión o, sin venta, el estimado con el último avalúo. Se carga al abrir la
 * pestaña, así no pesa en el paquete de la ficha.
 */
export default function CostsTab({ animal }: { animal: AnimalDetail }) {
  const finance = useAnimalFinance(animal.id);
  const voidValuation = useVoidValuation();
  const [valuing, setValuing] = useState(false);
  const [voiding, setVoiding] = useState<ValuationView | null>(null);
  const [correctingSale, setCorrectingSale] = useState(false);

  if (finance.isPending) return <p className="text-texto-2">Cargando costos…</p>;
  if (finance.isError) {
    return (
      <FormError
        message={isApiError(finance.error) ? finance.error.detail : 'No pudimos cargar los costos.'}
      />
    );
  }
  const data = finance.data;
  const result = data.result;
  const active = animal.status === 'ACTIVE';

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Resultado del animal">
        <div className="rounded-control border-2 border-cerca p-3">
          <dt className="text-texto-2">Inversión</dt>
          <dd className="font-display text-2xl font-bold">{formatCop(data.investment.total)}</dd>
        </div>
        <div className="rounded-control border-2 border-cerca p-3">
          <dt className="text-texto-2">{data.sale === null ? 'Último avalúo' : 'Venta'}</dt>
          <dd className="font-display text-2xl font-bold">
            {data.sale !== null
              ? formatCop(data.sale.amount)
              : data.valuations[0] === undefined
                ? '—'
                : formatCop(data.valuations[0].amount)}
          </dd>
        </div>
        <div className="rounded-control border-2 border-cerca p-3">
          <dt className="text-texto-2">
            {result === null
              ? 'Resultado'
              : result.basis === 'SALE'
                ? Number(result.amount) < 0
                  ? 'Pérdida'
                  : 'Ganancia'
                : 'Resultado estimado'}
          </dt>
          <dd className="font-display text-2xl font-bold">
            {result === null ? '—' : formatCop(result.amount)}
          </dd>
        </div>
      </dl>
      {result === null ? (
        <p className="text-texto-2">
          Sin venta ni avalúo todavía: registra un avalúo para estimar el resultado.
        </p>
      ) : null}

      <Section title="Gastos del animal">
        <Link
          to="/finance/expenses/new"
          search={{ animalId: animal.id }}
          className={`${BUTTON_LINK} self-start`}
        >
          <Plus aria-hidden="true" className="size-5" />
          Registrar gasto
        </Link>
        {data.investment.byType.length === 0 ? (
          <p className="text-texto-2">No tiene gastos registrados.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Inversión por tipo de gasto">
              {data.investment.byType.map((row) => (
                <li key={row.type}>
                  {EXPENSE_TYPE_LABEL[row.type]}: <strong>{formatCop(row.amount)}</strong>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col divide-y divide-cerca">
              {data.lines.map((line) => (
                <li
                  key={line.expenseId}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="flex flex-col">
                    <Link
                      to="/finance/expenses/$id"
                      params={{ id: line.expenseId }}
                      className={LINK}
                    >
                      {line.description}
                    </Link>
                    <span className="text-aux text-texto-2">
                      {formatDate(line.date)} · {EXPENSE_TYPE_LABEL[line.type]} · {shareText(line)}
                      {line.lot === null ? '' : ` · lote ${line.lot.name}`}
                    </span>
                  </span>
                  <strong>{formatCop(line.amount)}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Avalúos">
        {active ? (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setValuing(true);
            }}
          >
            Registrar avalúo
          </Button>
        ) : null}
        {data.valuations.length === 0 ? (
          <p className="text-texto-2">Sin avalúos.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-cerca">
            {data.valuations.map((valuation) => (
              <li
                key={valuation.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  {formatDate(valuation.date)} · {VALUATION_METHOD_LABEL[valuation.method]}
                </span>
                <span className="flex items-center gap-3">
                  <strong>{formatCop(valuation.amount)}</strong>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setVoiding(valuation);
                    }}
                  >
                    Anular{' '}
                    <span className="sr-only">el avalúo del {formatDate(valuation.date)}</span>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.sale === null ? null : (
        <Section title="Venta">
          <p>
            {formatDate(data.sale.date)} · <strong>{formatCop(data.sale.amount)}</strong>
            {data.sale.buyer === null ? '' : ` · ${data.sale.buyer}`}
          </p>
          {data.sale.notes === null ? null : <p className="text-texto-2">{data.sale.notes}</p>}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setCorrectingSale(true);
            }}
          >
            Corregir venta
          </Button>
        </Section>
      )}

      {valuing ? (
        <ValuationDialog
          animal={animal}
          onClose={() => {
            setValuing(false);
          }}
        />
      ) : null}
      {voiding === null ? null : (
        <VoidEventDialog
          title="Anular el avalúo"
          description="Deja de contar para el resultado estimado. Queda en los cambios con su motivo."
          animalId={animal.id}
          error={voidValuation.error}
          pending={voidValuation.isPending}
          onVoid={(body) => voidValuation.mutateAsync({ id: voiding.id, body })}
          onClose={() => {
            setVoiding(null);
          }}
        />
      )}
      {correctingSale && data.sale !== null ? (
        <SaleDialog
          sale={data.sale}
          onClose={() => {
            setCorrectingSale(false);
          }}
        />
      ) : null}
    </div>
  );
}
