import {
  CATEGORY_LABEL,
  EXPENSE_FORM_TYPES,
  EXPENSE_TYPE_LABEL,
  formatCop,
  formatDate,
  isIsoDate,
  isoDateFromParts,
  isoDateParts,
  type ExpenseType,
  type SaleView,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Plus, ReceiptText, Wallet } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { SelectField } from '../../components/ui/SelectField';
import { Tabs } from '../../components/ui/Tabs';
import { TextField } from '../../components/ui/TextField';
import { isApiError } from '../../lib/api/errors';
import { useToday } from '../../lib/clock';
import { useExpenses, useExportFinanceSummary, useFinanceSummary, useSales } from './api';
import { targetText } from './ExpenseDetailPage';
import { SaleDialog } from './SaleDialog';

export type FinanceTab = 'gastos' | 'ventas' | 'reporte';

const LINK = 'font-bold text-potrero underline underline-offset-4';
const BUTTON_LINK =
  'inline-flex min-h-touch items-center justify-center gap-2 rounded-control bg-potrero px-4 font-bold text-white hover:opacity-90';

/** Desde el 1.º de enero hasta hoy, editable; la fecha final no puede ser anterior. */
function usePeriod() {
  const today = useToday();
  const [from, setFrom] = useState<string>(isoDateFromParts(isoDateParts(today).year, 1, 1));
  const [to, setTo] = useState<string>(today);
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to;
  const fields = (
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
  );
  return { from: valid ? from : today, to: valid ? to : today, valid, fields };
}

function loadError(error: unknown, what: string) {
  return <FormError message={isApiError(error) ? error.detail : `No pudimos cargar ${what}.`} />;
}

/**
 * Finanzas (ECO-01 a ECO-06), solo ADMIN: los gastos con su reparto, las ventas (se corrigen
 * aquí) y el reporte económico del período con su descarga en Excel.
 */
export function FinancePage({
  tab,
  onTabChange,
}: {
  tab: FinanceTab;
  onTabChange: (tab: FinanceTab) => void;
}) {
  return (
    <Tabs
      label="Finanzas"
      value={tab}
      onValueChange={onTabChange}
      items={[
        { value: 'gastos', label: 'Gastos', content: <ExpensesSection /> },
        { value: 'ventas', label: 'Ventas', content: <SalesSection /> },
        { value: 'reporte', label: 'Reporte', content: <ReportSection /> },
      ]}
    />
  );
}

function ExpensesSection() {
  const [type, setType] = useState<ExpenseType | ''>('');
  const [voided, setVoided] = useState(false);
  const expenses = useExpenses({ type: type === '' ? undefined : type, voided });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Link to="/finance/expenses/new" className={BUTTON_LINK}>
          <Plus aria-hidden="true" className="size-5" />
          Registrar gasto
        </Link>
        <SelectField
          label="Tipo"
          value={type}
          onChange={(event) => {
            setType(event.target.value as ExpenseType | '');
          }}
        >
          <option value="">Todos</option>
          {(['PURCHASE', ...EXPENSE_FORM_TYPES] as const).map((value) => (
            <option key={value} value={value}>
              {EXPENSE_TYPE_LABEL[value]}
            </option>
          ))}
        </SelectField>
        <label className="flex min-h-touch items-center gap-2">
          <input
            type="checkbox"
            className="size-6"
            checked={voided}
            onChange={(event) => {
              setVoided(event.target.checked);
            }}
          />
          Mostrar anulados
        </label>
      </div>
      {expenses.isPending ? <p className="text-texto-2">Cargando gastos…</p> : null}
      {expenses.isError ? loadError(expenses.error, 'los gastos') : null}
      {expenses.data === undefined ? null : (
        <DataTable
          caption="Gastos"
          rowKey={(row) => row.id}
          rows={expenses.data.items}
          empty={
            <EmptyState
              icon={Wallet}
              title="Sin gastos registrados"
              description="Registra la compra de insumos, el veterinario o la sal del lote, y mira cuánto lleva cada animal."
            />
          }
          columns={[
            {
              key: 'date',
              header: 'Fecha',
              mobile: 'secondary',
              cell: (row) => formatDate(row.date),
            },
            {
              key: 'description',
              header: 'Gasto',
              mobile: 'primary',
              cell: (row) => (
                <Link to="/finance/expenses/$id" params={{ id: row.id }} className={LINK}>
                  {row.description}
                  {row.voided ? ' (anulado)' : ''}
                </Link>
              ),
            },
            {
              key: 'type',
              header: 'Tipo',
              mobile: 'hidden',
              cell: (row) => EXPENSE_TYPE_LABEL[row.type],
            },
            {
              key: 'target',
              header: 'A quién',
              mobile: 'secondary',
              cell: (row) => targetText(row),
            },
            {
              key: 'amount',
              header: 'Monto',
              align: 'end',
              mobile: 'secondary',
              cell: (row) => formatCop(row.amount),
            },
          ]}
        />
      )}
    </div>
  );
}

function SalesSection() {
  const period = usePeriod();
  const sales = useSales(period.from, period.to);
  const [editing, setEditing] = useState<SaleView | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {period.fields}
      {sales.isPending ? <p className="text-texto-2">Cargando ventas…</p> : null}
      {sales.isError ? loadError(sales.error, 'las ventas') : null}
      {sales.data === undefined ? null : (
        <DataTable
          caption="Ventas del período"
          rowKey={(row) => row.id}
          rows={sales.data.items}
          empty={
            <EmptyState
              icon={ReceiptText}
              title="Sin ventas en este período"
              description="Las ventas se registran con la salida del animal, desde su ficha."
            />
          }
          columns={[
            {
              key: 'date',
              header: 'Fecha',
              mobile: 'secondary',
              cell: (row) => formatDate(row.date),
            },
            {
              key: 'animal',
              header: 'Animal',
              mobile: 'primary',
              cell: (row) => (
                <Link
                  to="/animals/$id"
                  params={{ id: row.animal.id }}
                  search={{ tab: 'costos' }}
                  className={LINK}
                >
                  {row.animal.code}
                  {row.animal.name === null ? '' : ` · ${row.animal.name}`}
                </Link>
              ),
            },
            {
              key: 'buyer',
              header: 'Comprador',
              mobile: 'secondary',
              cell: (row) => row.buyer ?? '—',
            },
            {
              key: 'amount',
              header: 'Precio',
              align: 'end',
              mobile: 'secondary',
              cell: (row) => formatCop(row.amount),
            },
            {
              key: 'actions',
              header: 'Acciones',
              mobile: 'secondary',
              cell: (row) => (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(row);
                  }}
                >
                  Corregir <span className="sr-only">la venta de {row.animal.code}</span>
                </Button>
              ),
            },
          ]}
        />
      )}
      {editing === null ? null : (
        <SaleDialog
          sale={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ReportSection() {
  const period = usePeriod();
  const summary = useFinanceSummary(period.from, period.to, period.valid);
  const exporter = useExportFinanceSummary();

  return (
    <div className="flex flex-col gap-5">
      {period.fields}
      <Button
        variant="secondary"
        className="self-start"
        disabled={!period.valid || exporter.isPending}
        onClick={() => {
          exporter.mutate({ from: period.from, to: period.to });
        }}
      >
        {exporter.isPending ? 'Preparando…' : 'Descargar en Excel'}
      </Button>
      {exporter.isError ? loadError(exporter.error, 'el archivo') : null}
      {summary.isPending ? <p className="text-texto-2">Cargando reporte…</p> : null}
      {summary.isError ? loadError(summary.error, 'el reporte') : null}
      {summary.data === undefined ? null : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totales del período">
            {(
              [
                ['Gastos del período', formatCop(summary.data.expenses.total)],
                ['Gastos generales', formatCop(summary.data.expenses.general)],
                ['Ventas del período', formatCop(summary.data.sales.total)],
                ['Resultado de los vendidos', formatCop(summary.data.sales.result)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-control border-2 border-cerca p-3">
                <dt className="text-texto-2">{label}</dt>
                <dd className="font-display text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="flex flex-col gap-2">
            <h2 className="text-md font-bold">
              Inversión del hato activo: {formatCop(summary.data.herd.investment)}
            </h2>
            <DataTable
              caption="Inversión por categoría"
              rowKey={(row) => row.category}
              rows={summary.data.herd.byCategory}
              columns={[
                {
                  key: 'category',
                  header: 'Categoría',
                  mobile: 'primary',
                  cell: (row) => CATEGORY_LABEL[row.category],
                },
                {
                  key: 'animals',
                  header: 'Animales',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => row.animals,
                },
                {
                  key: 'investment',
                  header: 'Inversión',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.investment),
                },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-md font-bold">Gastos por tipo</h2>
            <DataTable
              caption="Gastos del período por tipo"
              rowKey={(row) => row.type}
              rows={summary.data.expenses.byType}
              columns={[
                {
                  key: 'type',
                  header: 'Tipo',
                  mobile: 'primary',
                  cell: (row) => EXPENSE_TYPE_LABEL[row.type],
                },
                {
                  key: 'amount',
                  header: 'Monto',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.amount),
                },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-md font-bold">Animales vendidos</h2>
            <DataTable
              caption="Resultado de los animales vendidos en el período"
              rowKey={(row) => row.saleId}
              rows={summary.data.sales.items}
              empty={<p className="text-texto-2">Sin ventas en este período.</p>}
              columns={[
                {
                  key: 'animal',
                  header: 'Animal',
                  mobile: 'primary',
                  cell: (row) => (
                    <Link
                      to="/animals/$id"
                      params={{ id: row.animal.id }}
                      search={{ tab: 'costos' }}
                      className={LINK}
                    >
                      {row.animal.code}
                    </Link>
                  ),
                },
                {
                  key: 'date',
                  header: 'Fecha',
                  mobile: 'secondary',
                  cell: (row) => formatDate(row.date),
                },
                {
                  key: 'amount',
                  header: 'Venta',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.amount),
                },
                {
                  key: 'investment',
                  header: 'Inversión',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.investment),
                },
                {
                  key: 'result',
                  header: 'Resultado',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.result),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}
